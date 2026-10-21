import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import { db } from "../db/client.js";
import { properties, units, contractUnits, contracts, documents as documentsTable } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole, canAccessProperty } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { changesBetween } from "../lib/auditDetail.js";
import { liveContractsForProperty, liveContractsForUnit, describeRefs } from "../lib/archiveGuards.js";
import { shortText, decimalString } from "../lib/validate.js";

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
  name: shortText(200),
  // nullable because the column is nullable: an edit form re-submits a
  // previously-null value as null, not as "the field was omitted".
  nameEn: z.string().trim().max(200).nullable().optional(),
  address: shortText(500),
});

const DUPLICATE_PROPERTY = "A property with this name already exists.";
const nameTaken = (name: string, exceptId?: number) =>
  db.select().from(properties).all().some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase());

propertiesRouter.post("/", requireRole("admin"), (req, res) => {
  const parsed = createPropertySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid property payload." } });
  }
  if (nameTaken(parsed.data.name)) return res.status(409).json({ error: { code: "duplicate_name", message: DUPLICATE_PROPERTY } });
  const inserted = db
    .insert(properties)
    .values({ name: parsed.data.name, nameEn: parsed.data.nameEn ?? null, address: parsed.data.address })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "property_created", entityType: "property", entityId: inserted.id, details: { name: inserted.name, address: inserted.address } });
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
  if (parsed.data.name !== undefined && nameTaken(parsed.data.name, id)) {
    return res.status(409).json({ error: { code: "duplicate_name", message: DUPLICATE_PROPERTY } });
  }

  // Archiving hides the property; it can't be hidden while a draft or active
  // contract still covers one of its units.
  if (parsed.data.archived === true && !existing.archived) {
    const live = liveContractsForProperty(id);
    if (live.length > 0) {
      return res.status(409).json({
        error: {
          code: "property_in_use",
          message: `This property has contracts still in use (${describeRefs(live)}) and cannot be archived until they have ended.`,
          details: { contracts: live },
        },
      });
    }
  }

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
    details: { name: updated.name, changes: changesBetween(existing, updated) },
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
  unitLabel: shortText(100),
  unitType: z.enum(["building", "open_land"]),
  rentableAreaSqm: decimalString.refine((v) => Number(v) > 0, "Must be more than zero."),
});

const DUPLICATE_UNIT = "This property already has a unit with this label.";
const labelTaken = (propertyId: number, label: string, exceptId?: number) =>
  db.select().from(units).where(eq(units.propertyId, propertyId)).all().some((u) => u.id !== exceptId && u.unitLabel.trim().toLowerCase() === label.trim().toLowerCase());

propertiesRouter.post("/:id/units", requireRole("admin", "manager"), (req, res) => {
  const propertyId = Number(req.params.id);
  if (!canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  const parsed = createUnitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid unit payload." } });
  }
  if (!db.select().from(properties).where(eq(properties.id, propertyId)).get()) {
    return res.status(404).json({ error: { code: "not_found", message: "Property not found." } });
  }
  if (labelTaken(propertyId, parsed.data.unitLabel)) return res.status(409).json({ error: { code: "duplicate_unit", message: DUPLICATE_UNIT } });
  const inserted = db
    .insert(units)
    .values({ propertyId, ...parsed.data })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "unit_created", entityType: "unit", entityId: inserted.id, details: { unit: inserted.unitLabel, property: db.select({ n: properties.name }).from(properties).where(eq(properties.id, propertyId)).get()?.n, rentableAreaSqm: inserted.rentableAreaSqm, unitType: inserted.unitType } });
  res.status(201).json({ unit: inserted });
});

const updateUnitSchema = z.object({
  unitLabel: shortText(100).optional(),
  unitType: z.enum(["building", "open_land"]).optional(),
  rentableAreaSqm: decimalString.refine((v) => Number(v) > 0, "Must be more than zero.").optional(),
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
  if (parsed.data.unitLabel !== undefined && labelTaken(propertyId, parsed.data.unitLabel, unitId)) {
    return res.status(409).json({ error: { code: "duplicate_unit", message: DUPLICATE_UNIT } });
  }
  // The unit can't be made smaller than the area a contract has already taken from it.
  if (parsed.data.rentableAreaSqm !== undefined) {
    const taken = db.select().from(contractUnits).where(eq(contractUnits.unitId, unitId)).all().reduce((max, cu) => Math.max(max, Number(cu.contractedAreaSqm)), 0);
    if (Number(parsed.data.rentableAreaSqm) < taken) {
      return res.status(409).json({ error: { code: "area_below_contracted", message: `A contract already uses ${taken} sqm of this unit, so its rentable area can't be set lower.` } });
    }
  }
  // "Unavailable" is how a unit is archived; not while a draft or active contract covers it.
  if (parsed.data.availability === "unavailable" && existing.availability !== "unavailable") {
    const live = liveContractsForUnit(unitId);
    if (live.length > 0) {
      return res.status(409).json({
        error: {
          code: "unit_in_use_live",
          message: `This unit is covered by contracts still in use (${describeRefs(live)}) and cannot be archived until they have ended.`,
          details: { contracts: live },
        },
      });
    }
  }
  const updated = db
    .update(units)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(units.id, unitId))
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "unit_updated", entityType: "unit", entityId: unitId, details: { unit: updated.unitLabel, changes: changesBetween(existing, updated) } });
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
