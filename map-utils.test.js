import { test } from "node:test";
import assert from "node:assert/strict";
import { createAddressLookup, geocodeCoordinates, kakaoAddressLink, noticeMapId, supplyAddress } from "./public/map-utils.js";

test("address links have a fixed HTTPS origin and encode the full public address", () => {
  const address = '서울 종로구 1 (일원) / #?&"';
  const link = kakaoAddressLink(` ${address} `);
  assert.equal(link, `https://map.kakao.com/link/search/${encodeURIComponent(address)}`);
  assert.equal(new URL(kakaoAddressLink("//evil.test/\\path")).origin, "https://map.kakao.com");
  assert.equal(supplyAddress("서울 종로구 1 일원"), "서울 종로구 1 일원");
  for (const missing of [undefined, null, 123, "  ", "..", ".", "a\nb", "\ud800"]) assert.equal(kakaoAddressLink(missing), null);
});

test("notice IDs use the notice category and both public numbers without delimiter collisions", () => {
  const base = { HOUSE_SECD: "01", HOUSE_MANAGE_NO: "1:2", PBLANC_NO: "3", HOUSE_NM: "A" };
  assert.equal(noticeMapId({ ...base, HOUSE_NM: "Renamed" }), noticeMapId(base));
  assert.notEqual(noticeMapId({ ...base, HOUSE_SECD: "04" }), noticeMapId(base));
  assert.notEqual(noticeMapId({ ...base, PBLANC_NO: "4" }), noticeMapId(base));
  assert.notEqual(noticeMapId({ ...base, HOUSE_MANAGE_NO: "1", PBLANC_NO: "2:3" }), noticeMapId(base));
  assert.notEqual(noticeMapId({ HOUSE_NM: "A" }), noticeMapId({ HOUSE_NM: "B" }));
});

test("coordinates require finite in-range numeric latitude and longitude", () => {
  assert.deepEqual(geocodeCoordinates({ x: "127.04", y: "37.55" }), { lat: 37.55, lng: 127.04 });
  for (const bad of [undefined, {}, { x: 127 }, { x: "", y: 37 }, { x: 127, y: null },
    { x: 181, y: 37 }, { x: 127, y: -91 }, { x: Infinity, y: 37 }, { x: "0x22", y: 37 }]) {
    assert.equal(geocodeCoordinates(bad), null);
  }
});

test("address lookup bounds concurrency across searches, avoids stale queued work, and shares a memory cache", async () => {
  const calls = [];
  const pending = new Map();
  const lookup = createAddressLookup(address => {
    calls.push(address);
    return new Promise(resolve => pending.set(address, resolve));
  }, 2);
  const point = { lat: 37, lng: 127 };
  let revision = 1;
  const old = () => revision === 1;
  const current = () => revision === 2;
  const a = lookup("A", old);
  const b = lookup("B", old);
  const stale = lookup("C", old);
  revision++;
  const duplicate = lookup("A", current);
  const fresh = lookup("D", current);
  assert.equal(await stale, null);
  assert.deepEqual(calls, ["A", "B"]);
  pending.get("A")(point);
  assert.equal(await a, point);
  assert.equal(await duplicate, point);
  assert.deepEqual(calls, ["A", "B", "D"]);
  pending.get("B")(null);
  pending.get("D")(undefined);
  assert.equal(await b, null);
  assert.equal(await fresh, null);
  assert.equal(await lookup("B", current), null);
  const retry = lookup("D", current);
  await Promise.resolve();
  pending.get("D")(point);
  assert.equal(await retry, point);
  assert.deepEqual(calls, ["A", "B", "D", "D"]);
});
