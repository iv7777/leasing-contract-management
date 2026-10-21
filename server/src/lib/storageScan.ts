import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

/** Every regular file under `dir`, as absolute paths. A missing directory yields none. */
export function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Files in the storage folder that no document record points to. */
export function findOrphanFiles(root: string, knownPaths: string[]): { relativePath: string; sizeBytes: number }[] {
  const known = new Set(knownPaths.map((p) => path.resolve(p)));
  const rootAbs = path.resolve(root);
  return listFilesRecursive(rootAbs)
    .filter((f) => !known.has(path.resolve(f)))
    .sort()
    .map((f) => ({ relativePath: path.relative(rootAbs, f), sizeBytes: fs.statSync(f).size }));
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}
