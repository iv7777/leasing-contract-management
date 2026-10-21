import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { amendments, contracts, documents } from "../db/schema.js";

/** Ids of documents a draft, pending or approved amendment relies on as its
 * supporting document. They are evidence: they can't be deleted, voided or
 * re-typed while that amendment stands (rejected / withdrawn ones don't count). */
export function citedDocumentIds(contractId: number): Set<number> {
  const rows = db
    .select({ id: amendments.supportingDocumentId })
    .from(amendments)
    .where(and(eq(amendments.contractId, contractId), inArray(amendments.status, ["draft", "pending", "approved"])))
    .all();
  return new Set(rows.map((r) => r.id).filter((id): id is number => id !== null));
}

export function contractStatusOf(contractId: number): string | null {
  return db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contractId)).get()?.status ?? null;
}

/** The signed leases still in force (not voided) on a contract. */
export function liveSignedLeaseIds(contractId: number): number[] {
  return db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.ownerType, "contract"), eq(documents.ownerId, contractId), eq(documents.docType, "signed_lease"), eq(documents.voided, false)))
    .all()
    .map((r) => r.id);
}
