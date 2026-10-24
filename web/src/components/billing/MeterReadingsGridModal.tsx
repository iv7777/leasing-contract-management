import { useEffect, useMemo, useState } from "react";
import { Alert, InputNumber, Modal, Space, Table, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { addMonths, todayInChina } from "@lcm/shared";
import { api, ApiError } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { PRICE_JUMP, impliedPrice, priceDeviation } from "./format";

export interface MeteredStream {
  id: number;
  name: string;
  unit: string;
  /** The reading carries its own amount (¥) as well as the quantity. */
  amountMode?: boolean;
}
interface UsageEntry {
  pricingStreamId: number;
  serviceStart: string;
  quantity: string;
  amountFen?: number | null;
}
interface PostedCharge {
  pricingStreamId: number;
  serviceStart: string;
  status: string;
}

const cellKey = (streamId: number, month: string) => `${streamId}|${month}`;

/** Month-by-month meter readings for every metered fee on a contract, in one
 * grid. Months that already have a posted charge are locked (the reading
 * behind a posted amount must not change); only edited cells are sent. */
export default function MeterReadingsGridModal({
  open,
  contractId,
  termStart,
  termEnd,
  streams,
  usageEntries,
  meteredFrom = null,
  charges,
  onClose,
  onDone,
}: {
  open: boolean;
  contractId: number;
  termStart: string;
  termEnd: string;
  streams: MeteredStream[];
  usageEntries: UsageEntry[];
  /** Readings for months before this are never billed (brought forward at go-live): those cells are closed. */
  meteredFrom?: string | null;
  charges: PostedCharge[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of usageEntries) m[cellKey(u.pricingStreamId, u.serviceStart.slice(0, 7))] = Number(u.quantity);
    return m;
  }, [usageEntries]);

  const initialAmounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of usageEntries) if (u.amountFen !== null && u.amountFen !== undefined) m[cellKey(u.pricingStreamId, u.serviceStart.slice(0, 7))] = u.amountFen / 100;
    return m;
  }, [usageEntries]);

  const locked = useMemo(() => {
    const s = new Set<string>();
    for (const c of charges) if (c.status === "posted") s.add(cellKey(c.pricingStreamId, c.serviceStart.slice(0, 7)));
    return s;
  }, [charges]);
  const beforeStart = (month: string) => !!meteredFrom && month < meteredFrom.slice(0, 7);

  // Newest month first, from the current month back to the lease's first month.
  const months = useMemo(() => {
    const last = termEnd.slice(0, 7) < todayInChina().slice(0, 7) ? termEnd.slice(0, 7) : todayInChina().slice(0, 7);
    const list: string[] = [];
    for (let m = `${termStart.slice(0, 7)}-01`; m.slice(0, 7) <= last; m = addMonths(m, 1)) list.push(m.slice(0, 7));
    return list.reverse();
  }, [termStart, termEnd]);

  useEffect(() => {
    if (open) {
      setValues({ ...initial });
      setAmounts({ ...initialAmounts });
      setError(null);
    }
  }, [open, initial, initialAmounts]);

  // The month just ended is the one being read; the current month is still running.
  const lastMonth = addMonths(`${todayInChina().slice(0, 7)}-01`, -1).slice(0, 7);

  const amountStreams = new Set(streams.filter((s) => s.amountMode).map((s) => String(s.id)));
  const isAmountCell = (k: string) => amountStreams.has(k.split("|")[0]);
  const cents = (v: number) => Math.round(v * 100);
  // A cell is sent when its quantity (or, for an amount-entered item, its amount) was changed.
  const changedKeys = new Set<string>();
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined && v !== initial[k]) changedKeys.add(k);
  for (const [k, v] of Object.entries(amounts)) if (v !== null && v !== undefined && v !== initialAmounts[k]) changedKeys.add(k);
  const changed = [...changedKeys].map((k) => [k, values[k] ?? null] as [string, number | null]);
  // An amount-entered reading needs both numbers.
  const incomplete = changed.filter(([k, q]) => isAmountCell(k) && (q === null || amounts[k] === null || amounts[k] === undefined));
  // The price per unit an amount-entered month works out to, compared with the nearest earlier month that has one.
  const averageBefore = (streamId: number, month: string): number | null => {
    for (const m of months) {
      if (m >= month) continue;
      const price = impliedPrice(values[cellKey(streamId, m)], amounts[cellKey(streamId, m)]);
      if (price !== null) return price;
    }
    return null;
  };

  const onOk = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<{ created: number; updated: number }>(`/contracts/${contractId}/usage-entries/bulk`, {
        entries: changed.map(([k, v]) => {
          const [streamId, period] = k.split("|");
          return { pricingStreamId: Number(streamId), period, quantity: String(v), ...(isAmountCell(k) ? { amountFen: cents(amounts[k] ?? 0) } : {}) };
        }),
      });
      message.success(t("billing.readings.done", { created: r.created, updated: r.updated }));
      onDone();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t("billing.readings.title")}
      open={open}
      width={Math.min(980, 280 + streams.reduce((w, s) => w + (s.amountMode ? 300 : 200), 0))}
      onCancel={onClose}
      onOk={onOk}
      okText={t("billing.readings.save", { count: changed.length })}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: changed.length === 0 || incomplete.length > 0, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">{t("billing.readings.intro")}</Typography.Paragraph>
      {meteredFrom && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.meteredFromNote", { date: meteredFrom })} />}
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table
        size="small"
        rowKey={(m: string) => m}
        dataSource={months}
        pagination={false}
        scroll={{ y: 420 }}
        columns={[
          { title: t("billing.month"), key: "month", width: 100, render: (_: unknown, m: string) => m },
          ...streams.map((s) => ({
            title: s.amountMode ? `${s.name} (${s.unit} · ¥)` : `${s.name} (${s.unit})`,
            key: String(s.id),
            render: (_: unknown, m: string) => {
              const k = cellKey(s.id, m);
              const quantityInput = (
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  disabled={locked.has(k) || beforeStart(m)}
                  title={locked.has(k) ? t("billing.readings.locked") : beforeStart(m) ? t("billing.readings.notBilled") : undefined}
                  autoFocus={m === lastMonth && s.id === streams[0]?.id && !locked.has(k) && !beforeStart(m)}
                  value={values[k] ?? null}
                  onChange={(v) => setValues((cur) => ({ ...cur, [k]: v as number | null }))}
                />
              );
              if (!s.amountMode) return quantityInput;
              const price = impliedPrice(values[k], amounts[k]);
              const dev = priceDeviation(price, averageBefore(s.id, m));
              const jumped = dev !== null && Math.abs(dev) > PRICE_JUMP;
              return (
                <div>
                  <Space.Compact style={{ width: "100%" }}>
                    {quantityInput}
                    <InputNumber
                      style={{ width: "100%" }}
                      min={0}
                      precision={2}
                      prefix="¥"
                      disabled={locked.has(k) || beforeStart(m)}
                      value={amounts[k] ?? null}
                      onChange={(v) => setAmounts((cur) => ({ ...cur, [k]: v as number | null }))}
                    />
                  </Space.Compact>
                  {price !== null && (
                    <Typography.Text type={jumped ? "warning" : "secondary"} style={{ fontSize: 12 }}>
                      {t("billing.readings.impliedPrice", { price: price.toFixed(4), unit: s.unit })}
                      {jumped ? ` — ${t("billing.readings.priceJump", { pct: Math.round(Math.abs(dev!) * 100), dir: t(dev! > 0 ? "billing.readings.higher" : "billing.readings.lower") })}` : ""}
                    </Typography.Text>
                  )}
                </div>
              );
            },
          })),
        ]}
      />
    </Modal>
  );
}
