/** One CSV cell. A value starting with = + - @ would be run as a formula by Excel; keep it as text. */
export const csvCell = (raw: string) => {
  const v = /^([=@\t\r]|[+-](?![\d.]))/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** Saves the lines as a UTF-8 CSV (with a byte-order mark so Excel reads Chinese correctly). */
export function downloadCsv(filename: string, rows: string[][]): void {
  const text = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Splits CSV or tab-separated text (as pasted from Excel) into rows of cells. Handles quoted cells. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(",") ? "," : firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** "¥1,500.50" or "1 500" -> fen; null when blank or not a number. */
export function parseYuanToFen(raw: string | undefined): number | null {
  const v = (raw ?? "").replace(/[¥￥,\s]/g, "");
  if (v === "" || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Math.round(parseFloat(v) * 100);
}

export interface BalanceRow {
  reference: string;
  balanceOwedFen: number | null;
  electricityFen: number | null;
  waterFen: number | null;
}

/** Reads the accountant's answers: a contract reference, the rent and fixed fees balance and, optionally,
 * the electricity and water balances. Works on the sheet we generate (columns found by their headings) or
 * on pasted columns in the order reference, rent and fixed fees, electricity, water. */
export function readBalances(rows: string[][]): BalanceRow[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  const find = (re: RegExp) => header.findIndex((h, i) => i > 0 && re.test(h));
  let rentCol = find(/rent|租金|fixed|固定/i);
  let elecCol = find(/electric|电/i);
  let waterCol = find(/water|水/i);
  let body = rows;
  if (rentCol >= 0 || elecCol >= 0 || waterCol >= 0) {
    body = rows.slice(1);
  } else if (rows.every((r) => r.length <= 4)) {
    [rentCol, elecCol, waterCol] = [1, 2, 3];
    // A header row of a pasted block ("Contract no., Balance") has a non-numeric cell where the balance should be.
    if (parseYuanToFen(rows[0][1]) === null && rows[0][1]?.trim()) body = rows.slice(1);
  } else {
    [rentCol, elecCol, waterCol] = [7, 8, 9];
    if (parseYuanToFen(rows[0][7]) === null && rows[0][7]?.trim()) body = rows.slice(1);
  }
  const at = (r: string[], col: number) => (col >= 0 ? parseYuanToFen(r[col]) : null);
  return body
    .map((r) => ({ reference: (r[0] ?? "").trim(), balanceOwedFen: at(r, rentCol), electricityFen: at(r, elecCol), waterFen: at(r, waterCol) }))
    .filter((r) => r.reference !== "");
}
