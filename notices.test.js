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

test("remaining notices normalize dates and retain both official categories without mutating raw rows", () => {
  const unsold = { ...row, HOUSE_SECD: "04", SUBSCRPT_RCEPT_BGNDE: today, SUBSCRPT_RCEPT_ENDDE: today };
  const resupply = { ...unsold, HOUSE_SECD: "06" };
  const result = currentNotices([unsold, resupply, unsold,
    { ...unsold, SUBSCRPT_RCEPT_ENDDE: "2026-11-19" },
    { ...unsold, SUBSCRPT_RCEPT_BGNDE: null }, row], today, "remaining");
  assert.deepEqual(result.map(x => x.HOUSE_SECD), ["04", "06"]);
  assert.equal(result[0].RCEPT_ENDDE, today);
  assert.notEqual(result[0], unsold);
});

test("remaining source scans past expired pages without undocumented date filters", async () => {
  const calls = [];
  const result = await fetchCurrentNotices(async params => {
    calls.push(params);
    return { matchCount: 2, data: [{ ...row, HOUSE_SECD: "06", PBLANC_NO: params.page,
      SUBSCRPT_RCEPT_BGNDE: "2026-11-18", SUBSCRPT_RCEPT_ENDDE: params.page === "1" ? "2026-11-19" : today }] };
  }, today, "remaining");
  assert.equal(result.length, 1);
  assert.equal(result[0].PBLANC_NO, "2");
  assert.deepEqual(calls, [{ page: "1", perPage: "100" }, { page: "2", perPage: "100" }]);
});
