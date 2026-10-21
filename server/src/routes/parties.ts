import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { parties, partySensitiveDetails, contracts } from "../db/schema.js";
import { eq, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { changesBetween } from "../lib/auditDetail.js";
import { liveContractsForParty, describeRefs } from "../lib/archiveGuards.js";

export const partiesRouter = Router();
partiesRouter.use(requireAuth);

partiesRouter.get("/", (req, res) => {
  const all = db.select().from(parties).all();
  res.json({ parties: all });
});

partiesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const party = db.select().from(parties).where(eq(parties.id, id)).get();
  if (!party) return res.status(404).json({ error: { code: "not_found", message: "Party not found." } });

  let sensitive = null;
  if (req.user!.role === "admin") {
    sensitive = db
      .select()
      .from(partySensitiveDetails)
      .where(eq(partySensitiveDetails.partyId, id))
      .get() ?? null;
    recordAudit({ actorUserId: req.user!.id, action: "party_sensitive_viewed", entityType: "party", entityId: id });
  }
  res.json({ party, sensitiveDetails: sensitive });
});

const createPartySchema = z.object({
  type: z.enum(["company", "individual"]),
  name: z.string().min(1),
  // nullable because the column is nullable: an edit form re-submits a
  // previously-null value as null, not as "the field was omitted".
  nameEn: z.string().nullable().optional(),
  contactDetails: z.string().nullable().optional(),
});

partiesRouter.post("/", requireRole("admin", "manager"), (req, res) => {
  const parsed = createPartySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid party payload.", details: parsed.error.flatten() } });
  }
  const inserted = db
    .insert(parties)
    .values({
      type: parsed.data.type,
      name: parsed.data.name,
      nameEn: parsed.data.nameEn ?? null,
      contactDetails: parsed.data.contactDetails ?? null,
    })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "party_created", entityType: "party", entityId: inserted.id, details: { name: inserted.name, type: inserted.type } });
  res.status(201).json({ party: inserted });
});

const updatePartySchema = z.object({
  type: z.enum(["company", "individual"]).optional(),
  name: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  contactDetails: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

partiesRouter.patch("/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(parties).where(eq(parties.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Party not found." } });

  const parsed = updatePartySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid party payload.", details: parsed.error.flatten() } });
  }
  if (parsed.data.archived === true && !existing.archived) {
    const live = liveContractsForParty(id);
    if (live.length > 0) {
      return res.status(409).json({
        error: {
          code: "party_in_live_contract",
          message: `This party is on contracts still in use (${describeRefs(live)}) and cannot be archived until they have ended.`,
          details: { contracts: live },
        },
      });
    }
  }
  const updated = db
    .update(parties)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(parties.id, id))
    .returning()
    .get();
  recordAudit({
    actorUserId: req.user!.id,
    action: existing.archived !== updated.archived ? (updated.archived ? "party_archived" : "party_unarchived") : "party_updated",
    entityType: "party",
    entityId: id,
    details: { name: updated.name, changes: changesBetween(existing, updated) },
  });
  res.json({ party: updated });
});

partiesRouter.delete("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(parties).where(eq(parties.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Party not found." } });

  const referencingContracts = db
    .select({ id: contracts.id, referenceNumber: contracts.referenceNumber })
    .from(contracts)
    .where(or(eq(contracts.landlordPartyId, id), eq(contracts.tenantPartyId, id)))
    .all();
  if (referencingContracts.length > 0) {
    return res.status(409).json({
      error: {
        code: "party_in_use",
        message: `This party is used by ${referencingContracts.length} contract(s) and cannot be deleted — archive it instead.`,
        details: { contracts: referencingContracts },
      },
    });
  }

  db.delete(partySensitiveDetails).where(eq(partySensitiveDetails.partyId, id)).run();
  db.delete(parties).where(eq(parties.id, id)).run();
  recordAudit({ actorUserId: req.user!.id, action: "party_deleted", entityType: "party", entityId: id, details: { name: existing.name } });
  res.status(204).send();
});

const sensitiveDetailsSchema = z.object({
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  licenseNumber: z.string().optional(),
  notes: z.string().optional(),
});

partiesRouter.put("/:id/sensitive-details", requireRole("admin"), (req, res) => {
  const partyId = Number(req.params.id);
  const parsed = sensitiveDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid payload." } });
  }
  db.insert(partySensitiveDetails)
    .values({ partyId, ...parsed.data, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: partySensitiveDetails.partyId,
      set: { ...parsed.data, updatedAt: new Date().toISOString() },
    })
    .run();
  // Never write the actual sensitive values into the audit log.
  recordAudit({ actorUserId: req.user!.id, action: "party_sensitive_updated", entityType: "party", entityId: partyId, details: { fieldsChanged: Object.keys(parsed.data) } });
  res.json({ ok: true });
});
