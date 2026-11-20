import test from "node:test";
import assert from "node:assert/strict";
import { fetchModels, enrichNotices } from "./models.js";

const notice = { HOUSE_MANAGE_NO: "123", PBLANC_NO: "456" };
test("model pages are fully collected with both notice identifiers", async () => {
  const calls = [];
  const result = await fetchModels(async params => {
    calls.push(params);
    return { matchCount: 2, data: [{ ...notice, MODEL_NO: params.page }] };
  }, notice);
  assert.equal(result.length, 2);
  assert.equal(calls[0]["cond[HOUSE_MANAGE_NO::EQ]"], "123");
  assert.equal(calls[0]["cond[PBLANC_NO::EQ]"], "456");
  assert.deepEqual(calls.map(x => x.page), ["1", "2"]);
});

test("rejects malformed, mismatched and incomplete models", async () => {
  for (const response of [{}, { matchCount: 1, data: [] },
    { matchCount: 1, data: [{ ...notice, PBLANC_NO: "wrong" }] }]) {
    await assert.rejects(fetchModels(async () => response, notice));
  }
});

test("isolates failures and empty data, preserves order, and limits concurrency", async () => {
  const notices = Array.from({ length: 6 }, (_, i) => ({ ...notice, PBLANC_NO: String(i) }));
  let active = 0, peak = 0;
  const results = await enrichNotices(notices, async params => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const id = params["cond[PBLANC_NO::EQ]"];
    if (id === "1") throw new Error("Unavailable");
    return { matchCount: id === "2" ? 0 : 1, data: id === "2" ? [] : [{ ...notice, PBLANC_NO: id }] };
  });
  assert.ok(peak <= 3);
  assert.deepEqual(results.map(x => x.PBLANC_NO), notices.map(x => x.PBLANC_NO));
  assert.deepEqual(results.map(x => x.modelStatus), ["available", "unavailable", "unavailable", "available", "available", "available"]);
  assert.equal(results[1].modelsFetchedAt, null);
  assert.ok(results[0].modelsFetchedAt);
  assert.equal(notices[0].models, undefined);
});
