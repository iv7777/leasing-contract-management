import { daysBetween, type IsoDate } from "@lcm/shared";

export interface ChargeInput {
  id: number;
  amountFen: number;
  dueDate: IsoDate;
  serviceStart: IsoDate;
  serviceEnd: IsoDate;
  status: "posted" | "voided";
}
export interface ChargeAdjustmentInput {
  chargeId: number;
  amountFen: number; // signed: positive = debit (increases owed), negative = credit
}
export interface ReceiptAllocationInput {
  receiptId: number;
  chargeId: number;
  amountFen: number; // signed: a reversal is a separate negative row, never an edit
}
export interface ReceiptInput {
  id: number;
  amountFen: number;
  status: "posted" | "reversed";
}

export interface ChargeBalance {
  chargeId: number;
  billedFen: number;
  adjustedFen: number;
  allocatedFen: number;
  balanceFen: number;
  isOverdue: boolean;
  daysOverdue: number;
}

/** Billed amount, allocated receipts, unpaid balance, and days overdue stay
 * distinct per the brief — nothing here mutates the original charge row. */
export function computeChargeBalance(
  charge: ChargeInput,
  adjustments: ChargeAdjustmentInput[],
  allocations: ReceiptAllocationInput[],
  asOfDate: IsoDate,
): ChargeBalance {
  const adjustedFen = adjustments.filter((a) => a.chargeId === charge.id).reduce((s, a) => s + a.amountFen, 0);
  const allocatedFen = allocations.filter((a) => a.chargeId === charge.id).reduce((s, a) => s + a.amountFen, 0);
  const balanceFen = charge.amountFen + adjustedFen - allocatedFen;
  const isOverdue = balanceFen > 0 && charge.dueDate < asOfDate;
  const daysOverdue = isOverdue ? daysBetween(charge.dueDate, asOfDate) : 0;

  return { chargeId: charge.id, billedFen: charge.amountFen, adjustedFen, allocatedFen, balanceFen, isOverdue, daysOverdue };
}

/** Money received but not (yet) applied to any charge — shown separately as
 * available credit, never treated as automatic additional income. */
export function computeUnallocatedFen(receipt: ReceiptInput, allocations: ReceiptAllocationInput[]): number {
  if (receipt.status === "reversed") return 0;
  const allocatedFen = allocations.filter((a) => a.receiptId === receipt.id).reduce((s, a) => s + a.amountFen, 0);
  return receipt.amountFen - allocatedFen;
}

export interface AllocationValidationInput {
  receipt: ReceiptInput;
  existingReceiptAllocations: ReceiptAllocationInput[];
  charge: ChargeInput;
  chargeAdjustments: ChargeAdjustmentInput[];
  existingChargeAllocations: ReceiptAllocationInput[];
  amountFen: number;
  asOfDate: IsoDate;
}

/** Refuses an allocation that would over-allocate either side: the receipt
 * can't apply more than it has left, and the charge can't be paid down past
 * its outstanding balance. */
export function validateAllocation(input: AllocationValidationInput): { ok: true } | { ok: false; reason: string } {
  if (input.amountFen <= 0) return { ok: false, reason: "Allocation amount must be positive." };
  if (input.receipt.status === "reversed") return { ok: false, reason: "This receipt has been reversed." };
  if (input.charge.status === "voided") return { ok: false, reason: "This charge has been voided." };

  const unallocated = computeUnallocatedFen(input.receipt, input.existingReceiptAllocations);
  if (input.amountFen > unallocated) {
    return { ok: false, reason: `Allocation of ${input.amountFen} exceeds the receipt's unallocated balance of ${unallocated}.` };
  }

  const chargeBalance = computeChargeBalance(input.charge, input.chargeAdjustments, input.existingChargeAllocations, input.asOfDate);
  if (input.amountFen > chargeBalance.balanceFen) {
    return { ok: false, reason: `Allocation of ${input.amountFen} exceeds the charge's outstanding balance of ${chargeBalance.balanceFen}.` };
  }

  return { ok: true };
}

export interface DepositTransactionInput {
  amountFen: number; // already signed: receipt +, refund/deduction/transfer_to_rent -, reversal opposite of what it reverses
  transactionDate: IsoDate;
}

export function computeDepositBalance(transactions: DepositTransactionInput[], asOfDate: IsoDate): number {
  return transactions.filter((t) => t.transactionDate <= asOfDate).reduce((s, t) => s + t.amountFen, 0);
}

export interface MonthlyStatementInput {
  charges: ChargeInput[];
  adjustments: (ChargeAdjustmentInput & { createdAt: IsoDate })[];
  receipts: ReceiptInput[];
  allocations: (ReceiptAllocationInput & { createdAt: IsoDate })[];
  depositTransactions: DepositTransactionInput[];
}

export interface MonthlyStatement {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  openingReceivableFen: number;
  newChargesFen: number;
  adjustmentsFen: number;
  receiptsAppliedFen: number;
  closingReceivableFen: number;
  unallocatedReceiptsFen: number;
  depositBalanceFen: number;
}

/** The brief's first working milestone: an accurate monthly collection
 * statement — opening balance, new charges, adjustments, receipts applied,
 * and closing balance, with deposits held out separately. Everything here
 * is a deterministic sum over posted rows as of the two period boundaries;
 * nothing is inferred or estimated. */
export function computeMonthlyStatement(input: MonthlyStatementInput, periodStart: IsoDate, periodEnd: IsoDate): MonthlyStatement {
  const dayBeforePeriod = shiftDate(periodStart, -1);

  const chargesAsOf = (asOf: IsoDate) => input.charges.filter((c) => c.status === "posted" && c.serviceStart <= asOf);
  const adjustmentsAsOf = (asOf: IsoDate) => input.adjustments.filter((a) => a.createdAt <= asOf);
  const allocationsAsOf = (asOf: IsoDate) => input.allocations.filter((a) => a.createdAt <= asOf);

  const receivableAsOf = (asOf: IsoDate): number => {
    const charges = chargesAsOf(asOf);
    const adjustments = adjustmentsAsOf(asOf);
    const allocations = allocationsAsOf(asOf);
    return charges.reduce((sum, c) => sum + computeChargeBalance(c, adjustments, allocations, asOf).balanceFen, 0);
  };

  const openingReceivableFen = receivableAsOf(dayBeforePeriod);
  const closingReceivableFen = receivableAsOf(periodEnd);

  const newChargesFen = input.charges
    .filter((c) => c.status === "posted" && c.serviceStart >= periodStart && c.serviceStart <= periodEnd)
    .reduce((s, c) => s + c.amountFen, 0);
  const adjustmentsFen = input.adjustments
    .filter((a) => a.createdAt >= periodStart && a.createdAt <= periodEnd)
    .reduce((s, a) => s + a.amountFen, 0);
  const receiptsAppliedFen = input.allocations
    .filter((a) => a.createdAt >= periodStart && a.createdAt <= periodEnd)
    .reduce((s, a) => s + a.amountFen, 0);

  const unallocatedReceiptsFen = input.receipts.reduce((s, r) => s + computeUnallocatedFen(r, allocationsAsOf(periodEnd)), 0);
  const depositBalanceFen = computeDepositBalance(input.depositTransactions, periodEnd);

  return {
    periodStart,
    periodEnd,
    openingReceivableFen,
    newChargesFen,
    adjustmentsFen,
    receiptsAppliedFen,
    closingReceivableFen,
    unallocatedReceiptsFen,
    depositBalanceFen,
  };
}

function shiftDate(date: IsoDate, deltaDays: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
