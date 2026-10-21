import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { documents, units, users, contracts, properties, parties, usageEntries } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireRole, canAccessProperty } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { changesBetween, ownerLabel } from "../lib/auditDetail.js";
import { canAccessContract } from "../lib/contractScope.js";
import { citedDocumentIds, contractStatusOf } from "../lib/documentRules.js";
import { inspectUpload, isInlineMime } from "../lib/uploadRules.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** Resolves which property (if any) governs scope for a document's owner,
 * so scope checks stay centralized instead of re-derived per route. Returns
 * null when the owner type has no property scope of its own (e.g. a party) —
 * such documents are restricted to admin/manager until contracts (phase 2)
 * give them a real property scope. */
function ownerPropertyId(ownerType: string, ownerId: number): number | null {
  if (ownerType === "property") return ownerId;
  if (ownerType === "unit") {
    const unit = db.select().from(units).where(eq(units.id, ownerId)).get();
    return unit?.propertyId ?? null;
  }
  return null;
}

/** Sends the 403 and returns true when the caller may not touch documents of
 * this owner: a property or unit needs assignment to that property, a contract
 * needs assignment to every property it covers. */
function ownerAccessDenied(req: import("express").Request, res: import("express").Response, ownerType: string, ownerId: number): boolean {
  const propertyId = ownerPropertyId(ownerType, ownerId);
  if (propertyId !== null && !canAccessProperty(req.user!, propertyId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
    return true;
  }
  if (ownerType === "contract" && !canAccessContract(req.user!, ownerId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return true;
  }
  // A meter-reading photo is as visible as the contract its reading belongs to.
  if (ownerType === "usage_entry") {
    const entry = db.select({ contractId: usageEntries.contractId }).from(usageEntries).where(eq(usageEntries.id, ownerId)).get();
    if (!entry || !canAccessContract(req.user!, entry.contractId)) {
      res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
      return true;
    }
  }
  return false;
}

export function ownerExists(ownerType: string, ownerId: number): boolean {
  switch (ownerType) {
    case "contract":
      return !!db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, ownerId)).get();
    case "property":
      return !!db.select({ id: properties.id }).from(properties).where(eq(properties.id, ownerId)).get();
    case "unit":
      return !!db.select({ id: units.id }).from(units).where(eq(units.id, ownerId)).get();
    case "party":
      return !!db.select({ id: parties.id }).from(parties).where(eq(parties.id, ownerId)).get();
    case "usage_entry":
      return !!db.select({ id: usageEntries.id }).from(usageEntries).where(eq(usageEntries.id, ownerId)).get();
    default:
      return false;
  }
}

const CONTRACT_DOC_TYPES = ["signed_lease", "signed_supplement", "other"];

const uploadMetaSchema = z.object({
  ownerType: z.enum(["property", "unit", "party", "contract"]),
  ownerId: z.coerce.number().int().positive(),
  docType: z.string().trim().min(1).max(100),
  name: z.string().trim().max(100).optional(),
  classification: z.enum(["ordinary", "sensitive"]),
});

documentsRouter.post("/", requireRole("admin", "manager"), upload.single("file"), (req, res) => {
  const parsed = uploadMetaSchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid document upload payload." } });
  }
  const { ownerType, ownerId, docType, classification } = parsed.data;
  const name = parsed.data.name || null;

  if (!ownerExists(ownerType, ownerId)) return res.status(404).json({ error: { code: "not_found", message: "The record this document belongs to was not found." } });
  if (ownerType === "contract" && !CONTRACT_DOC_TYPES.includes(docType)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid document type." } });
  }
  const inspected = inspectUpload(req.file.originalname, req.file.buffer);
  if (!inspected.ok) return res.status(400).json({ error: { code: "invalid_file", message: inspected.message } });

  if (ownerAccessDenied(req, res, ownerType, ownerId)) return;
  const propertyId = ownerPropertyId(ownerType, ownerId);
  if (propertyId === null && req.user!.role !== "admin" && req.user!.role !== "manager") {
    return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role." } });
  }

  const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const storedName = `${crypto.randomUUID()}${inspected.extension}`;
  const ownerDir = path.join(STORAGE_DIR, ownerType, String(ownerId));
  fs.mkdirSync(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, storedName);
  fs.writeFileSync(filePath, req.file.buffer);

  const inserted = db
    .insert(documents)
    .values({
      ownerType,
      ownerId,
      docType,
      name,
      classification,
      filePath,
      mimeType: inspected.mime,
      sizeBytes: req.file.size,
      checksumSha256: checksum,
      uploadedBy: req.user!.id,
    })
    .returning()
    .get();

  recordAudit({
    actorUserId: req.user!.id,
    action: "document_uploaded",
    entityType: "document",
    entityId: inserted.id,
    details: { owner: ownerLabel(ownerType, ownerId), ownerType, docType, name, classification },
  });

  res.status(201).json({ document: { ...inserted, filePath: undefined } });
});

documentsRouter.get("/", (req, res) => {
  const ownerType = req.query.ownerType as string | undefined;
  const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  if (!ownerType || ownerId === undefined) {
    return res.status(400).json({ error: { code: "invalid_input", message: "ownerType and ownerId are required." } });
  }

  if (ownerAccessDenied(req, res, ownerType, ownerId)) return;

  const includeVoided = req.query.includeVoided === "true";
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
  const rows = db
    .select()
    .from(documents)
    .where(and(eq(documents.ownerType, ownerType as "contract"), eq(documents.ownerId, ownerId)))
    .all()
    // Voided documents (withdrawn by an approved amendment) stay on record but out of the way.
    .filter((d) => includeVoided || !d.voided)
    // Sensitive originals never appear in a general listing for non-admins.
    .filter((d) => req.user!.role === "admin" || d.classification !== "sensitive")
    .map((d) => ({ ...d, fileMissing: !fs.existsSync(d.filePath), filePath: undefined, uploadedByName: names.get(d.uploadedBy) ?? null }));

  res.json({ documents: rows });
});

documentsRouter.get("/:id/download", (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });

  if (doc.classification === "sensitive" && req.user!.role !== "admin") {
    return res.status(403).json({ error: { code: "forbidden", message: "This document is restricted to Admin." } });
  }
  if (ownerAccessDenied(req, res, doc.ownerType, doc.ownerId)) return;
  if (!req.user!.canDownloadPdf && req.user!.role !== "admin" && req.user!.role !== "manager") {
    return res.status(403).json({ error: { code: "forbidden", message: "Download is disabled for this account." } });
  }

  if (!fs.existsSync(doc.filePath)) {
    return res.status(410).json({ error: { code: "file_missing", message: "Stored file is missing." } });
  }

  recordAudit({ actorUserId: req.user!.id, action: "document_downloaded", entityType: "document", entityId: id, details: { document: doc.name ?? doc.docType, owner: ownerLabel(doc.ownerType, doc.ownerId) } });
  // The stored type decides how the browser treats the file: scans and PDFs may be
  // shown, everything else is downloaded, and nothing is ever run as a page.
  const inline = isInlineMime(doc.mimeType);
  res.setHeader("Content-Type", inline ? doc.mimeType : "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  if (!inline) res.setHeader("Content-Disposition", "attachment");
  res.sendFile(path.resolve(doc.filePath));
});

const updateDocumentSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  docType: z.string().trim().min(1).max(100).optional(),
  classification: z.enum(["ordinary", "sensitive"]).optional(),
});

documentsRouter.patch("/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });
  if (ownerAccessDenied(req, res, doc.ownerType, doc.ownerId)) return;
  if (doc.ownerType === "usage_entry") {
    return res.status(409).json({ error: { code: "managed_by_reading", message: "A meter-reading photo is changed from the reading it belongs to." } });
  }

  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid document payload." } });
  const changes = { ...parsed.data, ...(parsed.data.name !== undefined ? { name: parsed.data.name || null } : {}) };
  if (doc.ownerType === "contract" && changes.docType !== undefined && !CONTRACT_DOC_TYPES.includes(changes.docType)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid document type." } });
  }

  // The name is a plain label: anyone allowed to edit documents may change it,
  // whatever the contract's or the amendment's status.
  const typeChanging = changes.docType !== undefined && changes.docType !== doc.docType;
  const classChanging = changes.classification !== undefined && changes.classification !== doc.classification;

  // Making a document ordinary or sensitive decides who can open it — Admin only.
  if (classChanging && req.user!.role !== "admin") {
    return res.status(403).json({ error: { code: "forbidden", message: "Only an Admin can change whether a document is sensitive." } });
  }
  if (typeChanging && doc.voided) {
    return res.status(409).json({ error: { code: "document_voided", message: "A voided document can only be renamed." } });
  }
  if (typeChanging && doc.ownerType === "contract" && contractStatusOf(doc.ownerId) !== "draft") {
    // Once the contract is in force the signed lease can't be re-labelled (or
    // another file passed off as one), and evidence for an amendment stays as filed.
    if (doc.docType === "signed_lease" || changes.docType === "signed_lease") {
      return res.status(409).json({ error: { code: "document_type_locked", message: "On a contract that is no longer a draft, a document can't be changed to or from \"Signed lease\"." } });
    }
    if (citedDocumentIds(doc.ownerId).has(id)) {
      return res.status(409).json({ error: { code: "document_in_use_by_amendment", message: "An amendment relies on this document, so its type can't be changed. You can still rename it." } });
    }
  }

  const updated = db.update(documents).set(changes).where(eq(documents.id, id)).returning().get();
  recordAudit({
    actorUserId: req.user!.id,
    action: "document_updated",
    entityType: "document",
    entityId: id,
    details: { owner: ownerLabel(doc.ownerType, doc.ownerId), document: doc.name ?? doc.docType, changes: changesBetween({ name: doc.name, docType: doc.docType, classification: doc.classification }, { ...{ name: doc.name, docType: doc.docType, classification: doc.classification }, ...changes }) },
  });
  res.json({ document: { ...updated, filePath: undefined } });
});

documentsRouter.delete("/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });
  if (ownerAccessDenied(req, res, doc.ownerType, doc.ownerId)) return;
  if (doc.ownerType === "usage_entry") {
    return res.status(409).json({ error: { code: "managed_by_reading", message: "A meter-reading photo is changed from the reading it belongs to." } });
  }

  // A record whose file has gone from the server can never be opened again and only breaks the
  // document check in backups, so an Admin may clear it whatever the contract's status — unless an
  // amendment relies on it as its supporting document.
  const fileGone = !fs.existsSync(doc.filePath);
  if (fileGone && req.user!.role === "admin") {
    if (doc.ownerType === "contract" && citedDocumentIds(doc.ownerId).has(id)) {
      return res.status(409).json({ error: { code: "document_in_use_by_amendment", message: "An amendment relies on this document, so it can't be deleted." } });
    }
    db.delete(documents).where(eq(documents.id, id)).run();
    recordAudit({
      actorUserId: req.user!.id,
      action: "document_deleted",
      entityType: "document",
      entityId: id,
      details: { owner: ownerLabel(doc.ownerType, doc.ownerId), ownerType: doc.ownerType, docType: doc.docType, name: doc.name, fileWasMissing: true },
    });
    return res.status(204).send();
  }

  // A sensitive document is Admin-only to open, so it is Admin-only to remove too.
  if (doc.classification === "sensitive" && req.user!.role !== "admin") {
    return res.status(403).json({ error: { code: "forbidden", message: "This document is restricted to Admin." } });
  }
  if (doc.ownerType === "contract") {
    // The paperwork of a contract in force is a legal record: nobody deletes it
    // directly. It is withdrawn through an approved amendment, which voids the
    // document and keeps the file. A draft is still being assembled, so Admin
    // and Manager may delete from it.
    if (contractStatusOf(doc.ownerId) !== "draft") {
      return res.status(409).json({
        error: { code: "delete_by_amendment", message: "A contract that is no longer a draft keeps its documents. To withdraw one, propose an amendment that voids it." },
      });
    }
    if (citedDocumentIds(doc.ownerId).has(id)) {
      return res.status(409).json({ error: { code: "document_in_use_by_amendment", message: "An amendment relies on this document, so it can't be deleted." } });
    }
  } else if (req.user!.role !== "admin") {
    return res.status(403).json({ error: { code: "forbidden", message: "Only an Admin can delete this document." } });
  }

  try {
    fs.unlinkSync(doc.filePath);
  } catch {
    // file already gone — fine, we're deleting the row either way
  }
  db.delete(documents).where(eq(documents.id, id)).run();
  recordAudit({
    actorUserId: req.user!.id,
    action: "document_deleted",
    entityType: "document",
    entityId: id,
    details: { owner: ownerLabel(doc.ownerType, doc.ownerId), ownerType: doc.ownerType, docType: doc.docType, name: doc.name },
  });
  res.status(204).send();
});
