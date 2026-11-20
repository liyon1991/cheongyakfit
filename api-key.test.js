import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServiceKey } from "./api-key.js";

test("accepts raw and encoded keys without replacing plus signs", () => {
  assert.equal(normalizeServiceKey(" example+key/value== "), "example+key/value==");
  assert.equal(normalizeServiceKey("example%2Bkey%2Fvalue%3D%3D"), "example+key/value==");
  assert.equal(normalizeServiceKey(), "");
  assert.equal(normalizeServiceKey("invalid%escape"), "invalid%escape");
});
