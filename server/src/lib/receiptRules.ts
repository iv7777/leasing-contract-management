import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { receipts } from "../db/schema.js";

export const DUPLICATE_PAYMENT_REFERENCE = "A payment with this bank reference has already been recorded on this contract.";

/** Whether a payment with the same bank/transfer reference is already on this
 * contract (reversed receipts don't count), which is almost always a double entry. */
export function paymentReferenceUsed(contractId: number, externalReference: string | null | undefined): boolean {
  const ref = externalReference?.trim();
  if (!ref) return false;
  return !!db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.contractId, contractId), eq(receipts.externalReference, ref), eq(receipts.status, "posted")))
    .get();
}
