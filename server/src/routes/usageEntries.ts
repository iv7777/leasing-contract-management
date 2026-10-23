import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { usageEntries, rateSchedule, charges, receiptAllocations, chargeAdjustments, documents } from "../db/schema.js";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PHOTO_TOO_LARGE, inspectPhotoUpload } from "../lib/uploadRules.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { pricingStreamBelongsToContract } from "../lib/ownership.js";
import { recordAudit } from "../lib/audit.js";
import { changesBetween, chargeFacts, contractRef, streamName } from "../lib/auditDetail.js";
import { Decimal, daysInMonth } from "@lcm/shared";

import { isoDate, decimalString } from "../lib/validate.js";
import { canEditEntry, editWindowEnd, withinEditWindow } from "../lib/editWindow.js";
import { rebillStreams } from "../billing/generate.js";

const WHOLE_MONTH = "A meter reading covers one whole calendar month, from its first day to its last.";
/** A reading is billed per calendar month, so its period must be exactly one. */
function wholeMonthError(serviceStart: string, serviceEnd: string): string | null {
  const [y, m] = serviceStart.split("-").map(Number);
  const first = `${serviceStart.slice(0, 7)}-01`;
  const last = `${serviceStart.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  return serviceStart === first && serviceEnd === last ? null : WHOLE_MONTH;
}

export const usageEntriesRouter = Router();

const PHOTO_DIR = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const photoOf = (entryId: number) => db.select().from(documents).all().find((d) => d.ownerType === "usage_entry" && d.ownerId === entryId) ?? null;

/** Removes a reading's photo: the record and its file. */
function removePhoto(entryId: number) {
  const doc = photoOf(entryId);
  if (!doc) return null;
  db.delete(documents).where(eq(documents.id, doc.id)).run();
  try {
    fs.unlinkSync(doc.filePath);
  } catch {
    // The file was already gone; the record is what mattered.
  }
  return doc;
}
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
function meteredMethodAt(pricingStreamId: number, atDate: string): "metered" | "metered_amount" | null {
  const rate = db
    .select()
    .from(rateSchedule)
    .where(eq(rateSchedule.pricingStreamId, pricingStreamId))
    .all()
    .find((r) => r.effectiveStart <= atDate && (!r.effectiveEnd || r.effectiveEnd >= atDate));
  return rate?.calculationMethod === "metered" || rate?.calculationMethod === "metered_amount" ? rate.calculationMethod : null;
}
const streamIsMeteredAt = (pricingStreamId: number, atDate: string) => meteredMethodAt(pricingStreamId, atDate) !== null;

const AMOUNT_REQUIRED = "Enter the amount for this reading too: this item is billed from the amount you type with the kWh.";

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
        eq(charges.status, "posted"),
      ),
    )
    .get();
}

/** The posted bills made from a reading: its own, plus any service fee that follows this item. */
function billedChargesFor(entry: typeof usageEntries.$inferSelect) {
  const followers = db
    .select()
    .from(rateSchedule)
    .all()
    .filter((r) => r.linkedStreamId === entry.pricingStreamId && r.effectiveStart <= entry.serviceStart && (!r.effectiveEnd || r.effectiveEnd >= entry.serviceStart))
    .map((r) => r.pricingStreamId);
  const streamIds = [entry.pricingStreamId, ...followers];
  return db
    .select()
    .from(charges)
    .where(and(eq(charges.contractId, entry.contractId), eq(charges.serviceStart, entry.serviceStart), eq(charges.serviceEnd, entry.serviceEnd), eq(charges.status, "posted")))
    .all()
    .filter((c) => streamIds.includes(c.pricingStreamId));
}

/** Whether a payment has been applied to a bill, or the bill has been adjusted by an amendment. */
function hasMoneyOn(chargeId: number): boolean {
  const paid = db.select().from(receiptAllocations).where(eq(receiptAllocations.chargeId, chargeId)).all().reduce((s, a) => s + a.amountFen, 0);
  return paid !== 0 || !!db.select().from(chargeAdjustments).where(eq(chargeAdjustments.chargeId, chargeId)).get();
}

usageEntriesRouter.get("/contracts/:contractId/usage-entries", (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  const rows = db.select().from(usageEntries).where(eq(usageEntries.contractId, contractId)).all();
  const photos = new Map(db.select().from(documents).all().filter((d) => d.ownerType === "usage_entry").map((d) => [d.ownerId, d]));
  res.json({
    usageEntries: rows.map((r) => {
      const billed = chargeAlreadyPosted(contractId, r.pricingStreamId, r.serviceStart, r.serviceEnd);
      const photo = photos.get(r.id);
      const paid = billed && billedChargesFor(r).some((c) => hasMoneyOn(c.id));
      // Why a billed reading can't be corrected any more (null while it can).
      const lockReason = !billed ? null : paid ? "paid" : !withinEditWindow(r.createdAt) ? "expired" : !canEditEntry(req.user!, r.enteredBy, r.createdAt) ? "not_yours" : null;
      return {
        ...r,
        photoDocumentId: photo?.id ?? null,
        photoMissing: photo ? !fs.existsSync(photo.filePath) : false,
        billed,
        // Unbilled readings can always be edited. A billed one can be corrected for 24 hours if no payment is on its bill.
        canEdit: lockReason === null,
        lockReason,
        editableUntil: billed ? editWindowEnd(r.createdAt) : null,
      };
    }),
  });
});

const addUsageEntrySchema = z.object({
  pricingStreamId: z.number().int(),
  serviceStart: isoDate,
  serviceEnd: isoDate,
  quantity: decimalString,
  /** Fen; required for an item priced "amount entered with the reading", ignored otherwise. */
  amountFen: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  source: z.string().max(200).optional(),
});

usageEntriesRouter.post("/contracts/:contractId/usage-entries", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  if (rejectIfDraft(res, contractId)) return;

  const parsed = addUsageEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid usage entry payload.", details: parsed.error.flatten() } });

  const { pricingStreamId, serviceStart, serviceEnd, source, ...rest } = parsed.data;
  const periodError = wholeMonthError(serviceStart, serviceEnd);
  if (periodError) return res.status(400).json({ error: { code: "invalid_period", message: periodError } });
  if (!pricingStreamBelongsToContract(pricingStreamId, contractId)) {
    return res.status(400).json({ error: { code: "invalid_reference", message: "Pricing stream does not belong to this contract." } });
  }
  const method = meteredMethodAt(pricingStreamId, serviceStart);
  if (!method) {
    return res.status(400).json({ error: { code: "not_metered", message: "This pricing stream is not on a metered rate at the given service start date." } });
  }
  if (method === "metered_amount" && (rest.amountFen === null || rest.amountFen === undefined)) {
    return res.status(400).json({ error: { code: "amount_required", message: AMOUNT_REQUIRED } });
  }
  if (method === "metered") rest.amountFen = null;

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
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_recorded", entityType: "contract", entityId: contractId, details: { contract: contractRef(contractId), item: streamName(pricingStreamId), servicePeriod: `${serviceStart} → ${serviceEnd}`, quantity: rest.quantity, unit: rest.unit, ...(rest.amountFen != null ? { amountFen: rest.amountFen } : {}) } });
  res.status(201).json({ usageEntry: inserted });
});

const updateUsageEntrySchema = z.object({
  serviceStart: isoDate.optional(),
  serviceEnd: isoDate.optional(),
  quantity: decimalString.optional(),
  amountFen: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  source: z.string().max(200).nullable().optional(),
});

usageEntriesRouter.patch("/usage-entries/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(usageEntries).where(eq(usageEntries.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Usage entry not found." } });
  if (!ensureContractAccess(req, res, existing.contractId)) return;
  if (rejectIfDraft(res, existing.contractId)) return;

  // A reading that has already been billed can still be corrected for 24 hours by whoever entered it
  // (or an Admin), as long as no payment is on the bill: the bill is voided and made again.
  const billed = chargeAlreadyPosted(existing.contractId, existing.pricingStreamId, existing.serviceStart, existing.serviceEnd);
  const billedCharges = billed ? billedChargesFor(existing) : [];
  if (billed) {
    if (!canEditEntry(req.user!, existing.enteredBy, existing.createdAt)) {
      return res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
    }
    if (billedCharges.some((c) => hasMoneyOn(c.id))) {
      return res.status(409).json({ error: { code: "charge_has_payments", message: "A payment is already applied to the bill made from this reading, so it can't be changed. An Admin can reverse the payment first." } });
    }
  }

  const parsed = updateUsageEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid usage entry payload." } });

  const nextServiceStart = parsed.data.serviceStart ?? existing.serviceStart;
  const periodError = wholeMonthError(nextServiceStart, parsed.data.serviceEnd ?? existing.serviceEnd);
  if (periodError) return res.status(400).json({ error: { code: "invalid_period", message: periodError } });
  const nextMethod = meteredMethodAt(existing.pricingStreamId, nextServiceStart);
  if (!nextMethod) {
    return res.status(400).json({ error: { code: "not_metered", message: "This pricing stream is not on a metered rate at the given service start date." } });
  }
  if (nextMethod === "metered_amount" && (parsed.data.amountFen === null || (parsed.data.amountFen === undefined && existing.amountFen === null))) {
    return res.status(400).json({ error: { code: "amount_required", message: AMOUNT_REQUIRED } });
  }
  if (nextMethod === "metered") parsed.data.amountFen = null;

  if (billed && (parsed.data.serviceStart !== undefined || parsed.data.serviceEnd !== undefined) && (nextServiceStart !== existing.serviceStart || (parsed.data.serviceEnd ?? existing.serviceEnd) !== existing.serviceEnd)) {
    return res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
  }

  const updated = db.transaction(() => {
    const row = db.update(usageEntries).set(parsed.data).where(eq(usageEntries.id, id)).returning().get();
    if (billed) {
      for (const c of billedCharges) {
        db.update(charges).set({ status: "voided", voidedAt: new Date().toISOString(), voidedBy: req.user!.id, voidReason: "Meter reading corrected" }).where(eq(charges.id, c.id)).run();
        recordAudit({ actorUserId: req.user!.id, action: "charge_voided", entityType: "charge", entityId: c.id, reason: "Meter reading corrected", details: { ...chargeFacts(c.id), chargeAmountFen: c.amountFen } });
      }
      rebillStreams(existing.contractId, existing.serviceStart, existing.serviceEnd, billedCharges.map((c) => c.pricingStreamId));
    }
    return row;
  });
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_updated", entityType: "contract", entityId: existing.contractId, details: { contract: contractRef(existing.contractId), item: streamName(existing.pricingStreamId), servicePeriod: `${existing.serviceStart} → ${existing.serviceEnd}`, changes: changesBetween(existing, updated), ...(billed ? { rebilled: billedCharges.length } : {}) } });
  res.json({ usageEntry: updated });
});

usageEntriesRouter.delete("/usage-entries/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(usageEntries).where(eq(usageEntries.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Usage entry not found." } });
  if (!ensureContractAccess(req, res, existing.contractId)) return;
  if (rejectIfDraft(res, existing.contractId)) return;

  // A reading that has already been billed can still be removed during the 24-hour correction window, by whoever
  // entered it (or an Admin), as long as no payment is on the bill: the bill is voided and the reading is
  // waited for again.
  const billed = chargeAlreadyPosted(existing.contractId, existing.pricingStreamId, existing.serviceStart, existing.serviceEnd);
  const billedCharges = billed ? billedChargesFor(existing) : [];
  if (billed) {
    if (!canEditEntry(req.user!, existing.enteredBy, existing.createdAt)) {
      return res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
    }
    if (billedCharges.some((c) => hasMoneyOn(c.id))) {
      return res.status(409).json({ error: { code: "charge_has_payments", message: "A payment is already applied to the bill made from this reading, so it can't be removed. An Admin can reverse the payment first." } });
    }
  }

  db.transaction(() => {
    for (const c of billedCharges) {
      db.update(charges).set({ status: "voided", voidedAt: new Date().toISOString(), voidedBy: req.user!.id, voidReason: "Meter reading removed" }).where(eq(charges.id, c.id)).run();
      recordAudit({ actorUserId: req.user!.id, action: "charge_voided", entityType: "charge", entityId: c.id, reason: "Meter reading removed", details: { ...chargeFacts(c.id), chargeAmountFen: c.amountFen } });
    }
    removePhoto(id);
    db.delete(usageEntries).where(eq(usageEntries.id, id)).run();
  });
  recordAudit({ actorUserId: req.user!.id, action: "usage_entry_removed", entityType: "contract", entityId: existing.contractId, details: { contract: contractRef(existing.contractId), item: streamName(existing.pricingStreamId), servicePeriod: `${existing.serviceStart} → ${existing.serviceEnd}`, quantity: existing.quantity, unit: existing.unit, ...(billed ? { billsVoided: billedCharges.length } : {}) } });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// The photo of the meter (optional): attached to a reading while it can still be edited
// ---------------------------------------------------------------------------

/** Loads the reading and applies the same rules as editing it. Sends the error and returns null when refused. */
function readingForPhoto(req: import("express").Request, res: import("express").Response) {
  const id = Number(req.params.id);
  const existing = db.select().from(usageEntries).where(eq(usageEntries.id, id)).get();
  if (!existing) {
    res.status(404).json({ error: { code: "not_found", message: "Usage entry not found." } });
    return null;
  }
  if (!ensureContractAccess(req, res, existing.contractId)) return null;
  if (rejectIfDraft(res, existing.contractId)) return null;
  if (chargeAlreadyPosted(existing.contractId, existing.pricingStreamId, existing.serviceStart, existing.serviceEnd)) {
    if (!canEditEntry(req.user!, existing.enteredBy, existing.createdAt)) {
      res.status(409).json({ error: { code: "charge_already_posted", message: "A charge has already been generated from this usage entry." } });
      return null;
    }
    if (billedChargesFor(existing).some((c) => hasMoneyOn(c.id))) {
      res.status(409).json({ error: { code: "charge_has_payments", message: "A payment is already applied to the bill made from this reading, so it can't be changed. An Admin can reverse the payment first." } });
      return null;
    }
  }
  return existing;
}

usageEntriesRouter.post("/usage-entries/:id/photo", requireRole("admin", "manager"), photoUpload.single("file"), (req, res) => {
  const existing = readingForPhoto(req, res);
  if (!existing) return;
  if (!req.file) return res.status(400).json({ error: { code: "invalid_input", message: "Choose a photo." } });
  if (req.file.size > MAX_PHOTO_BYTES) return res.status(413).json({ error: { code: "photo_too_large", message: PHOTO_TOO_LARGE } });
  const inspected = inspectPhotoUpload(req.file.originalname, req.file.buffer);
  if (!inspected.ok) return res.status(400).json({ error: { code: "invalid_file", message: inspected.message } });

  const dir = path.join(PHOTO_DIR, "usage_entry", String(existing.id));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${crypto.randomUUID()}${inspected.extension}`);
  fs.writeFileSync(filePath, req.file.buffer);

  const replaced = removePhoto(existing.id);
  const doc = db
    .insert(documents)
    .values({
      ownerType: "usage_entry",
      ownerId: existing.id,
      docType: "meter_photo",
      classification: "ordinary",
      filePath,
      mimeType: inspected.mime,
      sizeBytes: req.file.size,
      checksumSha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
      uploadedBy: req.user!.id,
    })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "usage_photo_attached", entityType: "contract", entityId: existing.contractId, details: { contract: contractRef(existing.contractId), item: streamName(existing.pricingStreamId), servicePeriod: `${existing.serviceStart} → ${existing.serviceEnd}`, ...(replaced ? { replaced: true } : {}) } });
  res.status(201).json({ photoDocumentId: doc.id });
});

usageEntriesRouter.delete("/usage-entries/:id/photo", requireRole("admin", "manager"), (req, res) => {
  const existing = readingForPhoto(req, res);
  if (!existing) return;
  const removed = removePhoto(existing.id);
  if (!removed) return res.status(404).json({ error: { code: "not_found", message: "This reading has no photo." } });
  recordAudit({ actorUserId: req.user!.id, action: "usage_photo_removed", entityType: "contract", entityId: existing.contractId, details: { contract: contractRef(existing.contractId), item: streamName(existing.pricingStreamId), servicePeriod: `${existing.serviceStart} → ${existing.serviceEnd}` } });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Bulk monthly entry (the readings grid): one request, many stream-months.
// Existing readings are updated in place unless a charge has already been
// posted from them; unchanged values are left alone. All-or-nothing.
// ---------------------------------------------------------------------------

const bulkUsageSchema = z.object({
  entries: z
    .array(z.object({ pricingStreamId: z.number().int(), period: z.string().regex(/^\d{4}-\d{2}$/), quantity: decimalString, amountFen: z.number().int().min(0).max(1_000_000_000_000).nullable().optional() }))
    .min(1)
    .max(1000),
});

usageEntriesRouter.post("/contracts/:contractId/usage-entries/bulk", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  if (rejectIfDraft(res, contractId)) return;

  const parsed = bulkUsageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid readings payload." } });

  type Op = { kind: "insert"; pricingStreamId: number; serviceStart: string; serviceEnd: string; quantity: string; amountFen: number | null; unit: string } | { kind: "update"; id: number; quantity: string; amountFen: number | null };
  const ops: Op[] = [];
  const errors: { row: number; message: string }[] = [];
  let unchanged = 0;

  parsed.data.entries.forEach((e, idx) => {
    const row = idx + 1;
    const [year, month] = e.period.split("-").map(Number);
    if (month < 1 || month > 12) return errors.push({ row, message: `Invalid month ${e.period}.` });
    const serviceStart = `${e.period}-01`;
    const serviceEnd = `${e.period}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

    if (!pricingStreamBelongsToContract(e.pricingStreamId, contractId)) return errors.push({ row, message: "Pricing stream does not belong to this contract." });
    const rate = db
      .select()
      .from(rateSchedule)
      .where(eq(rateSchedule.pricingStreamId, e.pricingStreamId))
      .all()
      .find((r) => r.effectiveStart <= serviceStart && (!r.effectiveEnd || r.effectiveEnd >= serviceStart));
    if (rate?.calculationMethod !== "metered" && rate?.calculationMethod !== "metered_amount") return errors.push({ row, message: `${e.period}: this stream is not metered then.` });
    const amountMode = rate.calculationMethod === "metered_amount";
    if (amountMode && (e.amountFen === null || e.amountFen === undefined)) return errors.push({ row, message: `${e.period}: ${AMOUNT_REQUIRED}` });
    const amountFen = amountMode ? e.amountFen ?? null : null;

    const existing = db
      .select()
      .from(usageEntries)
      .where(and(eq(usageEntries.pricingStreamId, e.pricingStreamId), eq(usageEntries.serviceStart, serviceStart), eq(usageEntries.serviceEnd, serviceEnd)))
      .get();
    if (!existing) return ops.push({ kind: "insert", pricingStreamId: e.pricingStreamId, serviceStart, serviceEnd, quantity: e.quantity, amountFen, unit: rate.unit ?? "unit" });
    if (new Decimal(existing.quantity).equals(new Decimal(e.quantity)) && (existing.amountFen ?? null) === amountFen) return void unchanged++;
    if (chargeAlreadyPosted(contractId, e.pricingStreamId, serviceStart, serviceEnd)) {
      return errors.push({ row, message: `${e.period}: a charge was already generated from this reading, so it can't be changed.` });
    }
    ops.push({ kind: "update", id: existing.id, quantity: e.quantity, amountFen });
  });

  if (errors.length > 0) {
    return res.status(400).json({ error: { code: "invalid_entries", message: errors[0].message, details: errors } });
  }

  db.transaction((tx) => {
    for (const op of ops) {
      if (op.kind === "insert") {
        tx.insert(usageEntries)
          .values({ contractId, pricingStreamId: op.pricingStreamId, serviceStart: op.serviceStart, serviceEnd: op.serviceEnd, quantity: op.quantity, amountFen: op.amountFen, unit: op.unit, source: "bulk entry", enteredBy: req.user!.id })
          .run();
      } else {
        tx.update(usageEntries).set({ quantity: op.quantity, amountFen: op.amountFen }).where(eq(usageEntries.id, op.id)).run();
      }
    }
  });

  const created = ops.filter((o) => o.kind === "insert").length;
  const updated = ops.length - created;
  recordAudit({ actorUserId: req.user!.id, action: "usage_entries_bulk_recorded", entityType: "contract", entityId: contractId, details: { contract: contractRef(contractId), created, updated, unchanged } });
  res.status(201).json({ created, updated, unchanged });
});
