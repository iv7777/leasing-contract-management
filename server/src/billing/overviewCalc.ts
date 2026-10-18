export interface OverviewCharge {
  chargeId: number;
  feeType: string;
  serviceStart: string;
  dueDate: string;
  balanceFen: number;
  isOverdue: boolean;
  daysOverdue: number;
}

/** A bill the nightly job hasn't created yet but will — so collectors can
 * see what is coming next without anything being posted early. */
export interface OverviewProjected {
  feeType: string;
  serviceStart: string;
  dueDate: string;
  amountFen: number;
}

export interface OverviewContractInput {
  contractId: number;
  referenceNumber: string;
  tenantName: string;
  charges: OverviewCharge[];
  projected: OverviewProjected[];
}

export type ItemStatus = "overdue" | "due" | "upcoming" | "projected";

export interface OverviewItem {
  chargeId: number | null;
  feeType: string;
  serviceStart: string;
  dueDate: string;
  amountFen: number;
  status: ItemStatus;
  daysOverdue: number;
}

export interface ContractOverview {
  contractId: number;
  referenceNumber: string;
  tenantName: string;
  overdueFen: number;
  dueFen: number;
  upcomingFen: number;
  projectedFen: number;
  nextDueDate: string | null;
  nextDueFen: number;
  items: OverviewItem[];
}

export interface OverviewTotals {
  overdueFen: number;
  overdueCount: number;
  dueFen: number;
  dueCount: number;
  upcomingFen: number;
  projectedFen: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Sorts what each contract's tenant owes into four buckets:
 * - overdue:   past due date plus grace, still unpaid
 * - due:       due date reached (inside the grace period), unpaid — collect now
 * - upcoming:  already billed, due date still ahead
 * - projected: not billed yet, expected by the next nightly runs
 * Contracts with nothing in any bucket are left out; the rest are ordered by
 * how much is overdue, then due now. */
export function buildOverview(inputs: OverviewContractInput[], today: string): { totals: OverviewTotals; contracts: ContractOverview[] } {
  const contracts: ContractOverview[] = [];

  for (const c of inputs) {
    const items: OverviewItem[] = [];
    for (const ch of c.charges) {
      if (ch.balanceFen <= 0) continue;
      const status: ItemStatus = ch.isOverdue ? "overdue" : ch.dueDate <= today ? "due" : "upcoming";
      items.push({ chargeId: ch.chargeId, feeType: ch.feeType, serviceStart: ch.serviceStart, dueDate: ch.dueDate, amountFen: ch.balanceFen, status, daysOverdue: ch.daysOverdue });
    }
    for (const p of c.projected) {
      items.push({ chargeId: null, feeType: p.feeType, serviceStart: p.serviceStart, dueDate: p.dueDate, amountFen: p.amountFen, status: "projected", daysOverdue: 0 });
    }
    if (items.length === 0) continue;

    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart));
    const of = (s: ItemStatus) => sum(items.filter((i) => i.status === s).map((i) => i.amountFen));

    const ahead = items.filter((i) => i.status === "upcoming" || i.status === "projected");
    const nextDueDate = ahead.length > 0 ? ahead.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), ahead[0].dueDate) : null;

    contracts.push({
      contractId: c.contractId,
      referenceNumber: c.referenceNumber,
      tenantName: c.tenantName,
      overdueFen: of("overdue"),
      dueFen: of("due"),
      upcomingFen: of("upcoming"),
      projectedFen: of("projected"),
      nextDueDate,
      nextDueFen: sum(ahead.filter((i) => i.dueDate === nextDueDate).map((i) => i.amountFen)),
      items,
    });
  }

  contracts.sort((a, b) => b.overdueFen - a.overdueFen || b.dueFen - a.dueFen || (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999"));

  const all = contracts.flatMap((c) => c.items);
  return {
    totals: {
      overdueFen: sum(contracts.map((c) => c.overdueFen)),
      overdueCount: all.filter((i) => i.status === "overdue").length,
      dueFen: sum(contracts.map((c) => c.dueFen)),
      dueCount: all.filter((i) => i.status === "due").length,
      upcomingFen: sum(contracts.map((c) => c.upcomingFen)),
      projectedFen: sum(contracts.map((c) => c.projectedFen)),
    },
    contracts,
  };
}
