import { Router } from "express";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { charges, chargeAdjustments, contracts, documents, pricingStreams, rateSchedule, receiptAllocations, receipts, billingRules, usageEntries, users } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { contractRef } from "../lib/auditDetail.js";
import { broughtForwardId } from "../lib/openingBalance.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance } from "../billing/ledger.js";
import { computeLatePenalty } from "../billing/latePenalty.js";
import { todayInChina } from "@lcm/shared";

/** Everything about one bill in one place: how its amount was worked out (as stored when it was made), what has been
 * paid on it, any adjustments, the meter reading behind it, and, if voided, who did it and why. Read-only. */
export const chargeDetailRouter = Router();
chargeDetailRouter.use(requireAuth);

chargeDetailRouter.get("/charges/:id", (req, res) => {
  const id = Number(req.params.id);
  const charge = db.select().from(charges).where(eq(charges.id, id)).get();
  if (!charge) return res.status(404).json({ error: { code: "not_found", message: "Charge not found." } });
  if (!canAccessContract(req.user!, charge.contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }

  const stream = db.select().from(pricingStreams).where(eq(pricingStreams.id, charge.pricingStreamId)).get();
  const contract = db.select().from(contracts).where(eq(contracts.id, charge.contractId)).get();
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));

  // The calculation exactly as it was stored when the bill was made.
  let snapshot: unknown = null;
  try {
    snapshot = JSON.parse(charge.calculationSnapshotJson);
  } catch {
    snapshot = null;
  }
  const broughtForward = broughtForwardId(charge.calculationSnapshotJson) !== null;

  // Balance and late fee as of today.
  const data = loadLedgerInputs(charge.contractId);
  const today = todayInChina();
  const ledgerCharge = data.charges.find((c) => c.id === id)!;
  const balance = computeChargeBalance(ledgerCharge, data.adjustments, data.allocations, today, data.overdueGraceDays);
  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, charge.contractId)).get();
  const latePenaltyFen = computeLatePenalty(balance.balanceFen, balance.daysOverdue, {
    enabled: rules?.latePenaltyEnabled ?? false,
    dailyRatePermille: rules?.latePenaltyDailyRatePermille ?? null,
    capFen: rules?.latePenaltyCapFen ?? null,
  });

  // Payments applied (and taken back), oldest first.
  const receiptById = new Map(data.receiptsRaw.map((r) => [r.id, r]));
  const payments = db
    .select()
    .from(receiptAllocations)
    .where(eq(receiptAllocations.chargeId, id))
    .all()
    .sort((a, b) => a.id - b.id)
    .map((a) => {
      const r = receiptById.get(a.receiptId) ?? db.select().from(receipts).where(eq(receipts.id, a.receiptId)).get();
      return { id: a.id, receiptId: a.receiptId, amountFen: a.amountFen, reversal: a.amountFen < 0, receivedDate: r?.receivedDate ?? null, paymentMethod: r?.paymentMethod ?? null, appliedAt: a.createdAt };
    });
  const adjustments = db
    .select()
    .from(chargeAdjustments)
    .where(eq(chargeAdjustments.chargeId, id))
    .all()
    .map((a) => ({ id: a.id, amountFen: a.amountFen, reason: a.reason, createdAt: a.createdAt, by: names.get(a.actorUserId) ?? null }));

  // The reading behind it: this item's own, or the metered item whose usage a service fee follows.
  const followed = db
    .select()
    .from(rateSchedule)
    .where(eq(rateSchedule.pricingStreamId, charge.pricingStreamId))
    .all()
    .find((r) => r.linkedStreamId && r.effectiveStart <= charge.serviceStart && (!r.effectiveEnd || r.effectiveEnd >= charge.serviceStart));
  const readingStreamId = followed?.linkedStreamId ?? charge.pricingStreamId;
  const reading = db
    .select()
    .from(usageEntries)
    .where(eq(usageEntries.pricingStreamId, readingStreamId))
    .all()
    .find((u) => u.serviceStart === charge.serviceStart && u.serviceEnd === charge.serviceEnd);
  const photo = reading ? db.select().from(documents).all().find((d) => d.ownerType === "usage_entry" && d.ownerId === reading.id) : null;
  const readingStream = reading && readingStreamId !== charge.pricingStreamId ? db.select().from(pricingStreams).where(eq(pricingStreams.id, readingStreamId)).get() : null;

  res.json({
    charge: {
      id: charge.id,
      contractId: charge.contractId,
      contractRef: contractRef(charge.contractId),
      contractStatus: contract?.status ?? null,
      feeType: charge.feeType,
      itemName: stream?.label ?? charge.feeType,
      serviceStart: charge.serviceStart,
      serviceEnd: charge.serviceEnd,
      dueDate: charge.dueDate,
      amountFen: charge.amountFen,
      status: charge.status,
      createdAt: charge.createdAt,
      voidedAt: charge.voidedAt,
      voidedBy: charge.voidedBy ? names.get(charge.voidedBy) ?? null : null,
      voidReason: charge.voidReason,
      broughtForward,
    },
    snapshot,
    balance: { balanceFen: balance.balanceFen, allocatedFen: balance.allocatedFen, adjustedFen: balance.adjustedFen, isOverdue: balance.isOverdue, daysOverdue: balance.daysOverdue, latePenaltyFen },
    payments,
    adjustments,
    reading: reading
      ? {
          id: reading.id,
          quantity: reading.quantity,
          unit: reading.unit,
          amountFen: reading.amountFen,
          itemName: readingStream ? readingStream.label ?? readingStream.feeType : null,
          photoDocumentId: photo?.id ?? null,
          photoMissing: photo ? !fs.existsSync(photo.filePath) : false,
        }
      : null,
  });
});

