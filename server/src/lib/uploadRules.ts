import path from "node:path";

/** What may be uploaded as a document: scans and photos, PDFs and ordinary
 * Office files. Anything else (programs, web pages, scripts) is refused, and
 * the stored type always comes from the extension we accept, never from what
 * the sender claims. */
interface FileKind {
  mime: string;
  /** Safe to show inside the browser; everything else is downloaded. */
  inline: boolean;
  /** Does the start of the file look like this kind of file? */
  magic: (head: Buffer) => boolean;
}

const startsWith = (head: Buffer, bytes: number[]) => bytes.every((b, i) => head[i] === b);
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP = [0x50, 0x4b];

const KINDS: Record<string, FileKind> = {
  ".pdf": { mime: "application/pdf", inline: true, magic: (h) => h.subarray(0, 1024).includes("%PDF-") },
  ".png": { mime: "image/png", inline: true, magic: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47]) },
  ".jpg": { mime: "image/jpeg", inline: true, magic: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  ".jpeg": { mime: "image/jpeg", inline: true, magic: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  ".gif": { mime: "image/gif", inline: true, magic: (h) => h.subarray(0, 4).toString("latin1") === "GIF8" },
  ".webp": { mime: "image/webp", inline: true, magic: (h) => h.subarray(0, 4).toString("latin1") === "RIFF" && h.subarray(8, 12).toString("latin1") === "WEBP" },
  ".bmp": { mime: "image/bmp", inline: false, magic: (h) => h.subarray(0, 2).toString("latin1") === "BM" },
  ".tif": { mime: "image/tiff", inline: false, magic: (h) => ["II*\0", "MM\0*"].includes(h.subarray(0, 4).toString("latin1")) },
  ".tiff": { mime: "image/tiff", inline: false, magic: (h) => ["II*\0", "MM\0*"].includes(h.subarray(0, 4).toString("latin1")) },
  ".doc": { mime: "application/msword", inline: false, magic: (h) => startsWith(h, OLE) },
  ".xls": { mime: "application/vnd.ms-excel", inline: false, magic: (h) => startsWith(h, OLE) },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, magic: (h) => startsWith(h, ZIP) },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, magic: (h) => startsWith(h, ZIP) },
};

export const UPLOAD_EMPTY = "The file is empty.";
export const UPLOAD_TYPE = "Only PDF files, images (JPG, PNG, GIF, WEBP, BMP, TIFF) and Word or Excel files can be uploaded.";
export const UPLOAD_CONTENT = "The file's content doesn't match its type. Check that it isn't damaged or renamed.";

export type UploadCheck = { ok: true; extension: string; mime: string; inline: boolean } | { ok: false; message: string };

export function inspectUpload(originalName: string, content: Buffer): UploadCheck {
  const extension = path.extname(originalName).toLowerCase();
  const kind = KINDS[extension];
  if (!kind) return { ok: false, message: UPLOAD_TYPE };
  if (content.length === 0) return { ok: false, message: UPLOAD_EMPTY };
  if (!kind.magic(content.subarray(0, 2048))) return { ok: false, message: UPLOAD_CONTENT };
  return { ok: true, extension, mime: kind.mime, inline: kind.inline };
}

/** Whether a stored document may be shown inside the browser rather than downloaded. */
export function isInlineMime(mime: string): boolean {
  return Object.values(KINDS).some((k) => k.inline && k.mime === mime);
}

/** A meter photo: a JPG, PNG or WEBP picture, nothing else. */
export function inspectPhotoUpload(originalName: string, content: Buffer): UploadCheck {
  const checked = inspectUpload(originalName, content);
  if (!checked.ok) return checked;
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(checked.extension)) return { ok: false, message: PHOTO_TYPE };
  return checked;
}

export const PHOTO_TYPE = "A meter photo must be a JPG, PNG or WEBP picture.";
export const PHOTO_TOO_LARGE = "That photo is too large (15 MB at most).";
