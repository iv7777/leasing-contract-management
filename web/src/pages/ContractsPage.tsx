import { saveContractOrder } from "../lib/contractNav";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Button, Form, Grid, Input, InputNumber, List, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography, Card, message } from "antd";
import { PlusOutlined, DownloadOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";
import { useAuth } from "../auth/AuthContext";
import { HelpIcon } from "../help/HelpIcon";
import DateField from "../components/DateField";
import { useOverdueSummary } from "../components/billing/useOverdueSummary";
import { yuan } from "../components/billing/format";

interface ContractDto {
  id: number;
  referenceNumber: string;
  landlordPartyId: number;
  tenantPartyId: number;
  termStart: string;
  termEnd: string;
  status: "draft" | "active" | "expired" | "terminated";
  versionNumber: number;
  archived: boolean;
  unitLabels: string[];
}

const statusColor: Record<ContractDto["status"], string> = {
  draft: "default",
  active: "green",
  expired: "orange",
  terminated: "red",
};

export default function ContractsPage() {
  const { t, i18n } = useTranslation();
  const exportLang = i18n.language.startsWith("zh") ? "zh" : "en";
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterPartyId = Number(searchParams.get("partyId")) || null;
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const wide = !!screens.xl;

  const [contracts, setContracts] = useState<ContractDto[]>([]);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { byContract: overdueByContract } = useOverdueSummary();

  const overdueTag = (id: number, compact = false) => {
    const o = overdueByContract.get(id);
    if (!o) return null;
    return (
      <Tooltip title={t("billing.overdueTip", { count: o.overdueCount, amount: yuan(o.overdueFen), days: o.maxDaysOverdue })}>
        <Tag color="red" style={compact ? { display: "block", width: "fit-content", maxWidth: "100%", marginTop: 4, whiteSpace: "normal" } : undefined}>
          {t("billing.overdueTag", { amount: yuan(o.overdueFen), days: o.maxDaysOverdue })}
        </Tag>
      </Tooltip>
    );
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ contracts: ContractDto[] }>("/contracts").then((r) => setContracts(r.contracts)),
      api.get<{ parties: PartyDto[] }>("/parties").then((r) => setParties(r.parties)),
    ]).finally(() => setLoading(false));
  };

  useEffect(load, []);

  // A new contract usually has the same landlord as the latest one.
  useEffect(() => {
    if (!modalOpen || contracts.length === 0) return;
    const latest = contracts.reduce((a, b) => (b.id > a.id ? b : a));
    form.setFieldsValue({ landlordPartyId: latest.landlordPartyId });
  }, [modalOpen]);

  const partyName = (id: number) => parties.find((p) => p.id === id)?.name ?? id;
  const partyLink = (id: number, role: "tenants" | "landlords" = "tenants") => (
    <Link to={`/${role}?highlight=${id}`} onClick={(e) => e.stopPropagation()}>
      {partyName(id)}
    </Link>
  );

  const visibleContracts = contracts
    .filter((c) => showArchived || !c.archived)
    .filter((c) => !filterPartyId || c.landlordPartyId === filterPartyId || c.tenantPartyId === filterPartyId);

  const onCreate = async () => {
    const values = await form.validateFields();
    const { dueDay, dueMonthOffset, overdueGraceDays, ...contractFields } = values;
    await api.post("/contracts", { ...contractFields, billingRules: { dueDay, dueMonthOffset: dueMonthOffset ?? 0, overdueGraceDays: overdueGraceDays ?? 5 } });
    setModalOpen(false);
    form.resetFields();
    load();
  };

  const canCreate = user?.role === "admin" || user?.role === "manager";

  // Admin: pick which drafts to activate. Each is checked first, so the list shows which are ready and why the others aren't.
  const drafts = visibleContracts.filter((c) => c.status === "draft");
  type DraftCheck = { id: number; referenceNumber: string; ok: boolean; error?: { code: string; message: string; details?: unknown } };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [checks, setChecks] = useState<DraftCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [activating, setActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<DraftCheck[] | null>(null);
  const failedActivations = (activationResult ?? []).filter((x) => !x.ok);
  const readyChecks = checks.filter((c) => c.ok);

  const openPicker = async () => {
    setPicked([]); // nothing is chosen until the Admin chooses
    setPickerOpen(true);
    setChecking(true);
    try {
      const r = await api.post<{ contracts: DraftCheck[] }>("/contracts/activation-check");
      const shown = new Set(drafts.map((c) => c.id));
      setChecks(r.contracts.filter((c) => shown.has(c.id)));
    } catch (err) {
      message.error(apiErrorMessage(err, t));
      setPickerOpen(false);
    } finally {
      setChecking(false);
    }
  };

  const activateSelected = async () => {
    setActivating(true);
    try {
      const r = await api.post<{ results: DraftCheck[] }>("/contracts/activate-all", { contractIds: picked });
      setPickerOpen(false);
      setActivationResult(r.results);
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    } finally {
      setActivating(false);
      load();
    }
  };

  const reasonText = (c: DraftCheck) => (c.error ? apiErrorMessage(new ApiError(c.error.code, c.error.message, 409, c.error.details), t) : "");
  const contractOf = (id: number) => contracts.find((c) => c.id === id);

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("contracts.title")}
        </Typography.Title>
        <Space wrap>
          <Space size={4}>
            <Switch size="small" checked={showArchived} onChange={setShowArchived} />
            <Typography.Text type="secondary">{t("common.showArchived")}</Typography.Text>
          </Space>
          <Button icon={<DownloadOutlined />} onClick={() => window.open(`/api/contracts.csv?lang=${exportLang}`, "_blank")}>
            {t("contracts.exportCsv")}
          </Button>
          {user?.role === "admin" && (
            <Button icon={<CheckCircleOutlined />} disabled={drafts.length === 0} onClick={() => void openPicker()}>
              {t("contracts.activateAll", { count: drafts.length })}
            </Button>
          )}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              {t("contracts.addContract")}
            </Button>
          )}
        </Space>
      </Space>

      <Space style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t("contracts.filterBy")}:</Typography.Text>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t("contracts.allParties")}
          style={{ minWidth: 220 }}
          value={filterPartyId ?? undefined}
          options={parties.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(val) => navigate(val ? `/contracts?partyId=${val}` : "/contracts")}
        />
      </Space>

      {filterPartyId && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => navigate("/contracts")}
          style={{ marginBottom: 16 }}
          message={
            <>
              {t("contracts.filteredByParty", { name: partyName(filterPartyId) })} · <Link to="/contracts">{t("contracts.clearFilter")}</Link>
            </>
          }
        />
      )}

      {isMobile ? (
        <List
          loading={loading}
          dataSource={visibleContracts}
          renderItem={(c) => (
            <Card style={{ marginBottom: 12 }} onClick={() => { saveContractOrder(visibleContracts.map((x) => x.id)); navigate(`/contracts/${c.id}`); }}>
              <Typography.Text strong>{c.referenceNumber}</Typography.Text> <Tag color={statusColor[c.status]}>{t(`contracts.${c.status}`)}</Tag>
              {c.archived && <Tag>{t("common.archived")}</Tag>}
              {overdueTag(c.id)}
              <br />
              <Typography.Text type="secondary">
                {partyLink(c.tenantPartyId)} · {c.termStart} → {c.termEnd}
              </Typography.Text>
              {c.unitLabels.length > 0 && (
                <>
                  <br />
                  <Typography.Text type="secondary">{c.unitLabels.join(", ")}</Typography.Text>
                </>
              )}
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleContracts}
          onRow={(c) => ({ onClick: () => { saveContractOrder(visibleContracts.map((x) => x.id)); navigate(`/contracts/${c.id}`); }, style: { cursor: "pointer" } })}
          // Like Tenants & Landlords: compact rows, text columns that wrap instead of
          // pushing the table wider, and a narrow-screen layout (a phone held sideways
          // still gets this table) that folds the two dates into one column and puts
          // the overdue tag under the status.
          size={wide ? "middle" : "small"}
          columns={[
            { title: t("contracts.reference"), dataIndex: "referenceNumber", render: (v: string) => <div style={{ minWidth: wide ? undefined : 70, wordBreak: "break-all" }}>{v}</div> },
            { title: t("contracts.tenant"), dataIndex: "tenantPartyId", render: (id: number) => <div style={{ minWidth: wide ? undefined : 70, wordBreak: "break-all" }}>{partyLink(id)}</div> },
            {
              title: t("contracts.units"),
              dataIndex: "unitLabels",
              render: (labels: string[]) => <div style={{ minWidth: wide ? undefined : 50, wordBreak: "break-all" }}>{labels.join(", ") || "—"}</div>,
            },
            ...(wide
              ? [
                  { title: t("contracts.termStart"), dataIndex: "termStart" },
                  { title: t("contracts.termEnd"), dataIndex: "termEnd" },
                ]
              : [
                  {
                    title: t("contracts.termStart") + " / " + t("contracts.termEnd"),
                    key: "term",
                    width: 96,
                    render: (_: unknown, c: ContractDto) => (
                      <>
                        {c.termStart}
                        <br />
                        {c.termEnd}
                      </>
                    ),
                  },
                ]),
            {
              title: t("contracts.status"),
              dataIndex: "status",
              width: wide ? undefined : 100,
              render: (s: ContractDto["status"], c: ContractDto) => (
                <>
                  <Tag color={statusColor[s]}>{t(`contracts.${s}`)}</Tag>
                  {c.archived && <Tag>{t("common.archived")}</Tag>}
                  {!wide && overdueTag(c.id, true)}
                </>
              ),
            },
            ...(wide ? [{ title: t("billing.overdueColumn"), key: "overdue", render: (_: unknown, c: ContractDto) => overdueTag(c.id) }] : []),
            { title: t("contracts.version"), dataIndex: "versionNumber", width: wide ? undefined : 56 },
          ]}
        />
      )}

      <Modal
        open={pickerOpen}
        title={t("contracts.pickTitle")}
        width={760}
        onCancel={() => setPickerOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setPickerOpen(false)}>{t("common.cancel")}</Button>
            <Button type="primary" disabled={picked.length === 0} loading={activating} onClick={() => void activateSelected()}>
              {t("contracts.activateSelected", { count: picked.length })}
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">{t("contracts.pickHelp")}</Typography.Paragraph>
        <Space style={{ marginBottom: 8 }} wrap>
          <Button size="small" onClick={() => setPicked(readyChecks.map((c) => c.id))} disabled={readyChecks.length === 0}>
            {t("contracts.pickAll", { count: readyChecks.length })}
          </Button>
          <Button size="small" onClick={() => setPicked([])} disabled={picked.length === 0}>
            {t("contracts.pickNone")}
          </Button>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={checking}
          dataSource={checks}
          pagination={false}
          scroll={{ y: 360, x: true }}
          rowSelection={{
            selectedRowKeys: picked,
            onChange: (keys) => setPicked(keys as number[]),
            getCheckboxProps: (c: DraftCheck) => ({ disabled: !c.ok }),
          }}
          columns={[
            { title: t("contracts.reference"), dataIndex: "referenceNumber", render: (v: string, c: DraftCheck) => <Link to={`/contracts/${c.id}`}>{v}</Link> },
            { title: t("contracts.tenant"), render: (_: unknown, c: DraftCheck) => (contractOf(c.id) ? partyName(contractOf(c.id)!.tenantPartyId) : "") },
            { title: t("contracts.termStart"), render: (_: unknown, c: DraftCheck) => contractOf(c.id)?.termStart ?? "" },
            {
              title: t("contracts.pickStatus"),
              render: (_: unknown, c: DraftCheck) =>
                c.ok ? (
                  <Tag color="green">{t("contracts.pickReady")}</Tag>
                ) : (
                  <div>
                    <Tag color="red">{t("contracts.pickBlocked")}</Tag>
                    <div style={{ whiteSpace: "pre-line", fontSize: 12 }}>{reasonText(c)}</div>
                  </div>
                ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={activationResult !== null}
        title={t("contracts.activateAllDone", { ok: (activationResult?.length ?? 0) - failedActivations.length, failed: failedActivations.length })}
        onCancel={() => setActivationResult(null)}
        footer={<Button onClick={() => setActivationResult(null)}>{t("common.close")}</Button>}
        width={560}
      >
        {failedActivations.length > 0 && (
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            <Typography.Paragraph type="secondary">{t("contracts.activateAllStayDraft")}</Typography.Paragraph>
            {failedActivations.map((f) => (
              <div key={f.id} style={{ marginBottom: 8 }}>
                <Typography.Text strong>
                  <Link to={`/contracts/${f.id}`}>{f.referenceNumber}</Link>
                </Typography.Text>
                <div style={{ whiteSpace: "pre-line" }}>{apiErrorMessage(new ApiError(f.error!.code, f.error!.message, 409, f.error!.details), t)}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        title={t("contracts.addContract")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onCreate}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="referenceNumber" label={t("contracts.reference")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="landlordPartyId" label={t("contracts.landlord")} rules={[{ required: true }]}>
            <Select options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="tenantPartyId" label={t("contracts.tenant")} rules={[{ required: true }]}>
            <Select options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="termStart" label={t("contracts.termStart")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="termEnd" label={t("contracts.termEnd")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Space size={8} style={{ marginBottom: 12 }} wrap>
            <Typography.Text type="secondary">{t("contracts.termQuick")}</Typography.Text>
            {[1, 3, 5, 6].map((n) => (
              <Button
                key={n}
                size="small"
                onClick={() => {
                  const start = form.getFieldValue("termStart");
                  if (start) form.setFieldsValue({ termEnd: dayjs(start).add(n, "year").subtract(1, "day").format("YYYY-MM-DD") });
                }}
              >
                {t("contracts.nYears", { count: n })}
              </Button>
            ))}
          </Space>
          <Form.Item name="dueDay" label={t("contracts.dueDay")} rules={[{ required: true }]} initialValue={1}>
            <InputNumber min={1} max={31} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="dueMonthOffset"
            label={
              <>
                {t("contracts.dueMonthOffset")} <HelpIcon field="dueMonthOffset" />
              </>
            }
            initialValue={0}
          >
            <InputNumber min={-3} max={3} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="overdueGraceDays" label={t("billing.graceDays")} extra={t("billing.graceDaysHint")} initialValue={5}>
            <InputNumber min={0} max={60} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
