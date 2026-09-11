import { Decimal, type IsoDate } from "@lcm/shared";

export interface UnitInput {
  id: number;
  propertyId: number;
  unitType: "building" | "open_land";
  rentableAreaSqm: string;
}

export interface ActiveContractUnitInput {
  unitId: number;
  effectiveStart: IsoDate;
  effectiveEnd: IsoDate | null;
}

export interface OccupancySummary {
  totalAreaSqm: string;
  leasedAreaSqm: string;
  occupancyPercent: string;
  unitCount: number;
  leasedUnitCount: number;
  availableUnitCount: number;
}

export interface OccupancyReport {
  asOfDate: IsoDate;
  building: OccupancySummary;
  openLand: OccupancySummary;
}

/** Leased area / total eligible rentable area, kept separate for buildings
 * vs open land since combining them would misstate either figure (brief
 * §5). Only `activeContractUnits` belonging to non-draft/non-terminated
 * contracts should be passed in — the caller filters by contract status. */
export function computeOccupancy(units: UnitInput[], activeContractUnits: ActiveContractUnitInput[], asOfDate: IsoDate): OccupancyReport {
  const leasedUnitIds = new Set(
    activeContractUnits
      .filter((cu) => cu.effectiveStart <= asOfDate && (!cu.effectiveEnd || cu.effectiveEnd >= asOfDate))
      .map((cu) => cu.unitId),
  );

  const summarize = (list: UnitInput[]): OccupancySummary => {
    const totalArea = list.reduce((sum, u) => sum.plus(new Decimal(u.rentableAreaSqm)), new Decimal(0));
    const leased = list.filter((u) => leasedUnitIds.has(u.id));
    const leasedArea = leased.reduce((sum, u) => sum.plus(new Decimal(u.rentableAreaSqm)), new Decimal(0));
    const occupancyPercent = totalArea.isZero() ? new Decimal(0) : leasedArea.dividedBy(totalArea).times(100);

    return {
      totalAreaSqm: totalArea.toFixed(2),
      leasedAreaSqm: leasedArea.toFixed(2),
      occupancyPercent: occupancyPercent.toFixed(1),
      unitCount: list.length,
      leasedUnitCount: leased.length,
      availableUnitCount: list.length - leased.length,
    };
  };

  return {
    asOfDate,
    building: summarize(units.filter((u) => u.unitType === "building")),
    openLand: summarize(units.filter((u) => u.unitType === "open_land")),
  };
}
