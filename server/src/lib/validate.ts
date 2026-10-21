import { z } from "zod";

/** A real calendar date written YYYY-MM-DD ("2026-02-30" and "abc" are refused). */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isoDate = z.string().refine(isRealDate, "Must be a date written YYYY-MM-DD.");

/** Whole fen (the smallest money unit); never fractional. */
export const fenAmount = z.number().int().min(0).max(1_000_000_000_000);
export const positiveFen = z.number().int().positive().max(1_000_000_000_000);

/** Names and labels: trimmed, not blank, not absurdly long. */
export const shortText = (max = 200) => z.string().trim().min(1).max(max);
/** Free text (notes, reasons, special terms). */
export const longText = (max = 5000) => z.string().max(max);

export const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number").max(20);

/** A percentage from 0 to 100, as decimal text. */
export const percentString = decimalString.refine((v) => Number(v) <= 100, "Can't be more than 100.");
