import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, isDateOnly, normalizeRegion, rankNotices, safeNoticeLink } from "./public/notice-utils.js";

const asOf = "2026-11-20";
const notice = (name, region, start, end) => Object.freeze({
  HOUSE_NM: name, SUBSCRPT_AREA_CODE_NM: region, RCEPT_BGNDE: start, RCEPT_ENDDE: end,
});

test("normalizes all 17 province and metro names, including old aliases", () => {
  const full = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"];
  const short = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
  assert.deepEqual(full.map(normalizeRegion), short);
  assert.deepEqual(short.map(normalizeRegion), short);
  assert.equal(normalizeRegion(" 강원도 "), "강원");
  assert.equal(normalizeRegion("전라북도"), "전북");
  assert.equal(normalizeRegion("제주도"), "제주");
  assert.equal(normalizeRegion("서울특별시 무관"), null);
});

test("ranks local first, then by status and the applicable date, without mutating notices", () => {
  const rows = Object.freeze([
    notice("other upcoming", "경기", "2026-11-21", "2026-11-22"),
    notice("local upcoming later", "서울시", "2026-11-24", "2026-11-25"),
    notice("local started today", "서울특별시", asOf, "2026-11-22"),
    notice("other active", "경기도", "2026-11-17", asOf),
    notice("local upcoming sooner", "서울", "2026-11-23", "2026-11-28"),
    notice("local ends today", "서울", "2026-11-17", asOf),
    notice("local date tie", "서울", "2026-11-18", asOf),
  ]);
  const ranked = rankNotices(rows, "서울특별시", asOf);
  assert.deepEqual(ranked.map(row => row.notice), [rows[5], rows[6], rows[2], rows[4], rows[1], rows[3], rows[0]]);
  assert.deepEqual(ranked.map(row => row.status), ["active", "active", "active", "upcoming", "upcoming", "active", "upcoming"]);
  assert.equal(ranked.filter(row => row.isLocal).length, 5);
  assert.notEqual(ranked, rows);
  assert.equal(rows[0].HOUSE_NM, "other upcoming");
  assert.equal(Object.hasOwn(rows[0], "status"), false);
});

test("excludes expired, missing, impossible and inverted dates and does not match unknown regions", () => {
  assert.equal(isDateOnly("2024-02-29"), true);
  assert.equal(isDateOnly("2026-02-29"), false);
  assert.equal(isDateOnly("2026-1-01"), false);
  const eligible = notice("unknown region", null, asOf, asOf);
  const rows = [null, {}, eligible,
    notice("expired", "서울", "2026-11-18", "2026-11-19"),
    notice("impossible", "서울", "2026-11-31", "2026-12-01"),
    notice("inverted", "서울", "2026-12-02", "2026-11-21"),
  ];
  assert.deepEqual(rankNotices(rows, "unknown", asOf), [{ notice: eligible, isLocal: false, status: "active", start: asOf, end: asOf }]);
  assert.deepEqual(rankNotices(rows, "서울", "2026-11-99"), []);
});

test("allows only official HTTPS notice links and rejects URL injection tricks", () => {
  assert.equal(safeNoticeLink(" https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetailView.do?houseManageNo=123&px=456 "),
    "https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetailView.do?houseManageNo=123&px=456");
  assert.equal(safeNoticeLink("HTTPS://applyhome.co.kr/"), "https://applyhome.co.kr/");
  for (const candidate of [null, 123, "", "javascript:alert(1)", "data:text/html,hello", "/notices", "//applyhome.co.kr/",
    "http://www.applyhome.co.kr/", "https://applyhome.co.kr.evil.test/", "https://evil.test/applyhome.co.kr",
    "https://applyhome.co.kr@evil.test/", "https://evil.test@applyhome.co.kr/", "https://applyhome.co.kr\\@evil.test/",
    "https://applyhome.co.kr:444/", "https://applyhome.co.kr\n/", "https://applyhome.co.kr.", "https://other.applyhome.co.kr/",
    'https://applyhome.co.kr" onclick="alert(1)', "https://%61pplyhome.co.kr/"]) {
    assert.equal(safeNoticeLink(candidate), null, String(candidate));
  }
});

test("escapes notice text and attribute injection, including ampersands", () => {
  assert.equal(escapeHtml(`"><img src=x onerror='alert(1)'>&lt;`),
    "&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;lt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(0), "0");
});
