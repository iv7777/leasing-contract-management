import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { documents, units, contracts } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, canAccessProperty } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

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

const uploadMetaSchema = z.object({
  ownerType: z.enum(["property", "unit", "party", "contract"]),
  ownerId: z.coerce.number(),
  docType: z.string().min(1),
  classification: z.enum(["ordinary", "sensitive"]),
});

documentsRouter.post("/", requireRole("admin", "manager"), upload.single("file"), (req, res) => {
  const parsed = uploadMetaSchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid document upload payload." } });
  }
  const { ownerType, ownerId, docType, classification } = parsed.data;

  const propertyId = ownerPropertyId(ownerType, ownerId);
  if (propertyId !== null && !canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  if (propertyId === null && req.user!.role !== "admin" && req.user!.role !== "manager") {
    return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role." } });
  }

  const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const storedName = `${crypto.randomUUID()}${path.extname(req.file.originalname)}`;
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
      classification,
      filePath,
      mimeType: req.file.mimetype,
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
    details: { ownerType, ownerId, docType, classification },
  });

  res.status(201).json({ document: { ...inserted, filePath: undefined } });
});

documentsRouter.get("/", (req, res) => {
  const ownerType = req.query.ownerType as string | undefined;
  const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  if (!ownerType || ownerId === undefined) {
    return res.status(400).json({ error: { code: "invalid_input", message: "ownerType and ownerId are required." } });
  }

  const propertyId = ownerPropertyId(ownerType, ownerId);
  if (propertyId !== null && !canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }

  const rows = db
    .select()
    .from(documents)
    .all()
    .filter((d) => d.ownerType === ownerType && d.ownerId === ownerId)
    // Sensitive originals never appear in a general listing for non-admins.
    .filter((d) => req.user!.role === "admin" || d.classification !== "sensitive")
    .map((d) => ({ ...d, filePath: undefined }));

  res.json({ documents: rows });
});

documentsRouter.get("/:id/download", (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });

  if (doc.classification === "sensitive" && req.user!.role !== "admin") {
    return res.status(403).json({ error: { code: "forbidden", message: "This document is restricted to Admin." } });
  }
  const propertyId = ownerPropertyId(doc.ownerType, doc.ownerId);
  if (propertyId !== null && !canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }
  if (!req.user!.canDownloadPdf && req.user!.role !== "admin" && req.user!.role !== "manager") {
    return res.status(403).json({ error: { code: "forbidden", message: "Download is disabled for this account." } });
  }

  if (!fs.existsSync(doc.filePath)) {
    return res.status(410).json({ error: { code: "file_missing", message: "Stored file is missing." } });
  }

  recordAudit({ actorUserId: req.user!.id, action: "document_downloaded", entityType: "document", entityId: id });
  res.setHeader("Content-Type", doc.mimeType);
  res.sendFile(path.resolve(doc.filePath));
});

documentsRouter.delete("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });

  const propertyId = ownerPropertyId(doc.ownerType, doc.ownerId);
  if (propertyId !== null && !canAccessProperty(req.user!, propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this property." } });
  }

  // The one invariant worth protecting: activation required a signed lease
  // on file, so a contract that has left "draft" must never end up with
  // zero. Everything else (duplicates, other doc types, drafts) is free to
  // delete — there's no value in a blanket "keep at least one" rule that
  // blocks cleaning up a mistaken upload just because it's currently the
  // only file on record.
  if (doc.ownerType === "contract" && doc.docType === "signed_lease") {
    const contract = db.select().from(contracts).where(eq(contracts.id, doc.ownerId)).get();
    if (contract && contract.status !== "draft") {
      const remainingSignedLeases = db
        .select()
        .from(documents)
        .all()
        .filter((d) => d.ownerType === "contract" && d.ownerId === doc.ownerId && d.docType === "signed_lease" && d.id !== id);
      if (remainingSignedLeases.length === 0) {
        return res.status(409).json({
          error: {
            code: "last_signed_lease",
            message: "This is the only signed lease on file for a contract that is no longer a draft — upload a replacement before deleting it.",
          },
        });
      }
    }
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
    details: { ownerType: doc.ownerType, ownerId: doc.ownerId, docType: doc.docType, checksumSha256: doc.checksumSha256 },
  });
  res.status(204).send();
});
