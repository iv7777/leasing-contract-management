import { useEffect, useMemo, useState } from "react";
import { Alert, Descriptions, Modal, Table, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { streamName, yuan } from "./format";

interface PlannedCharge {
  periodStart: string;
  dueDate: string;
  pricingStreamId: number;
  streamLabel: string;
  feeType: string;
  amountFen: number;
}
interface MissingReading {
  pricingStreamId: number;
  streamLabel: string;
  feeType: string;
  periodStart: string;
}
interface Preview {
  cutoff: string;
  totalFen: number;
  charges: PlannedCharge[];
  missingReadings: MissingReading[];
}

/** Admin review step for bringing an existing contract onto automatic
 * billing: shows every charge that would be created from the lease's first
 * month, posts nothing until confirmed, and the server re-checks the totals
 * so only what was reviewed can be posted. */
export default function CatchUpBillingModal({
  open,
  contractId,
  onClose,
  onDone,
}: {
  open: boolean;
  contractId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setLoading(true);
    api
      .post<Preview>(`/contracts/${contractId}/billing/catch-up/preview`)
      .then(setPreview)
      .catch((err) => setError(apiErrorMessage(err, t)))
      .finally(() => setLoading(false));
  }, [open, contractId, t]);

  const missingByStream = useMemo(() => {
    const groups = new Map<number, { name: string; months: string[] }>();
    for (const m of preview?.missingReadings ?? []) {
      const g = groups.get(m.pricingStreamId) ?? { name: streamName(t, m.streamLabel, m.feeType), months: [] };
      g.months.push(m.periodStart.slice(0, 7));
      groups.set(m.pricingStreamId, g);
    }
    return Array.from(groups.values());
  }, [preview, t]);

  const onConfirm = async () => {
    if (!preview) return;
    setSubmitting(true);
    try {
      const r = await api.post<{ created: number; totalFen: number }>(`/contracts/${contractId}/billing/catch-up`, {
        expectedTotalFen: preview.totalFen,
        expectedCount: preview.charges.length,
      });
      message.success(t("billing.catchUp.done", { count: r.created, total: yuan(r.totalFen) }));
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
      title={t("billing.catchUp.title")}
      open={open}
      width={760}
      style={{ top: 24 }}
      onCancel={onClose}
      onOk={onConfirm}
      okText={t("billing.catchUp.confirm")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: !preview, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">{t("billing.catchUp.intro")}</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      {preview && (
        <>
          <Descriptions size="small" bordered column={3} style={{ marginBottom: 12 }}>
            <Descriptions.Item label={t("billing.catchUp.chargeCount")}>{preview.charges.length}</Descriptions.Item>
            <Descriptions.Item label={t("billing.catchUp.total")}>
              <Typography.Text strong>{yuan(preview.totalFen)}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("billing.catchUp.through")}>{preview.cutoff}</Descriptions.Item>
          </Descriptions>

          {missingByStream.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={t("billing.catchUp.missingTitle")}
              description={
                <>
                  <div>{t("billing.catchUp.missingBody")}</div>
                  {missingByStream.map((g) => (
                    <div key={g.name}>
                      <strong>{g.name}</strong>: {g.months.join(", ")}
                    </div>
                  ))}
                </>
              }
            />
          )}

          <Table
            size="small"
            rowKey={(c) => `${c.pricingStreamId}-${c.periodStart}`}
            dataSource={preview.charges}
            loading={loading}
            pagination={false}
            scroll={{ y: 260 }}
            columns={[
              { title: t("billing.month"), key: "month", render: (_: unknown, c: PlannedCharge) => c.periodStart.slice(0, 7) },
              { title: t("contracts.feeType"), key: "fee", render: (_: unknown, c: PlannedCharge) => streamName(t, c.streamLabel, c.feeType) },
              { title: t("contracts.dueDate"), dataIndex: "dueDate" },
              { title: t("contracts.amount"), dataIndex: "amountFen", align: "right" as const, render: yuan },
            ]}
          />
        </>
      )}
      {loading && !preview && <Typography.Text type="secondary">{t("common.loading")}</Typography.Text>}
    </Modal>
  );
}
