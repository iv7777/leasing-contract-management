import { useEffect, useState } from "react";
import { Alert, InputNumber, Modal, Table, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { camel, yuan } from "./format";

interface Row {
  chargeId: number;
  feeType: string;
  serviceStart: string;
  dueDate: string;
  balanceFen: number;
  amountFen: number;
}

/** Puts a receipt's unallocated money on several bills at once, the way Record payment does: every unpaid bill is
 * listed oldest first with the money already applied from the top, and the boxes stay editable for when the tenant
 * said which bills it pays. Whatever is not applied stays as unallocated credit. */
export default function AllocateReceiptModal({
  receiptId,
  onClose,
  onDone,
}: {
  /** The receipt being allocated; null keeps the dialog closed. */
  receiptId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [creditFen, setCreditFen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (receiptId === null) {
      setRows([]);
      setCreditFen(0);
      return;
    }
    setLoading(true);
    api
      .post<{ unallocatedFen: number; openCharges: Row[] }>(`/receipts/${receiptId}/allocate/preview`, {})
      .then((r) => {
        setCreditFen(r.unallocatedFen);
        setRows([...r.openCharges].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart) || a.chargeId - b.chargeId));
      })
      .catch((err) => {
        if (err instanceof ApiError) message.error(apiErrorMessage(err, t));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [receiptId, t]);

  const totalUnpaidFen = rows.reduce((s, r) => s + r.balanceFen, 0);
  const allocatedFen = rows.reduce((s, r) => s + r.amountFen, 0);
  const leftFen = creditFen - allocatedFen;
  const overAllocated = allocatedFen > creditFen;

  const setRowAmount = (chargeId: number, yuanValue: number | null) =>
    setRows((rs) => rs.map((r) => (r.chargeId === chargeId ? { ...r, amountFen: Math.round((yuanValue ?? 0) * 100) } : r)));

  const onOk = async () => {
    if (receiptId === null) return;
    setSubmitting(true);
    try {
      await api.post(`/receipts/${receiptId}/allocations`, {
        allocations: rows.filter((r) => r.amountFen > 0).map((r) => ({ chargeId: r.chargeId, amountFen: r.amountFen })),
      });
      message.success(t("billing.payment.allocated"));
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
      title={t("contracts.allocateTo")}
      open={receiptId !== null}
      width={680}
      onCancel={onClose}
      onOk={onOk}
      okText={t("contracts.allocate")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: allocatedFen <= 0 || overAllocated, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph style={{ marginBottom: 4 }}>
        {t("billing.payment.toAllocate")}: <strong>{yuan(creditFen)}</strong>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {rows.length === 0 && !loading ? t("billing.payment.noBillsOwed") : t("billing.payment.oldestFirst")}
      </Typography.Paragraph>
      {rows.length > 0 && (
        <Table
          size="small"
          rowKey="chargeId"
          loading={loading}
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
              render: (_: unknown, r: Row) => (
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
      {overAllocated && <Alert type="error" showIcon style={{ marginTop: 8 }} message={t("billing.payment.overAllocatedReceipt")} />}
      {!overAllocated && leftFen > 0 && rows.length > 0 && (
        <Alert type="info" showIcon style={{ marginTop: 8 }} message={t("billing.payment.credit", { amount: yuan(leftFen) })} />
      )}
    </Modal>
  );
}
