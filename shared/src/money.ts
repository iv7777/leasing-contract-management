import Decimal from "decimal.js";

/**
 * All persisted monetary amounts are integer fen (1 yuan = 100 fen).
 * All intermediate math (rates, areas, percentages, escalations) must use
 * Decimal, never native floating point, per project brief.
 */
export type Fen = number;

export function yuanToFen(yuan: Decimal.Value): Fen {
  return new Decimal(yuan).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fenToYuan(fen: Fen): Decimal {
  return new Decimal(fen).dividedBy(100);
}

export function formatFen(fen: Fen, locale: "en" | "zh" = "en"): string {
  const yuan = fenToYuan(fen).toNumber();
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency: "CNY",
    currencyDisplay: "symbol",
  }).format(yuan);
}

export function sumFen(values: Fen[]): Fen {
  return values.reduce((acc, v) => acc + v, 0);
}

export function roundToFen(amount: Decimal.Value, mode: Decimal.Rounding = Decimal.ROUND_HALF_UP): Fen {
  return new Decimal(amount).toDecimalPlaces(0, mode).toNumber();
}

export { Decimal };
