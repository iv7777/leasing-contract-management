import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "./client.js";
import {
  parties,
  properties,
  units,
  contracts,
  billingRules,
  contractUnits,
  pricingStreams,
  pricingStreamUnits,
  rateSchedule,
  concessions,
  depositTerms,
  documents,
  users,
} from "./schema.js";
import { recordContractVersion } from "../lib/contractSnapshot.js";

/**
 * Bulk-loads a full lease (parties, property/unit, contract, pricing
 * streams with every rate tier, concessions, deposit terms, and optionally
 * the signed lease document) from a single JSON file, instead of clicking
 * through the "add contract" wizard field by field.
 *
 * Landlord/tenant/property/unit are matched by name (case-sensitive exact
 * match) and reused if they already exist, so the same JSON file format
 * works for every new lease against the same landlord/property portfolio
 * without creating duplicates.
 *
 * This also does one thing the HTTP API cannot: the "add pricing stream"
 * endpoint only accepts a single initial rate, so a contract with rent that
 * steps up on pre-agreed future dates (common in multi-year China leases)
 * can't be entered that way today. This script writes every rate_schedule
 * row directly, and the charge engine already picks the right one by date
 * range — so a multi-tier lease can be captured in full on day one.
 *
 * Usage:
 *   npm run import-contract -- <path/to/contract.json> [--activate] [--actor-email you@company.com]
 *
 * The contract is left in "draft" status unless --activate is passed, so
 * you get a chance to review the imported terms in the UI first. Activating
 * still requires a signed_lease document to be attached — either upload one
 * by hand afterward, or point `sourceDocument.path` in the JSON at the
 * signed PDF and this script will attach it for you.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number");
const partySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["company", "individual"]).default("company"),
  nameEn: z.string().optional(),
  contactDetails: z.string().optional(),
});
const rateSchema = z.object({
  effectiveStart: z.string(),
  effectiveEnd: z.string().optional(),
  calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation"]),
  amountOrRate: decimalString,
  rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month"]),
  escalationBase: z.enum(["initial", "previous"]).optional(),
  escalationPercentage: decimalString.optional(),
  escalationIntervalMonths: z.number().optional(),
  notes: z.string().optional(),
});
const pricingStreamSchema = z.object({
  feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]),
  targetType: z.enum(["unit", "group", "contract"]).default("unit"),
  label: z.string().optional(),
  notes: z.string().optional(),
  // For a multi-unit contract (`units`), a "unit"-scoped stream that should
  // only price a subset of the units it created — matched against those
  // units' own unitLabel. Omitted (the common case: one unit, or a stream
  // that legitimately covers every unit it created) links to all of them.
  contractUnitLabels: z.array(z.string()).optional(),
  rates: z.array(rateSchema).min(1),
});
const concessionSchema = z.object({
  streamLabel: z.string().nullable().optional(), // null/omitted = applies to every stream
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  discountPercentage: decimalString,
  reason: z.string().optional(),
});
const depositTermsSchema = z.object({
  effectiveStart: z.string(),
  requirementType: z.enum(["fixed", "formula"]),
  fixedAmountFen: z.number().optional(),
  formulaBasis: z.string().optional(),
  waiverConditionText: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

const unitSchema = z.object({
  unitLabel: z.string().min(1),
  unitType: z.enum(["building", "open_land"]).default("building"),
  rentableAreaSqm: decimalString,
  // Optional per-unit override for a multi-unit contract; falls back to
  // rentableAreaSqm when omitted. For the single-unit `unit` field, the
  // top-level `contractedAreaSqm` is used instead when this is unset.
  contractedAreaSqm: decimalString.optional(),
  // Optional per-unit override for when this specific space's coverage
  // starts later than the contract's own termStart (e.g. space added
  // partway through an existing lease's term). Falls back to termStart.
  effectiveStart: z.string().optional(),
});

const importSchema = z
  .object({
    referenceNumber: z.string().min(1),
    landlord: partySchema,
    tenant: partySchema,
    property: z.object({ name: z.string().min(1), nameEn: z.string().optional(), address: z.string().min(1) }),
    // Single-unit contracts (the common case) use `unit` + top-level
    // `contractedAreaSqm`. A contract spanning more than one physical space
    // (e.g. two floors under one lease) uses `units` instead — each entry
    // may carry its own `contractedAreaSqm`. Exactly one of the two must be
    // given; `unit` is kept as its own field rather than folded into
    // `units` so every JSON file generated before this existed keeps working
    // unchanged.
    unit: unitSchema.optional(),
    units: z.array(unitSchema).min(1).optional(),
    termStart: z.string(),
    termEnd: z.string(),
    renewalNoticeDays: z.number().default(90),
    specialTerms: z.string().optional(),
    contractedAreaSqm: decimalString.optional(),
    billingRules: z.object({
      billingFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
      periodAnchorDay: z.number().default(1),
      dueDay: z.number(),
      dueMonthOffset: z.number().default(0),
    }),
    pricingStreams: z.array(pricingStreamSchema).min(1),
    concessions: z.array(concessionSchema).default([]),
    // A contract can carry more than one deposit requirement — e.g. the
    // original committed area's deposit plus a separately-negotiated (or
    // waived) deposit for space added later. `depositTerms` (singular)
    // stays for the common one-deposit case; `depositTermsList` covers more
    // than one without disturbing any existing single-deposit import file.
    depositTerms: depositTermsSchema.optional(),
    depositTermsList: z.array(depositTermsSchema).optional(),
    sourceDocument: z.object({ path: z.string(), docType: z.string().default("signed_lease"), classification: z.enum(["ordinary", "sensitive"]).default("ordinary") }).optional(),
  })
  .refine((data) => !!data.unit !== !!data.units, {
    message: "Provide exactly one of `unit` (single-unit contract) or `units` (multi-unit contract).",
  })
  .refine((data) => !data.unit || !!data.contractedAreaSqm, {
    message: "`contractedAreaSqm` is required at the top level when using `unit`.",
  });

function findOrCreateParty(input: z.infer<typeof partySchema>) {
  const existing = db.select().from(parties).where(and(eq(parties.name, input.name), eq(parties.type, input.type))).get();
  if (existing) {
    console.log(`Reusing existing ${input.type} party: ${input.name} (id ${existing.id})`);
    return existing;
  }
  const inserted = db.insert(parties).values(input).returning().get();
  console.log(`Created ${input.type} party: ${input.name} (id ${inserted.id})`);
  return inserted;
}

function findOrCreateProperty(input: { name: string; nameEn?: string; address: string }) {
  const existing = db.select().from(properties).where(eq(properties.address, input.address)).get();
  if (existing) {
    console.log(`Reusing existing property: ${input.name} (id ${existing.id})`);
    return existing;
  }
  const inserted = db.insert(properties).values(input).returning().get();
  console.log(`Created property: ${input.name} (id ${inserted.id})`);
  return inserted;
}

function findOrCreateUnit(propertyId: number, input: { unitLabel: string; unitType: "building" | "open_land"; rentableAreaSqm: string }) {
  const existing = db.select().from(units).where(and(eq(units.propertyId, propertyId), eq(units.unitLabel, input.unitLabel))).get();
  if (existing) {
    console.log(`Reusing existing unit: ${input.unitLabel} (id ${existing.id})`);
    return existing;
  }
  const inserted = db.insert(units).values({ propertyId, ...input }).returning().get();
  console.log(`Created unit: ${input.unitLabel} (id ${inserted.id})`);
  return inserted;
}

function resolveActor(actorEmail: string | undefined) {
  const actor = actorEmail
    ? db.select().from(users).where(eq(users.email, actorEmail)).get()
    : db.select().from(users).where(eq(users.role, "admin")).get();
  if (!actor) {
    throw new Error(actorEmail ? `No user found with email ${actorEmail}.` : "No admin user found — pass --actor-email <email>.");
  }
  return actor;
}

function main() {
  const args = process.argv.slice(2);
  const jsonPath = args.find((a) => !a.startsWith("--"));
  const activate = args.includes("--activate");
  const actorEmailFlagIdx = args.indexOf("--actor-email");
  const actorEmail = actorEmailFlagIdx >= 0 ? args[actorEmailFlagIdx + 1] : undefined;

  if (!jsonPath) {
    console.error("Usage: npm run import-contract -- <path/to/contract.json> [--activate] [--actor-email you@company.com]");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Invalid import file:");
    console.error(JSON.stringify(parsed.error.flatten(), null, 2));
    process.exit(1);
  }
  const data = parsed.data;
  const actor = resolveActor(actorEmail);

  const contractId = db.transaction(() => {
    const landlord = findOrCreateParty(data.landlord);
    const tenant = findOrCreateParty(data.tenant);
    const property = findOrCreateProperty(data.property);

    const unitsInput = data.units ?? [data.unit!];

    const contract = db
      .insert(contracts)
      .values({
        referenceNumber: data.referenceNumber,
        landlordPartyId: landlord.id,
        tenantPartyId: tenant.id,
        termStart: data.termStart,
        termEnd: data.termEnd,
        renewalNoticeDays: data.renewalNoticeDays,
        specialTerms: data.specialTerms,
      })
      .returning()
      .get();
    console.log(`Created contract ${data.referenceNumber} (id ${contract.id}, draft)`);

    db.insert(billingRules).values({ contractId: contract.id, ...data.billingRules }).run();

    const contractUnitsCreated = unitsInput.map((unitInput) => {
      const { contractedAreaSqm, effectiveStart, ...unitFields } = unitInput;
      const unit = findOrCreateUnit(property.id, unitFields);
      // The top-level `contractedAreaSqm` is a single-unit concept (paired
      // with the singular `unit` field) — never applied per-entry here, or
      // a multi-unit contract's combined total would get duplicated onto
      // every one of its units instead of each keeping its own area.
      const resolvedContractedAreaSqm = data.units ? (contractedAreaSqm ?? unitInput.rentableAreaSqm) : (data.contractedAreaSqm ?? unitInput.rentableAreaSqm);
      const contractUnit = db
        .insert(contractUnits)
        .values({
          contractId: contract.id,
          unitId: unit.id,
          effectiveStart: effectiveStart ?? data.termStart,
          contractedAreaSqm: resolvedContractedAreaSqm,
        })
        .returning()
        .get();
      return { contractUnit, unitLabel: unitInput.unitLabel };
    });

    const streamIdByLabel = new Map<string, number>();
    for (const streamInput of data.pricingStreams) {
      const { rates, contractUnitLabels, ...streamFields } = streamInput;
      const stream = db.insert(pricingStreams).values({ contractId: contract.id, ...streamFields }).returning().get();
      if (streamFields.label) streamIdByLabel.set(streamFields.label, stream.id);
      if (streamFields.targetType === "unit") {
        // A single-unit contract links unambiguously. A multi-unit contract
        // targets only the units named in contractUnitLabels, if given —
        // otherwise (no targeting info) it links to every unit it created,
        // right for a combined figure covering all of them.
        const targets = contractUnitLabels
          ? contractUnitsCreated.filter((c) => contractUnitLabels.includes(c.unitLabel))
          : contractUnitsCreated;
        if (contractUnitLabels && targets.length !== contractUnitLabels.length) {
          throw new Error(`Pricing stream "${streamFields.label ?? streamFields.feeType}" references unknown contractUnitLabels: ${contractUnitLabels.filter((l) => !contractUnitsCreated.some((c) => c.unitLabel === l)).join(", ")}`);
        }
        for (const { contractUnit } of targets) {
          db.insert(pricingStreamUnits).values({ pricingStreamId: stream.id, contractUnitId: contractUnit.id }).run();
        }
      }
      for (const rate of rates) {
        db.insert(rateSchedule).values({ pricingStreamId: stream.id, ...rate }).run();
      }
      console.log(`  + pricing stream "${streamFields.label ?? streamFields.feeType}": ${rates.length} rate tier(s)`);
    }

    for (const concession of data.concessions) {
      const { streamLabel, ...fields } = concession;
      let pricingStreamId: number | null = null;
      if (streamLabel) {
        pricingStreamId = streamIdByLabel.get(streamLabel) ?? null;
        if (pricingStreamId === null) throw new Error(`Concession references unknown streamLabel "${streamLabel}".`);
      }
      db.insert(concessions).values({ contractId: contract.id, pricingStreamId, ...fields }).run();
      console.log(`  + concession: ${fields.discountPercentage}% off ${streamLabel ?? "all streams"}, ${fields.effectiveStart}..${fields.effectiveEnd}`);
    }

    for (const dt of [...(data.depositTerms ? [data.depositTerms] : []), ...(data.depositTermsList ?? [])]) {
      db.insert(depositTerms).values({ contractId: contract.id, ...dt }).run();
      console.log(`  + deposit terms recorded`);
    }

    if (data.sourceDocument) {
      const storageDir = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";
      const fileBuffer = fs.readFileSync(data.sourceDocument.path);
      const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const storedName = `${crypto.randomUUID()}${path.extname(data.sourceDocument.path)}`;
      const ownerDir = path.join(storageDir, "contract", String(contract.id));
      fs.mkdirSync(ownerDir, { recursive: true });
      const destPath = path.join(ownerDir, storedName);
      fs.copyFileSync(data.sourceDocument.path, destPath);
      const mimeType = data.sourceDocument.path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
      db.insert(documents)
        .values({
          ownerType: "contract",
          ownerId: contract.id,
          docType: data.sourceDocument.docType,
          classification: data.sourceDocument.classification,
          filePath: destPath,
          mimeType,
          sizeBytes: fileBuffer.length,
          checksumSha256: checksum,
          uploadedBy: actor.id,
        })
        .run();
      console.log(`  + attached ${data.sourceDocument.docType} document from ${data.sourceDocument.path}`);
    }

    if (activate) {
      const hasSignedLease = db
        .select()
        .from(documents)
        .where(and(eq(documents.ownerType, "contract"), eq(documents.ownerId, contract.id), eq(documents.docType, "signed_lease")))
        .get();
      if (!hasSignedLease) {
        throw new Error("--activate requires a signed_lease document — set sourceDocument in the JSON (with docType \"signed_lease\") or upload one first.");
      }
      db.update(contracts).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(contracts.id, contract.id)).run();
      recordContractVersion(contract.id, contract.versionNumber, contract.termStart, null);
      console.log(`  + activated`);
    }

    return contract.id;
  });

  console.log(`\nDone — contract id ${contractId}${activate ? " (active)" : " (draft — review it in the UI, then Activate)"}.`);
}

main();
