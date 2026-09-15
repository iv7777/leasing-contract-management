import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { usageEntries, rateSchedule, charges } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { pricingStreamBelongsToContract } from "../lib/ownership.js";
import { recordAudit } from "../lib/audit.js";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number");

export const usageEntriesRouter = Router();
usageEntriesRouter.use(requireAuth);

function ensureContractAccess(req: import("express").Request, res: import("express").Response, contractId: number): boolean {
  if (!canAccessContract(req.user!, contractId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return false;
  }
  return true;
}

/** A usage entry only makes sense against a stream whose rate at the entry's
 * service-start date is "metered" — otherwise there is no price-per-unit to
 * multiply the quantity by. */
function streamIsMeteredAt(pricingStreamId: number, atDate: string): boolean {
  const rate = db
    .select()
    .from(rateSchedule)
    .where(eq(rateSchedule.pricingStreamId, pricingStreamId))
    .all()
    .find((r) => r.effectiveStart <= atDate && (!r.effectiveEnd || r.effectiveEnd >= atDate));
  return rate?.calculationMethod === "metered";
}

/** Once a charge has been posted for this exact stream+period, the usage
 * entry that fed it must not silently change underneath the posted amount. */
function chargeAlreadyPosted(contractId: number, pricingStreamId: number, serviceStart: string, serviceEnd: string): boolean {
  return !!db
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.contractId, contractId),
        eq(charges.pricingStreamId, pricingStreamId),
        eq(charges.serviceStart, serviceStart),
        eq(charges.serviceEnd, serviceEnd),
      ),
    )
    .get();
}

usageEntriesRouter.get("/contracts/:contractId/usage-entries", (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  const rows = db.select().from(usageEntries).where(eq(usageEntries.contractId, contractId)).all();
  res.json({ usageEntries: rows });
});

const addUsageEntrySchema = z.object({
  pricingStreamId: z.number(),
  serviceStart: z.string(),
  serviceEnd: z.string(),
  quantity: decimalString,
  unit: z.string().min(1),
  source: z.string().optional(),
});

usageEntriesRouter.post("/contracts/:contractId/usage-entries", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;

  const parsed = addUsageEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid usage entry payload.", details: parsed.error.flatten() } });

  const { pricingStreamId, serviceStart, serviceEnd, source, ...rest } = parsed.data;
  if (!pricingStreamBelongsToContract(pricingStreamId, contractId)) {
    return res.status(400).json({ error: { code: "invalid_reference", message: "Pricing stream does not belong to this contract." } });
  }
  if (!streamIsMeteredAt(pricingStreamId, serviceStart)) {
    return res.status(400).json({ error: { code: "not_metered", message: "This pricing stream is not on a metered rate at the given service start date." } });
  }

  const duplicate = db
    .select()
    .from(usageEntries)
    .where(and(eq(usageEntries.pricingStreamId, pricingStreamId), eq(usageEntries.serviceStart, serviceStart), eq(usageEntries.serviceEnd, serviceEnd)))
    .get();
  if (duplicate) {
    return res.status(409).json({ error: { code: "duplicate_usage", message: "A usage entry already exists for this stream and period." } });
  }

  const inserted = db
    .insert(usageEntries)
    .values({ contractId, pricingStreamId, serviceStart, serviceEnd, source: source ?? null, enteredBy: req.user!.id, ...rest })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_recorded", entityType: "contract", entityId: contractId, details: { pricingStreamId, quantity: rest.quantity, unit: rest.unit } });
  res.status(201).json({ usageEntry: inserted });
});

const updateUsageEntrySchema = z.object({
  serviceStart: z.string().optional(),
  serviceEnd: z.string().optional(),
  quantity: decimalString.optional(),
  unit: z.string().min(1).optional(),
  source: z.string().nullable().optional(),
});

usageEntriesRouter.patch("/usage-entries/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(usageEntries).where(eq(usageEntries.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Usage entry not found." } });
  if (!ensureContractAccess(req, res, existing.contractId)) return;

  if (chargeAlreadyPosted(existing.contractId, existing.pricingStreamId, existing.serviceStart, existing.serviceEnd)) {
    return res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
  }

  const parsed = updateUsageEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid usage entry payload." } });

  const nextServiceStart = parsed.data.serviceStart ?? existing.serviceStart;
  if (!streamIsMeteredAt(existing.pricingStreamId, nextServiceStart)) {
    return res.status(400).json({ error: { code: "not_metered", message: "This pricing stream is not on a metered rate at the given service start date." } });
  }

  const updated = db.update(usageEntries).set(parsed.data).where(eq(usageEntries.id, id)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_updated", entityType: "contract", entityId: existing.contractId });
  res.json({ usageEntry: updated });
});

usageEntriesRouter.delete("/usage-entries/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(usageEntries).where(eq(usageEntries.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Usage entry not found." } });
  if (!ensureContractAccess(req, res, existing.contractId)) return;

  if (chargeAlreadyPosted(existing.contractId, existing.pricingStreamId, existing.serviceStart, existing.serviceEnd)) {
    return res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
  }

  db.delete(usageEntries).where(eq(usageEntries.id, id)).run();
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_removed", entityType: "contract", entityId: existing.contractId });
  res.status(204).send();
});
