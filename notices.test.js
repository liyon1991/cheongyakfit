import test from "node:test";
import assert from "node:assert/strict";
import { koreaDate, currentNotices, fetchCurrentNotices } from "./notices.js";

const today = "2026-11-20";
const row = { HOUSE_SECD: "01", HOUSE_MANAGE_NO: "1", PBLANC_NO: "1",
  RCRIT_PBLANC_DE: "2026-11-10", RCEPT_BGNDE: today, RCEPT_ENDDE: today };

test("uses Korean calendar day at the UTC date boundary", () => {
  assert.equal(koreaDate(new Date("2026-11-19T14:59:59Z")), "2026-11-19");
  assert.equal(koreaDate(new Date("2026-11-19T15:00:00Z")), today);
});

test("includes final day, removes duplicates, expired, unpublished and non-APT notices", () => {
  assert.deepEqual(currentNotices([row, row,
    { ...row, RCEPT_ENDDE: "2026-11-19" },
    { ...row, RCRIT_PBLANC_DE: "2026-11-21" },
    { ...row, RCEPT_BGNDE: null }, { ...row, HOUSE_SECD: "02" }], today), [row]);
});

test("collects all matching pages rather than total historical rows", async () => {
  const pages = [];
  const result = await fetchCurrentNotices(async params => {
    pages.push(params);
    return { data: [{ ...row, PBLANC_NO: params.page }], matchCount: 2, totalCount: 5000 };
  }, today);
  assert.equal(result.length, 2);
  assert.deepEqual(pages.map(p => p.page), ["1", "2"]);
  assert.equal(pages[0]["cond[RCEPT_ENDDE::GTE]"], today);
});

test("accepts empty results and rejects partial or malformed results", async () => {
  assert.deepEqual(await fetchCurrentNotices(async () => ({ data: [], matchCount: 0 }), today), []);
  await assert.rejects(fetchCurrentNotices(async () => ({ data: [], matchCount: 1 }), today));
  await assert.rejects(fetchCurrentNotices(async () => ({}), today));
});
