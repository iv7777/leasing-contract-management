export interface DepositTermInput {
  id: number;
  effectiveStart: string;
  requirementType: "fixed" | "formula";
  fixedAmountFen: number | null;
  formulaBasis: string | null;
  waiverMet: boolean | null;
  dueDate: string | null;
}

export interface DepositTermStatus {
  termId: number;
  kind: "fixed" | "formula";
  amountFen: number | null; // null for a formula term (amount can't be computed)
  formula: string | null;
  waived: boolean;
  dueDate: string | null;
  inForce: boolean; // effective and due by the as-of date
}

export type DepositState = "none" | "ok" | "short" | "manual";

export interface DepositStatus {
  requiredFen: number;
  waivedFen: number;
  heldFen: number;
  shortfallFen: number;
  /** A formula term is in force: its amount is free text, so the system can't
   * say whether the deposit is short — someone has to check by hand. */
  needsManualCheck: boolean;
  state: DepositState;
  terms: DepositTermStatus[];
}

/** One answer to "is this contract's deposit where it should be?", shared by
 * the contract page, the dashboard and the reminders so they can't disagree.
 *
 * A contract can carry several deposit terms (the original deposit, plus an
 * extra one for space added later); they add up. A term counts once it is
 * effective and its due date (if any) has arrived. A term an Admin has
 * recorded as waived counts for nothing. Formula terms can't be computed. */
export function computeDepositStatus(terms: DepositTermInput[], heldFen: number, asOf: string): DepositStatus {
  const statuses: DepositTermStatus[] = terms
    .slice()
    .sort((a, b) => a.effectiveStart.localeCompare(b.effectiveStart) || a.id - b.id)
    .map((t) => ({
      termId: t.id,
      kind: t.requirementType,
      amountFen: t.requirementType === "fixed" ? t.fixedAmountFen ?? 0 : null,
      formula: t.requirementType === "formula" ? t.formulaBasis : null,
      waived: t.waiverMet === true,
      dueDate: t.dueDate,
      inForce: t.effectiveStart <= asOf && (t.dueDate ?? t.effectiveStart) <= asOf,
    }));

  let requiredFen = 0;
  let waivedFen = 0;
  let needsManualCheck = false;
  let anyWaived = false;
  for (const t of statuses) {
    if (!t.inForce) continue;
    if (t.waived) anyWaived = true;
    if (t.kind === "formula") {
      if (!t.waived) needsManualCheck = true;
      continue;
    }
    if (t.waived) waivedFen += t.amountFen ?? 0;
    else requiredFen += t.amountFen ?? 0;
  }

  const shortfallFen = Math.max(0, requiredFen - heldFen);
  const state: DepositState =
    shortfallFen > 0 ? "short" : needsManualCheck ? "manual" : requiredFen > 0 || anyWaived ? "ok" : "none";

  return { requiredFen, waivedFen, heldFen, shortfallFen, needsManualCheck, state, terms: statuses };
}
