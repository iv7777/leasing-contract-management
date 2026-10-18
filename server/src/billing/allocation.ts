export interface OpenCharge {
  chargeId: number;
  dueDate: string;
  serviceStart: string;
  balanceFen: number;
}

export interface ProposedAllocation {
  chargeId: number;
  amountFen: number;
}

/** Applies a payment to what is owed, oldest due date first (ties broken by
 * service period, then id, so the result is deterministic). Never allocates
 * more than a charge's balance or more than the payment; whatever is left
 * stays as unallocated credit rather than being forced onto anything. */
export function proposeAllocations(openCharges: OpenCharge[], amountFen: number): { allocations: ProposedAllocation[]; unallocatedFen: number } {
  const ordered = openCharges
    .filter((c) => c.balanceFen > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart) || a.chargeId - b.chargeId);

  let remaining = amountFen;
  const allocations: ProposedAllocation[] = [];
  for (const c of ordered) {
    if (remaining <= 0) break;
    const apply = Math.min(remaining, c.balanceFen);
    allocations.push({ chargeId: c.chargeId, amountFen: apply });
    remaining -= apply;
  }
  return { allocations, unallocatedFen: remaining };
}
