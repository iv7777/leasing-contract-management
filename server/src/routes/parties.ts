import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { parties, partySensitiveDetails } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

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
  nameEn: z.string().optional(),
  contactDetails: z.string().optional(),
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
  recordAudit({ actorUserId: req.user!.id, action: "party_created", entityType: "party", entityId: inserted.id });
  res.status(201).json({ party: inserted });
});

const updatePartySchema = z.object({
  type: z.enum(["company", "individual"]).optional(),
  name: z.string().min(1).optional(),
  nameEn: z.string().optional(),
  contactDetails: z.string().optional(),
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
    details: { before: existing, after: updated },
  });
  res.json({ party: updated });
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
  recordAudit({ actorUserId: req.user!.id, action: "party_sensitive_updated", entityType: "party", entityId: partyId });
  res.json({ ok: true });
});
