import { useEffect, useState } from "react";
import { Alert, Form, Input, InputNumber, Modal, Select, Table, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { todayInChina } from "@lcm/shared";
import { api, ApiError } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import DateField from "../DateField";
import { camel, PAYMENT_METHODS, yuan } from "./format";

interface ProposedRow {
  chargeId: number;
  feeType: string;
  serviceStart: string;
  dueDate: string;
  balanceFen: number;
  amountFen: number;
}

/** "The tenant paid X on this date." The money is applied to what they owe,
 * oldest first, and the split stays editable for when a tenant says which
 * bill a payment is for. Anything not applied stays as unallocated credit. */
export default function RecordPaymentModal({
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
  const [form] = Form.useForm();
  const [rows, setRows] = useState<ProposedRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [amount, setAmount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setRows([]);
      setAmount(null);
      return;
    }
    form.setFieldsValue({ receivedDate: todayInChina(), paymentMethod: PAYMENT_METHODS[0] });
  }, [open, form]);

  // Re-propose the oldest-first split whenever the amount changes.
  useEffect(() => {
    if (!open || !amount || amount <= 0) {
      setRows([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .post<{ openCharges: ProposedRow[]; openChargeCount: number }>(`/contracts/${contractId}/payments/preview`, {
          amountFen: Math.round(amount * 100),
        })
        .then((r) => {
          // Every unpaid bill is listed, oldest first; the ones the amount doesn't reach start at 0.
          setRows([...r.openCharges].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart) || a.chargeId - b.chargeId));
          setOpenCount(r.openChargeCount);
        })
        .catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [open, amount, contractId]);

  const amountFen = Math.round((amount ?? 0) * 100);
  const totalUnpaidFen = rows.reduce((s, r) => s + r.balanceFen, 0);
  const allocatedFen = rows.reduce((s, r) => s + r.amountFen, 0);
  const creditFen = amountFen - allocatedFen;
  const overAllocated = allocatedFen > amountFen;

  const setRowAmount = (chargeId: number, yuanValue: number | null) =>
    setRows((rs) => rs.map((r) => (r.chargeId === chargeId ? { ...r, amountFen: Math.round((yuanValue ?? 0) * 100) } : r)));

  const onOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await api.post(`/contracts/${contractId}/payments`, {
        receivedDate: values.receivedDate,
        amountFen,
        paymentMethod: values.paymentMethod,
        externalReference: values.externalReference || undefined,
        allocations: rows.filter((r) => r.amountFen > 0).map((r) => ({ chargeId: r.chargeId, amountFen: r.amountFen })),
      });
      message.success(t("billing.payment.recorded"));
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) message.error(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t("billing.payment.title")}
      open={open}
      width={680}
      onCancel={onClose}
      onOk={onOk}
      okText={t("billing.payment.save")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: amountFen <= 0 || overAllocated, loading: submitting }}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="receivedDate" label={t("contracts.receivedDate")} rules={[{ required: true }]}>
          <DateField disabledDate={(d) => d.format("YYYY-MM-DD") > todayInChina()} />
        </Form.Item>
        <Form.Item name="amount" label={t("contracts.amount")} rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0.01} precision={2} prefix="¥" onChange={(v) => setAmount(v as number | null)} />
        </Form.Item>
        <Form.Item name="paymentMethod" label={t("contracts.paymentMethod")} rules={[{ required: true }]}>
          <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`billing.methods.${camel(m.toLowerCase().replace(/ /g, "_"))}`) }))} />
        </Form.Item>
        <Form.Item name="externalReference" label={t("billing.payment.reference")}>
          <Input />
        </Form.Item>
      </Form>

      {amountFen > 0 && (
        <>
          <Typography.Text strong>{t("billing.payment.appliedTo")}</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {openCount === 0 ? t("billing.payment.nothingOwed") : t("billing.payment.oldestFirst")}
          </Typography.Paragraph>
          {rows.length > 0 && (
            <Table
              size="small"
              rowKey="chargeId"
              dataSource={rows}
              pagination={{ pageSize: 10, size: "small", hideOnSinglePage: true }}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <strong>{t("billing.payment.totalUnpaid")}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{yuan(totalUnpaidFen)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2}>
                    <strong>{yuan(allocatedFen)}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
              columns={[
                { title: t("contracts.feeType"), dataIndex: "feeType", render: (v: string) => t(`contracts.${camel(v)}`) },
                { title: t("contracts.serviceStart"), dataIndex: "serviceStart" },
                { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                { title: t("contracts.balance"), dataIndex: "balanceFen", align: "right" as const, render: yuan },
                {
                  title: t("billing.payment.apply"),
                  key: "apply",
                  render: (_: unknown, r: ProposedRow) => (
                    <InputNumber
                      size="small"
                      min={0}
                      max={r.balanceFen / 100}
                      precision={2}
                      value={r.amountFen / 100}
                      onChange={(v) => setRowAmount(r.chargeId, v as number | null)}
                    />
                  ),
                },
              ]}
            />
          )}
          {overAllocated && <Alert type="error" showIcon style={{ marginTop: 8 }} message={t("billing.payment.overAllocated")} />}
          {!overAllocated && creditFen > 0 && (
            <Alert type="info" showIcon style={{ marginTop: 8 }} message={t("billing.payment.credit", { amount: yuan(creditFen) })} />
          )}
        </>
      )}
    </Modal>
  );
}
