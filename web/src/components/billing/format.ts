export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Server returns a stream's own label, or the raw fee type when it has none. */
export function streamName(t: (key: string) => string, label: string, feeType: string): string {
  return label === feeType ? t(`contracts.${camel(feeType)}`) : label;
}

/** Payment methods are stored as the English names above; show them in the
 * viewer's language. Anything else (older or free-typed values) is shown as is. */
export function paymentMethodLabel(t: (key: string) => string, method: string): string {
  return (PAYMENT_METHODS as readonly string[]).includes(method) ? t(`billing.methods.${camel(method.toLowerCase().replace(/ /g, "_"))}`) : method;
}

/** What a document is called in lists: the name its uploader gave it, or else its type. */
export function docDisplayName(t: (key: string) => string, d: { name?: string | null; docType: string }): string {
  return d.name?.trim() ? d.name.trim() : docTypeLabel(t, d.docType);
}

/** Document types the app itself offers; any other value is the user's own wording. */
export function docTypeLabel(t: (key: string) => string, docType: string): string {
  if (docType === "signed_lease") return t("contracts.signedLease");
  if (docType === "signed_supplement") return t("contracts.signedSupplement");
  if (docType === "other") return t("contracts.otherDocumentType");
  return docType;
}

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "WeChat Pay", "Alipay", "Cheque", "Other"] as const;
