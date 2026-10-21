import { proposeAllocations, type OpenCharge } from "../billing/allocation.js";

/** Payment method recorded on the one receipt an opening balance creates. */
export const OPENING_METHOD = "Opening balance";
/** How long an Admin can still adjust an opening balance before it is final. */
export const PROVISIONAL_DAYS = 7;

export type OpeningProblem =
  | "negative_balance"
  | "balance_exceeds_billed"
  | "unpaid_unknown_bill"
  | "unpaid_exceeds_bill"
  | "unpaid_total_mismatch";

export interface OpeningPlanRow {
  chargeId: number;
  balanceFen: number; // what the bill still owed before the opening payment
  paidFen: number; // covered by the opening payment
  unpaidFen: number; // left owing
}

export interface OpeningPlan {
  billedFen: number;
  balanceOwedFen: number;
  paymentFen: number;
  rows: OpeningPlanRow[];
  problems: OpeningProblem[];
}

/** Works out the opening payment for a contract: everything billed and due by the
 * as-of date, less the balance the accountant says is still owed. With no explicit
 * choice the oldest bills are paid first, so the newest carry the balance; with
 * `unpaid` the Admin names exactly how much stays owing on each bill (the rest is
 * paid). Pure: the caller supplies the in-scope bills (due on or before the date,
 * with what each still owes). */
export function planOpening(inScope: OpenCharge[], balanceOwedFen: number, unpaid?: { chargeId: number; unpaidFen: number }[]): OpeningPlan {
  const bills = inScope.filter((c) => c.balanceFen > 0);
  const billedFen = bills.reduce((s, c) => s + c.balanceFen, 0);
  const problems: OpeningProblem[] = [];
  const empty = (): OpeningPlan => ({ billedFen, balanceOwedFen, paymentFen: 0, rows: bills.map((c) => ({ chargeId: c.chargeId, balanceFen: c.balanceFen, paidFen: 0, unpaidFen: c.balanceFen })), problems });

  if (!Number.isInteger(balanceOwedFen) || balanceOwedFen < 0) return { ...empty(), problems: ["negative_balance"] };
  if (balanceOwedFen > billedFen) return { ...empty(), problems: ["balance_exceeds_billed"] };

  const paymentFen = billedFen - balanceOwedFen;
  let unpaidByCharge: Map<number, number>;

  if (unpaid) {
    unpaidByCharge = new Map();
    for (const u of unpaid) {
      const bill = bills.find((c) => c.chargeId === u.chargeId);
      if (!bill) problems.push("unpaid_unknown_bill");
      else if (!Number.isInteger(u.unpaidFen) || u.unpaidFen < 0 || u.unpaidFen > bill.balanceFen) problems.push("unpaid_exceeds_bill");
      else unpaidByCharge.set(u.chargeId, u.unpaidFen);
    }
    const total = [...unpaidByCharge.values()].reduce((s, v) => s + v, 0);
    if (problems.length === 0 && total !== balanceOwedFen) problems.push("unpaid_total_mismatch");
  } else {
    const { allocations } = proposeAllocations(bills, paymentFen);
    const paid = new Map(allocations.map((a) => [a.chargeId, a.amountFen]));
    unpaidByCharge = new Map(bills.map((c) => [c.chargeId, c.balanceFen - (paid.get(c.chargeId) ?? 0)]));
  }

  const ordered = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart) || a.chargeId - b.chargeId);
  const rows = ordered.map((c) => {
    const unpaidFen = unpaidByCharge.get(c.chargeId) ?? (unpaid ? 0 : c.balanceFen);
    return { chargeId: c.chargeId, balanceFen: c.balanceFen, paidFen: c.balanceFen - unpaidFen, unpaidFen };
  });
  return { billedFen, balanceOwedFen, paymentFen, rows, problems };
}

export interface OpeningStanding {
  status: "provisional" | "final" | "reversed";
  /** Why a provisional one became final by itself. */
  finalBecause?: "manual" | "payment" | "expired";
}

/** Whether an opening balance can still be adjusted. It stops being provisional when an
 * Admin finalizes it, when any other receipt is recorded on the contract after it, or
 * once PROVISIONAL_DAYS have passed — whichever comes first. */
export function openingStanding(
  row: { status: "provisional" | "final" | "reversed"; provisionalUntil: string },
  laterPayment: boolean,
  now: Date = new Date(),
): OpeningStanding {
  if (row.status === "reversed") return { status: "reversed" };
  if (row.status === "final") return { status: "final", finalBecause: "manual" };
  if (laterPayment) return { status: "final", finalBecause: "payment" };
  if (now.getTime() >= new Date(row.provisionalUntil).getTime()) return { status: "final", finalBecause: "expired" };
  return { status: "provisional" };
}

export function provisionalUntil(from: Date = new Date()): string {
  return new Date(from.getTime() + PROVISIONAL_DAYS * 86400000).toISOString();
}
