import fs from "node:fs";

// pdfkit's built-in fonts (Helvetica etc.) have zero CJK glyph coverage, so
// any Chinese text renders as blank boxes unless a CJK-capable font is
// embedded. WenQuanYi Zen Hei covers Simplified Chinese and has decent Latin
// glyphs too, so it's used for everything (not just Chinese-language
// documents) — a party name can be Chinese even in an English-language
// export. Installed via `apt-get install fonts-wqy-zenhei` (see
// deploy/vps-deploy.sh); the file is a font *collection*, so pdfkit needs
// the specific sub-font name, not just the path, to embed it correctly.
const CJK_FONT_CANDIDATES: Array<{ path: string; family: string }> = [
  { path: "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", family: "WenQuanYiZenHei" },
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJK-Regular" },
];

let resolved: { path: string; family: string } | null | undefined;

function resolveCjkFont() {
  if (resolved !== undefined) return resolved;
  resolved = CJK_FONT_CANDIDATES.find((c) => fs.existsSync(c.path)) ?? null;
  if (!resolved) {
    console.warn("No CJK font found (looked for fonts-wqy-zenhei / fonts-noto-cjk) — Chinese text in PDF exports will not render.");
  }
  return resolved;
}

/** Registers the CJK font as "CJK" on the document and selects it as the
 * current font, if one is installed; otherwise leaves pdfkit's default
 * (Helvetica) in place so English-only output still works. */
export function useCjkFont(doc: PDFKit.PDFDocument): void {
  const font = resolveCjkFont();
  if (!font) return;
  doc.registerFont("CJK", font.path, font.family);
  doc.font("CJK");
}
