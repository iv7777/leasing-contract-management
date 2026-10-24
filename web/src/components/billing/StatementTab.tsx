import { useEffect, useMemo, useState } from "react";
import { Alert, Button, DatePicker, List, Segmented, Select, Space, Switch, Table, Tag, Typography, Grid } from "antd";
import { DownloadOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { todayInChina } from "@lcm/shared";
import MonthField from "../MonthField";
import ChargeDetailDrawer from "./ChargeDetailDrawer";
import { paymentMethodLabel, periodLabel, streamName, yuan } from "./format";
import { esc, printHtml } from "./print";

type Mode = "month" | "year" | "custom" | "all";

interface Line {
  key: string;
  date: string;
  kind: "charge" | "adjustment" | "payment";
  chargeId?: number;
  pricingStreamId?: number;
  feeType?: string;
  serviceStart?: string;
  serviceEnd?: string;
  broughtForward?: boolean;
  paymentMethod?: string;
  reference?: string | null;
  reason?: string;
  effectFen: number;
  debitFen: number;
  creditFen: number;
  balanceFen: number | null;
  muted: null | "voided" | "reversed" | "removed";
}
interface Dto {
  header: { contractRef: string; tenant: string; landlord: string; units: string[]; termStart: string; termEnd: string };
  items: { id: number; label: string | null; feeType: string }[];
  statement: { from: string | null; to: string | null; openingFen: number; chargesFen: number; adjustmentsFen: number; paymentsFen: number; closingFen: number; unallocatedFen: number; lines: Line[] };
  deposit: { lines: { id: number; date: string; type: string; amountFen: number; reason: string; removed: boolean }[]; heldFen: number };
  asOf: string;
}

const money = (fen: number) => (fen / 100).toFixed(2);

/** The period as the person chose it, as from/to days (null = no limit). */
function rangeOf(mode: Mode, month: string, year: number, custom: [string, string] | null): { from: string | null; to: string | null } | null {
  if (mode === "all") return { from: null, to: null };
  if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (mode === "month") return month ? { from: `${month}-01`, to: dayjs(`${month}-01`).endOf("month").format("YYYY-MM-DD") } : null;
  return custom ? { from: custom[0], to: custom[1] } : null;
}

/** Statement of account for a contract: pick a month, a year, custom dates or everything; read it, print it or take it as CSV. */
export default function StatementTab({ contractId, reloadKey, canExport }: { contractId: number; reloadKey: unknown; canExport: boolean }) {
  const { t } = useTranslation();
  const isPhone = !Grid.useBreakpoint().md;
  const today = todayInChina();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [custom, setCustom] = useState<[string, string] | null>(null);
  const [streamId, setStreamId] = useState<number | null>(null);
  const [includeVoided, setIncludeVoided] = useState(false);
  const [data, setData] = useState<Dto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailChargeId, setDetailChargeId] = useState<number | null>(null);

  const range = rangeOf(mode, month, year, custom);
  useEffect(() => {
    if (!range) return;
    setError(null);
    const q = new URLSearchParams();
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    if (streamId !== null) q.set("streamId", String(streamId));
    if (includeVoided) q.set("includeVoided", "1");
    api
      .get<Dto>(`/contracts/${contractId}/account-statement?${q}`)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, range?.from, range?.to, streamId, includeVoided, reloadKey, t]);

  const itemName = useMemo(() => {
    const m = new Map((data?.items ?? []).map((i) => [i.id, streamName(t, i.label ?? i.feeType, i.feeType)]));
    return (id?: number, feeType?: string) => (id !== undefined && m.get(id)) || (feeType ? streamName(t, feeType, feeType) : "");
  }, [data, t]);

  const describe = (l: Line): string => {
    const period = l.serviceStart && l.serviceEnd ? periodLabel(l.serviceStart, l.serviceEnd) : "";
    if (l.kind === "charge") return `${itemName(l.pricingStreamId, l.feeType)} · ${period}`;
    if (l.kind === "adjustment") return `${t("statement.adjustment")}: ${itemName(l.pricingStreamId, l.feeType)} · ${period}${l.reason ? ` — ${l.reason}` : ""}`;
    return `${t("statement.payment")} · ${l.paymentMethod ? paymentMethodLabel(t, l.paymentMethod) : ""}${l.reference ? ` (${l.reference})` : ""}`;
  };
  const periodTitle = (): string => {
    if (!data) return "";
    const { from, to } = data.statement;
    if (from === null && to === null) return t("statement.allTime");
    if (mode === "month") return month;
    if (mode === "year") return String(year);
    return `${from ?? ""} → ${to ?? ""}`;
  };

  const csv = () => {
    if (!data) return;
    const rows = [[t("statement.date"), t("statement.type"), t("statement.description"), t("statement.charge"), t("statement.paymentCol"), t("statement.balance")]];
    rows.push(["", "", t("statement.opening"), "", "", money(data.statement.openingFen)]);
    for (const l of data.statement.lines) {
      rows.push([l.date, t(`statement.kind.${l.kind}`), describe(l) + (l.muted ? ` [${t(`statement.muted.${l.muted}`)}]` : ""), l.debitFen ? money(l.debitFen) : "", l.creditFen ? money(l.creditFen) : "", l.balanceFen === null ? "" : money(l.balanceFen)]);
    }
    rows.push(["", "", t("statement.closing"), "", "", money(data.statement.closingFen)]);
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.header.contractRef}-statement-${periodTitle().replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    if (!data) return;
    const s = data.statement;
    const h = data.header;
    const itemLabel = streamId !== null ? itemName(streamId) : t("statement.allItems");
    const lineRows = s.lines
      .map(
        (l) =>
          `<tr${l.muted ? ' style="color:#888;text-decoration:line-through"' : ""}><td>${esc(l.date)}</td><td>${esc(describe(l))}${l.muted ? ` [${esc(t(`statement.muted.${l.muted}`))}]` : ""}</td><td class="r">${l.debitFen ? esc(money(l.debitFen)) : ""}</td><td class="r">${l.creditFen ? esc(money(l.creditFen)) : ""}</td><td class="r">${l.balanceFen === null ? "" : esc(money(l.balanceFen))}</td></tr>`,
      )
      .join("");
    const depositRows = data.deposit.lines
      .map((d) => `<tr><td>${esc(d.date)}</td><td>${esc(t(`contracts.depositTxnTypes.${d.type}`, { defaultValue: d.type }))}</td><td>${esc(d.reason)}</td><td class="r">${esc(money(d.amountFen))}</td></tr>`)
      .join("");
    printHtml(
      `${h.contractRef} ${t("statement.printTitle")}`,
      `<h1>${esc(t("statement.printTitle"))}</h1>
<table>
<tr><th>${esc(t("statement.contract"))}</th><td>${esc(h.contractRef)}</td><th>${esc(t("statement.period"))}</th><td>${esc(periodTitle())}</td></tr>
<tr><th>${esc(t("statement.tenant"))}</th><td>${esc(h.tenant)}</td><th>${esc(t("statement.landlord"))}</th><td>${esc(h.landlord)}</td></tr>
<tr><th>${esc(t("statement.units"))}</th><td>${esc(h.units.join(", "))}</td><th>${esc(t("statement.item"))}</th><td>${esc(itemLabel)}</td></tr>
</table>
<h2>${esc(t("statement.summary"))}</h2>
<table>
<tr><td>${esc(t("statement.opening"))}</td><td class="r">${esc(yuan(s.openingFen))}</td></tr>
<tr><td>+ ${esc(t("statement.charges"))}</td><td class="r">${esc(yuan(s.chargesFen))}</td></tr>
<tr><td>+ ${esc(t("statement.adjustments"))}</td><td class="r">${esc(yuan(s.adjustmentsFen))}</td></tr>
<tr><td>− ${esc(t("statement.payments"))}</td><td class="r">${esc(yuan(s.paymentsFen))}</td></tr>
<tr><th>= ${esc(t("statement.closing"))}</th><th class="r">${esc(yuan(s.closingFen))}</th></tr>
</table>
<p>${esc(t("statement.creditNote"))}</p>
<h2>${esc(t("statement.transactions"))}</h2>
<table><tr><th>${esc(t("statement.date"))}</th><th>${esc(t("statement.description"))}</th><th>${esc(t("statement.charge"))}</th><th>${esc(t("statement.paymentCol"))}</th><th>${esc(t("statement.balance"))}</th></tr>
<tr><td></td><td>${esc(t("statement.opening"))}</td><td></td><td></td><td class="r">${esc(money(s.openingFen))}</td></tr>${lineRows}
<tr><th></th><th>${esc(t("statement.closing"))}</th><th></th><th></th><th class="r">${esc(money(s.closingFen))}</th></tr></table>
${depositRows ? `<h2>${esc(t("statement.depositTitle"))}</h2><table>${depositRows}</table>` : ""}
${streamId === null ? `<p>${esc(t("statement.depositHeld"))}: ${esc(yuan(data.deposit.heldFen))}${s.unallocatedFen > 0 ? ` · ${esc(t("statement.unallocated"))}: ${esc(yuan(s.unallocatedFen))}` : ""}</p>` : ""}
<p style="color:#666;font-size:12px">${esc(t("statement.printedOn", { date: data.asOf }))}</p>`,
    );
  };

  const s = data?.statement;
  const yearOptions = useMemo(() => {
    const first = data ? Number(data.header.termStart.slice(0, 4)) : Number(today.slice(0, 4));
    const last = Math.max(Number(today.slice(0, 4)), data ? Number(data.header.termEnd.slice(0, 4)) : 0);
    return Array.from({ length: Math.max(last - first + 1, 1) }, (_, i) => ({ value: first + i, label: String(first + i) }));
  }, [data, today]);

  const mutedTag = (l: Line) => (l.muted ? <Tag>{t(`statement.muted.${l.muted}`)}</Tag> : null);
  const rowClick = (l: Line) => (l.chargeId ? () => setDetailChargeId(l.chargeId!) : undefined);
  const style = (l: Line) => (l.muted ? { color: "#999", textDecoration: "line-through" } : undefined);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { value: "month", label: t("statement.mode.month") },
            { value: "year", label: t("statement.mode.year") },
            { value: "custom", label: t("statement.mode.custom") },
            { value: "all", label: t("statement.mode.all") },
          ]}
        />
        {mode === "month" && <MonthField value={month} onChange={(v) => v && setMonth(v)} style={{ width: 140 }} />}
        {mode === "year" && <Select value={year} onChange={setYear} options={yearOptions} style={{ width: 110 }} />}
        {mode === "custom" && (
          <DatePicker.RangePicker
            value={custom ? [dayjs(custom[0]), dayjs(custom[1])] : null}
            onChange={(v) => setCustom(v && v[0] && v[1] ? [v[0].format("YYYY-MM-DD"), v[1].format("YYYY-MM-DD")] : null)}
            allowClear={false}
          />
        )}
      </Space>
      <Space wrap>
        <Select
          allowClear
          placeholder={t("statement.allItems")}
          value={streamId ?? undefined}
          onChange={(v) => setStreamId(v ?? null)}
          options={(data?.items ?? []).map((i) => ({ value: i.id, label: streamName(t, i.label ?? i.feeType, i.feeType) }))}
          style={{ minWidth: 180 }}
        />
        <Space size={4}>
          <Switch size="small" checked={includeVoided} onChange={setIncludeVoided} />
          <Typography.Text type="secondary">{t("statement.showVoided")}</Typography.Text>
        </Space>
        {canExport && (
          <>
            <Button icon={<PrinterOutlined />} onClick={print} disabled={!data}>
              {t("statement.print")}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={csv} disabled={!data}>
              {t("statement.csv")}
            </Button>
          </>
        )}
      </Space>

      {mode === "custom" && !custom && <Alert type="info" showIcon message={t("statement.pickDates")} />}
      {error && <Alert type="error" showIcon message={error} />}

      {s && data && (
        <>
          <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, background: "#fff" }}>
            {(
              [
                [t("statement.opening"), yuan(s.openingFen), false],
                [`+ ${t("statement.charges")}`, yuan(s.chargesFen), false],
                [`+ ${t("statement.adjustments")}`, yuan(s.adjustmentsFen), false],
                [`− ${t("statement.payments")}`, yuan(s.paymentsFen), false],
                [`= ${t("statement.closing")}`, yuan(s.closingFen), true],
                ...(streamId === null && s.unallocatedFen > 0 ? [[t("statement.unallocated"), yuan(s.unallocatedFen), false]] : []),
                ...(streamId === null ? [[t("statement.depositHeld"), yuan(data.deposit.heldFen), false]] : []),
              ] as [string, string, boolean][]
            ).map(([label, value, strong], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 12px", borderTop: i ? "1px solid #f0f0f0" : undefined }}>
                <Typography.Text type={strong ? undefined : "secondary"} strong={strong}>
                  {label}
                </Typography.Text>
                <Typography.Text strong={strong} type={strong && s.closingFen > 0 ? "danger" : undefined} style={{ whiteSpace: "nowrap" }}>
                  {value}
                </Typography.Text>
              </div>
            ))}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("statement.creditNote")}
          </Typography.Text>

          <Typography.Title level={5} style={{ margin: 0 }}>
            {t("statement.transactions")}
          </Typography.Title>
          {isPhone ? (
            <List
              bordered
              size="small"
              locale={{ emptyText: t("statement.none") }}
              dataSource={s.lines}
              header={<Typography.Text type="secondary">{t("statement.opening")}: {yuan(s.openingFen)}</Typography.Text>}
              footer={<Typography.Text strong>{t("statement.closing")}: {yuan(s.closingFen)}</Typography.Text>}
              renderItem={(l: Line) => (
                <List.Item style={{ display: "block", cursor: l.chargeId ? "pointer" : undefined }} onClick={rowClick(l)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, ...style(l) }}>
                    <span>{describe(l)}</span>
                    <Typography.Text strong type={l.creditFen > 0 && l.kind !== "adjustment" ? "success" : undefined} style={{ whiteSpace: "nowrap", ...style(l) }}>
                      {l.creditFen > 0 ? `− ${yuan(l.creditFen)}` : yuan(l.debitFen)}
                    </Typography.Text>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {l.date} {mutedTag(l)}
                    </Typography.Text>
                    {l.balanceFen !== null && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t("statement.balance")} {yuan(l.balanceFen)}
                      </Typography.Text>
                    )}
                  </div>
                </List.Item>
              )}
            />
          ) : (
            <Table
              size="small"
              rowKey="key"
              pagination={s.lines.length > 50 ? { pageSize: 50, size: "small" } : false}
              dataSource={s.lines}
              locale={{ emptyText: t("statement.none") }}
              onRow={(l: Line) => ({ onClick: rowClick(l), style: { cursor: l.chargeId ? "pointer" : undefined } })}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <Typography.Text strong>{t("statement.closing")}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Typography.Text strong>{yuan(s.closingFen)}</Typography.Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
              title={() => (
                <Typography.Text type="secondary">
                  {t("statement.opening")}: {yuan(s.openingFen)}
                </Typography.Text>
              )}
              columns={[
                { title: t("statement.date"), dataIndex: "date", width: 110, render: (v: string, l: Line) => <span style={style(l)}>{v}</span> },
                {
                  title: t("statement.description"),
                  render: (_: unknown, l: Line) => (
                    <span style={style(l)}>
                      {describe(l)} {l.broughtForward && <Tag color="blue">{t("openingBalance.broughtForward")}</Tag>}
                      {mutedTag(l)}
                    </span>
                  ),
                },
                { title: t("statement.charge"), align: "right" as const, width: 120, render: (_: unknown, l: Line) => <span style={style(l)}>{l.debitFen ? yuan(l.debitFen) : ""}</span> },
                { title: t("statement.paymentCol"), align: "right" as const, width: 120, render: (_: unknown, l: Line) => <span style={style(l)}>{l.creditFen ? yuan(l.creditFen) : ""}</span> },
                { title: t("statement.balance"), align: "right" as const, width: 120, render: (_: unknown, l: Line) => (l.balanceFen === null ? "" : yuan(l.balanceFen)) },
              ]}
            />
          )}

          {streamId === null && data.deposit.lines.length > 0 && (
            <>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {t("statement.depositTitle")}
              </Typography.Title>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.deposit.lines}
                columns={[
                  { title: t("statement.date"), dataIndex: "date", width: 110 },
                  { title: t("contracts.transactionType"), dataIndex: "type", render: (v: string) => t(`contracts.depositTxnTypes.${v}`, { defaultValue: v }) },
                  { title: t("contracts.reason"), dataIndex: "reason" },
                  { title: t("contracts.amount"), dataIndex: "amountFen", align: "right" as const, render: (v: number) => yuan(v) },
                ]}
              />
            </>
          )}
        </>
      )}
      <ChargeDetailDrawer chargeId={detailChargeId} onClose={() => setDetailChargeId(null)} />
    </Space>
  );
}
