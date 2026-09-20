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
  preferredLocale: text("preferred_locale", { enum: ["en", "zh", "auto"] }).notNull().default("en"),
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
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
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
// Agreements and pricing
// ---------------------------------------------------------------------------

export const contracts = sqliteTable("contracts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referenceNumber: text("reference_number").notNull(),
  landlordPartyId: integer("landlord_party_id").notNull().references(() => parties.id),
  tenantPartyId: integer("tenant_party_id").notNull().references(() => parties.id),
  termStart: text("term_start").notNull(),
  termEnd: text("term_end").notNull(),
  renewalNoticeDays: integer("renewal_notice_days").notNull().default(90),
  specialTerms: text("special_terms"),
  status: text("status", { enum: ["draft", "active", "expired", "terminated"] }).notNull().default("draft"),
  versionNumber: integer("version_number").notNull().default(1),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
}, (t) => ({
  refIdx: uniqueIndex("contracts_reference_idx").on(t.referenceNumber),
}));

/** Retains leased-space history: a contract's coverage of a unit over time,
 * independent of the unit's current inventory state. */
export const contractUnits = sqliteTable("contract_units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  unitId: integer("unit_id").notNull().references(() => units.id),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end"),
  contractedAreaSqm: text("contracted_area_sqm").notNull(),
  notes: text("notes"),
}, (t) => ({
  contractIdx: index("contract_units_contract_idx").on(t.contractId),
}));

/** One row per contract (initial build); billing shape rarely varies within
 * a lease's life, and a change goes through the amendment workflow. */
export const billingRules = sqliteTable("billing_rules", {
  contractId: integer("contract_id").primaryKey().references(() => contracts.id),
  billingFrequency: text("billing_frequency", { enum: ["monthly", "quarterly", "yearly"] })
    .notNull()
    .default("monthly"),
  periodAnchorDay: integer("period_anchor_day").notNull().default(1),
  dueDay: integer("due_day").notNull(),
  dueMonthOffset: integer("due_month_offset").notNull().default(0),
  shortMonthFallback: text("short_month_fallback", { enum: ["last_day_of_month"] })
    .notNull()
    .default("last_day_of_month"),
  prorationMethod: text("proration_method", { enum: ["actual_calendar_day"] })
    .notNull()
    .default("actual_calendar_day"),
  roundingMode: text("rounding_mode", { enum: ["round_half_up"] }).notNull().default("round_half_up"),
  latePenaltyEnabled: integer("late_penalty_enabled", { mode: "boolean" }).notNull().default(false),
  latePenaltyDailyRatePermille: text("late_penalty_daily_rate_permille"),
  latePenaltyCapFen: integer("late_penalty_cap_fen"),
});

/** Identifies exactly what is being priced: a single unit, an explicit
 * group of units, or the whole contract (e.g. a flat management fee). */
export const pricingStreams = sqliteTable("pricing_streams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  feeType: text("fee_type", {
    enum: ["rent", "management", "electricity_base", "water", "elevator", "other"],
  }).notNull(),
  targetType: text("target_type", { enum: ["unit", "group", "contract"] }).notNull(),
  label: text("label"),
  notes: text("notes"),
}, (t) => ({
  contractIdx: index("pricing_streams_contract_idx").on(t.contractId),
}));

export const pricingStreamUnits = sqliteTable("pricing_stream_units", {
  pricingStreamId: integer("pricing_stream_id").notNull().references(() => pricingStreams.id),
  contractUnitId: integer("contract_unit_id").notNull().references(() => contractUnits.id),
}, (t) => ({
  pk: uniqueIndex("pricing_stream_units_pk").on(t.pricingStreamId, t.contractUnitId),
}));

export const rateSchedule = sqliteTable("rate_schedule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pricingStreamId: integer("pricing_stream_id").notNull().references(() => pricingStreams.id),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end"),
  calculationMethod: text("calculation_method", {
    enum: ["flat", "per_sqm", "percentage_escalation", "metered"],
  }).notNull(),
  // Decimal yuan as text — exact precision, converted to fen only at charge time.
  // For "metered" this is the price per unit (e.g. yuan per kWh), paired with `unit` below.
  amountOrRate: text("amount_or_rate").notNull(),
  rateBasis: text("rate_basis", {
    enum: ["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit"],
  }).notNull(),
  // percentage_escalation fields (null for flat/per_sqm/metered)
  escalationBase: text("escalation_base", { enum: ["initial", "previous"] }),
  escalationPercentage: text("escalation_percentage"),
  escalationIntervalMonths: integer("escalation_interval_months"),
  // metered only: the unit amountOrRate is priced per (e.g. "kWh", "ton") —
  // null for every other calculationMethod.
  unit: text("unit"),
  notes: text("notes"),
}, (t) => ({
  streamIdx: index("rate_schedule_stream_idx").on(t.pricingStreamId),
}));

/** Free-rent / component-specific waivers or discounts. A null
 * pricingStreamId applies to every stream on the contract for the period. */
export const concessions = sqliteTable("concessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  pricingStreamId: integer("pricing_stream_id").references(() => pricingStreams.id),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end").notNull(),
  discountPercentage: text("discount_percentage").notNull(), // "100" = full waiver
  reason: text("reason"),
}, (t) => ({
  contractIdx: index("concessions_contract_idx").on(t.contractId),
}));

export const usageEntries = sqliteTable("usage_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  pricingStreamId: integer("pricing_stream_id").notNull().references(() => pricingStreams.id),
  serviceStart: text("service_start").notNull(),
  serviceEnd: text("service_end").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  source: text("source"),
  enteredBy: integer("entered_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(nowIso),
});

export const depositTerms = sqliteTable("deposit_terms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  effectiveStart: text("effective_start").notNull(),
  requirementType: text("requirement_type", { enum: ["fixed", "formula"] }).notNull(),
  fixedAmountFen: integer("fixed_amount_fen"),
  formulaBasis: text("formula_basis"),
  waiverConditionText: text("waiver_condition_text"),
  waiverMet: integer("waiver_met", { mode: "boolean" }),
  waiverEvidenceDocumentId: integer("waiver_evidence_document_id").references(() => documents.id),
  dueDate: text("due_date"),
  notes: text("notes"),
}, (t) => ({
  contractIdx: index("deposit_terms_contract_idx").on(t.contractId),
}));

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

export const charges = sqliteTable("charges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  pricingStreamId: integer("pricing_stream_id").notNull().references(() => pricingStreams.id),
  feeType: text("fee_type").notNull(),
  serviceStart: text("service_start").notNull(),
  serviceEnd: text("service_end").notNull(),
  dueDate: text("due_date").notNull(),
  amountFen: integer("amount_fen").notNull(),
  calculationSnapshotJson: text("calculation_snapshot_json").notNull(),
  sourceContractVersion: integer("source_contract_version").notNull(),
  status: text("status", { enum: ["posted", "voided"] }).notNull().default("posted"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  // Enforces the idempotent-generation requirement: one charge per billing
  // item, never duplicated by a retried or repeated job.
  dedupeIdx: uniqueIndex("charges_dedupe_idx").on(t.contractId, t.pricingStreamId, t.serviceStart, t.serviceEnd),
}));

/** Posted charges are never edited or deleted; a correction is a linked
 * debit/credit row referencing the original charge. */
export const chargeAdjustments = sqliteTable("charge_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chargeId: integer("charge_id").notNull().references(() => charges.id),
  amountFen: integer("amount_fen").notNull(), // signed: positive = debit (increase owed)
  reason: text("reason").notNull(),
  sourceAmendmentId: integer("source_amendment_id"),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(nowIso),
});

// ---------------------------------------------------------------------------
// Receipts and deposits
// ---------------------------------------------------------------------------

export const receipts = sqliteTable("receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  receivedDate: text("received_date").notNull(),
  amountFen: integer("amount_fen").notNull(),
  paymentMethod: text("payment_method").notNull(),
  externalReference: text("external_reference"),
  recordedBy: integer("recorded_by").notNull().references(() => users.id),
  evidenceDocumentId: integer("evidence_document_id").references(() => documents.id),
  status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  contractIdx: index("receipts_contract_idx").on(t.contractId),
}));

/** A positive row applies money from a receipt to a charge. A reversal is a
 * new negative row referencing the row it reverses via reversalOfId —
 * nothing is ever deleted or edited in place, so the full history of what
 * was applied and undone stays intact. */
export const receiptAllocations = sqliteTable("receipt_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id").notNull().references(() => receipts.id),
  chargeId: integer("charge_id").notNull().references(() => charges.id),
  amountFen: integer("amount_fen").notNull(),
  reversalOfId: integer("reversal_of_id"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  receiptIdx: index("receipt_allocations_receipt_idx").on(t.receiptId),
  chargeIdx: index("receipt_allocations_charge_idx").on(t.chargeId),
}));

/** Every deposit movement — receipt, refund, deduction, or a transfer of
 * held deposit to rent — as one append-only ledger, kept independent of the
 * rent ledger so the two amounts are never double-counted (brief §6). */
export const depositTransactions = sqliteTable("deposit_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  transactionType: text("transaction_type", {
    enum: ["receipt", "refund", "deduction", "transfer_to_rent", "reversal"],
  }).notNull(),
  amountFen: integer("amount_fen").notNull(),
  transactionDate: text("transaction_date").notNull(),
  receiptId: integer("receipt_id").references(() => receipts.id),
  chargeId: integer("charge_id").references(() => charges.id),
  reversalOfId: integer("reversal_of_id"),
  reason: text("reason").notNull(),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  contractIdx: index("deposit_transactions_contract_idx").on(t.contractId),
}));

// ---------------------------------------------------------------------------
// Change control
// ---------------------------------------------------------------------------

export const amendments = sqliteTable("amendments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  type: text("type").notNull(),
  reason: text("reason").notNull(),
  effectiveDate: text("effective_date").notNull(),
  baseContractVersion: integer("base_contract_version").notNull(),
  changesJson: text("changes_json").notNull(),
  supportingDocumentId: integer("supporting_document_id").references(() => documents.id),
  status: text("status", { enum: ["draft", "pending", "approved", "rejected", "withdrawn"] })
    .notNull()
    .default("draft"),
  submittedBy: integer("submitted_by").references(() => users.id),
  submittedAt: text("submitted_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: text("reviewed_at"),
  reviewReason: text("review_reason"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  contractIdx: index("amendments_contract_idx").on(t.contractId),
}));

export const contractVersions = sqliteTable("contract_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  sourceAmendmentId: integer("source_amendment_id").references(() => amendments.id),
  effectiveDate: text("effective_date").notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  contractVersionIdx: uniqueIndex("contract_versions_unique_idx").on(t.contractId, t.versionNumber),
}));

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export const backupRuns = sqliteTable("backup_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // "daily" runs nightly; "weekly" only once the daily rotation is full (see
  // jobs/backup.ts) and only on Sundays. Each kind is retained and pruned
  // independently.
  kind: text("kind", { enum: ["daily", "weekly"] }).notNull().default("daily"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
  backupReference: text("backup_reference"),
  includedDocumentCount: integer("included_document_count"),
  error: text("error"),
});

// ---------------------------------------------------------------------------
// App settings (single row, admin-editable values shown on the dashboard)
// ---------------------------------------------------------------------------

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(), // always 1 — a single-row settings table
  copyrightText: text("copyright_text").notNull(),
  updatedAt: text("updated_at").notNull().default(nowIso),
  updatedBy: integer("updated_by").references(() => users.id),
});
