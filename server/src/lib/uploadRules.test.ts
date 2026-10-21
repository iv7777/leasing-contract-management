import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectUpload } from "./uploadRules.js";

test("a real PDF and PNG are accepted; scripts, programs and mislabelled files are not", () => {
  assert.equal(inspectUpload("lease.PDF", Buffer.from("%PDF-1.4\n...")).ok, true);
  assert.equal(inspectUpload("a.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])).ok, true);
  assert.equal(inspectUpload("x.html", Buffer.from("<script>alert(1)</script>")).ok, false);
  assert.equal(inspectUpload("x.exe", Buffer.from("MZ")).ok, false);
  assert.equal(inspectUpload("x.pdf", Buffer.alloc(0)).ok, false);
  assert.equal(inspectUpload("x.pdf", Buffer.from("<html>")).ok, false);
  assert.equal(inspectUpload("noext", Buffer.from("%PDF-1.4")).ok, false);
});

import { inspectPhotoUpload } from "./uploadRules.js";

test("a meter photo must be a JPG, PNG or WEBP picture", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const gif = Buffer.from("GIF89a....");
  assert.equal(inspectPhotoUpload("meter.jpg", jpg).ok, true);
  assert.equal(inspectPhotoUpload("meter.gif", gif).ok, false);
  assert.equal(inspectPhotoUpload("meter.pdf", Buffer.from("%PDF-1.4")).ok, false);
  assert.equal(inspectPhotoUpload("meter.jpg", gif).ok, false); // content must match the extension
});
