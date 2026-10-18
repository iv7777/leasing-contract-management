import type { TFunction } from "i18next";
import i18n from "../i18n";
import { apiErrorByCode, apiErrorPatterns, apiErrorsZh } from "../i18n/apiErrors.zh";
import { ApiError } from "./client";

/** The text to show for a failed request. The server only speaks English, so
 * in Chinese the message is looked up by its exact text, then by pattern (for
 * messages with numbers in them), then by error code; anything unknown falls
 * back to the server's own message rather than hiding it. */
export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof ApiError)) return t("common.error");
  if (!i18n.language?.startsWith("zh")) return err.message;

  const exact = apiErrorsZh[err.message];
  if (exact) return exact;
  for (const p of apiErrorPatterns) {
    const m = err.message.match(p.re);
    if (m) return p.zh(m);
  }
  return apiErrorByCode[err.code] ?? err.message;
}
