import { useEffect, useState, type ReactNode } from "react";
import { Button, Collapse, Input, message, Select, Space, Table, Tag, Typography } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import DateField from "../components/DateField";

interface AuditEventDto {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel?: string | null;
  reason: string | null;
  details: unknown;
  createdAt: string;
}

type Change = { from: unknown; to: unknown };
type Details = Record<string, unknown>;

/** Facts that say what the entry is about; shown first, as a one-line headline. */
const IDENTITY_KEYS = ["contract", "item", "unit", "servicePeriod", "period", "name", "owner", "document", "property"];
/** Keys already shown elsewhere, or only useful in the raw data. */
const SKIP_KEYS = new Set(["changes", "before", "after", ...IDENTITY_KEYS]);

const isPlainObject = (v: unknown): v is Details => typeof v === "object" && v !== null && !Array.isArray(v);

function fieldLabel(t: TFunction, key: string) {
  return t(`audit.fields.${key}`, { defaultValue: key });
}

function formatValue(t: TFunction, key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return t(v ? "audit.yes" : "audit.no");
  if (typeof v === "number") return key.endsWith("Fen") ? `¥${(v / 100).toFixed(2)}` : String(v);
  if (typeof v === "string") {
    if (v === "ALL" && (key === "item" || key === "pricingStreamId")) return t("audit.allItems");
    return t(`audit.values.${v}`, { defaultValue: v });
  }
  if (Array.isArray(v)) return v.map((x) => formatValue(t, key, x)).join(", ");
  if (isPlainObject(v)) return Object.entries(v).map(([k, x]) => `${fieldLabel(t, k)}: ${formatValue(t, k, x)}`).join(", ");
  return String(v);
}

/** {field: {from, to}} — taken from `changes`, or worked out from an older entry's before/after. */
function changesOf(details: unknown): Record<string, Change> {
  if (!isPlainObject(details)) return {};
  if (isPlainObject(details.changes)) return details.changes as Record<string, Change>;
  if (isPlainObject(details.before) && isPlainObject(details.after)) {
    const out: Record<string, Change> = {};
    for (const [k, to] of Object.entries(details.after)) {
      const from = (details.before as Details)[k] ?? null;
      if (from !== (to ?? null)) out[k] = { from, to: to ?? null };
    }
    return out;
  }
  return {};
}

/** The remaining facts of an entry (everything except identity and changes). */
function factsOf(details: unknown): [string, unknown][] {
  if (!isPlainObject(details)) return [];
  return Object.entries(details).filter(([k]) => !SKIP_KEYS.has(k));
}

function identityOf(details: unknown): [string, unknown][] {
  if (!isPlainObject(details)) return [];
  return IDENTITY_KEYS.filter((k) => details[k] !== undefined && details[k] !== null && details[k] !== "").map((k) => [k, details[k]]);
}

function headlineOf(t: TFunction, details: unknown): string {
  return identityOf(details).map(([k, v]) => formatValue(t, k, v)).join(" · ");
}

type DetailRow = { key: string; label: string; from?: string; to?: string; value?: string };

/** The detail rows of one entry: what changed first, then the other facts, then the reason. */
function detailRows(t: TFunction, event: AuditEventDto): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const [k, c] of Object.entries(changesOf(event.details))) {
    rows.push({ key: `c-${k}`, label: fieldLabel(t, k), from: formatValue(t, k, c.from), to: formatValue(t, k, c.to) });
  }
  for (const [k, v] of factsOf(event.details)) rows.push({ key: `f-${k}`, label: fieldLabel(t, k), value: formatValue(t, k, v) });
  if (event.reason) rows.push({ key: "reason", label: t("contracts.reason"), value: event.reason });
  return rows;
}

const rowText = (r: DetailRow) => (r.value !== undefined ? `${r.label}: ${r.value}` : `${r.label}: ${r.from} → ${r.to}`);

function lineItems(t: TFunction, event: AuditEventDto): ReactNode[] {
  return detailRows(t, event).map((r) =>
    r.value !== undefined ? (
      <span key={r.key}>{r.label}: {r.value}</span>
    ) : (
      <span key={r.key}>
        {r.label}: <span style={{ color: "#cf1322" }}>{r.from}</span> → <span style={{ color: "#389e0d" }}>{r.to}</span>
      </span>
    ),
  );
}

const csvCell = (raw: string) => {
  // A cell starting with = + - @ would be run as a formula by Excel; keep it as text.
  const v = /^([=@\t\r]|[+-](?![\d.]))/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** One CSV line per audit record, in the language the page is showing. */
function auditCsv(t: TFunction, events: AuditEventDto[]): string {
  const header = [t("audit.timestamp"), t("audit.actor"), t("audit.action"), t("audit.entityType"), t("audit.entityId"), t("audit.target"), t("audit.details")];
  const lines = [header.join(",")];
  for (const e of events) {
    const details = [headlineOf(t, e.details), ...detailRows(t, e).map(rowText)].filter(Boolean).join(" | ");
    lines.push(
      [
        e.createdAt,
        e.actorName ?? t("audit.system"),
        t(`audit.actions.${e.action}`, { defaultValue: e.action }),
        t(`audit.entities.${e.entityType}`, { defaultValue: e.entityType }),
        e.entityId === null ? "" : String(e.entityId),
        e.entityLabel ?? "",
        details,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/** What an expanded record shows: the headline, every change / fact / reason, and the raw data. */
function ExpandedDetail({ event }: { event: AuditEventDto }) {
  const { t } = useTranslation();
  const headline = headlineOf(t, event.details);
  return (
    <div style={{ fontSize: 13 }}>
      <div>
        {[headline ? <strong key="headline">{headline}</strong> : null, ...lineItems(t, event)]
          .filter(Boolean)
          .map((l, i) => (
            <span key={i}>
              {i > 0 && <span style={{ margin: "0 10px", color: "#bfbfbf" }}>|</span>}
              {l}
            </span>
          ))}
      </div>
      {!!event.details && (
        <Collapse
          ghost
          size="small"
          items={[{ key: "raw", label: t("audit.rawData"), children: <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(event.details, null, 2)}</pre> }]}
        />
      )}
    </div>
  );
}

const hasDetail = (e: AuditEventDto) => !!e.details || !!e.reason;

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<readonly React.Key[]>([]);
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [entityType, setEntityType] = useState<string | undefined>(undefined);
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (entityType) params.set("entityType", entityType);
    if (entityId) params.set("entityId", entityId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    void api
      .get<{ events: AuditEventDto[]; total: number }>(`/audit?${params.toString()}`)
      .then((r) => {
        setEvents(r.events);
        setExpanded([]);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [page]);
  useEffect(() => {
    void api.get<{ entityTypes: string[] }>("/audit/entity-types").then((r) => setEntityTypes(r.entityTypes));
  }, []);

  /** Every record matching the filters (not just this page), as a CSV that opens correctly in Excel. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AuditEventDto[] = [];
      for (let pg = 1; pg <= 500; pg++) {
        const params = new URLSearchParams({ page: String(pg), pageSize: "200" });
        if (entityType) params.set("entityType", entityType);
        if (entityId) params.set("entityId", entityId);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const r = await api.get<{ events: AuditEventDto[]; total: number }>(`/audit?${params.toString()}`);
        all.push(...r.events);
        if (all.length >= r.total || r.events.length === 0) break;
      }
      const blob = new Blob(["\uFEFF" + auditCsv(t, all)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(t("audit.exported", { count: all.length }));
    } catch {
      message.error(t("common.error"));
    } finally {
      setExporting(false);
    }
  };

  const expandable = events.filter(hasDetail);
  const allExpanded = expandable.length > 0 && expandable.every((e) => expanded.includes(e.id));

  const applyFilters = () => {
    setPage(1);
    load();
  };

  return (
    <div>
      <Typography.Title level={4}>{t("audit.title")}</Typography.Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder={t("audit.entityType")}
          style={{ width: 180 }}
          value={entityType}
          onChange={setEntityType}
          options={entityTypes.map((e) => ({ value: e, label: t(`audit.entities.${e}`, { defaultValue: e }) }))}
        />
        <Input placeholder={t("audit.entityId")} style={{ width: 120 }} value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        <DateField placeholder={t("audit.from")} style={{ width: 160 }} value={from || undefined} onChange={(v) => setFrom(v ?? "")} allowClear />
        <DateField placeholder={t("audit.to")} style={{ width: 160 }} value={to || undefined} onChange={(v) => setTo(v ?? "")} allowClear />
        <Button type="primary" onClick={applyFilters}>
          {t("audit.applyFilters")}
        </Button>
        <Button onClick={() => setExpanded(allExpanded ? [] : expandable.map((e) => e.id))} disabled={expandable.length === 0}>
          {allExpanded ? t("audit.collapseAll") : t("audit.expandAll")}
        </Button>
        <Button onClick={() => void exportCsv()} loading={exporting}>
          {t("audit.exportCsv")}
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={events}
        scroll={{ x: true }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
        expandable={{
          rowExpandable: hasDetail,
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => setExpanded([...keys]),
          expandedRowRender: (e) => <ExpandedDetail event={e} />,
        }}
        columns={[
          { title: t("audit.timestamp"), dataIndex: "createdAt", width: 230, render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{v}</span> },
          { title: t("audit.actor"), dataIndex: "actorName", render: (v: string | null) => v ?? t("audit.system") },
          { title: t("audit.action"), dataIndex: "action", render: (v: string) => <Tag>{t(`audit.actions.${v}`, { defaultValue: v })}</Tag> },
          {
            title: t("audit.target"),
            render: (_: unknown, e: AuditEventDto) => (
              <span style={{ whiteSpace: "nowrap" }}>
                {t(`audit.entities.${e.entityType}`, { defaultValue: e.entityType })}
                {(e.entityLabel || e.entityId !== null) && (
                  <Typography.Text type="secondary">
                    {" · "}
                    {e.entityLabel ? t(`audit.values.${e.entityLabel}`, { defaultValue: e.entityLabel }) : ""} {e.entityId !== null && `#${e.entityId}`}
                  </Typography.Text>
                )}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
