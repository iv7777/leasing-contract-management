/** A statement of account for a contract over any period: every bill, adjustment and payment on its own date, with a
 * running balance. Bills are dated by their due date and payments by the day they were received, which is how a
 * tenant reads their own account. Pure: it only adds up the rows it is given. */

export interface StatementCharge {
  id: number;
  pricingStreamId: number;
  feeType: string;
  serviceStart: string;
  serviceEnd: string;
  dueDate: string;
  amountFen: number;
  status: "posted" | "voided";
  broughtForward: boolean;
  oneOff?: boolean;
}
export interface StatementAdjustment {
  id: number;
  chargeId: number;
  /** Signed: positive increases what is owed. */
  amountFen: number;
  reason: string;
  /** The day it was made (China). */
  date: string;
}
export interface StatementReceipt {
  id: number;
  receivedDate: string;
  amountFen: number;
  paymentMethod: string;
  externalReference: string | null;
  status: "posted" | "reversed";
  removed: boolean;
}
export interface StatementAllocation {
  receiptId: number;
  chargeId: number;
  amountFen: number;
  /** The day it was made (China). */
  date: string;
}

export interface StatementLine {
  key: string;
  date: string;
  kind: "charge" | "adjustment" | "payment";
  /** Bills: the item and its service period. */
  chargeId?: number;
  pricingStreamId?: number;
  feeType?: string;
  serviceStart?: string;
  serviceEnd?: string;
  broughtForward?: boolean;
  oneOff?: boolean;
  /** Payments. */
  receiptId?: number;
  paymentMethod?: string;
  reference?: string | null;
  /** Adjustments. */
  reason?: string;
  /** What the line adds to (+) or takes off (−) the balance; 0 for a line kept only for the record. */
  effectFen: number;
  debitFen: number;
  creditFen: number;
  /** Balance after this line (not set on lines kept only for the record). */
  balanceFen: number | null;
  /** A voided bill, or a reversed/removed payment: shown only when asked for, and counted for nothing. */
  muted: null | "voided" | "reversed" | "removed";
}

export interface AccountStatement {
  from: string | null;
  to: string | null;
  openingFen: number;
  chargesFen: number;
  adjustmentsFen: number;
  paymentsFen: number;
  closingFen: number;
  /** Payments received up to the end of the period that are not applied to any bill (all items only). */
  unallocatedFen: number;
  lines: StatementLine[];
}

export interface StatementInput {
  charges: StatementCharge[];
  adjustments: StatementAdjustment[];
  receipts: StatementReceipt[];
  allocations: StatementAllocation[];
}

const KIND_ORDER = { charge: 0, adjustment: 1, payment: 2 } as const;

export function buildAccountStatement(
  input: StatementInput,
  opts: { from: string | null; to: string | null; pricingStreamId?: number | null; includeMuted?: boolean },
): AccountStatement {
  const { from, to } = opts;
  const byStream = opts.pricingStreamId ?? null;
  const charges = input.charges.filter((c) => byStream === null || c.pricingStreamId === byStream);
  const postedIds = new Set(charges.filter((c) => c.status === "posted").map((c) => c.id));

  const all: Omit<StatementLine, "balanceFen">[] = [];

  for (const c of charges) {
    const muted = c.status === "voided" ? "voided" : null;
    const effect = muted ? 0 : c.amountFen;
    all.push({
      key: `c${c.id}`, date: c.dueDate, kind: "charge", chargeId: c.id, pricingStreamId: c.pricingStreamId, feeType: c.feeType,
      serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, broughtForward: c.broughtForward, oneOff: c.oneOff,
      effectFen: effect, debitFen: c.amountFen, creditFen: 0, muted,
    });
  }
  for (const a of input.adjustments) {
    if (!postedIds.has(a.chargeId)) continue;
    const c = charges.find((x) => x.id === a.chargeId)!;
    all.push({
      key: `a${a.id}`, date: a.date, kind: "adjustment", chargeId: a.chargeId, pricingStreamId: c.pricingStreamId, feeType: c.feeType,
      serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, reason: a.reason,
      effectFen: a.amountFen, debitFen: Math.max(a.amountFen, 0), creditFen: Math.max(-a.amountFen, 0), muted: null,
    });
  }

  if (byStream === null) {
    // Every payment received, whether or not it has been applied to a bill yet.
    for (const r of input.receipts) {
      const muted = r.removed ? "removed" : r.status === "reversed" ? "reversed" : null;
      all.push({
        key: `r${r.id}`, date: r.receivedDate, kind: "payment", receiptId: r.id, paymentMethod: r.paymentMethod, reference: r.externalReference,
        effectFen: muted ? 0 : -r.amountFen, debitFen: 0, creditFen: r.amountFen, muted,
      });
    }
  } else {
    // For one item, what was applied to its bills, on the day the payment was received.
    const receiptById = new Map(input.receipts.map((r) => [r.id, r]));
    const net = new Map<number, number>();
    for (const al of input.allocations) {
      if (!charges.some((c) => c.id === al.chargeId)) continue;
      net.set(al.receiptId, (net.get(al.receiptId) ?? 0) + al.amountFen);
    }
    for (const [receiptId, amount] of net) {
      const r = receiptById.get(receiptId);
      if (!r || amount <= 0 || r.status !== "posted") continue;
      all.push({
        key: `r${r.id}`, date: r.receivedDate, kind: "payment", receiptId: r.id, paymentMethod: r.paymentMethod, reference: r.externalReference,
        effectFen: -amount, debitFen: 0, creditFen: amount, muted: null,
      });
    }
  }

  const rank = (l: { kind: StatementLine["kind"] }) => KIND_ORDER[l.kind];
  all.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.key.localeCompare(b.key, undefined, { numeric: true }));

  const openingFen = from === null ? 0 : all.filter((l) => l.date < from).reduce((s, l) => s + l.effectFen, 0);
  const inPeriod = all.filter((l) => (from === null || l.date >= from) && (to === null || l.date <= to));

  let balance = openingFen;
  const lines: StatementLine[] = [];
  for (const l of inPeriod) {
    if (l.muted && !opts.includeMuted) continue;
    balance += l.effectFen;
    lines.push({ ...l, balanceFen: l.muted ? null : balance });
  }

  const sum = (kind: StatementLine["kind"]) => inPeriod.filter((l) => l.kind === kind).reduce((s, l) => s + l.effectFen, 0);

  let unallocatedFen = 0;
  if (byStream === null) {
    for (const r of input.receipts) {
      if (r.status !== "posted" || (to !== null && r.receivedDate > to)) continue;
      const applied = input.allocations.filter((al) => al.receiptId === r.id && (to === null || al.date <= to)).reduce((s, al) => s + al.amountFen, 0);
      unallocatedFen += Math.max(r.amountFen - applied, 0);
    }
  }

  return {
    from,
    to,
    openingFen,
    chargesFen: sum("charge"),
    adjustmentsFen: sum("adjustment"),
    paymentsFen: -sum("payment"),
    closingFen: openingFen + inPeriod.reduce((s, l) => s + l.effectFen, 0),
    unallocatedFen,
    lines,
  };
}
