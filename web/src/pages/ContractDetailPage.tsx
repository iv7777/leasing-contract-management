import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { PlusOutlined, ThunderboltOutlined, DownloadOutlined, FilePdfOutlined, UploadOutlined, LockOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useHelpTopic } from "../help/HelpContext";
import { HelpIcon } from "../help/HelpIcon";

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
interface BillingRulesDto {
  dueDay: number;
  dueMonthOffset: number;
  latePenaltyEnabled: boolean;
  latePenaltyDailyRatePermille: string | null;
  latePenaltyCapFen: number | null;
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
  escalationBase: string | null;
  escalationPercentage: string | null;
  escalationIntervalMonths: number | null;
  unit: string | null;
}
interface UsageEntryDto {
  id: number;
  pricingStreamId: number;
  serviceStart: string;
  serviceEnd: string;
  quantity: string;
  unit: string;
  source: string | null;
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
  submittedBy: number | null;
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
  reversalOfId: number | null;
}
interface DocumentDto {
  id: number;
  docType: string;
  classification: "ordinary" | "sensitive";
  mimeType: string;
  uploadedAt: string;
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
const rateBases = ["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit"] as const;
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const exportLang = i18n.language.startsWith("zh") ? "zh" : "en";
  const { user } = useAuth();

  const [contract, setContract] = useState<ContractDto | null>(null);
  const [billingRulesInfo, setBillingRulesInfo] = useState<BillingRulesDto | null>(null);
  const [units, setUnits] = useState<ContractUnitDto[]>([]);
  const [streams, setStreams] = useState<PricingStreamDto[]>([]);
  const [streamUnitLinks, setStreamUnitLinks] = useState<{ pricingStreamId: number; contractUnitId: number }[]>([]);
  const [rates, setRates] = useState<RateScheduleDto[]>([]);
  const [usageEntries, setUsageEntries] = useState<UsageEntryDto[]>([]);
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
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [activeTab, setActiveTab] = useState("units");
  useHelpTopic(`contracts.detail.${activeTab}`);

  const [docModal, setDocModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docForm] = Form.useForm();
  const [editModal, setEditModal] = useState(false);
  const [editForm] = Form.useForm();
  const [unitModal, setUnitModal] = useState(false);
  const [streamModal, setStreamModal] = useState(false);
  const [concessionModal, setConcessionModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [generateModal, setGenerateModal] = useState(false);
  const [amendmentModal, setAmendmentModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [allocateModal, setAllocateModal] = useState<{ receiptId: number } | null>(null);
  const [reverseReceiptModal, setReverseReceiptModal] = useState<{ receiptId: number } | null>(null);
  const [depositTxnModal, setDepositTxnModal] = useState(false);
  const [depositTxnType, setDepositTxnType] = useState("receipt");
  const [amendmentKind, setAmendmentKind] = useState<"rate_change" | "add_unit" | "add_pricing_stream" | "terminate">("rate_change");
  const [amendmentStreamTargetType, setAmendmentStreamTargetType] = useState("unit");
  const [rejectAmendmentModal, setRejectAmendmentModal] = useState<{ amendmentId: number } | null>(null);
  const [reverseDepositTxnModal, setReverseDepositTxnModal] = useState<{ depositTxnId: number } | null>(null);
  const [latePenaltyModal, setLatePenaltyModal] = useState(false);
  const [latePenaltyEnabled, setLatePenaltyEnabled] = useState(false);
  const [editUnitModal, setEditUnitModal] = useState<ContractUnitDto | null>(null);
  const [editStreamModal, setEditStreamModal] = useState<PricingStreamDto | null>(null);
  const [rateModal, setRateModal] = useState<{ streamId: number; rate?: RateScheduleDto } | null>(null);
  const [usageEntryModal, setUsageEntryModal] = useState(false);
  const [editUsageEntryModal, setEditUsageEntryModal] = useState<UsageEntryDto | null>(null);
  const [editConcessionModal, setEditConcessionModal] = useState<ConcessionDto | null>(null);
  const [editDepositModal, setEditDepositModal] = useState<DepositTermsDto | null>(null);
  const [editDocModal, setEditDocModal] = useState<DocumentDto | null>(null);
  const [unitForm] = Form.useForm();
  const [streamForm] = Form.useForm();
  const [concessionForm] = Form.useForm();
  const [depositForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [amendmentForm] = Form.useForm();
  const [receiptForm] = Form.useForm();
  const [allocateForm] = Form.useForm();
  const [reverseReceiptForm] = Form.useForm();
  const [depositTxnForm] = Form.useForm();
  const [rejectAmendmentForm] = Form.useForm();
  const [reverseDepositTxnForm] = Form.useForm();
  const [latePenaltyForm] = Form.useForm();
  const [editUnitForm] = Form.useForm();
  const [editStreamForm] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [usageEntryForm] = Form.useForm();
  const [editUsageEntryForm] = Form.useForm();
  const [editConcessionForm] = Form.useForm();
  const [editDepositForm] = Form.useForm();
  const [editDocForm] = Form.useForm();

  const load = () => {
    void api.get<any>(`/contracts/${id}`).then((r) => {
      setContract(r.contract);
      setBillingRulesInfo(r.billingRules);
      setUnits(r.units);
      setStreams(r.pricingStreams);
      setStreamUnitLinks(r.pricingStreamUnits);
      setRates(r.rateSchedule);
      setConcessions(r.concessions);
      setDepositTerms(r.depositTerms);
    });
    void api.get<{ usageEntries: UsageEntryDto[] }>(`/contracts/${id}/usage-entries`).then((r) => setUsageEntries(r.usageEntries));
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
    void api.get<{ documents: DocumentDto[] }>(`/documents?ownerType=contract&ownerId=${id}`).then((r) => setDocuments(r.documents));
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
  const canManageUsage = user?.role === "admin" || user?.role === "manager";
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
      const { effectiveStart, calculationMethod, amountOrRate, rateBasis, unit, contractUnitIds, ...rest } = values;
      await api.post(`/contracts/${id}/pricing-streams`, {
        ...rest,
        contractUnitIds,
        initialRate: { effectiveStart, calculationMethod, amountOrRate: String(amountOrRate), rateBasis, unit },
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

  const onEditContractUnit = async () => {
    if (!editUnitModal) return;
    try {
      const values = await editUnitForm.validateFields();
      await api.patch(`/contracts/${id}/units/${editUnitModal.id}`, values);
      setEditUnitModal(null);
      editUnitForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteContractUnit = async (contractUnitId: number) => {
    try {
      await api.delete(`/contracts/${id}/units/${contractUnitId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditStream = async () => {
    if (!editStreamModal) return;
    try {
      const values = await editStreamForm.validateFields();
      await api.patch(`/contracts/${id}/pricing-streams/${editStreamModal.id}`, values);
      setEditStreamModal(null);
      editStreamForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteStream = async (streamId: number) => {
    try {
      await api.delete(`/contracts/${id}/pricing-streams/${streamId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSaveRate = async () => {
    if (!rateModal) return;
    try {
      const values = await rateForm.validateFields();
      const payload = { ...values, amountOrRate: String(values.amountOrRate) };
      if (rateModal.rate) {
        await api.patch(`/contracts/${id}/pricing-streams/${rateModal.streamId}/rate-schedule/${rateModal.rate.id}`, payload);
      } else {
        await api.post(`/contracts/${id}/pricing-streams/${rateModal.streamId}/rate-schedule`, payload);
      }
      setRateModal(null);
      rateForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteRate = async (streamId: number, rateId: number) => {
    try {
      await api.delete(`/contracts/${id}/pricing-streams/${streamId}/rate-schedule/${rateId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddUsageEntry = async () => {
    try {
      const values = await usageEntryForm.validateFields();
      await api.post(`/contracts/${id}/usage-entries`, { ...values, quantity: String(values.quantity) });
      setUsageEntryModal(false);
      usageEntryForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditUsageEntry = async () => {
    if (!editUsageEntryModal) return;
    try {
      const values = await editUsageEntryForm.validateFields();
      await api.patch(`/usage-entries/${editUsageEntryModal.id}`, { ...values, quantity: String(values.quantity) });
      setEditUsageEntryModal(null);
      editUsageEntryForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteUsageEntry = async (usageEntryId: number) => {
    try {
      await api.delete(`/usage-entries/${usageEntryId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditConcession = async () => {
    if (!editConcessionModal) return;
    try {
      const values = await editConcessionForm.validateFields();
      await api.patch(`/contracts/${id}/concessions/${editConcessionModal.id}`, { ...values, discountPercentage: String(values.discountPercentage) });
      setEditConcessionModal(null);
      editConcessionForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteConcession = async (concessionId: number) => {
    try {
      await api.delete(`/contracts/${id}/concessions/${concessionId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditDepositTerms = async () => {
    if (!editDepositModal) return;
    try {
      const { depositAmountYuan, ...values } = await editDepositForm.validateFields();
      await api.patch(`/contracts/${id}/deposit-terms/${editDepositModal.id}`, {
        ...values,
        fixedAmountFen: depositAmountYuan !== undefined ? Math.round(depositAmountYuan * 100) : undefined,
      });
      setEditDepositModal(null);
      editDepositForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteDepositTerms = async (depositTermId: number) => {
    try {
      await api.delete(`/contracts/${id}/deposit-terms/${depositTermId}`);
      message.success(t("common.deleted"));
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

  const onUploadDocument = async () => {
    if (!pendingFile || uploadingDoc) return;
    setUploadingDoc(true);
    try {
      const values = await docForm.validateFields();
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("ownerType", "contract");
      formData.append("ownerId", id!);
      formData.append("docType", values.docType);
      formData.append("classification", values.classification);
      await api.post("/documents", formData);
      setDocModal(false);
      docForm.resetFields();
      setPendingFile(null);
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setUploadingDoc(false);
    }
  };

  const downloadDocument = async (docId: number) => {
    const res = await fetch(`/api/documents/${docId}/download`, { credentials: "include" });
    if (!res.ok) {
      message.error(t("common.error"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const onEditDocument = async () => {
    if (!editDocModal) return;
    try {
      const values = await editDocForm.validateFields();
      await api.patch(`/documents/${editDocModal.id}`, values);
      setEditDocModal(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const deleteDocument = async (docId: number) => {
    try {
      await api.delete(`/documents/${docId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const onEditContract = async () => {
    try {
      const { dueDay, dueMonthOffset, ...contractValues } = await editForm.validateFields();
      await Promise.all([
        api.patch(`/contracts/${id}`, contractValues),
        api.patch(`/contracts/${id}/billing-rules`, { dueDay, dueMonthOffset }),
      ]);
      setEditModal(false);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSaveLatePenalty = async () => {
    try {
      const values = await latePenaltyForm.validateFields();
      await api.patch(`/contracts/${id}/late-penalty-rules`, {
        ...values,
        latePenaltyDailyRatePermille: values.latePenaltyDailyRatePermille !== undefined ? String(values.latePenaltyDailyRatePermille) : undefined,
        latePenaltyCapFen: values.latePenaltyCapFen !== undefined ? Math.round(values.latePenaltyCapFen * 100) : undefined,
      });
      setLatePenaltyModal(false);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteContract = () => {
    Modal.confirm({
      title: t("contracts.deleteContract"),
      content: t("contracts.deleteContractConfirm"),
      okText: t("common.confirm"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await api.delete(`/contracts/${id}`);
          message.success(t("contracts.deleteContract"));
          window.location.href = "/contracts";
        } catch (err) {
          handleError(err);
        }
      },
    });
  };

  const onProposeAmendment = async () => {
    try {
      const values = await amendmentForm.validateFields();
      let changes: Record<string, unknown> = {};
      if (amendmentKind === "rate_change" && values.newAmountOrRate) {
        changes = {
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
        };
      } else if (amendmentKind === "add_unit") {
        changes = {
          addUnits: [
            {
              unitId: values.amendUnitId,
              effectiveStart: values.effectiveDate,
              contractedAreaSqm: String(values.amendContractedAreaSqm),
            },
          ],
        };
      } else if (amendmentKind === "add_pricing_stream") {
        changes = {
          addPricingStreams: [
            {
              feeType: values.amendStreamFeeType,
              targetType: values.amendStreamTargetType,
              label: values.amendStreamLabel || undefined,
              contractUnitIds: values.amendStreamTargetType === "unit" ? values.amendStreamContractUnitIds ?? [] : [],
              initialRate: {
                effectiveStart: values.effectiveDate,
                calculationMethod: values.amendStreamCalculationMethod,
                amountOrRate: String(values.amendStreamAmountOrRate),
                rateBasis: values.amendStreamRateBasis,
              },
            },
          ],
        };
      } else if (amendmentKind === "terminate") {
        changes = {
          contract: { status: "terminated", termEnd: values.effectiveDate },
          endUnits: units.filter((u) => !u.effectiveEnd || u.effectiveEnd > values.effectiveDate).map((u) => ({ contractUnitId: u.id, effectiveEnd: values.effectiveDate })),
        };
      }
      await api.post(`/contracts/${id}/amendments`, {
        type: values.type,
        reason: values.reason,
        effectiveDate: values.effectiveDate,
        changes,
        supportingDocumentId: values.supportingDocumentId || undefined,
      });
      setAmendmentModal(false);
      amendmentForm.resetFields();
      setAmendmentKind("rate_change");
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

  const onReverseReceipt = async () => {
    if (!reverseReceiptModal) return;
    try {
      const values = await reverseReceiptForm.validateFields();
      await api.post(`/receipts/${reverseReceiptModal.receiptId}/reverse`, values);
      setReverseReceiptModal(null);
      reverseReceiptForm.resetFields();
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
  const withdrawAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/withdraw`);
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const onRejectAmendment = async () => {
    if (!rejectAmendmentModal) return;
    try {
      const values = await rejectAmendmentForm.validateFields();
      await api.post(`/amendments/${rejectAmendmentModal.amendmentId}/reject`, values);
      setRejectAmendmentModal(null);
      rejectAmendmentForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const onReverseDepositTxn = async () => {
    if (!reverseDepositTxnModal) return;
    try {
      const values = await reverseDepositTxnForm.validateFields();
      await api.post(`/deposit-transactions/${reverseDepositTxnModal.depositTxnId}/reverse`, values);
      setReverseDepositTxnModal(null);
      reverseDepositTxnForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div>
      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <Typography.Title level={4} style={{ margin: 0, flexShrink: 0 }}>
          {contract.referenceNumber}
        </Typography.Title>
        <Space wrap>
          <Tag>{t(`contracts.${contract.status}`)}</Tag>
          <Tag>v{contract.versionNumber}</Tag>
          {(user?.canDownloadPdf || user?.role === "admin" || user?.role === "manager") && (
            <Button icon={<FilePdfOutlined />} onClick={() => window.open(`/api/contracts/${id}/pdf-summary?lang=${exportLang}`, "_blank")}>
              {t("contracts.exportPdf")}
            </Button>
          )}
          {(user?.canPrint || user?.role === "admin" || user?.role === "manager") && (
            <Button icon={<DownloadOutlined />} onClick={() => window.open(`/api/contracts/${id}/ledger.csv?lang=${exportLang}`, "_blank")}>
              {t("contracts.exportCsv")}
            </Button>
          )}
          {isDraft && user?.role === "admin" && (
            <Button icon={<ThunderboltOutlined />} onClick={onActivate}>
              {t("contracts.activate")}
            </Button>
          )}
          {canEdit && (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editForm.setFieldsValue({ ...contract, dueDay: billingRulesInfo?.dueDay, dueMonthOffset: billingRulesInfo?.dueMonthOffset });
                setEditModal(true);
              }}
            >
              {t("contracts.editContract")}
            </Button>
          )}
          {canEdit && (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                latePenaltyForm.setFieldsValue({
                  ...billingRulesInfo,
                  latePenaltyCapFen: billingRulesInfo?.latePenaltyCapFen != null ? billingRulesInfo.latePenaltyCapFen / 100 : undefined,
                });
                setLatePenaltyEnabled(billingRulesInfo?.latePenaltyEnabled ?? false);
                setLatePenaltyModal(true);
              }}
            >
              {t("contracts.latePenaltyRules")}
            </Button>
          )}
          {isDraft && user?.role === "admin" && (
            <Button danger icon={<DeleteOutlined />} onClick={onDeleteContract}>
              {t("contracts.deleteContract")}
            </Button>
          )}
        </Space>
      </Space>
      {isDraft && <Alert type="info" showIcon message={t("contracts.activateHint")} style={{ marginBottom: 12 }} />}
      {!isDraft && <Alert type="info" showIcon message={t("contracts.documentRequired")} style={{ marginBottom: 12 }} />}

      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t("contracts.landlord")}>
          <Link to={`/parties?highlight=${contract.landlordPartyId}`}>{partyName(contract.landlordPartyId)}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={t("contracts.tenant")}>
          <Link to={`/parties?highlight=${contract.tenantPartyId}`}>{partyName(contract.tenantPartyId)}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={t("contracts.termStart")}>{contract.termStart}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.termEnd")}>{contract.termEnd}</Descriptions.Item>
      </Descriptions>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
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
                  renderItem={(u) => {
                    const au = availableUnits.find((x) => x.id === u.unitId);
                    return (
                      <List.Item
                        actions={
                          canEdit
                            ? [
                                <Button
                                  key="edit"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editUnitForm.setFieldsValue(u);
                                    setEditUnitModal(u);
                                  }}
                                />,
                                <Popconfirm
                                  key="delete"
                                  title={t("contracts.confirmDeleteUnit")}
                                  onConfirm={() => onDeleteContractUnit(u.id)}
                                  okText={t("common.delete")}
                                  cancelText={t("common.cancel")}
                                >
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>,
                              ]
                            : []
                        }
                      >
                        {au ? <Link to={`/properties/${au.propertyId}`}>{au.unitLabel}</Link> : u.unitId} · {u.contractedAreaSqm} sqm ·{" "}
                        {u.effectiveStart}
                        {u.effectiveEnd ? ` → ${u.effectiveEnd}` : ""}
                      </List.Item>
                    );
                  }}
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
                        return (
                          <>
                            {active.map((r) => (
                              <div key={r.id}>
                                {t(`contracts.${camel(r.calculationMethod)}`)} — {r.amountOrRate} ({t(`contracts.${camel(r.rateBasis)}`)}
                                {r.unit ? ` / ${r.unit}` : ""}) [{r.effectiveStart}
                                {r.effectiveEnd ? ` → ${r.effectiveEnd}` : ""}]
                                {canEdit && (
                                  <>
                                    {" "}
                                    <Button
                                      type="link"
                                      size="small"
                                      icon={<EditOutlined />}
                                      onClick={() => {
                                        rateForm.setFieldsValue(r);
                                        setRateModal({ streamId: s.id, rate: r });
                                      }}
                                    />
                                    <Popconfirm
                                      title={t("contracts.confirmDeleteRateTier")}
                                      onConfirm={() => onDeleteRate(s.id, r.id)}
                                      okText={t("common.delete")}
                                      cancelText={t("common.cancel")}
                                    >
                                      <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                  </>
                                )}
                              </div>
                            ))}
                            {canEdit && (
                              <Button
                                type="link"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={() => setRateModal({ streamId: s.id })}
                              >
                                {t("contracts.addRateTier")}
                              </Button>
                            )}
                          </>
                        );
                      },
                    },
                    ...(canEdit
                      ? [
                          {
                            title: t("common.actions"),
                            key: "actions",
                            render: (_: unknown, s: PricingStreamDto) => (
                              <Space>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editStreamForm.setFieldsValue({
                                      ...s,
                                      contractUnitIds: streamUnitLinks.filter((l) => l.pricingStreamId === s.id).map((l) => l.contractUnitId),
                                    });
                                    setEditStreamModal(s);
                                  }}
                                />
                                <Popconfirm
                                  title={t("contracts.confirmDeleteStream")}
                                  onConfirm={() => onDeleteStream(s.id)}
                                  okText={t("common.delete")}
                                  cancelText={t("common.cancel")}
                                >
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            ),
          },
          {
            key: "usage",
            label: t("contracts.usageEntries"),
            children: (() => {
              const meteredStreams = streams.filter((s) => rates.some((r) => r.pricingStreamId === s.id && r.calculationMethod === "metered"));
              const streamLabel = (streamId: number) => {
                const s = streams.find((x) => x.id === streamId);
                return s ? s.label ?? t(`contracts.${camel(s.feeType)}`) : streamId;
              };
              return (
                <>
                  {canManageUsage && (
                    <Button
                      icon={<PlusOutlined />}
                      disabled={meteredStreams.length === 0}
                      onClick={() => setUsageEntryModal(true)}
                      style={{ marginBottom: 12 }}
                    >
                      {t("contracts.addUsageEntry")}
                    </Button>
                  )}
                  {canManageUsage && meteredStreams.length === 0 && (
                    <Typography.Paragraph type="secondary">{t("contracts.usageEntryNoMeteredStreams")}</Typography.Paragraph>
                  )}
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={usageEntries}
                    pagination={false}
                    columns={[
                      { title: t("contracts.usageEntryStream"), key: "stream", render: (_: unknown, u: UsageEntryDto) => streamLabel(u.pricingStreamId) },
                      { title: t("contracts.serviceStart"), dataIndex: "serviceStart" },
                      { title: t("contracts.serviceEnd"), dataIndex: "serviceEnd" },
                      { title: t("contracts.usageEntryQuantity"), key: "quantity", render: (_: unknown, u: UsageEntryDto) => `${u.quantity} ${u.unit}` },
                      { title: t("contracts.usageEntrySource"), dataIndex: "source" },
                      ...(canManageUsage
                        ? [
                            {
                              title: t("common.actions"),
                              key: "actions",
                              render: (_: unknown, u: UsageEntryDto) => (
                                <Space>
                                  <Button
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => {
                                      editUsageEntryForm.setFieldsValue(u);
                                      setEditUsageEntryModal(u);
                                    }}
                                  />
                                  <Popconfirm
                                    title={t("contracts.confirmDeleteUsageEntry")}
                                    onConfirm={() => onDeleteUsageEntry(u.id)}
                                    okText={t("common.delete")}
                                    cancelText={t("common.cancel")}
                                  >
                                    <Button size="small" danger icon={<DeleteOutlined />} />
                                  </Popconfirm>
                                </Space>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </>
              );
            })(),
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
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Button
                                key="edit"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editConcessionForm.setFieldsValue(c);
                                  setEditConcessionModal(c);
                                }}
                              />,
                              <Popconfirm
                                key="delete"
                                title={t("contracts.confirmDeleteConcession")}
                                onConfirm={() => onDeleteConcession(c.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
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
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Button
                                key="edit"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editDepositForm.setFieldsValue({
                                    ...d,
                                    depositAmountYuan: d.fixedAmountFen != null ? d.fixedAmountFen / 100 : undefined,
                                  });
                                  setEditDepositModal(d);
                                }}
                              />,
                              <Popconfirm
                                key="delete"
                                title={t("contracts.confirmDeleteDepositTerms")}
                                onConfirm={() => onDeleteDepositTerms(d.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
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
                    {
                      title: t("common.actions"),
                      key: "actions",
                      render: (_: unknown, txn: DepositTransactionDto) => {
                        const isReversed = depositTxns.some((t) => t.reversalOfId === txn.id);
                        if (isReversed) return <Tag color="red">{t("contracts.reversed")}</Tag>;
                        if (txn.transactionType === "reversal") return null;
                        return (
                          user?.role === "admin" && (
                            <Button size="small" danger onClick={() => setReverseDepositTxnModal({ depositTxnId: txn.id })}>
                              {t("contracts.reverse")}
                            </Button>
                          )
                        );
                      },
                    },
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
                    { title: t("common.actions"), dataIndex: "status", render: (s: string) => (s === "reversed" ? <Tag color="red">{s}</Tag> : <Tag>{s}</Tag>) },
                    {
                      title: "",
                      key: "action",
                      render: (_: unknown, r: ReceiptDto) =>
                        r.status === "posted" && (
                          <Space>
                            {(receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0) > 0 && (
                              <Button size="small" onClick={() => setAllocateModal({ receiptId: r.id })}>
                                {t("contracts.allocate")}
                              </Button>
                            )}
                            {user?.role === "admin" && (
                              <Button size="small" danger onClick={() => setReverseReceiptModal({ receiptId: r.id })}>
                                {t("contracts.reverse")}
                              </Button>
                            )}
                          </Space>
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
                        a.status === "pending" && user?.role === "admin" && (
                          <Button key="reject" size="small" danger onClick={() => setRejectAmendmentModal({ amendmentId: a.id })}>
                            {t("contracts.reject")}
                          </Button>
                        ),
                        (a.status === "draft" || a.status === "pending") && (user?.role === "admin" || a.submittedBy === user?.id) && (
                          <Button key="withdraw" size="small" onClick={() => withdrawAmendment(a.id)}>
                            {t("contracts.withdraw")}
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
          {
            key: "documents",
            label: t("contracts.documents"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<UploadOutlined />} onClick={() => setDocModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.uploadDocument")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={documents}
                  renderItem={(d) => (
                    <List.Item
                      actions={[
                        <Button key="dl" type="link" icon={<DownloadOutlined />} onClick={() => downloadDocument(d.id)}>
                          {t("properties.download")}
                        </Button>,
                        ...(user?.role === "admin" || user?.role === "manager"
                          ? [
                              <Button
                                key="edit"
                                type="link"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editDocForm.setFieldsValue(d);
                                  setEditDocModal(d);
                                }}
                              />,
                            ]
                          : []),
                        ...(user?.role === "admin"
                          ? [
                              <Popconfirm
                                key="del"
                                title={t("properties.confirmDeleteDocument")}
                                onConfirm={() => deleteDocument(d.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button type="link" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []),
                      ]}
                    >
                      <Space>
                        {d.classification === "sensitive" && <LockOutlined />}
                        <Typography.Text>{d.docType === "signed_lease" ? t("contracts.signedLease") : d.docType}</Typography.Text>
                        {d.classification === "sensitive" && <Tag color="orange">{t("properties.sensitive")}</Tag>}
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={t("contracts.uploadDocument")}
        open={docModal}
        onCancel={() => setDocModal(false)}
        onOk={onUploadDocument}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        confirmLoading={uploadingDoc}
        okButtonProps={{ disabled: !pendingFile || uploadingDoc }}
        cancelButtonProps={{ disabled: uploadingDoc }}
        closable={!uploadingDoc}
        maskClosable={!uploadingDoc}
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label="File" required>
            <Upload
              disabled={uploadingDoc}
              beforeUpload={(file) => {
                setPendingFile(file);
                return false;
              }}
              maxCount={1}
              accept="image/*,.pdf"
            >
              <Button icon={<UploadOutlined />}>Select file</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="docType" label={t("properties.docType")} rules={[{ required: true }]} initialValue="signed_lease">
            <Select
              options={[
                { value: "signed_lease", label: t("contracts.signedLease") },
                { value: "other", label: t("contracts.otherDocumentType") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="classification"
            label={
              <>
                {t("properties.classification")} <HelpIcon field="documentClassification" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="ordinary"
          >
            <Select
              options={[
                { value: "ordinary", label: t("properties.ordinary") },
                { value: "sensitive", label: t("properties.sensitive") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editDocModal}
        onCancel={() => setEditDocModal(null)}
        onOk={onEditDocument}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editDocForm} layout="vertical">
          <Form.Item name="docType" label={t("properties.docType")} rules={[{ required: true }]}>
            <Select
              options={[
                { value: "signed_lease", label: t("contracts.signedLease") },
                { value: "other", label: t("contracts.otherDocumentType") },
              ]}
            />
          </Form.Item>
          <Form.Item name="classification" label={t("properties.classification")} rules={[{ required: true }]}>
            <Select
              options={[
                { value: "ordinary", label: t("properties.ordinary") },
                { value: "sensitive", label: t("properties.sensitive") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.editContract")}
        open={editModal}
        onCancel={() => setEditModal(false)}
        onOk={onEditContract}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="referenceNumber" label={t("contracts.reference")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="landlordPartyId" label={t("contracts.landlord")} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="tenantPartyId" label={t("contracts.tenant")} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="termStart" label={t("contracts.termStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="termEnd" label={t("contracts.termEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="renewalNoticeDays" label={t("contracts.renewalNoticeDays")}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="dueDay" label={t("contracts.dueDay")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} max={31} />
          </Form.Item>
          <Form.Item
            name="dueMonthOffset"
            label={
              <>
                {t("contracts.dueMonthOffset")} <HelpIcon field="dueMonthOffset" />
              </>
            }
          >
            <InputNumber style={{ width: "100%" }} min={-3} max={3} />
          </Form.Item>
          <Form.Item name="specialTerms" label={t("contracts.specialTerms")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.latePenaltyRules")}
        open={latePenaltyModal}
        onCancel={() => setLatePenaltyModal(false)}
        onOk={onSaveLatePenalty}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form
          form={latePenaltyForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.latePenaltyEnabled !== undefined) setLatePenaltyEnabled(v.latePenaltyEnabled);
          }}
        >
          <Form.Item name="latePenaltyEnabled" label={t("contracts.latePenaltyEnabled")} valuePropName="checked">
            <Switch />
          </Form.Item>
          {(latePenaltyEnabled || billingRulesInfo?.latePenaltyEnabled) && (
            <>
              <Form.Item name="latePenaltyDailyRatePermille" label={t("contracts.latePenaltyDailyRate")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} step={0.1} />
              </Form.Item>
              <Form.Item name="latePenaltyCapFen" label={t("contracts.latePenaltyCap")}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

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

      <Modal
        title={t("common.edit")}
        open={!!editUnitModal}
        onCancel={() => setEditUnitModal(null)}
        onOk={onEditContractUnit}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editUnitForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.termEnd")}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="contractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="notes" label={t("contracts.reason")}>
            <Input.TextArea rows={2} />
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
          <Form.Item
            name="contractUnitIds"
            label={
              <>
                {t("contracts.units")} <HelpIcon field="pricingTargetUnits" />
              </>
            }
            rules={[{ required: true }]}
          >
            <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
          </Form.Item>
          <Form.Item
            name="calculationMethod"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="calculationMethod" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="flat"
          >
            <Select
              options={[
                { value: "flat", label: t("contracts.flat") },
                { value: "per_sqm", label: t("contracts.perSqm") },
                { value: "percentage_escalation", label: t("contracts.percentageEscalation") },
                { value: "metered", label: t("contracts.metered") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="rateBasis"
            label={
              <>
                {t("contracts.rateBasis")} <HelpIcon field="rateBasis" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="per_month"
          >
            <Select options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
          </Form.Item>
          <Form.Item name="amountOrRate" label={t("contracts.amountOrRate")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.calculationMethod !== cur.calculationMethod}>
            {() =>
              streamForm.getFieldValue("calculationMethod") === "metered" && (
                <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
                  <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editStreamModal}
        onCancel={() => setEditStreamModal(null)}
        onOk={onEditStream}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
        width={560}
      >
        <Form form={editStreamForm} layout="vertical">
          <Form.Item name="feeType" label={t("contracts.feeType")} rules={[{ required: true }]}>
            <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
          </Form.Item>
          <Form.Item name="label" label={t("common.name")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="contractUnitIds"
            label={
              <>
                {t("contracts.units")} <HelpIcon field="pricingTargetUnits" />
              </>
            }
          >
            <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={rateModal?.rate ? t("common.edit") : t("contracts.addRateTier")}
        open={!!rateModal}
        onCancel={() => setRateModal(null)}
        onOk={onSaveRate}
        okText={rateModal?.rate ? t("common.save") : t("common.create")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={rateForm} layout="vertical">
          <Form.Item
            name="calculationMethod"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="calculationMethod" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="flat"
          >
            <Select
              options={[
                { value: "flat", label: t("contracts.flat") },
                { value: "per_sqm", label: t("contracts.perSqm") },
                { value: "percentage_escalation", label: t("contracts.percentageEscalation") },
                { value: "metered", label: t("contracts.metered") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="rateBasis"
            label={
              <>
                {t("contracts.rateBasis")} <HelpIcon field="rateBasis" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="per_month"
          >
            <Select options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
          </Form.Item>
          <Form.Item name="amountOrRate" label={t("contracts.amountOrRate")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.calculationMethod !== cur.calculationMethod}>
            {() =>
              rateForm.getFieldValue("calculationMethod") === "metered" && (
                <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
                  <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.termEnd")}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.addUsageEntry")}
        open={usageEntryModal}
        onCancel={() => setUsageEntryModal(false)}
        onOk={onAddUsageEntry}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={usageEntryForm} layout="vertical">
          <Form.Item name="pricingStreamId" label={t("contracts.usageEntryStream")} rules={[{ required: true }]}>
            <Select
              options={streams
                .filter((s) => rates.some((r) => r.pricingStreamId === s.id && r.calculationMethod === "metered"))
                .map((s) => ({ value: s.id, label: s.label ?? t(`contracts.${camel(s.feeType)}`) }))}
            />
          </Form.Item>
          <Form.Item name="serviceStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="serviceEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="quantity" label={t("contracts.usageEntryQuantity")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
            <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
          </Form.Item>
          <Form.Item name="source" label={t("contracts.usageEntrySource")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editUsageEntryModal}
        onCancel={() => setEditUsageEntryModal(null)}
        onOk={onEditUsageEntry}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editUsageEntryForm} layout="vertical">
          <Form.Item name="serviceStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="serviceEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="quantity" label={t("contracts.usageEntryQuantity")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
            <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
          </Form.Item>
          <Form.Item name="source" label={t("contracts.usageEntrySource")}>
            <Input />
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
          <Form.Item
            name="discountPercentage"
            label={
              <>
                {t("contracts.discountPercentage")} <HelpIcon field="concessionDiscount" />
              </>
            }
            rules={[{ required: true }]}
            initialValue={100}
          >
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editConcessionModal}
        onCancel={() => setEditConcessionModal(null)}
        onOk={onEditConcession}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editConcessionForm} layout="vertical">
          <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
            <Select allowClear placeholder="All streams" options={streams.map((s) => ({ value: s.id, label: s.label ?? s.feeType }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            name="discountPercentage"
            label={
              <>
                {t("contracts.discountPercentage")} <HelpIcon field="concessionDiscount" />
              </>
            }
            rules={[{ required: true }]}
          >
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
          <Form.Item
            name="requirementType"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="depositRequirementType" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="fixed"
          >
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

      <Modal
        title={t("common.edit")}
        open={!!editDepositModal}
        onCancel={() => setEditDepositModal(null)}
        onOk={onEditDepositTerms}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editDepositForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            name="requirementType"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="depositRequirementType" />
              </>
            }
            rules={[{ required: true }]}
          >
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
        title={t("contracts.reverse")}
        open={!!reverseReceiptModal}
        onCancel={() => setReverseReceiptModal(null)}
        onOk={onReverseReceipt}
        okText={t("contracts.reverse")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={reverseReceiptForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reversalReason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="e.g. check bounced" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.reject")}
        open={!!rejectAmendmentModal}
        onCancel={() => setRejectAmendmentModal(null)}
        onOk={onRejectAmendment}
        okText={t("contracts.reject")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={rejectAmendmentForm} layout="vertical">
          <Form.Item name="reviewReason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.reverse")}
        open={!!reverseDepositTxnModal}
        onCancel={() => setReverseDepositTxnModal(null)}
        onOk={onReverseDepositTxn}
        okText={t("contracts.reverse")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={reverseDepositTxnForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reversalReason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
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
          <Form.Item
            name="transactionType"
            label={
              <>
                {t("contracts.transactionType")} <HelpIcon field="depositTxnType" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="receipt"
          >
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

      <Modal
        title={t("contracts.proposeAmendment")}
        open={amendmentModal}
        onCancel={() => {
          setAmendmentModal(false);
          setAmendmentKind("rate_change");
        }}
        onOk={onProposeAmendment}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        width={560}
      >
        <Form
          form={amendmentForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.amendmentKind) setAmendmentKind(v.amendmentKind);
            if (v.amendStreamTargetType) setAmendmentStreamTargetType(v.amendStreamTargetType);
          }}
        >
          <Form.Item
            name="type"
            label={
              <>
                {t("common.name")} <HelpIcon field="amendmentType" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="rent_change"
          >
            <Input />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="effectiveDate" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            name="supportingDocumentId"
            label={t("contracts.supportingDocument")}
            extra={t("contracts.supportingDocumentHint")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={documents.map((d) => ({
                value: d.id,
                label: `${d.docType === "signed_lease" ? t("contracts.signedLease") : d.docType} (${d.uploadedAt.slice(0, 10)})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="amendmentKind" label={t("contracts.amendmentKind")} initialValue="rate_change">
            <Select
              options={[
                { value: "rate_change", label: t("contracts.amendmentKindRateChange") },
                { value: "add_unit", label: t("contracts.amendmentKindAddUnit") },
                { value: "add_pricing_stream", label: t("contracts.amendmentKindAddPricingStream") },
                { value: "terminate", label: t("contracts.amendmentKindTerminate") },
              ]}
            />
          </Form.Item>

          {amendmentKind === "rate_change" && (
            <>
              <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
                <Select allowClear options={streams.map((s) => ({ value: s.id, label: s.label ?? s.feeType }))} />
              </Form.Item>
              <Form.Item name="newAmountOrRate" label={t("contracts.newAmountOrRate")}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </>
          )}

          {amendmentKind === "add_unit" && (
            <>
              <Form.Item name="amendUnitId" label={t("properties.unitLabel")} rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={availableUnits.map((u) => ({ value: u.id, label: u.unitLabel }))} />
              </Form.Item>
              <Form.Item name="amendContractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Typography.Text type="secondary">{t("contracts.amendAddUnitHint")}</Typography.Text>
            </>
          )}

          {amendmentKind === "add_pricing_stream" && (
            <>
              <Form.Item name="amendStreamFeeType" label={t("contracts.feeType")} rules={[{ required: true }]} initialValue="rent">
                <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
              </Form.Item>
              <Form.Item name="amendStreamTargetType" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="unit">
                <Select
                  options={[
                    { value: "unit", label: t("contracts.units") },
                    { value: "contract", label: t("contracts.title") },
                  ]}
                />
              </Form.Item>
              <Form.Item name="amendStreamLabel" label={t("common.name")}>
                <Input />
              </Form.Item>
              {amendmentStreamTargetType === "unit" && (
                <Form.Item name="amendStreamContractUnitIds" label={t("contracts.units")} rules={[{ required: true }]}>
                  <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
                </Form.Item>
              )}
              <Form.Item name="amendStreamCalculationMethod" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="flat">
                <Select
                  options={[
                    { value: "flat", label: t("contracts.flat") },
                    { value: "per_sqm", label: t("contracts.perSqm") },
                    { value: "percentage_escalation", label: t("contracts.percentageEscalation") },
                  ]}
                />
              </Form.Item>
              <Form.Item name="amendStreamRateBasis" label={t("contracts.rateBasis")} rules={[{ required: true }]} initialValue="per_month">
                <Select options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
              </Form.Item>
              <Form.Item name="amendStreamAmountOrRate" label={t("contracts.amountOrRate")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Typography.Text type="secondary">{t("contracts.amendAddStreamHint")}</Typography.Text>
            </>
          )}

          {amendmentKind === "terminate" && <Typography.Text type="secondary">{t("contracts.amendTerminateHint")}</Typography.Text>}
        </Form>
      </Modal>
    </div>
  );
}
