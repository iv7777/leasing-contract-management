import { daysBetween, type IsoDate } from "@lcm/shared";

export type ReminderType = "renewal_notice" | "rate_change" | "deposit_shortfall" | "deposit_check" | "overdue_balance" | "missing_reading";
export type ReminderSeverity = "info" | "warning" | "critical";

/** Money fields here are always fen (integer, matching every other amount
 * in the system) — the UI is responsible for converting to yuan and
 * translating the message, the same way charge/receipt amounts are
 * formatted client-side rather than baked into a pre-rendered string. */
export interface Reminder {
  contractId: number;
  referenceNumber: string;
  type: ReminderType;
  severity: ReminderSeverity;
  date: IsoDate;
  params: Record<string, string | number>;
}

export interface RateChangeInput {
  effectiveStart: IsoDate;
  pricingStreamLabel: string;
}

export interface ChargeBalanceInput {
  chargeId: number;
  balanceFen: number;
  dueDate: IsoDate;
  isOverdue: boolean;
  daysOverdue: number;
}

export interface MissingReadingInput {
  stream: string;
  month: string; // YYYY-MM
}

export interface DepositReminderInput {
  state: "none" | "ok" | "short" | "manual";
  requiredFen: number;
  heldFen: number;
  shortfallFen: number;
}

export interface ContractReminderInput {
  contractId: number;
  referenceNumber: string;
  status: "draft" | "active" | "expired" | "terminated";
  termEnd: IsoDate;
  renewalNoticeDays: number;
  upcomingRateChanges: RateChangeInput[];
  deposit: DepositReminderInput;
  chargeBalances: ChargeBalanceInput[];
  missingReadings: MissingReadingInput[];
}

const RATE_CHANGE_LOOKAHEAD_DAYS = 30;

/** Computed fresh on every request rather than persisted: since nothing is
 * delivered yet (WeChat/SMS is Phase 5 per the brief), there is no stale
 * "already sent" state to track, and re-evaluating live guarantees a
 * reminder disappears the moment an amendment, payment, or adjustment
 * resolves it — automatically satisfying "don't send obsolete reminders"
 * without a dedupe table. */
export function computeReminders(contracts: ContractReminderInput[], asOfDate: IsoDate): Reminder[] {
  const reminders: Reminder[] = [];

  for (const c of contracts) {
    if (c.status !== "active") continue;

    const noticeDeadline = shiftDate(c.termEnd, -c.renewalNoticeDays);
    if (asOfDate >= noticeDeadline && asOfDate <= c.termEnd) {
      const daysLeft = daysBetween(asOfDate, c.termEnd);
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "renewal_notice",
        severity: daysLeft <= 30 ? "critical" : "warning",
        date: c.termEnd,
        params: { termEnd: c.termEnd, daysLeft },
      });
    }

    for (const rc of c.upcomingRateChanges) {
      if (rc.effectiveStart >= asOfDate && daysBetween(asOfDate, rc.effectiveStart) <= RATE_CHANGE_LOOKAHEAD_DAYS) {
        reminders.push({
          contractId: c.contractId,
          referenceNumber: c.referenceNumber,
          type: "rate_change",
          severity: "info",
          date: rc.effectiveStart,
          params: { pricingStreamLabel: rc.pricingStreamLabel, effectiveStart: rc.effectiveStart },
        });
      }
    }

    if (c.deposit.state === "short") {
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "deposit_shortfall",
        severity: "warning",
        date: asOfDate,
        params: { depositHeldFen: c.deposit.heldFen, depositRequiredFen: c.deposit.requiredFen, shortfallFen: c.deposit.shortfallFen },
      });
    } else if (c.deposit.state === "manual") {
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "deposit_check",
        severity: "info",
        date: asOfDate,
        params: { depositHeldFen: c.deposit.heldFen },
      });
    }

    // One overdue reminder per contract, from the first day after the grace
    // period (days overdue already count from its end): the tenant's total,
    // how many bills, and how long the oldest has been waiting. Settling or
    // adjusting the bills makes it disappear on its own.
    const overdue = c.chargeBalances.filter((cb) => cb.isOverdue && cb.balanceFen > 0);
    if (overdue.length > 0) {
      const oldest = overdue.reduce((a, b) => (b.dueDate < a.dueDate ? b : a));
      const longest = Math.max(...overdue.map((o) => o.daysOverdue));
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "overdue_balance",
        severity: longest >= 30 ? "critical" : "warning",
        date: oldest.dueDate,
        params: { count: overdue.length, balanceFen: overdue.reduce((sum, o) => sum + o.balanceFen, 0), daysOverdue: longest, dueDate: oldest.dueDate },
      });
    }

    // Metered fees can't be billed without a reading — the one manual input.
    if (c.missingReadings.length > 0) {
      const months = Array.from(new Set(c.missingReadings.map((m) => m.month))).sort();
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "missing_reading",
        severity: "warning",
        date: `${months[0]}-01`,
        params: { count: c.missingReadings.length, streams: Array.from(new Set(c.missingReadings.map((m) => m.stream))).join(", "), months: months.join(", ") },
      });
    }
  }

  // Most urgent first; within a level, the oldest issue first.
  const rank: Record<ReminderSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return reminders.sort((a, b) => rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date));
}

function shiftDate(date: IsoDate, deltaDays: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
