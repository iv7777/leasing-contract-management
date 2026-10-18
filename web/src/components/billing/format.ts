export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Server returns a stream's own label, or the raw fee type when it has none. */
export function streamName(t: (key: string) => string, label: string, feeType: string): string {
  return label === feeType ? t(`contracts.${camel(feeType)}`) : label;
}

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "WeChat Pay", "Alipay", "Cheque", "Other"] as const;
