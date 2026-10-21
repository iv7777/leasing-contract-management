import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findOrphanFiles, listFilesRecursive, sha256File } from "./storageScan.js";

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lcm-scan-"));
  fs.mkdirSync(path.join(root, "contract", "1"), { recursive: true });
  fs.writeFileSync(path.join(root, "contract", "1", "a.pdf"), "aaa");
  fs.writeFileSync(path.join(root, "contract", "1", "b.pdf"), "bbbb");
  return root;
}

test("listFilesRecursive finds nested files and tolerates a missing folder", () => {
  const root = scratch();
  assert.equal(listFilesRecursive(root).length, 2);
  assert.deepEqual(listFilesRecursive(path.join(root, "nope")), []);
});

test("findOrphanFiles reports only files no record points to", () => {
  const root = scratch();
  const orphans = findOrphanFiles(root, [path.join(root, "contract", "1", "a.pdf")]);
  assert.deepEqual(orphans, [{ relativePath: path.join("contract", "1", "b.pdf"), sizeBytes: 4 }]);
});

test("sha256File matches the known digest", async () => {
  const root = scratch();
  assert.equal(await sha256File(path.join(root, "contract", "1", "a.pdf")), "9834876dcfb05cb167a5c24953eba58c4ac89b1adf57f28f2f9d09af107ee8f0");
});
