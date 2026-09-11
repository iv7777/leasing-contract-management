import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ContractDto {
  id: number;
  referenceNumber: string;
  landlordPartyId: number;
  tenantPartyId: number;
  termStart: string;
  termEnd: string;
  status: "draft" | "active" | "expired" | "terminated";
  versionNumber: number;
  specialTerms: string | null;
}
interface ContractUnitDto {
  id: number;
  unitId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  contractedAreaSqm: string;
}
interface PricingStreamDto {
  id: number;
  feeType: string;
  targetType: string;
  label: string | null;
}
interface RateScheduleDto {
  id: number;
  pricingStreamId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  calculationMethod: string;
  amountOrRate: string;
  rateBasis: string;
}
interface ConcessionDto {
  id: number;
  pricingStreamId: number | null;
  effectiveStart: string;
  effectiveEnd: string;
  discountPercentage: string;
  reason: string | null;
}
interface DepositTermsDto {
  id: number;
  effectiveStart: string;
  requirementType: string;
  fixedAmountFen: number | null;
  formulaBasis: string | null;
}
interface ChargeDto {
  id: number;
  pricingStreamId: number;
  feeType: string;
  serviceStart: string;
  serviceEnd: string;
  dueDate: string;
  amountFen: number;
}
interface AmendmentDto {
  id: number;
  type: string;
  reason: string;
  effectiveDate: string;
  status: "draft" | "pending" | "approved" | "rejected" | "withdrawn";
  baseContractVersion: number;
  supportingDocumentId: number | null;
}
interface ChargeBalanceDto {
  chargeId: number;
  billedFen: number;
  adjustedFen: number;
  allocatedFen: number;
  balanceFen: number;
  isOverdue: boolean;
  daysOverdue: number;
}
interface ReceiptDto {
  id: number;
  receivedDate: string;
  amountFen: number;
  paymentMethod: string;
  externalReference: string | null;
  status: "posted" | "reversed";
}
interface ReceiptBalanceDto {
  receiptId: number;
  unallocatedFen: number;
}
interface DepositTransactionDto {
  id: number;
  transactionType: string;
  amountFen: number;
  transactionDate: string;
  reason: string;
}
interface StatementDto {
  periodStart: string;
  periodEnd: string;
  openingReceivableFen: number;
  newChargesFen: number;
  adjustmentsFen: number;
  receiptsAppliedFen: number;
  closingReceivableFen: number;
  unallocatedReceiptsFen: number;
  depositBalanceFen: number;
}
const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

const feeTypes = ["rent", "management", "electricity_base", "water", "elevator", "other"] as const;
const rateBases = ["per_month", "per_quarter", "per_year", "per_sqm_per_month"] as const;
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [contract, setContract] = useState<ContractDto | null>(null);
  const [units, setUnits] = useState<ContractUnitDto[]>([]);
  const [streams, setStreams] = useState<PricingStreamDto[]>([]);
  const [rates, setRates] = useState<RateScheduleDto[]>([]);
  const [concessions, setConcessions] = useState<ConcessionDto[]>([]);
  const [depositTerms, setDepositTerms] = useState<DepositTermsDto[]>([]);
  const [charges, setCharges] = useState<ChargeDto[]>([]);
  const [chargeBalances, setChargeBalances] = useState<ChargeBalanceDto[]>([]);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [receiptBalances, setReceiptBalances] = useState<ReceiptBalanceDto[]>([]);
  const [depositTxns, setDepositTxns] = useState<DepositTransactionDto[]>([]);
  const [depositBalanceFen, setDepositBalanceFen] = useState(0);
  const [statement, setStatement] = useState<StatementDto | null>(null);
  const [statementPeriod, setStatementPeriod] = useState("");
  const [amendments, setAmendments] = useState<AmendmentDto[]>([]);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [availableUnits, setAvailableUnits] = useState<{ id: number; unitLabel: string; propertyId: number }[]>([]);

  const [unitModal, setUnitModal] = useState(false);
  const [streamModal, setStreamModal] = useState(false);
  const [concessionModal, setConcessionModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [generateModal, setGenerateModal] = useState(false);
  const [amendmentModal, setAmendmentModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [allocateModal, setAllocateModal] = useState<{ receiptId: number } | null>(null);
  const [depositTxnModal, setDepositTxnModal] = useState(false);
  const [depositTxnType, setDepositTxnType] = useState("receipt");
  const [unitForm] = Form.useForm();
  const [streamForm] = Form.useForm();
  const [concessionForm] = Form.useForm();
  const [depositForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [amendmentForm] = Form.useForm();
  const [receiptForm] = Form.useForm();
  const [allocateForm] = Form.useForm();
  const [depositTxnForm] = Form.useForm();

  const load = () => {
    void api.get<any>(`/contracts/${id}`).then((r) => {
      setContract(r.contract);
      setUnits(r.units);
      setStreams(r.pricingStreams);
      setRates(r.rateSchedule);
      setConcessions(r.concessions);
      setDepositTerms(r.depositTerms);
    });
    void api.get<{ charges: ChargeDto[] }>(`/contracts/${id}/charges`).then((r) => setCharges(r.charges));
    void api
      .get<{ chargeBalances: ChargeBalanceDto[]; receipts: ReceiptDto[]; receiptBalances: ReceiptBalanceDto[] }>(`/contracts/${id}/ledger`)
      .then((r) => {
        setChargeBalances(r.chargeBalances);
        setReceipts(r.receipts);
        setReceiptBalances(r.receiptBalances);
      });
    void api
      .get<{ transactions: DepositTransactionDto[]; balanceFen: number }>(`/contracts/${id}/deposit-transactions`)
      .then((r) => {
        setDepositTxns(r.transactions);
        setDepositBalanceFen(r.balanceFen);
      });
    void api.get<{ amendments: AmendmentDto[] }>(`/contracts/${id}/amendments`).then((r) => setAmendments(r.amendments));
    void api.get<{ parties: PartyDto[] }>("/parties").then((r) => setParties(r.parties));
    void api.get<{ properties: { id: number }[] }>("/properties").then(async (r) => {
      const allUnits = await Promise.all(
        r.properties.map((p) => api.get<{ units: { id: number; unitLabel: string }[] }>(`/properties/${p.id}`).then((u) => u.units.map((x) => ({ ...x, propertyId: p.id })))),
      );
      setAvailableUnits(allUnits.flat());
    });
  };

  useEffect(load, [id]);

  if (!contract) return <Typography.Text>{t("common.loading")}</Typography.Text>;

  const isDraft = contract.status === "draft";
  const canEdit = (user?.role === "admin" || user?.role === "manager") && isDraft;
  const canPropose = user?.role === "admin" || user?.role === "manager";
  const partyName = (pid: number) => parties.find((p) => p.id === pid)?.name ?? pid;

  const handleError = (err: unknown) => {
    message.error(err instanceof ApiError ? err.message : t("common.error"));
  };

  const onAddUnit = async () => {
    try {
      const values = await unitForm.validateFields();
      await api.post(`/contracts/${id}/units`, values);
      setUnitModal(false);
      unitForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddStream = async () => {
    try {
      const values = await streamForm.validateFields();
      const { effectiveStart, calculationMethod, amountOrRate, rateBasis, contractUnitIds, ...rest } = values;
      await api.post(`/contracts/${id}/pricing-streams`, {
        ...rest,
        contractUnitIds,
        initialRate: { effectiveStart, calculationMethod, amountOrRate: String(amountOrRate), rateBasis },
      });
      setStreamModal(false);
      streamForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddConcession = async () => {
    try {
      const values = await concessionForm.validateFields();
      await api.post(`/contracts/${id}/concessions`, { ...values, discountPercentage: String(values.discountPercentage) });
      setConcessionModal(false);
      concessionForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSetDeposit = async () => {
    try {
      const { depositAmountYuan, ...values } = await depositForm.validateFields();
      await api.post(`/contracts/${id}/deposit-terms`, {
        ...values,
        fixedAmountFen: depositAmountYuan !== undefined ? Math.round(depositAmountYuan * 100) : undefined,
      });
      setDepositModal(false);
      depositForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onGenerate = async () => {
    try {
      const values = await generateForm.validateFields();
      const result = await api.post<{ created: number; skippedExisting: number }>(`/contracts/${id}/generate-charges`, values);
      message.success(`${result.created} created, ${result.skippedExisting} already existed`);
      setGenerateModal(false);
      generateForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onActivate = async () => {
    try {
      await api.post(`/contracts/${id}/activate`);
      message.success(t("contracts.activate"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onProposeAmendment = async () => {
    try {
      const values = await amendmentForm.validateFields();
      const rateChange = values.newAmountOrRate
        ? {
            addRateSchedule: [
              {
                pricingStreamId: values.pricingStreamId,
                closePreviousRateScheduleId: rates.filter((r) => r.pricingStreamId === values.pricingStreamId && !r.effectiveEnd)[0]?.id,
                effectiveStart: values.effectiveDate,
                calculationMethod: rates.find((r) => r.pricingStreamId === values.pricingStreamId)?.calculationMethod ?? "flat",
                amountOrRate: String(values.newAmountOrRate),
                rateBasis: rates.find((r) => r.pricingStreamId === values.pricingStreamId)?.rateBasis ?? "per_month",
              },
            ],
          }
        : {};
      await api.post(`/contracts/${id}/amendments`, {
        type: values.type,
        reason: values.reason,
        effectiveDate: values.effectiveDate,
        changes: rateChange,
      });
      setAmendmentModal(false);
      amendmentForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onRecordReceipt = async () => {
    try {
      const values = await receiptForm.validateFields();
      await api.post(`/contracts/${id}/receipts`, { ...values, amountFen: Math.round(values.amountFen * 100) });
      setReceiptModal(false);
      receiptForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAllocate = async () => {
    if (!allocateModal) return;
    try {
      const values = await allocateForm.validateFields();
      await api.post(`/receipts/${allocateModal.receiptId}/allocate`, { chargeId: values.chargeId, amountFen: Math.round(values.amountFen * 100) });
      setAllocateModal(null);
      allocateForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onRecordDepositTxn = async () => {
    try {
      const values = await depositTxnForm.validateFields();
      await api.post(`/contracts/${id}/deposit-transactions`, { ...values, amountFen: Math.round(values.amountFen * 100) });
      setDepositTxnModal(false);
      depositTxnForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onViewStatement = async () => {
    try {
      const r = await api.get<{ statement: StatementDto }>(`/contracts/${id}/statement?period=${statementPeriod}`);
      setStatement(r.statement);
    } catch (err) {
      handleError(err);
    }
  };

  const submitAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/submit`);
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const approveAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/approve`);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {contract.referenceNumber}
        </Typography.Title>
        <Space>
          <Tag>{t(`contracts.${contract.status}`)}</Tag>
          <Tag>v{contract.versionNumber}</Tag>
          {isDraft && user?.role === "admin" && (
            <Button icon={<ThunderboltOutlined />} onClick={onActivate}>
              {t("contracts.activate")}
            </Button>
          )}
        </Space>
      </Space>
      {isDraft && <Alert type="info" showIcon message={t("contracts.activateHint")} style={{ marginBottom: 12 }} />}
      {!isDraft && <Alert type="info" showIcon message={t("contracts.documentRequired")} style={{ marginBottom: 12 }} />}

      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t("contracts.landlord")}>{partyName(contract.landlordPartyId)}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.tenant")}>{partyName(contract.tenantPartyId)}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.termStart")}>{contract.termStart}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.termEnd")}>{contract.termEnd}</Descriptions.Item>
      </Descriptions>

      <Tabs
        items={[
          {
            key: "units",
            label: t("contracts.units"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setUnitModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addUnit")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={units}
                  renderItem={(u) => (
                    <List.Item>
                      {availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId} · {u.contractedAreaSqm} sqm · {u.effectiveStart}
                      {u.effectiveEnd ? ` → ${u.effectiveEnd}` : ""}
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: "pricing",
            label: t("contracts.pricingStreams"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setStreamModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addPricingStream")}
                  </Button>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={streams}
                  pagination={false}
                  columns={[
                    { title: t("contracts.feeType"), dataIndex: "feeType", render: (v: string) => t(`contracts.${camel(v)}`) },
                    { title: t("common.name"), dataIndex: "label" },
                    {
                      title: t("contracts.calculationMethod"),
                      key: "method",
                      render: (_: unknown, s: PricingStreamDto) => {
                        const active = rates.filter((r) => r.pricingStreamId === s.id);
                        return active.map((r) => (
                          <div key={r.id}>
                            {t(`contracts.${camel(r.calculationMethod)}`)} — {r.amountOrRate} ({t(`contracts.${camel(r.rateBasis)}`)}) [{r.effectiveStart}
                            {r.effectiveEnd ? ` → ${r.effectiveEnd}` : ""}]
                          </div>
                        ));
                      },
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "concessions",
            label: t("contracts.concessions"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setConcessionModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addConcession")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={concessions}
                  renderItem={(c) => (
                    <List.Item>
                      {c.discountPercentage}% · {c.effectiveStart} → {c.effectiveEnd} · {c.reason}
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: "deposit",
            label: t("contracts.depositTerms"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setDepositModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addDepositTerms")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={depositTerms}
                  style={{ marginBottom: 16 }}
                  renderItem={(d) => (
                    <List.Item>
                      {d.requirementType === "fixed" ? yuan(d.fixedAmountFen ?? 0) : d.formulaBasis} · {t("common.active")}: {d.effectiveStart}
                    </List.Item>
                  )}
                />

                <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                  <Typography.Text strong>
                    {t("contracts.depositBalance")}: {yuan(depositBalanceFen)}
                  </Typography.Text>
                  {(user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && (
                    <Button icon={<PlusOutlined />} onClick={() => setDepositTxnModal(true)}>
                      {t("contracts.recordDepositTxn")}
                    </Button>
                  )}
                </Space>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={depositTxns}
                  columns={[
                    { title: t("contracts.transactionDate"), dataIndex: "transactionDate" },
                    { title: t("contracts.transactionType"), dataIndex: "transactionType" },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    { title: t("contracts.reason"), dataIndex: "reason" },
                  ]}
                />
              </>
            ),
          },
          {
            key: "statement",
            label: t("contracts.statement"),
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Input placeholder="2026-04" value={statementPeriod} onChange={(e) => setStatementPeriod(e.target.value)} style={{ width: 140 }} />
                  <Button type="primary" onClick={onViewStatement}>
                    {t("contracts.viewStatement")}
                  </Button>
                </Space>
                {statement && (
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label={t("contracts.openingReceivable")}>{yuan(statement.openingReceivableFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.newCharges")}>{yuan(statement.newChargesFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.adjustments")}>{yuan(statement.adjustmentsFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.receiptsApplied")}>{yuan(statement.receiptsAppliedFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.closingReceivable")}>
                      <Typography.Text strong>{yuan(statement.closingReceivableFen)}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t("contracts.unallocatedReceipts")}>{yuan(statement.unallocatedReceiptsFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.depositBalance")}>{yuan(statement.depositBalanceFen)}</Descriptions.Item>
                  </Descriptions>
                )}
              </>
            ),
          },
          {
            key: "receipts",
            label: t("contracts.receipts"),
            children: (
              <>
                {(user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && (
                  <Button icon={<PlusOutlined />} onClick={() => setReceiptModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.recordReceipt")}
                  </Button>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={receipts}
                  columns={[
                    { title: t("contracts.receivedDate"), dataIndex: "receivedDate" },
                    { title: t("contracts.paymentMethod"), dataIndex: "paymentMethod" },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    {
                      title: t("contracts.unallocated"),
                      key: "unallocated",
                      render: (_: unknown, r: ReceiptDto) => yuan(receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0),
                    },
                    { title: t("common.actions"), dataIndex: "status", render: (s: string) => s === "posted" && <Tag>{s}</Tag> },
                    {
                      title: "",
                      key: "action",
                      render: (_: unknown, r: ReceiptDto) =>
                        (receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0) > 0 && (
                          <Button size="small" onClick={() => setAllocateModal({ receiptId: r.id })}>
                            {t("contracts.allocate")}
                          </Button>
                        ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "charges",
            label: t("contracts.charges"),
            children: (
              <>
                {(user?.role === "admin" || user?.role === "manager") && (
                  <Button icon={<PlusOutlined />} onClick={() => setGenerateModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.generateCharges")}
                  </Button>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={charges}
                  columns={[
                    { title: t("contracts.feeType"), dataIndex: "feeType", render: (v: string) => t(`contracts.${camel(v)}`) },
                    { title: t("contracts.serviceStart"), dataIndex: "serviceStart" },
                    { title: t("contracts.serviceEnd"), dataIndex: "serviceEnd" },
                    { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    {
                      title: t("contracts.balance"),
                      key: "balance",
                      render: (_: unknown, c: ChargeDto) => {
                        const b = chargeBalances.find((x) => x.chargeId === c.id);
                        if (!b) return null;
                        return (
                          <Space>
                            {yuan(b.balanceFen)}
                            {b.isOverdue && <Tag color="red">{t("contracts.overdueDays", { days: b.daysOverdue })}</Tag>}
                          </Space>
                        );
                      },
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "amendments",
            label: t("contracts.amendments"),
            children: (
              <>
                {canPropose && (
                  <Button icon={<PlusOutlined />} onClick={() => setAmendmentModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.proposeAmendment")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={amendments}
                  renderItem={(a) => (
                    <List.Item
                      actions={[
                        a.status === "draft" && (
                          <Button key="submit" size="small" onClick={() => submitAmendment(a.id)}>
                            {t("contracts.submit")}
                          </Button>
                        ),
                        a.status === "pending" && user?.role === "admin" && (
                          <Button key="approve" size="small" type="primary" onClick={() => approveAmendment(a.id)}>
                            {t("contracts.approve")}
                          </Button>
                        ),
                      ].filter(Boolean)}
                    >
                      <Space direction="vertical" size={0}>
                        <span>
                          <Tag>{a.type}</Tag> {a.reason}
                        </span>
                        <Typography.Text type="secondary">
                          {t("contracts.effectiveDate")}: {a.effectiveDate} · {t(`contracts.${a.status}`)}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
        ]}
      />

      <Modal title={t("contracts.addUnit")} open={unitModal} onCancel={() => setUnitModal(false)} onOk={onAddUnit} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={unitForm} layout="vertical">
          <Form.Item name="unitId" label={t("properties.unitLabel")} rules={[{ required: true }]}>
            <Select options={availableUnits.map((u) => ({ value: u.id, label: u.unitLabel }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="contractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addPricingStream")} open={streamModal} onCancel={() => setStreamModal(false)} onOk={onAddStream} okText={t("common.create")} cancelText={t("common.cancel")} width={560}>
        <Form form={streamForm} layout="vertical">
          <Form.Item name="feeType" label={t("contracts.feeType")} rules={[{ required: true }]} initialValue="rent">
            <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
          </Form.Item>
          <Form.Item name="targetType" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="unit" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="label" label={t("common.name")}>
            <Input />
          </Form.Item>
          <Form.Item name="contractUnitIds" label={t("contracts.units")} rules={[{ required: true }]}>
            <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
          </Form.Item>
          <Form.Item name="calculationMethod" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="flat">
            <Select
              options={[
                { value: "flat", label: t("contracts.flat") },
                { value: "per_sqm", label: t("contracts.perSqm") },
                { value: "percentage_escalation", label: t("contracts.percentageEscalation") },
              ]}
            />
          </Form.Item>
          <Form.Item name="rateBasis" label={t("contracts.rateBasis")} rules={[{ required: true }]} initialValue="per_month">
            <Select options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
          </Form.Item>
          <Form.Item name="amountOrRate" label={t("contracts.amountOrRate")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addConcession")} open={concessionModal} onCancel={() => setConcessionModal(false)} onOk={onAddConcession} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={concessionForm} layout="vertical">
          <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
            <Select allowClear placeholder="All streams" options={streams.map((s) => ({ value: s.id, label: s.label ?? s.feeType }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="discountPercentage" label={t("contracts.discountPercentage")} rules={[{ required: true }]} initialValue={100}>
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addDepositTerms")} open={depositModal} onCancel={() => setDepositModal(false)} onOk={onSetDeposit} okText={t("common.save")} cancelText={t("common.cancel")}>
        <Form form={depositForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="requirementType" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="fixed">
            <Select
              options={[
                { value: "fixed", label: t("contracts.fixedAmount") },
                { value: "formula", label: "Formula" },
              ]}
            />
          </Form.Item>
          <Form.Item name="depositAmountYuan" label={t("contracts.fixedAmount")} tooltip="Enter yuan; stored as fen">
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="formulaBasis" label="Formula basis">
            <Input placeholder="e.g. 2x monthly rent" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.generateCharges")} open={generateModal} onCancel={() => setGenerateModal(false)} onOk={onGenerate} okText={t("contracts.generateCharges")} cancelText={t("common.cancel")}>
        <Form form={generateForm} layout="vertical">
          <Form.Item name="period" label={t("contracts.period")} rules={[{ required: true, pattern: /^\d{4}-\d{2}$/ }]}>
            <Input placeholder="2026-04" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.recordReceipt")} open={receiptModal} onCancel={() => setReceiptModal(false)} onOk={onRecordReceipt} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={receiptForm} layout="vertical">
          <Form.Item name="receivedDate" label={t("contracts.receivedDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="amountFen" label={`${t("contracts.amount")} (yuan)`} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="paymentMethod" label={t("contracts.paymentMethod")} rules={[{ required: true }]} initialValue="bank_transfer">
            <Input />
          </Form.Item>
          <Form.Item name="externalReference" label={t("contracts.externalReference")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.allocateTo")}
        open={!!allocateModal}
        onCancel={() => setAllocateModal(null)}
        onOk={onAllocate}
        okText={t("contracts.allocate")}
        cancelText={t("common.cancel")}
      >
        <Form form={allocateForm} layout="vertical">
          <Form.Item name="chargeId" label={t("contracts.charges")} rules={[{ required: true }]}>
            <Select
              options={charges.map((c) => {
                const b = chargeBalances.find((x) => x.chargeId === c.id);
                return { value: c.id, label: `${t(`contracts.${camel(c.feeType)}`)} ${c.serviceStart} — ${b ? yuan(b.balanceFen) : ""}` };
              })}
            />
          </Form.Item>
          <Form.Item name="amountFen" label={`${t("contracts.amount")} (yuan)`} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.recordDepositTxn")}
        open={depositTxnModal}
        onCancel={() => setDepositTxnModal(false)}
        onOk={onRecordDepositTxn}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={depositTxnForm} layout="vertical" onValuesChange={(v) => v.transactionType && setDepositTxnType(v.transactionType)}>
          <Form.Item name="transactionType" label={t("contracts.transactionType")} rules={[{ required: true }]} initialValue="receipt">
            <Select
              options={[
                { value: "receipt", label: t("contracts.depositReceipt") },
                ...(user?.role === "admin"
                  ? [
                      { value: "refund", label: t("contracts.refund") },
                      { value: "deduction", label: t("contracts.deduction") },
                      { value: "transfer_to_rent", label: t("contracts.transferToRent") },
                    ]
                  : []),
              ]}
            />
          </Form.Item>
          <Form.Item name="transactionDate" label={t("contracts.transactionDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="amountFen" label={`${t("contracts.amount")} (yuan)`} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          {depositTxnType === "transfer_to_rent" && (
            <Form.Item name="chargeId" label={t("contracts.charges")} rules={[{ required: true }]}>
              <Select options={charges.map((c) => ({ value: c.id, label: `${t(`contracts.${camel(c.feeType)}`)} ${c.serviceStart}` }))} />
            </Form.Item>
          )}
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.proposeAmendment")} open={amendmentModal} onCancel={() => setAmendmentModal(false)} onOk={onProposeAmendment} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={amendmentForm} layout="vertical">
          <Form.Item name="type" label={t("common.name")} rules={[{ required: true }]} initialValue="rent_change">
            <Input />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="effectiveDate" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
            <Select allowClear options={streams.map((s) => ({ value: s.id, label: s.label ?? s.feeType }))} />
          </Form.Item>
          <Form.Item name="newAmountOrRate" label={`New ${t("contracts.amountOrRate")}`}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
