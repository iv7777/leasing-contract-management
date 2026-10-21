import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, InputNumber, Modal, Space, Table, Tag, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { todayInChina } from "@lcm/shared";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import DateField from "../DateField";
import { streamName, yuan } from "./format";

interface BillRow {
  chargeId: number;
  feeType: string;
  streamLabel: string;
  serviceStart: string;
  serviceEnd: string;
  dueDate: string;
  balanceFen: number;
  paidFen: number;
  unpaidFen: number;
}
interface ExtraRow {
  feeType: string;
  amountFen: number;
  streamLabel: string;
}
interface Preview {
  adjusting: boolean;
  extras: ExtraRow[];
  extraProblems: { code: string; feeType: string; message: string }[];
  billedFen: number;
  balanceOwedFen: number;
  paymentFen: number;
  billCount: number;
  problems: { code: string; message: string }[];
  rows: BillRow[];
}

/** Go-live for a contract that already existed. The Admin enters the accountant's balance as of a
 * date; every bill due by then is paid except that balance. The newest bills carry the balance
 * by default, and the Admin can move it to other bills until the unpaid amounts add up exactly. */
export default function OpeningBalanceModal({
  open,
  contractId,
  adjusting,
  initial,
  onClose,
  onDone,
}: {
  open: boolean;
  contractId: number;
  adjusting: boolean;
  initial?: { asOfDate: string; balanceOwedFen: number; extras?: { feeType: string; amountFen: number }[] };
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState<string | undefined>(todayInChina());
  const [balance, setBalance] = useState<number | null>(null);
  const [electricity, setElectricity] = useState<number | null>(null);
  const [water, setWater] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unpaid, setUnpaid] = useState<Record<number, number>>({}); // chargeId -> unpaid fen
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setUnpaid({});
    setError(null);
    setAsOf(initial?.asOfDate ?? todayInChina());
    setBalance(initial ? initial.balanceOwedFen / 100 : null);
    const amountOf = (type: string) => initial?.extras?.find((e) => e.feeType === type)?.amountFen;
    setElectricity(amountOf("electricity_base") !== undefined ? amountOf("electricity_base")! / 100 : null);
    setWater(amountOf("water") !== undefined ? amountOf("water")! / 100 : null);
  }, [open, initial]);

  const balanceFen = balance === null ? null : Math.round(balance * 100);
  const extrasPayload = [
    { feeType: "electricity_base", amountFen: Math.round((electricity ?? 0) * 100) },
    { feeType: "water", amountFen: Math.round((water ?? 0) * 100) },
  ].filter((e) => e.amountFen > 0);

  const showBills = async () => {
    if (!asOf || balanceFen === null) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.post<Preview>(`/contracts/${contractId}/opening-balance/preview`, { asOfDate: asOf, balanceOwedFen: balanceFen, extras: extrasPayload });
      setPreview(p);
      setUnpaid(Object.fromEntries(p.rows.map((r) => [r.chargeId, r.unpaidFen])));
      if (p.problems.length > 0) setError(p.problems[0].message);
      else if (p.extraProblems.length > 0) setError(p.extraProblems[0].message);
    } catch (err) {
      setPreview(null);
      setError(apiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Changing the date or the balance invalidates what was shown.
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [asOf, balance, electricity, water]);

  const assignedFen = useMemo(() => Object.values(unpaid).reduce((s, v) => s + v, 0), [unpaid]);
  const remainingFen = balanceFen === null ? 0 : balanceFen - assignedFen;
  const paymentFen = preview ? preview.billedFen - (balanceFen ?? 0) : 0;
  const canConfirm = !!preview && preview.problems.length === 0 && preview.extraProblems.length === 0 && remainingFen === 0;

  const onConfirm = async () => {
    if (!preview || balanceFen === null || !asOf) return;
    setSubmitting(true);
    try {
      await api.post(`/contracts/${contractId}/opening-balance${adjusting ? "/adjust" : ""}`, {
        asOfDate: asOf,
        balanceOwedFen: balanceFen,
        unpaid: preview.rows.map((r) => ({ chargeId: r.chargeId, unpaidFen: unpaid[r.chargeId] ?? 0 })),
        extras: extrasPayload,
        expectedBilledFen: preview.billedFen,
        expectedBillCount: preview.billCount,
      });
      message.success(t(adjusting ? "openingBalance.adjusted" : "openingBalance.applied"));
      onDone();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const stateTag = (r: BillRow) => {
    const u = unpaid[r.chargeId] ?? 0;
    if (u <= 0) return <Tag color="green">{t("openingBalance.paid")}</Tag>;
    if (u >= r.balanceFen) return <Tag color="red">{t("openingBalance.unpaid")}</Tag>;
    return <Tag color="orange">{t("openingBalance.partPaid")}</Tag>;
  };

  return (
    <Modal
      title={t(adjusting ? "openingBalance.adjustTitle" : "openingBalance.title")}
      open={open}
      width={820}
      style={{ top: 24 }}
      onCancel={onClose}
      onOk={onConfirm}
      okText={t(adjusting ? "openingBalance.confirmAdjust" : "openingBalance.confirm")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: !canConfirm, loading: submitting }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">{t("openingBalance.intro")}</Typography.Paragraph>
      <Form layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item label={t("openingBalance.asOf")}>
          <DateField value={asOf} onChange={setAsOf} style={{ width: 150 }} disabledDate={(d) => d.isAfter(todayInChina())} />
        </Form.Item>
        <Form.Item label={t("openingBalance.balanceOwed")}>
          <InputNumber min={0} step={100} precision={2} prefix="¥" value={balance} onChange={setBalance} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item label={t("openingBalance.electricityOwed")}>
          <InputNumber min={0} step={100} precision={2} prefix="¥" value={electricity} onChange={setElectricity} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item label={t("openingBalance.waterOwed")}>
          <InputNumber min={0} step={100} precision={2} prefix="¥" value={water} onChange={setWater} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" ghost loading={loading} disabled={!asOf || balance === null} onClick={() => void showBills()}>
            {t("openingBalance.showBills")}
          </Button>
        </Form.Item>
      </Form>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      {preview && preview.problems.length === 0 && (
        <>
          <Space size="large" wrap style={{ marginBottom: 8 }}>
            <span>{t("openingBalance.billed", { count: preview.billCount, total: yuan(preview.billedFen) })}</span>
            <span>{t("openingBalance.openingPayment", { total: yuan(paymentFen) })}</span>
            <Typography.Text strong type={remainingFen === 0 ? "success" : "danger"}>
              {t("openingBalance.stillToAssign", { total: yuan(remainingFen) })}
            </Typography.Text>
          </Space>
          <Table
            size="small"
            rowKey="chargeId"
            pagination={false}
            scroll={{ y: 360 }}
            dataSource={preview.rows}
            columns={[
              { title: t("contracts.feeType"), render: (_: unknown, r: BillRow) => streamName(t, r.streamLabel, r.feeType) },
              { title: t("openingBalance.period"), render: (_: unknown, r: BillRow) => `${r.serviceStart} → ${r.serviceEnd}` },
              { title: t("openingBalance.due"), dataIndex: "dueDate", width: 105 },
              { title: t("openingBalance.owed"), dataIndex: "balanceFen", width: 100, align: "right" as const, render: (v: number) => yuan(v) },
              {
                title: t("openingBalance.leftUnpaid"),
                width: 140,
                render: (_: unknown, r: BillRow) => (
                  <InputNumber
                    size="small"
                    min={0}
                    max={r.balanceFen / 100}
                    step={100}
                    precision={2}
                    value={(unpaid[r.chargeId] ?? 0) / 100}
                    onChange={(v) => setUnpaid((u) => ({ ...u, [r.chargeId]: Math.round((v ?? 0) * 100) }))}
                    style={{ width: 120 }}
                  />
                ),
              },
              { title: "", width: 90, render: (_: unknown, r: BillRow) => stateTag(r) },
            ]}
          />
          {preview.extras.length > 0 && (
            <Alert
              style={{ marginTop: 8 }}
              type="info"
              showIcon
              message={t("openingBalance.broughtForwardBills")}
              description={preview.extras.map((e) => `${t(`contracts.${e.feeType === "water" ? "water" : "electricityBase"}`)}: ${yuan(e.amountFen)}`).join(" · ") + " — " + t("openingBalance.broughtForwardNote", { date: asOf })}
            />
          )}
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            {t("openingBalance.editHint")}
          </Typography.Paragraph>
        </>
      )}
    </Modal>
  );
}
