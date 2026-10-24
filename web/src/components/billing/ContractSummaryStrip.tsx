import { useEffect, useState } from "react";
import { Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { yuan } from "./format";
import ChargeDetailDrawer from "./ChargeDetailDrawer";

export type ChargeFilter = "all" | "unpaid" | "overdue" | "due" | "later" | "paid";

interface Item {
  chargeId: number | null;
  pricingStreamId?: number;
  serviceStart: string;
  serviceEnd?: string;
  dueDate: string;
  status: "overdue" | "due" | "upcoming" | "projected";
}
interface Row {
  overdueFen: number;
  dueFen: number;
  upcomingFen: number;
  projectedFen: number;
  nextDueDate: string | null;
  nextDueFen: number;
  items: Item[];
}
interface Overview {
  contracts: Row[];
}

/** What this contract owes, in the Dashboard's own words and numbers: Overdue, Due now, Due later this month,
 * Not billed yet and the Next bill. Each one takes you to where that information is. */
export default function ContractSummaryStrip({
  contractId,
  reloadKey,
  onFilter,
  onTab,
}: {
  contractId: number;
  reloadKey: unknown;
  /** Show these bills on the Charges tab. */
  onFilter: (filter: ChargeFilter) => void;
  onTab: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  const [detail, setDetail] = useState<{ chargeId: number | null; projected: { contractId: number; pricingStreamId: number; serviceStart: string; serviceEnd: string } | null }>({ chargeId: null, projected: null });

  useEffect(() => {
    void api
      .get<Overview>(`/billing/overview?contractId=${contractId}`)
      .then((o) => setRow(o.contracts[0] ?? null))
      .catch(() => setRow(undefined));
  }, [contractId, reloadKey]);

  if (row === undefined) return null;

  const ahead = row ? row.items.filter((i) => i.status === "upcoming" || i.status === "projected") : [];
  const nextItems = row?.nextDueDate ? ahead.filter((i) => i.dueDate === row.nextDueDate) : [];
  const openNext = () => {
    const only = nextItems.length === 1 ? nextItems[0] : null;
    if (only?.chargeId != null) setDetail({ chargeId: only.chargeId, projected: null });
    else if (only && only.pricingStreamId !== undefined && only.serviceEnd !== undefined) setDetail({ chargeId: null, projected: { contractId, pricingStreamId: only.pricingStreamId, serviceStart: only.serviceStart, serviceEnd: only.serviceEnd } });
    else if (nextItems.every((i) => i.status === "projected")) onTab("upcoming");
    else onFilter("later");
  };

  const chips: { key: string; label: string; value: string; amount: number; color?: string; onClick: () => void }[] = [
    { key: "overdue", label: t("billing.overview.overdue"), value: yuan(row?.overdueFen ?? 0), amount: row?.overdueFen ?? 0, color: token.colorError, onClick: () => onFilter("overdue") },
    { key: "due", label: t("billing.overview.dueNow"), value: yuan(row?.dueFen ?? 0), amount: row?.dueFen ?? 0, color: token.colorWarning, onClick: () => onFilter("due") },
    { key: "later", label: t("billing.overview.dueLater"), value: yuan(row?.upcomingFen ?? 0), amount: row?.upcomingFen ?? 0, onClick: () => onFilter("later") },
    { key: "projected", label: t("billing.overview.nextMonth"), value: yuan(row?.projectedFen ?? 0), amount: row?.projectedFen ?? 0, onClick: () => onTab("upcoming") },
  ];
  if (row?.nextDueDate) chips.push({ key: "next", label: t("billing.overview.nextDue"), value: `${row.nextDueDate} · ${yuan(row.nextDueFen)}`, amount: row.nextDueFen, onClick: openNext });

  if (!row) return <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>{t("billing.summary.clear")}</Typography.Text>;

  return (
    <>
      <div data-scroll-host style={{ position: "relative", marginBottom: 8, ["--hint-bg" as string]: "#f6f7f5" }}>
      <div data-scroll-body style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0" }}>
        {chips.map((c) => (
          <div
            key={c.key}
            role="button"
            tabIndex={0}
            onClick={c.onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                c.onClick();
              }
            }}
            style={{
              flex: "1 0 auto",
              minWidth: 110,
              padding: "4px 10px",
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderLeft: `3px solid ${c.amount > 0 && c.color ? c.color : token.colorBorderSecondary}`,
              borderRadius: token.borderRadius,
              cursor: "pointer",
              opacity: c.amount > 0 ? 1 : 0.55,
            }}
          >
            <div style={{ fontSize: 12, color: token.colorTextSecondary, whiteSpace: "nowrap" }}>{c.label}</div>
            <div style={{ fontWeight: 600, whiteSpace: "nowrap", color: c.amount > 0 && c.color ? c.color : undefined }}>{c.amount > 0 || c.key === "next" ? c.value : "—"}</div>
          </div>
        ))}
      </div>
      </div>
      <ChargeDetailDrawer chargeId={detail.chargeId} projected={detail.projected} onClose={() => setDetail({ chargeId: null, projected: null })} />
    </>
  );
}
