import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { amendments, contracts } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { todayInChina } from "@lcm/shared";

type ContractStatus = "draft" | "active" | "expired" | "terminated";

/** A contract whose last day has passed is expired. termEnd is inclusive, so it
 * is still active all through that day and expires the morning after. */
export function isPastTermEnd(status: ContractStatus, termEnd: string, today: string): boolean {
  return status === "active" && termEnd < today;
}

/** The status an approved amendment asked for, once its effective date has
 * arrived. An amendment approved ahead of its effective date changes the
 * contract's terms straight away but holds the status change until then. */
export function dueStatusFromAmendment(changesJson: string, effectiveDate: string, today: string): ContractStatus | null {
  if (effectiveDate > today) return null;
  try {
    const status = (JSON.parse(changesJson) as { contract?: { status?: ContractStatus } }).contract?.status;
    return status ?? null;
  } catch {
    return null;
  }
}

export interface LifecycleResult {
  statusChanged: number;
  expired: number;
}

/** The nightly status pass, safe to run any number of times:
 *  1. active contracts with an approved amendment (e.g. an early termination)
 *     whose effective date has arrived take the status that amendment asked for;
 *  2. every other active contract past its term end becomes expired.
 * It only changes the status — nothing is archived (that stays an Admin's call)
 * and no money data is touched. */
export function runContractLifecycle(today = todayInChina()): LifecycleResult {
  let statusChanged = 0;
  let expired = 0;

  const approved = db.select().from(amendments).where(eq(amendments.status, "approved")).all();
  for (const a of approved) {
    const next = dueStatusFromAmendment(a.changesJson, a.effectiveDate, today);
    if (!next || next === "active") continue;
    const contract = db.select().from(contracts).where(eq(contracts.id, a.contractId)).get();
    if (!contract || contract.status !== "active") continue;
    // An early termination ends the contract on its effective date; that date becomes its end.
    const termEnd = next === "terminated" && a.effectiveDate < contract.termEnd ? a.effectiveDate : contract.termEnd;
    db.update(contracts).set({ status: next, termEnd, updatedAt: new Date().toISOString() }).where(eq(contracts.id, contract.id)).run();
    recordAudit({
      actorUserId: null,
      action: next === "terminated" ? "contract_terminated" : "contract_status_changed",
      entityType: "contract",
      entityId: contract.id,
      details: { contract: contract.referenceNumber, from: "active", to: next, amendmentId: a.id, effectiveDate: a.effectiveDate },
    });
    statusChanged++;
  }

  for (const c of db.select().from(contracts).where(eq(contracts.status, "active")).all()) {
    if (!isPastTermEnd(c.status, c.termEnd, today)) continue;
    db.update(contracts).set({ status: "expired", updatedAt: new Date().toISOString() }).where(eq(contracts.id, c.id)).run();
    recordAudit({
      actorUserId: null,
      action: "contract_expired",
      entityType: "contract",
      entityId: c.id,
      details: { contract: c.referenceNumber, termEnd: c.termEnd },
    });
    expired++;
  }

  return { statusChanged, expired };
}
