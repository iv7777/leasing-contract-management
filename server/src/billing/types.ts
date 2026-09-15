import type { IsoDate } from "@lcm/shared";

export type CalculationMethod = "flat" | "per_sqm" | "percentage_escalation" | "metered";
export type RateBasis = "per_month" | "per_quarter" | "per_year" | "per_sqm_per_month" | "per_unit";

export interface ContractUnitInput {
  id: number;
  effectiveStart: IsoDate;
  effectiveEnd: IsoDate | null;
  contractedAreaSqm: string;
}

export interface PricingStreamInput {
  id: number;
  feeType: string;
  targetType: "unit" | "group" | "contract";
}

export interface PricingStreamUnitInput {
  pricingStreamId: number;
  contractUnitId: number;
}

export interface RateScheduleInput {
  id: number;
  pricingStreamId: number;
  effectiveStart: IsoDate;
  effectiveEnd: IsoDate | null;
  calculationMethod: CalculationMethod;
  amountOrRate: string; // decimal yuan
  rateBasis: RateBasis;
  escalationBase: "initial" | "previous" | null;
  escalationPercentage: string | null; // decimal, e.g. "5" = 5%
  escalationIntervalMonths: number | null;
  unit: string | null; // metered only: the unit amountOrRate is priced per (e.g. "kWh")
}

export interface ConcessionInput {
  pricingStreamId: number | null; // null = applies to every stream
  effectiveStart: IsoDate;
  effectiveEnd: IsoDate;
  discountPercentage: string; // "100" = full waiver
  reason?: string | null;
}

export interface BillingRulesInput {
  dueDay: number;
  dueMonthOffset: number;
}

export interface UsageEntryInput {
  pricingStreamId: number;
  serviceStart: IsoDate;
  serviceEnd: IsoDate;
  quantity: string; // decimal
}

export interface ChargeEngineInput {
  contractUnits: ContractUnitInput[];
  pricingStreams: PricingStreamInput[];
  pricingStreamUnits: PricingStreamUnitInput[];
  rateSchedule: RateScheduleInput[];
  concessions: ConcessionInput[];
  billingRules: BillingRulesInput;
  usageEntries: UsageEntryInput[];
}

export interface ChargeLineSnapshotSubperiod {
  start: IsoDate;
  end: IsoDate;
  rateScheduleId: number;
  calculationMethod: CalculationMethod;
  rateBasis: RateBasis;
  baseRate: string;
  effectiveRate: string;
  areaSqm: string | null;
  daysInSubperiod: number;
  daysInMonth: number;
  monthlyEquivalent: string;
  proratedAmount: string;
  concessionDiscountPercentage: string | null;
  concessionReason: string | null;
  amountAfterConcession: string;
  quantity?: string;
  unit?: string | null;
}

export interface ChargeLine {
  pricingStreamId: number;
  feeType: string;
  serviceStart: IsoDate;
  serviceEnd: IsoDate;
  dueDate: IsoDate;
  amountFen: number;
  snapshot: {
    subperiods: ChargeLineSnapshotSubperiod[];
    totalBeforeRounding: string;
  };
}
