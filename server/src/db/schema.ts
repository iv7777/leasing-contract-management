import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ---------------------------------------------------------------------------
// Users, sessions, roles
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "manager", "collector", "viewer"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  canDownloadPdf: integer("can_download_pdf", { mode: "boolean" }).notNull().default(false),
  canPrint: integer("can_print", { mode: "boolean" }).notNull().default(false),
  preferredLocale: text("preferred_locale", { enum: ["en", "zh"] }).notNull().default("en"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
}, (t) => ({
  emailIdx: uniqueIndex("users_email_idx").on(t.email),
}));

export const sessions = sqliteTable("sessions", {
  sid: text("sid").primaryKey(),
  data: text("data").notNull(),
  expiresAt: text("expires_at").notNull(),
});

// ---------------------------------------------------------------------------
// Property inventory and people
// ---------------------------------------------------------------------------

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  address: text("address").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const units = sqliteTable("units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  unitLabel: text("unit_label").notNull(),
  unitType: text("unit_type", { enum: ["building", "open_land"] }).notNull(),
  // Stored as text to preserve exact decimal representation (e.g. "1234.56").
  rentableAreaSqm: text("rentable_area_sqm").notNull(),
  availability: text("availability", { enum: ["vacant", "leased", "unavailable"] })
    .notNull()
    .default("vacant"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
}, (t) => ({
  propertyUnitIdx: uniqueIndex("units_property_label_idx").on(t.propertyId, t.unitLabel),
}));

export const parties = sqliteTable("parties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["company", "individual"] }).notNull(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  contactDetails: text("contact_details"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

/** Admin-only protected identity details, split from `parties` so ordinary
 * scoped queries never even select these columns. */
export const partySensitiveDetails = sqliteTable("party_sensitive_details", {
  partyId: integer("party_id").primaryKey().references(() => parties.id),
  idType: text("id_type"),
  idNumber: text("id_number"),
  licenseNumber: text("license_number"),
  notes: text("notes"),
  updatedAt: text("updated_at").notNull().default(nowIso),
});

export const userProperties = sqliteTable("user_properties", {
  userId: integer("user_id").notNull().references(() => users.id),
  propertyId: integer("property_id").notNull().references(() => properties.id),
}, (t) => ({
  pk: uniqueIndex("user_properties_pk").on(t.userId, t.propertyId),
}));

// ---------------------------------------------------------------------------
// Documents (generalized store; contract_documents in phase 2 reuses this
// table with ownerType = 'contract')
// ---------------------------------------------------------------------------

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerType: text("owner_type", { enum: ["property", "unit", "party", "contract"] }).notNull(),
  ownerId: integer("owner_id").notNull(),
  docType: text("doc_type").notNull(),
  classification: text("classification", { enum: ["ordinary", "sensitive"] }).notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  originalDocumentId: integer("original_document_id"),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  uploadedAt: text("uploaded_at").notNull().default(nowIso),
}, (t) => ({
  ownerIdx: index("documents_owner_idx").on(t.ownerType, t.ownerId),
}));

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  reason: text("reason"),
  detailsJson: text("details_json"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  entityIdx: index("audit_events_entity_idx").on(t.entityType, t.entityId),
  createdAtIdx: index("audit_events_created_at_idx").on(t.createdAt),
}));

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export const backupRuns = sqliteTable("backup_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
  backupReference: text("backup_reference"),
  includedDocumentCount: integer("included_document_count"),
  error: text("error"),
});
