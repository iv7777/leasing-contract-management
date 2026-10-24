import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, contractUnits, parties, pricingStreams, properties, units } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { contractRef } from "../lib/auditDetail.js";
import { broughtForwardId } from "../lib/openingBalance.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { buildAccountStatement } from "../billing/accountStatement.js";
import { computeDepositBalance } from "../billing/ledger.js";
import { todayInChina } from "@lcm/shared";

/** The Statement tab: a statement of account for any period (a month, a year, custom dates, or everything). */
export const accountStatementRouter = Router();
accountStatementRouter.use(requireAuth);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The China calendar day of a stored UTC timestamp. */
const chinaDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

accountStatementRouter.get("/contracts/:id/account-statement", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });

  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
  if ((from !== null && !DAY.test(from)) || (to !== null && !DAY.test(to)) || (from !== null && to !== null && from > to)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Give the period as from=YYYY-MM-DD&to=YYYY-MM-DD (from must not be after to), or leave both out for everything." } });
  }
  const streamId = req.query.streamId ? Number(req.query.streamId) : null;
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  if (streamId !== null && !streams.some((s) => s.id === streamId)) {
    return res.status(400).json({ error: { code: "invalid_reference", message: "That item does not belong to this contract." } });
  }
  const includeMuted = req.query.includeVoided === "1";

  const ledger = loadLedgerInputs(contractId);
  const statement = buildAccountStatement(
    {
      charges: ledger.chargesRaw.map((c) => ({
        id: c.id, pricingStreamId: c.pricingStreamId, feeType: c.feeType, serviceStart: c.serviceStart, serviceEnd: c.serviceEnd,
        dueDate: c.dueDate, amountFen: c.amountFen, status: c.status, broughtForward: broughtForwardId(c.calculationSnapshotJson) !== null, oneOff: c.calculationSnapshotJson.includes('"kind":"one_off"'),
      })),
      adjustments: ledger.adjustmentsRaw.map((a) => ({ id: a.id, chargeId: a.chargeId, amountFen: a.amountFen, reason: a.reason, date: chinaDay(a.createdAt) })),
      receipts: ledger.receiptsRaw.map((r) => ({
        id: r.id, receivedDate: r.receivedDate, amountFen: r.amountFen, paymentMethod: r.paymentMethod, externalReference: r.externalReference,
        status: r.status, removed: r.removedAt !== null,
      })),
      allocations: ledger.allocations.map((a) => ({ receiptId: a.receiptId, chargeId: a.chargeId, amountFen: a.amountFen, date: chinaDay(a.createdAt) })),
    },
    { from, to, pricingStreamId: streamId, includeMuted },
  );

  // Deposit movements are kept apart: the deposit is held for the tenant, it is not rent owed.
  const removedIds = new Set<number>();
  for (const d of ledger.depositTransactionsRaw) if (d.removedAt && d.reversalOfId !== null) removedIds.add(d.reversalOfId);
  const deposit = ledger.depositTransactionsRaw
    .filter((d) => (from === null || d.transactionDate >= from) && (to === null || d.transactionDate <= to))
    .filter((d) => includeMuted || (!d.removedAt && !removedIds.has(d.id)))
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.id - b.id)
    .map((d) => ({ id: d.id, date: d.transactionDate, type: d.transactionType, amountFen: d.amountFen, reason: d.reason, removed: removedIds.has(d.id) || !!d.removedAt }));
  const heldFen = computeDepositBalance(ledger.depositTransactionsRaw.map((d) => ({ amountFen: d.amountFen, transactionDate: d.transactionDate })), to ?? "9999-12-31");

  const landlord = db.select({ name: parties.name }).from(parties).where(eq(parties.id, contract.landlordPartyId)).get();
  const tenant = db.select({ name: parties.name }).from(parties).where(eq(parties.id, contract.tenantPartyId)).get();
  const cu = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  const unitRows = db.select().from(units).all().filter((u) => cu.some((x) => x.unitId === u.id));
  const propertyNames = new Map(db.select({ id: properties.id, name: properties.name }).from(properties).all().map((p) => [p.id, p.name]));

  res.json({
    header: {
      contractRef: contractRef(contractId),
      tenant: tenant?.name ?? "",
      landlord: landlord?.name ?? "",
      units: unitRows.map((u) => `${propertyNames.get(u.propertyId) ?? ""} ${u.unitLabel}`.trim()),
      termStart: contract.termStart,
      termEnd: contract.termEnd,
    },
    items: streams.map((s) => ({ id: s.id, label: s.label, feeType: s.feeType })),
    statement,
    deposit: { lines: deposit, heldFen },
    asOf: todayInChina(),
  });
});
