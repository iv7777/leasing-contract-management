import { useCallback, useEffect, useState } from "react";
import { Button, Popconfirm, Space, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { yuan } from "./format";
import OpeningBalanceModal from "./OpeningBalanceModal";
import StatusStrip, { type StripItem } from "./StatusStrip";

interface RecordDto {
  asOfDate: string;
  balanceOwedFen: number;
  paymentFen: number;
  provisionalUntil: string;
  extras?: { feeType: string; amountFen: number }[];
  depositFen?: number;
  depositHeldFen?: number | null;
  status: "provisional" | "final";
  finalBecause?: "manual" | "payment" | "expired";
}
interface StatusDto {
  record: RecordDto | null;
  blocked: "has_payments" | null;
}

/** Admin-only go-live control on the Charges tab: bring the contract up to date, then adjust it
 * for a few days, then it is final. Its notice sits in one folded strip with any `extraItems` (the billing notice). */
export default function OpeningBalancePanel({ contractId, onChanged, extraItems = [] }: { contractId: number; onChanged: () => void; extraItems?: StripItem[] }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [modal, setModal] = useState<"apply" | "adjust" | null>(null);

  const load = useCallback(() => {
    api.get<StatusDto>(`/contracts/${contractId}/opening-balance`).then(setStatus).catch(() => setStatus(null));
  }, [contractId]);
  useEffect(load, [load]);

  const changed = () => {
    load();
    onChanged();
  };
  const act = async (path: "finalize" | "undo") => {
    try {
      await api.post(`/contracts/${contractId}/opening-balance/${path}`);
      changed();
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    }
  };

  if (!status) return null;
  const r = status.record;
  const headline = r
    ? t(r.status === "provisional" ? "openingBalance.provisional" : "openingBalance.final", {
        date: r.asOfDate,
        balance: yuan(r.balanceOwedFen),
        payment: yuan(r.paymentFen),
      }) + (r.depositFen ? " " + t("openingBalance.depositRecordedNote", { total: yuan(r.depositFen) }) : "")
    : "";
  const openingItem: StripItem | null = r
    ? {
        key: "opening",
        tone: r.status === "provisional" ? "warning" : "success",
        title: t(r.status === "provisional" ? "openingBalance.stripProvisional" : "openingBalance.stripFinal", { date: r.asOfDate }),
        hint: r.status === "provisional" ? t("openingBalance.stripUntil", { until: r.provisionalUntil.slice(0, 10) }) : undefined,
        body: (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text strong>{headline}</Typography.Text>
            <Typography.Text type="secondary">
              {r.status === "provisional" ? t("openingBalance.provisionalNote", { until: r.provisionalUntil.slice(0, 10) }) : t(`openingBalance.finalBecause.${r.finalBecause ?? "manual"}`)}
            </Typography.Text>
            {r.status === "provisional" && (
              <Space wrap>
                <Button size="small" type="primary" onClick={() => setModal("adjust")}>
                  {t("openingBalance.adjust")}
                </Button>
                <Popconfirm title={t("openingBalance.finalizeConfirm")} onConfirm={() => void act("finalize")} okText={t("openingBalance.finalize")} cancelText={t("common.cancel")}>
                  <Button size="small">{t("openingBalance.finalize")}</Button>
                </Popconfirm>
                <Popconfirm title={t("openingBalance.undoConfirm")} onConfirm={() => void act("undo")} okText={t("openingBalance.undo")} cancelText={t("common.cancel")}>
                  <Button size="small" danger>
                    {t("openingBalance.undo")}
                  </Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        ),
      }
    : null;
  return (
    <>
      {!r && !status.blocked && (
        <Button style={{ marginBottom: 12, marginRight: 8 }} onClick={() => setModal("apply")}>
          {t("openingBalance.button")}
        </Button>
      )}
      <StatusStrip items={[...extraItems, ...(openingItem ? [openingItem] : [])]} />
      <OpeningBalanceModal
        open={modal !== null}
        contractId={contractId}
        adjusting={modal === "adjust"}
        initial={modal === "adjust" && r ? { asOfDate: r.asOfDate, balanceOwedFen: r.balanceOwedFen, extras: r.extras, depositHeldFen: r.depositHeldFen ?? null } : undefined}
        onClose={() => setModal(null)}
        onDone={changed}
      />
    </>
  );
}
