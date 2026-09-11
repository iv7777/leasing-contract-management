import { daysBetween, type IsoDate } from "@lcm/shared";

export type ReminderType = "renewal_notice" | "rate_change" | "deposit_shortfall" | "overdue_balance";
export type ReminderSeverity = "info" | "warning" | "critical";

export interface Reminder {
  contractId: number;
  referenceNumber: string;
  type: ReminderType;
  severity: ReminderSeverity;
  message: string;
  date: IsoDate;
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

export interface ContractReminderInput {
  contractId: number;
  referenceNumber: string;
  status: "draft" | "active" | "expired" | "terminated";
  termEnd: IsoDate;
  renewalNoticeDays: number;
  upcomingRateChanges: RateChangeInput[];
  depositRequiredFen: number | null;
  depositWaived: boolean;
  depositHeldFen: number;
  chargeBalances: ChargeBalanceInput[];
}

const RATE_CHANGE_LOOKAHEAD_DAYS = 30;

/** Computed fresh on every request rather than persisted: since nothing is
 * delivered yet (WeChat/SMS is Phase 5 per the brief), there is no stale
 * "already sent" state to track, and re-evaluating live guarantees a
 * reminder disappears the moment an amendment, payment, or adjustment
 * resolves it — automatically satisfying "don't send obsolete reminders"
 * without a dedupe table. */
export function computeReminders(contracts: ContractReminderInput[], asOfDate: IsoDate, overdueEscalationThresholdDays = 10): Reminder[] {
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
        message: `Renewal notice window is open — term ends ${c.termEnd} (${daysLeft} days left).`,
        date: c.termEnd,
      });
    }

    for (const rc of c.upcomingRateChanges) {
      if (rc.effectiveStart >= asOfDate && daysBetween(asOfDate, rc.effectiveStart) <= RATE_CHANGE_LOOKAHEAD_DAYS) {
        reminders.push({
          contractId: c.contractId,
          referenceNumber: c.referenceNumber,
          type: "rate_change",
          severity: "info",
          message: `Rate change for "${rc.pricingStreamLabel}" takes effect ${rc.effectiveStart}.`,
          date: rc.effectiveStart,
        });
      }
    }

    if (!c.depositWaived && c.depositRequiredFen !== null && c.depositHeldFen < c.depositRequiredFen) {
      reminders.push({
        contractId: c.contractId,
        referenceNumber: c.referenceNumber,
        type: "deposit_shortfall",
        severity: "warning",
        message: `Deposit shortfall: holding ${c.depositHeldFen} fen against a required ${c.depositRequiredFen} fen.`,
        date: asOfDate,
      });
    }

    for (const cb of c.chargeBalances) {
      if (cb.isOverdue && cb.daysOverdue >= overdueEscalationThresholdDays) {
        reminders.push({
          contractId: c.contractId,
          referenceNumber: c.referenceNumber,
          type: "overdue_balance",
          severity: cb.daysOverdue >= 30 ? "critical" : "warning",
          message: `Charge overdue ${cb.daysOverdue} days, balance ${cb.balanceFen} fen (due ${cb.dueDate}).`,
          date: cb.dueDate,
        });
      }
    }
  }

  return reminders;
}

function shiftDate(date: IsoDate, deltaDays: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
