import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Modal, Space, Statistic, Table, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { todayInChina } from "@lcm/shared";
import { api } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";
import { downloadCsv, parseDelimited, readBalances } from "../api/csv";
import DateField from "../components/DateField";
import { yuan } from "../components/billing/format";

interface GoLiveRow {
  id: number;
  referenceNumber: string;
  status: string;
  tenantName: string;
  landlordName: string;
  place: string;
  termStart: string;
  termEnd: string;
  autoBilling: boolean;
  chargeCount: number;
  unpaidFen: number;
  depositHeldFen: number;
  hasOtherPayments: boolean;
  opening: { asOfDate: string; balanceOwedFen: number; paymentFen: number; status: "provisional" | "final"; provisionalUntil: string } | null;
}

interface PlanResult {
  reference: string;
  contractId: number | null;
  tenantName: string | null;
  state: "ready" | "skipped";
  reason: string | null;
  balanceOwedFen?: number;
  billedFen?: number;
  paymentFen?: number;
  billCount?: number;
  unpaidBills?: number;
  partialBills?: number;
  catchUp?: { count: number; totalFen: number } | null;
  missingReadings?: number;
}
interface ApplyResult {
  contractId: number;
  ok: boolean;
  error?: { code: string; message: string };
  billsCreated?: number;
  paymentFen?: number;
}

export default function GoLivePage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<GoLiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | undefined>(todayInChina());
  const [selected, setSelected] = useState<number[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [plan, setPlan] = useState<PlanResult[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: number; failed: { reference: string; message: string }[]; totalFen: number } | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<{ contracts: GoLiveRow[] }>("/go-live/contracts")
      .then((r) => setRows(r.contracts))
      .catch((err) => message.error(apiErrorMessage(err, t)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // By default the sheet covers the contracts still waiting to be brought up to date.
  const pendingIds = useMemo(() => rows.filter((r) => !r.opening && !r.hasOtherPayments).map((r) => r.id), [rows]);
  const chosen = selected ?? pendingIds;

  const done = rows.filter((r) => r.opening).length;
  const provisional = rows.filter((r) => r.opening?.status === "provisional").length;
  const openingTotal = rows.reduce((s, r) => s + (r.opening?.paymentFen ?? 0), 0);
  const unpaidTotal = rows.reduce((s, r) => s + r.unpaidFen, 0);

  const ready = (plan ?? []).filter((r) => r.state === "ready");
  const skipped = (plan ?? []).filter((r) => r.state === "skipped");
  const readyPaymentFen = ready.reduce((s, r) => s + (r.paymentFen ?? 0), 0);

  const checkText = async (text: string) => {
    const items = readBalances(parseDelimited(text));
    if (items.length === 0) {
      message.warning(t("goLive.import.nothingFound"));
      return;
    }
    setPlanning(true);
    setOutcome(null);
    try {
      const r = await api.post<{ results: PlanResult[] }>("/go-live/plan", { asOfDate: asOf, items });
      setPlan(r.results);
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    } finally {
      setPlanning(false);
    }
  };

  const applyAll = () => {
    Modal.confirm({
      title: t("goLive.import.confirmTitle", { count: ready.length }),
      content: t("goLive.import.confirmBody", { total: yuan(readyPaymentFen), skipped: skipped.length }),
      okText: t("goLive.import.apply", { count: ready.length }),
      cancelText: t("common.cancel"),
      onOk: async () => {
        setApplying(true);
        try {
          const r = await api.post<{ results: ApplyResult[] }>("/go-live/apply", {
            asOfDate: asOf,
            items: ready.map((x) => ({
              contractId: x.contractId,
              balanceOwedFen: x.balanceOwedFen,
              expectedBilledFen: x.billedFen,
              expectedBillCount: x.billCount,
              catchUp: x.catchUp ?? null,
            })),
          });
          const byId = new Map(ready.map((x) => [x.contractId, x.reference]));
          setOutcome({
            ok: r.results.filter((x) => x.ok).length,
            failed: r.results.filter((x) => !x.ok).map((x) => ({ reference: byId.get(x.contractId) ?? String(x.contractId), message: x.error?.message ?? "" })),
            totalFen: r.results.reduce((s, x) => s + (x.paymentFen ?? 0), 0),
          });
          setPlan(null);
          setPasted("");
          load();
        } catch (err) {
          message.error(apiErrorMessage(err, t));
        } finally {
          setApplying(false);
        }
      },
    });
  };

  const adjustable = rows.filter((r) => r.opening?.status === "provisional");
  const finalizeAll = () => {
    Modal.confirm({
      title: t("goLive.finalizeAllTitle", { count: adjustable.length }),
      content: t("goLive.finalizeAllBody"),
      okText: t("openingBalance.finalize"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const r = await api.post<{ finalized: number }>("/go-live/finalize", { contractIds: adjustable.map((x) => x.id) });
          message.success(t("goLive.finalizedAll", { count: r.finalized }));
          load();
        } catch (err) {
          message.error(apiErrorMessage(err, t));
        }
      },
    });
  };

  const downloadSheet = () => {
    const picked = rows.filter((r) => chosen.includes(r.id));
    if (picked.length === 0) return;
    const header = [
      t("goLive.sheet.contract"),
      t("goLive.sheet.tenant"),
      t("goLive.sheet.landlord"),
      t("goLive.sheet.place"),
      t("goLive.sheet.termStart"),
      t("goLive.sheet.termEnd"),
      t("goLive.sheet.deposit"),
      t("goLive.sheet.balance", { date: asOf }),
      t("goLive.sheet.notes"),
    ];
    const body = picked.map((r) => [r.referenceNumber, r.tenantName, r.landlordName, r.place, r.termStart, r.termEnd, (r.depositHeldFen / 100).toFixed(2), "", ""]);
    downloadCsv(`go-live-accountant-sheet-${asOf}.csv`, [header, ...body]);
    message.success(t("goLive.sheetDownloaded", { count: picked.length }));
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {t("nav.goLive")}
      </Typography.Title>
      <Alert type="info" showIcon message={t("goLive.intro")} />

      <Card size="small">
        <Space size="large" wrap>
          <Statistic title={t("goLive.stats.contracts")} value={rows.length} />
          <Statistic title={t("goLive.stats.done")} value={`${done} / ${rows.length}`} />
          <Statistic title={t("goLive.stats.provisional")} value={provisional} />
          <Statistic title={t("goLive.stats.openingTotal")} value={yuan(openingTotal)} />
          <Statistic title={t("goLive.stats.unpaidTotal")} value={yuan(unpaidTotal)} />
        </Space>
      </Card>

      <Card size="small" title={t("goLive.step1")}>
        <Typography.Paragraph type="secondary">{t("goLive.sheetHelp")}</Typography.Paragraph>
        <Space wrap>
          <span>{t("openingBalance.asOf")}</span>
          <DateField value={asOf} onChange={setAsOf} style={{ width: 150 }} />
          <Button type="primary" icon={<DownloadOutlined />} disabled={!asOf || chosen.length === 0} onClick={downloadSheet}>
            {t("goLive.downloadSheet", { count: chosen.length })}
          </Button>
        </Space>
      </Card>

      <Card size="small" title={t("goLive.import.title")}>
        <Typography.Paragraph type="secondary">{t("goLive.import.help")}</Typography.Paragraph>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <span>{t("openingBalance.asOf")}</span>
            <DateField value={asOf} onChange={setAsOf} style={{ width: 150 }} />
            <Upload
              accept=".csv,.txt,.tsv"
              showUploadList={false}
              beforeUpload={(file) => {
                void file.text().then((text) => checkText(text));
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>{t("goLive.import.upload")}</Button>
            </Upload>
          </Space>
          <Input.TextArea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t("goLive.import.paste")} />
          <Button type="primary" ghost loading={planning} disabled={!asOf || !pasted.trim()} onClick={() => void checkText(pasted)}>
            {t("goLive.import.check")}
          </Button>
        </Space>

        {outcome && (
          <Alert
            style={{ marginTop: 12 }}
            type={outcome.failed.length ? "warning" : "success"}
            showIcon
            message={t("goLive.import.done", { ok: outcome.ok, total: yuan(outcome.totalFen) })}
            description={outcome.failed.length ? outcome.failed.map((f) => `${f.reference}: ${f.message}`).join(" · ") : undefined}
          />
        )}

        {plan && (
          <div style={{ marginTop: 12 }}>
            <Space size="large" wrap style={{ marginBottom: 8 }}>
              <Typography.Text strong>{t("goLive.import.summary", { ready: ready.length, skipped: skipped.length, total: yuan(readyPaymentFen) })}</Typography.Text>
              <Button type="primary" disabled={ready.length === 0} loading={applying} onClick={applyAll}>
                {t("goLive.import.apply", { count: ready.length })}
              </Button>
            </Space>
            <Table
              size="small"
              rowKey={(r: PlanResult) => `${r.reference}-${r.state}-${r.reason ?? ""}`}
              dataSource={plan}
              pagination={plan.length > 25 ? { pageSize: 25 } : false}
              scroll={{ x: true }}
              columns={[
                { title: t("goLive.col.contract"), dataIndex: "reference" },
                { title: t("goLive.col.tenant"), dataIndex: "tenantName" },
                {
                  title: t("goLive.import.result"),
                  render: (_: unknown, r: PlanResult) =>
                    r.state === "ready" ? (
                      <Space direction="vertical" size={0}>
                        <Tag color="green">{t("goLive.import.ready")}</Tag>
                        {r.partialBills ? <Tag color="orange">{t("goLive.import.partial")}</Tag> : null}
                      </Space>
                    ) : (
                      <Tag color="red">{t(`goLive.reason.${r.reason}`, { defaultValue: r.reason ?? "" })}</Tag>
                    ),
                },
                { title: t("openingBalance.balanceOwed"), align: "right" as const, render: (_: unknown, r: PlanResult) => (r.balanceOwedFen === undefined ? "" : yuan(r.balanceOwedFen)) },
                { title: t("goLive.import.billed"), align: "right" as const, render: (_: unknown, r: PlanResult) => (r.billedFen === undefined ? "" : yuan(r.billedFen)) },
                { title: t("goLive.import.openingPayment"), align: "right" as const, render: (_: unknown, r: PlanResult) => (r.paymentFen === undefined ? "" : yuan(r.paymentFen)) },
                { title: t("goLive.import.unpaidBills"), align: "right" as const, render: (_: unknown, r: PlanResult) => r.unpaidBills ?? "" },
                {
                  title: t("goLive.import.catchUp"),
                  render: (_: unknown, r: PlanResult) => (r.catchUp ? t("goLive.import.catchUpBills", { count: r.catchUp.count, total: yuan(r.catchUp.totalFen) }) : ""),
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Card size="small" title={t("goLive.step2")}>
        <Typography.Paragraph type="secondary">{t("goLive.step2Help")}</Typography.Paragraph>
        <Button disabled={adjustable.length === 0} onClick={finalizeAll} style={{ marginBottom: 8 }}>
          {t("goLive.finalizeAll", { count: adjustable.length })}
        </Button>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={rows.length > 25 ? { pageSize: 25 } : false}
          scroll={{ x: true }}
          rowSelection={{ selectedRowKeys: chosen, onChange: (keys) => setSelected(keys as number[]) }}
          columns={[
            { title: t("goLive.col.contract"), render: (_: unknown, r: GoLiveRow) => <Link to={`/contracts/${r.id}`}>{r.referenceNumber}</Link> },
            { title: t("goLive.col.tenant"), dataIndex: "tenantName" },
            { title: t("goLive.col.place"), dataIndex: "place" },
            {
              title: t("goLive.col.billing"),
              render: (_: unknown, r: GoLiveRow) =>
                r.chargeCount > 0 ? (
                  <Tag color="green">{t("goLive.billed", { count: r.chargeCount })}</Tag>
                ) : (
                  <Tag>{t("goLive.notBilled")}</Tag>
                ),
            },
            { title: t("goLive.col.unpaid"), dataIndex: "unpaidFen", align: "right" as const, render: (v: number) => yuan(v) },
            { title: t("goLive.col.deposit"), dataIndex: "depositHeldFen", align: "right" as const, render: (v: number) => yuan(v) },
            {
              title: t("goLive.col.opening"),
              render: (_: unknown, r: GoLiveRow) =>
                r.opening ? (
                  <Space direction="vertical" size={0}>
                    <Tag color={r.opening.status === "provisional" ? "orange" : "green"}>{t(`goLive.openingStatus.${r.opening.status}`)}</Tag>
                    <Typography.Text type="secondary">
                      {t("goLive.openingLine", { date: r.opening.asOfDate, balance: yuan(r.opening.balanceOwedFen) })}
                    </Typography.Text>
                  </Space>
                ) : r.hasOtherPayments ? (
                  <Tag>{t("goLive.hasPayments")}</Tag>
                ) : (
                  <Tag color="blue">{t("goLive.pending")}</Tag>
                ),
            },
            {
              title: "",
              render: (_: unknown, r: GoLiveRow) => <Link to={`/contracts/${r.id}`}>{t("goLive.open")}</Link>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
