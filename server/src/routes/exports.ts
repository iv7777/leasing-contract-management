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
import { useCjkFont } from "../lib/pdfFonts.js";
import { exportLabels, resolveExportLang } from "../lib/exportLabels.js";

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

  const lang = resolveExportLang(req.query.lang);
  const L = exportLabels[lang];

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${contract.referenceNumber}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  useCjkFont(doc); // covers Chinese party/label text even when lang="en"
  doc.pipe(res);

  doc.fontSize(18).text(`${L.summaryTitle} — ${contract.referenceNumber}`, { underline: true });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`${L.status}: ${L[contract.status] ?? contract.status}  ·  ${L.version}: ${contract.versionNumber}`);
  doc.text(`${L.landlord}: ${landlord?.name ?? ""}`);
  doc.text(`${L.tenant}: ${tenant?.name ?? ""}`);
  doc.text(`${L.term}: ${contract.termStart} ${L.to} ${contract.termEnd}`);
  doc.text(`${L.renewalNotice}: ${contract.renewalNoticeDays} ${L.days}`);
  doc.moveDown();

  doc.fontSize(14).text(L.units);
  doc.fontSize(11);
  for (const u of cUnits) {
    doc.text(`  ${unitLabels.get(u.unitId) ?? u.unitId} — ${u.contractedAreaSqm} ${L.sqm}, ${L.from} ${u.effectiveStart}${u.effectiveEnd ? ` ${L.to} ${u.effectiveEnd}` : ""}`);
  }
  doc.moveDown();

  doc.fontSize(14).text(L.pricing);
  doc.fontSize(11);
  for (const s of streams) {
    doc.text(`  ${s.label ?? (L[s.feeType] ?? s.feeType)} (${L[s.feeType] ?? s.feeType})`);
    for (const r of rates.filter((r) => r.pricingStreamId === s.id)) {
      doc.text(`    ${L[r.calculationMethod] ?? r.calculationMethod} — ${r.amountOrRate} (${L[r.rateBasis] ?? r.rateBasis}), ${L.from} ${r.effectiveStart}${r.effectiveEnd ? ` ${L.to} ${r.effectiveEnd}` : ""}`);
    }
  }
  doc.moveDown();

  doc.fontSize(14).text(L.deposit);
  doc.fontSize(11);
  for (const d of deposits) {
    doc.text(`  ${d.requirementType === "fixed" ? `${((d.fixedAmountFen ?? 0) / 100).toFixed(2)} ${L.yuan}` : d.formulaBasis}, ${L.effective} ${d.effectiveStart}`);
  }
  doc.moveDown();

  doc.fontSize(14).text(L.paymentLedger);
  doc.fontSize(10);
  for (const { charge, balance } of chargeBalances) {
    doc.text(
      `  ${charge.serviceStart} – ${charge.serviceEnd}  ${L[charge.feeType] ?? charge.feeType}  ${L.billed} ${(charge.amountFen / 100).toFixed(2)}  ${L.balance} ${(balance.balanceFen / 100).toFixed(2)}${balance.isOverdue ? `  ${L.overdue} ${balance.daysOverdue}${lang === "zh" ? "天" : "d"}` : ""}`,
    );
  }
  doc.moveDown();

  doc.fontSize(14).text(L.amendmentHistory);
  doc.fontSize(10);
  for (const a of amendmentRows) {
    doc.text(`  ${a.effectiveDate}  ${a.type}  [${L[a.status] ?? a.status}]  ${a.reason}`);
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
  const lang = resolveExportLang(req.query.lang);
  const L = exportLabels[lang];
  const all = db.select().from(contracts).all().filter((c) => canAccessContract(req.user!, c.id));
  const partyMap = new Map(db.select().from(parties).all().map((p) => [p.id, p.name]));

  const csv = toCsv(
    all.map((c) => ({
      [L.csvReferenceNumber]: c.referenceNumber,
      [L.csvLandlord]: partyMap.get(c.landlordPartyId) ?? "",
      [L.csvTenant]: partyMap.get(c.tenantPartyId) ?? "",
      [L.csvTermStart]: c.termStart,
      [L.csvTermEnd]: c.termEnd,
      [L.csvStatus]: L[c.status] ?? c.status,
      [L.csvVersion]: c.versionNumber,
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

  const lang = resolveExportLang(req.query.lang);
  const L = exportLabels[lang];
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
      [L.csvServiceStart]: c.serviceStart,
      [L.csvServiceEnd]: c.serviceEnd,
      [L.csvFeeType]: L[c.feeType] ?? c.feeType,
      [L.csvDueDate]: c.dueDate,
      [L.csvBilledYuan]: (c.amountFen / 100).toFixed(2),
      [L.csvAllocatedYuan]: (balance.allocatedFen / 100).toFixed(2),
      [L.csvBalanceYuan]: (balance.balanceFen / 100).toFixed(2),
      [L.csvOverdueDays]: balance.daysOverdue,
    };
  });

  recordAudit({ actorUserId: req.user!.id, action: "contract_ledger_exported_csv", entityType: "contract", entityId: contractId });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="contract-${contractId}-ledger.csv"`);
  res.send("﻿" + toCsv(rows));
});
