import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contracts,
  billingRules,
  contractUnits,
  pricingStreams,
  pricingStreamUnits,
  rateSchedule,
  concessions,
  depositTerms,
  contractVersions,
} from "../db/schema.js";

/** Full approved-terms snapshot for a contract, written into
 * `contract_versions` at activation and again on every approved amendment.
 * Charges reference the version they were generated from, so a later
 * amendment never silently changes what a posted charge meant. */
export function buildContractSnapshot(contractId: number) {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, contractId)).get();
  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  const streamIds = streams.map((s) => s.id);
  const streamUnits = streamIds.length
    ? db.select().from(pricingStreamUnits).all().filter((r) => streamIds.includes(r.pricingStreamId))
    : [];
  const rates = streamIds.length ? db.select().from(rateSchedule).all().filter((r) => streamIds.includes(r.pricingStreamId)) : [];
  const contractConcessions = db.select().from(concessions).where(eq(concessions.contractId, contractId)).all();
  const deposits = db.select().from(depositTerms).where(eq(depositTerms.contractId, contractId)).all();

  return {
    contract,
    billingRules: rules,
    units: cUnits,
    pricingStreams: streams,
    pricingStreamUnits: streamUnits,
    rateSchedule: rates,
    concessions: contractConcessions,
    depositTerms: deposits,
  };
}

export function recordContractVersion(contractId: number, versionNumber: number, effectiveDate: string, sourceAmendmentId: number | null) {
  db.insert(contractVersions)
    .values({
      contractId,
      versionNumber,
      snapshotJson: JSON.stringify(buildContractSnapshot(contractId)),
      sourceAmendmentId,
      effectiveDate,
    })
    .run();
}
