import { useEffect, useMemo, useState } from "react";
import { Alert, InputNumber, Modal, Table, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { addMonths, todayInChina } from "@lcm/shared";
import { api, ApiError } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";

export interface MeteredStream {
  id: number;
  name: string;
  unit: string;
}
interface UsageEntry {
  pricingStreamId: number;
  serviceStart: string;
  quantity: string;
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
  charges: PostedCharge[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of usageEntries) m[cellKey(u.pricingStreamId, u.serviceStart.slice(0, 7))] = Number(u.quantity);
    return m;
  }, [usageEntries]);

  const locked = useMemo(() => {
    const s = new Set<string>();
    for (const c of charges) if (c.status === "posted") s.add(cellKey(c.pricingStreamId, c.serviceStart.slice(0, 7)));
    return s;
  }, [charges]);

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
      setError(null);
    }
  }, [open, initial]);

  const changed = Object.entries(values).filter(([k, v]) => v !== null && v !== undefined && v !== initial[k]);

  const onOk = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<{ created: number; updated: number }>(`/contracts/${contractId}/usage-entries/bulk`, {
        entries: changed.map(([k, v]) => {
          const [streamId, period] = k.split("|");
          return { pricingStreamId: Number(streamId), period, quantity: String(v) };
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
      width={Math.min(900, 280 + streams.length * 200)}
      onCancel={onClose}
      onOk={onOk}
      okText={t("billing.readings.save", { count: changed.length })}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: changed.length === 0, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">{t("billing.readings.intro")}</Typography.Paragraph>
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
            title: `${s.name} (${s.unit})`,
            key: String(s.id),
            render: (_: unknown, m: string) => {
              const k = cellKey(s.id, m);
              return (
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  disabled={locked.has(k)}
                  title={locked.has(k) ? t("billing.readings.locked") : undefined}
                  value={values[k] ?? null}
                  onChange={(v) => setValues((cur) => ({ ...cur, [k]: v as number | null }))}
                />
              );
            },
          })),
        ]}
      />
    </Modal>
  );
}
