import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import { db } from "../db/client.js";
import { properties, units, contractUnits, contracts, documents as documentsTable } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole, canAccessProperty } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

propertiesRouter.get("/", (req, res) => {
  const all = db.select().from(properties).all();
  const visible =
    req.user!.role === "admin" ? all : all.filter((p) => req.user!.propertyIds.includes(p.id));
  res.json({ properties: visible });
});

propertiesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const property = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!property) return res.status(404).json({ error: { code: "not_found", message: "Property not found." } });
  if (!canAccessProperty(req.user!, id)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  const propertyUnits = db.select().from(units).where(eq(units.propertyId, id)).all();

  const unitIds = propertyUnits.map((u) => u.id);
  const unitContracts: Record<number, { contractId: number; referenceNumber: string; status: string }[]> = {};
  if (unitIds.length > 0) {
    const coverage = db
      .select({
        unitId: contractUnits.unitId,
        contractId: contracts.id,
        referenceNumber: contracts.referenceNumber,
        status: contracts.status,
      })
      .from(contractUnits)
      .innerJoin(contracts, eq(contractUnits.contractId, contracts.id))
      .where(inArray(contractUnits.unitId, unitIds))
      .all();
    for (const row of coverage) {
      (unitContracts[row.unitId] ??= []).push({
        contractId: row.contractId,
        referenceNumber: row.referenceNumber,
        status: row.status,
      });
    }
  }

  res.json({ property, units: propertyUnits, unitContracts });
});

const createPropertySchema = z.object({
  name: z.string().min(1),
  // nullable because the column is nullable: an edit form re-submits a
  // previously-null value as null, not as "the field was omitted".
  nameEn: z.string().nullable().optional(),
  address: z.string().min(1),
});

propertiesRouter.post("/", requireRole("admin"), (req, res) => {
  const parsed = createPropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid property payload." } });
  }
  const inserted = db
    .insert(properties)
    .values({ name: parsed.data.name, nameEn: parsed.data.nameEn ?? null, address: parsed.data.address })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "property_created", entityType: "property", entityId: inserted.id });
  res.status(201).json({ property: inserted });
});

const updatePropertySchema = createPropertySchema.partial().extend({
  archived: z.boolean().optional(),
});

propertiesRouter.patch("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const parsed = updatePropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid property payload." } });
  }
  const existing = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Property not found." } });

  const updated = db
    .update(properties)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(properties.id, id))
    .returning()
    .get();
  recordAudit({
    actorUserId: req.user!.id,
    action: "property_updated",
    entityType: "property",
    entityId: id,
    details: { before: existing, after: updated },
  });
  res.json({ property: updated });
});

propertiesRouter.delete("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(properties).where(eq(properties.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Property not found." } });

  const existingUnits = db.select().from(units).where(eq(units.propertyId, id)).all();
  if (existingUnits.length > 0) {
    return res.status(409).json({
      error: {
        code: "property_has_units",
        message: `This property has ${existingUnits.length} unit(s) and cannot be deleted — remove them first, or archive the property instead.`,
      },
    });
  }

  const docs = db.select().from(documentsTable).where(eq(documentsTable.ownerType, "property")).all().filter((d) => d.ownerId === id);
  db.transaction(() => {
    for (const doc of docs) {
      db.delete(documentsTable).where(eq(documentsTable.id, doc.id)).run();
    }
    db.delete(properties).where(eq(properties.id, id)).run();
  });
  for (const doc of docs) {
    try {
      fs.unlinkSync(doc.filePath);
    } catch {
      // file already gone — fine, the row is gone either way
    }
  }
  recordAudit({ actorUserId: req.user!.id, action: "property_deleted", entityType: "property", entityId: id, details: { name: existing.name } });
  res.status(204).send();
});

const createUnitSchema = z.object({
  unitLabel: z.string().min(1),
  unitType: z.enum(["building", "open_land"]),
  rentableAreaSqm: z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number"),
});

propertiesRouter.post("/:id/units", requireRole("admin", "manager"), (req, res) => {
  const propertyId = Number(req.params.id);
  if (!canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  const parsed = createUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid unit payload." } });
  }
  const inserted = db
    .insert(units)
    .values({ propertyId, ...parsed.data })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "unit_created", entityType: "unit", entityId: inserted.id });
  res.status(201).json({ unit: inserted });
});

const updateUnitSchema = z.object({
  unitLabel: z.string().min(1).optional(),
  unitType: z.enum(["building", "open_land"]).optional(),
  rentableAreaSqm: z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number").optional(),
  availability: z.enum(["vacant", "leased", "unavailable"]).optional(),
});

propertiesRouter.patch("/:propertyId/units/:unitId", requireRole("admin", "manager"), (req, res) => {
  const propertyId = Number(req.params.propertyId);
  const unitId = Number(req.params.unitId);
  if (!canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  const existing = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!existing || existing.propertyId !== propertyId) {
    return res.status(404).json({ error: { code: "not_found", message: "Unit not found." } });
  }
  const parsed = updateUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid unit payload." } });
  }
  const updated = db
    .update(units)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(units.id, unitId))
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "unit_updated", entityType: "unit", entityId: unitId, details: { before: existing, after: updated } });
  res.json({ unit: updated });
});

propertiesRouter.delete("/:propertyId/units/:unitId", requireRole("admin"), (req, res) => {
  const propertyId = Number(req.params.propertyId);
  const unitId = Number(req.params.unitId);
  const existing = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!existing || existing.propertyId !== propertyId) {
    return res.status(404).json({ error: { code: "not_found", message: "Unit not found." } });
  }

  const referencingContracts = db
    .select({ contractId: contractUnits.contractId })
    .from(contractUnits)
    .where(eq(contractUnits.unitId, unitId))
    .all();
  if (referencingContracts.length > 0) {
    return res.status(409).json({
      error: {
        code: "unit_in_use",
        message: `This unit is used by ${referencingContracts.length} contract(s) and cannot be deleted — mark it unavailable instead.`,
        details: { contracts: referencingContracts },
      },
    });
  }

  const docs = db.select().from(documentsTable).where(eq(documentsTable.ownerType, "unit")).all().filter((d) => d.ownerId === unitId);
  db.transaction(() => {
    for (const doc of docs) {
      db.delete(documentsTable).where(eq(documentsTable.id, doc.id)).run();
    }
    db.delete(units).where(eq(units.id, unitId)).run();
  });
  for (const doc of docs) {
    try {
      fs.unlinkSync(doc.filePath);
    } catch {
      // file already gone — fine, the row is gone either way
    }
  }
  recordAudit({ actorUserId: req.user!.id, action: "unit_deleted", entityType: "unit", entityId: unitId, details: { unitLabel: existing.unitLabel } });
  res.status(204).send();
});
