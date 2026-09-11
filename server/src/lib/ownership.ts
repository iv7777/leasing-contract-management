import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { pricingStreams, contractUnits, charges, rateSchedule } from "../db/schema.js";

/** Cross-entity ownership checks. Every route that accepts a child-entity ID
 * (pricing stream, contract unit, rate schedule, charge) in its request body
 * must verify it actually belongs to the contract being modified — a naked
 * numeric ID is not proof of ownership, and getting this wrong lets one
 * contract's amendment silently corrupt another contract's billing terms. */

export function pricingStreamBelongsToContract(pricingStreamId: number, contractId: number): boolean {
  const stream = db.select().from(pricingStreams).where(eq(pricingStreams.id, pricingStreamId)).get();
  return stream?.contractId === contractId;
}

export function contractUnitBelongsToContract(contractUnitId: number, contractId: number): boolean {
  const unit = db.select().from(contractUnits).where(eq(contractUnits.id, contractUnitId)).get();
  return unit?.contractId === contractId;
}

export function chargeBelongsToContract(chargeId: number, contractId: number): boolean {
  const charge = db.select().from(charges).where(eq(charges.id, chargeId)).get();
  return charge?.contractId === contractId;
}

export function rateScheduleBelongsToStream(rateScheduleId: number, pricingStreamId: number): boolean {
  const rate = db.select().from(rateSchedule).where(eq(rateSchedule.id, rateScheduleId)).get();
  return rate?.pricingStreamId === pricingStreamId;
}
