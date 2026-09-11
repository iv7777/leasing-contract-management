import { Router } from "express";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { db } from "../db/client.js";
import {
  contracts,
  parties,
  contractUnits,
  units,
  pricingStreams,
  rateSchedule,
  depositTerms,
  amendments,
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance } from "../billing/ledger.js";
import { recordAudit } from "../lib/audit.js";
import { todayInChina } from "@lcm/shared";

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

function canDownloadOrPrint(user: { role: string; canDownloadPdf: boolean; canPrint: boolean }, kind: "pdf" | "print"): boolean {
  if (user.role === "admin" || user.role === "manager") return true;
  return kind === "pdf" ? user.canDownloadPdf : user.canPrint;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PDF contract summary: approved terms, payment ledger, amendment history —
// generated fresh each time, never including party_sensitive_details or the
// stored sensitive originals, and gated the same way document download is.
// ---------------------------------------------------------------------------

exportsRouter.get("/contracts/:id/pdf-summary", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  if (!canDownloadOrPrint(req.user!, "pdf")) {
    return res.status(403).json({ error: { code: "forbidden", message: "Download is disabled for this account." } });
  }

  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });

  const landlord = db.select().from(parties).where(eq(parties.id, contract.landlordPartyId)).get();
  const tenant = db.select().from(parties).where(eq(parties.id, contract.tenantPartyId)).get();
  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  const unitLabels = new Map(db.select().from(units).all().map((u) => [u.id, u.unitLabel]));
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  const streamIds = streams.map((s) => s.id);
  const rates = streamIds.length ? db.select().from(rateSchedule).all().filter((r) => streamIds.includes(r.pricingStreamId)) : [];
  const deposits = db.select().from(depositTerms).where(eq(depositTerms.contractId, contractId)).all();
  const amendmentRows = db.select().from(amendments).where(eq(amendments.contractId, contractId)).all();

  const ledger = loadLedgerInputs(contractId);
  const asOfDate = todayInChina();
  const chargeBalances = ledger.charges.map((c) => ({ charge: ledger.chargesRaw.find((x) => x.id === c.id)!, balance: computeChargeBalance(c, ledger.adjustments, ledger.allocations, asOfDate) }));

  recordAudit({ actorUserId: req.user!.id, action: "contract_pdf_exported", entityType: "contract", entityId: contractId });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${contract.referenceNumber}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text(`Contract Summary — ${contract.referenceNumber}`, { underline: true });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Status: ${contract.status}  ·  Version: ${contract.versionNumber}`);
  doc.text(`Landlord: ${landlord?.name ?? ""}`);
  doc.text(`Tenant: ${tenant?.name ?? ""}`);
  doc.text(`Term: ${contract.termStart} to ${contract.termEnd}`);
  doc.text(`Renewal notice: ${contract.renewalNoticeDays} days`);
  doc.moveDown();

  doc.fontSize(14).text("Units");
  doc.fontSize(11);
  for (const u of cUnits) {
    doc.text(`  ${unitLabels.get(u.unitId) ?? u.unitId} — ${u.contractedAreaSqm} sqm, from ${u.effectiveStart}${u.effectiveEnd ? ` to ${u.effectiveEnd}` : ""}`);
  }
  doc.moveDown();

  doc.fontSize(14).text("Pricing");
  doc.fontSize(11);
  for (const s of streams) {
    doc.text(`  ${s.label ?? s.feeType} (${s.feeType})`);
    for (const r of rates.filter((r) => r.pricingStreamId === s.id)) {
      doc.text(`    ${r.calculationMethod} — ${r.amountOrRate} (${r.rateBasis}), from ${r.effectiveStart}${r.effectiveEnd ? ` to ${r.effectiveEnd}` : ""}`);
    }
  }
  doc.moveDown();

  doc.fontSize(14).text("Deposit");
  doc.fontSize(11);
  for (const d of deposits) {
    doc.text(`  ${d.requirementType === "fixed" ? `${((d.fixedAmountFen ?? 0) / 100).toFixed(2)} yuan` : d.formulaBasis}, effective ${d.effectiveStart}`);
  }
  doc.moveDown();

  doc.fontSize(14).text("Payment ledger");
  doc.fontSize(10);
  for (const { charge, balance } of chargeBalances) {
    doc.text(
      `  ${charge.serviceStart} – ${charge.serviceEnd}  ${charge.feeType}  billed ${(charge.amountFen / 100).toFixed(2)}  balance ${(balance.balanceFen / 100).toFixed(2)}${balance.isOverdue ? `  OVERDUE ${balance.daysOverdue}d` : ""}`,
    );
  }
  doc.moveDown();

  doc.fontSize(14).text("Amendment history");
  doc.fontSize(10);
  for (const a of amendmentRows) {
    doc.text(`  ${a.effectiveDate}  ${a.type}  [${a.status}]  ${a.reason}`);
  }

  doc.end();
});

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

exportsRouter.get("/contracts.csv", (req, res) => {
  if (!canDownloadOrPrint(req.user!, "print")) {
    return res.status(403).json({ error: { code: "forbidden", message: "Export is disabled for this account." } });
  }
  const all = db.select().from(contracts).all().filter((c) => canAccessContract(req.user!, c.id));
  const partyMap = new Map(db.select().from(parties).all().map((p) => [p.id, p.name]));

  const csv = toCsv(
    all.map((c) => ({
      referenceNumber: c.referenceNumber,
      landlord: partyMap.get(c.landlordPartyId) ?? "",
      tenant: partyMap.get(c.tenantPartyId) ?? "",
      termStart: c.termStart,
      termEnd: c.termEnd,
      status: c.status,
      version: c.versionNumber,
    })),
  );

  recordAudit({ actorUserId: req.user!.id, action: "contracts_exported_csv", entityType: "contract" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contracts.csv"');
  res.send("﻿" + csv); // BOM so Excel renders Chinese characters correctly
});

exportsRouter.get("/contracts/:id/ledger.csv", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  if (!canDownloadOrPrint(req.user!, "print")) {
    return res.status(403).json({ error: { code: "forbidden", message: "Export is disabled for this account." } });
  }

  const ledger = loadLedgerInputs(contractId);
  const asOfDate = todayInChina();
  const rows = ledger.chargesRaw.map((c) => {
    const balance = computeChargeBalance(
      { id: c.id, amountFen: c.amountFen, dueDate: c.dueDate, serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, status: c.status },
      ledger.adjustments,
      ledger.allocations,
      asOfDate,
    );
    return {
      serviceStart: c.serviceStart,
      serviceEnd: c.serviceEnd,
      feeType: c.feeType,
      dueDate: c.dueDate,
      billedYuan: (c.amountFen / 100).toFixed(2),
      allocatedYuan: (balance.allocatedFen / 100).toFixed(2),
      balanceYuan: (balance.balanceFen / 100).toFixed(2),
      overdueDays: balance.daysOverdue,
    };
  });

  recordAudit({ actorUserId: req.user!.id, action: "contract_ledger_exported_csv", entityType: "contract", entityId: contractId });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="contract-${contractId}-ledger.csv"`);
  res.send("﻿" + toCsv(rows));
});
