import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOccupancy, type UnitInput, type ActiveContractUnitInput } from "./occupancy.js";

test("building and open-land occupancy are computed and reported separately", () => {
  const units: UnitInput[] = [
    { id: 1, propertyId: 1, unitType: "building", rentableAreaSqm: "500" },
    { id: 2, propertyId: 1, unitType: "building", rentableAreaSqm: "300" },
    { id: 3, propertyId: 1, unitType: "open_land", rentableAreaSqm: "1000" },
  ];
  const active: ActiveContractUnitInput[] = [
    { unitId: 1, effectiveStart: "2026-01-01", effectiveEnd: null }, // leased
  ];

  const report = computeOccupancy(units, active, "2026-06-01");
  assert.equal(report.building.totalAreaSqm, "800.00");
  assert.equal(report.building.leasedAreaSqm, "500.00");
  assert.equal(report.building.occupancyPercent, "62.5");
  assert.equal(report.building.leasedUnitCount, 1);
  assert.equal(report.building.availableUnitCount, 1);

  assert.equal(report.openLand.totalAreaSqm, "1000.00");
  assert.equal(report.openLand.leasedAreaSqm, "0.00");
  assert.equal(report.openLand.occupancyPercent, "0.0");
});

test("a contract unit outside its effective date range does not count as leased", () => {
  const units: UnitInput[] = [{ id: 1, propertyId: 1, unitType: "building", rentableAreaSqm: "100" }];
  const active: ActiveContractUnitInput[] = [{ unitId: 1, effectiveStart: "2026-01-01", effectiveEnd: "2026-03-31" }];

  assert.equal(computeOccupancy(units, active, "2026-02-01").building.leasedUnitCount, 1);
  assert.equal(computeOccupancy(units, active, "2026-06-01").building.leasedUnitCount, 0);
});
