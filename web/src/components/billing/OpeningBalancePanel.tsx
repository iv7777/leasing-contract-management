import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Popconfirm, Space, message } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { yuan } from "./format";
import OpeningBalanceModal from "./OpeningBalanceModal";

interface RecordDto {
  asOfDate: string;
  balanceOwedFen: number;
  paymentFen: number;
  provisionalUntil: string;
  extras?: { feeType: string; amountFen: number }[];
  status: "provisional" | "final";
  finalBecause?: "manual" | "payment" | "expired";
}
interface StatusDto {
  record: RecordDto | null;
  blocked: "has_payments" | null;
}

/** Admin-only go-live control on the Charges tab: bring the contract up to date, then adjust it
 * for a few days, then it is final. */
export default function OpeningBalancePanel({ contractId, onChanged }: { contractId: number; onChanged: () => void }) {
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
  return (
    <>
      {!r && !status.blocked && (
        <Button style={{ marginBottom: 12, marginRight: 8 }} onClick={() => setModal("apply")}>
          {t("openingBalance.button")}
        </Button>
      )}
      {r && (
        <Alert
          style={{ marginBottom: 12 }}
          type={r.status === "provisional" ? "warning" : "success"}
          showIcon
          message={t(r.status === "provisional" ? "openingBalance.provisional" : "openingBalance.final", {
            date: r.asOfDate,
            balance: yuan(r.balanceOwedFen),
            payment: yuan(r.paymentFen),
          })}
          description={
            r.status === "provisional"
              ? t("openingBalance.provisionalNote", { until: r.provisionalUntil.slice(0, 10) })
              : t(`openingBalance.finalBecause.${r.finalBecause ?? "manual"}`)
          }
          action={
            r.status === "provisional" && (
              <Space direction="vertical" size={4}>
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
            )
          }
        />
      )}
      <OpeningBalanceModal
        open={modal !== null}
        contractId={contractId}
        adjusting={modal === "adjust"}
        initial={modal === "adjust" && r ? { asOfDate: r.asOfDate, balanceOwedFen: r.balanceOwedFen, extras: r.extras } : undefined}
        onClose={() => setModal(null)}
        onDone={changed}
      />
    </>
  );
}
