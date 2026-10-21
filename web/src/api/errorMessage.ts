import type { TFunction } from "i18next";
import i18n from "../i18n";
import { apiErrorByCode, apiErrorPatterns, apiErrorsZh } from "../i18n/apiErrors.zh";
import { ApiError } from "./client";

/** The text to show for a failed request. The server only speaks English, so
 * in Chinese the message is looked up by its exact text, then by pattern (for
 * messages with numbers in them), then by error code; anything unknown falls
 * back to the server's own message rather than hiding it. */
function translate(message: string, code: string): string {
  if (!i18n.language?.startsWith("zh")) return message;
  const exact = apiErrorsZh[message];
  if (exact) return exact;
  for (const p of apiErrorPatterns) {
    const m = message.match(p.re);
    if (m) return p.zh(m);
  }
  return apiErrorByCode[code] ?? message;
}

/** A list of problems the server found (e.g. why a contract can't be activated). */
function problemLines(details: unknown): string[] {
  const problems = (details as { problems?: { item?: string; message: string }[] } | undefined)?.problems;
  if (!Array.isArray(problems)) return [];
  return problems.map((p) => `• ${p.item ? `${p.item}: ` : ""}${translate(p.message, "invalid_input")}`);
}

export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof ApiError)) return t("common.error");
  const lines = problemLines(err.details);
  const base = translate(err.message, err.code);
  return lines.length ? `${base}\n${lines.join("\n")}` : base;
}
