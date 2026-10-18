import { useEffect, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Table, Typography, message } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { addMonths, todayInChina } from "@lcm/shared";
import { api, ApiError } from "../../api/client";
import DateField from "../DateField";
import { camel, PAYMENT_METHODS, yuan } from "./format";

interface Row {
  key: number;
  receivedDate?: string;
  amount?: number | null;
  method: string;
  reference: string;
}

let nextKey = 1;
const blankRow = (over: Partial<Row> = {}): Row => ({ key: nextKey++, method: PAYMENT_METHODS[0], reference: "", ...over });

/** Entering a tenant's past payments in one go to bring the account current.
 * Rows are applied in date order, each oldest-first, all or nothing. */
export default function BulkPaymentsModal({
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
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows([blankRow()]);
      setError(null);
    }
  }, [open]);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addNextMonth = () =>
    setRows((rs) => {
      const last = rs[rs.length - 1];
      if (!last) return [blankRow()];
      return [...rs, blankRow({ receivedDate: last.receivedDate ? addMonths(last.receivedDate, 1) : undefined, amount: last.amount, method: last.method })];
    });

  const complete = rows.filter((r) => r.receivedDate && r.amount && r.amount > 0 && r.method);
  const totalFen = complete.reduce((s, r) => s + Math.round((r.amount ?? 0) * 100), 0);
  const incomplete = rows.length - complete.length;

  const onOk = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<{ results: { allocatedFen: number; unallocatedFen: number }[] }>(`/contracts/${contractId}/payments/bulk`, {
        payments: complete.map((p) => ({
          receivedDate: p.receivedDate,
          amountFen: Math.round((p.amount ?? 0) * 100),
          paymentMethod: p.method,
          externalReference: p.reference || undefined,
        })),
      });
      const credit = r.results.reduce((s, x) => s + x.unallocatedFen, 0);
      message.success(t("billing.bulkPayments.done", { count: r.results.length, total: yuan(totalFen), credit: yuan(credit) }));
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t("billing.bulkPayments.title")}
      open={open}
      width={860}
      onCancel={onClose}
      onOk={onOk}
      okText={t("billing.bulkPayments.save", { count: complete.length })}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: complete.length === 0 || incomplete > 0, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">{t("billing.bulkPayments.intro")}</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table
        size="small"
        rowKey="key"
        dataSource={rows}
        pagination={false}
        scroll={{ y: 360 }}
        columns={[
          {
            title: t("contracts.receivedDate"),
            key: "date",
            width: 170,
            render: (_: unknown, r: Row) => (
              <DateField value={r.receivedDate} onChange={(v) => update(r.key, { receivedDate: v })} disabledDate={(d) => d.format("YYYY-MM-DD") > todayInChina()} />
            ),
          },
          {
            title: t("contracts.amount"),
            key: "amount",
            width: 140,
            render: (_: unknown, r: Row) => (
              <InputNumber style={{ width: "100%" }} min={0.01} precision={2} prefix="¥" value={r.amount ?? null} onChange={(v) => update(r.key, { amount: v as number | null })} />
            ),
          },
          {
            title: t("contracts.paymentMethod"),
            key: "method",
            width: 150,
            render: (_: unknown, r: Row) => (
              <Select
                style={{ width: "100%" }}
                value={r.method}
                onChange={(v) => update(r.key, { method: v })}
                options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`billing.methods.${camel(m.toLowerCase().replace(/ /g, "_"))}`) }))}
              />
            ),
          },
          {
            title: t("billing.payment.reference"),
            key: "reference",
            render: (_: unknown, r: Row) => <Input value={r.reference} onChange={(e) => update(r.key, { reference: e.target.value })} />,
          },
          {
            title: "",
            key: "remove",
            width: 48,
            render: (_: unknown, r: Row) => (
              <Button size="small" danger type="text" icon={<DeleteOutlined />} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
            ),
          },
        ]}
      />
      <Space style={{ marginTop: 12, width: "100%", justifyContent: "space-between" }} wrap>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            {t("billing.bulkPayments.addRow")}
          </Button>
          <Button onClick={addNextMonth}>{t("billing.bulkPayments.addNextMonth")}</Button>
        </Space>
        <Typography.Text strong>
          {t("billing.bulkPayments.total")}: {yuan(totalFen)}
        </Typography.Text>
      </Space>
      {incomplete > 0 && <Typography.Paragraph type="warning" style={{ marginTop: 8 }}>{t("billing.bulkPayments.incomplete", { count: incomplete })}</Typography.Paragraph>}
    </Modal>
  );
}
