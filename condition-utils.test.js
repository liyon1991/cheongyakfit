import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, noticeCategory, SUPPLIES, modelFacts, supplyCount, searchNotices, profileInterests, profileChecklist } from "./public/condition-utils.js";

const today = "2026-11-20";
const model = (patch = {}) => ({ HOUSE_TY: "084.9900A", LTTOT_TOP_AMOUNT: "60000", SUPLY_AR: "113.2000",
  SUPLY_HSHLDCO: 1, NWWDS_HSHLDCO: "1", LFE_FRST_HSHLDCO: "1", ...patch });
const notice = (name, patch = {}) => ({ HOUSE_NM: name, SUBSCRPT_AREA_CODE_NM: "서울특별시", HOUSE_SECD: "01", HOUSE_DTL_SECD: "01",
  RCEPT_BGNDE: "2026-11-19", RCEPT_ENDDE: "2026-11-21", SPSPLY_RCEPT_BGNDE: today, SPSPLY_RCEPT_ENDDE: today,
  GNRL_RNK1_CRSPAREA_RCPTDE: "2026-11-19", GNRL_RNK1_CRSPAREA_ENDDE: "2026-11-21",
  modelStatus: "available", models: [model()], ...patch });
const run = (data, criteria = {}) => searchNotices(data, { region: "서울", ...criteria }, today);
const names = group => group.map(({ notice }) => notice.HOUSE_NM);
const remainingModel = (patch = {}) => ({ HOUSE_TY: "084.9900A", LTTOT_TOP_AMOUNT: "60000", SUPLY_AR: "113.2000",
  SUPLY_HSHLDCO: 1, SPSPLY_HSHLDCO: 3, ...patch });
const remaining = (name, category, patch = {}) => notice(name, {
  HOUSE_SECD: category, HOUSE_DTL_SECD: undefined, SPSPLY_RCEPT_BGNDE: undefined, SPSPLY_RCEPT_ENDDE: undefined,
  SUBSCRPT_RCEPT_BGNDE: "2026-11-19", SUBSCRPT_RCEPT_ENDDE: "2026-11-21",
  GNRL_RNK1_CRSPAREA_RCPTDE: undefined, GNRL_RNK1_CRSPAREA_ENDDE: undefined,
  models: [remainingModel()], ...patch,
});

test("notice category is independent of supply and combines with region and same-model price/area", () => {
  assert.deepEqual(CATEGORIES, { all: "전체 공고", "01": "일반 아파트", "04": "무순위", "06": "불법행위 재공급" });
  const data = [notice("APT"), remaining("unranked", "04"), remaining("resupply", "06"),
    remaining("other region", "04", { SUBSCRPT_AREA_CODE_NM: "경기도" }),
    remaining("split models", "04", { models: [remainingModel({ LTTOT_TOP_AMOUNT: "55000", SUPLY_AR: "125" }),
      remainingModel({ LTTOT_TOP_AMOUNT: "65000", SUPLY_AR: "110" })] }),
    remaining("unknown category", "99"), remaining("missing category", undefined), remaining("not exact", " 04 ")];
  const criteria = { regionMode: "only", maxPrice: 60000, maxArea: 114, period: "active" };
  const all = run(data, criteria);
  assert.deepEqual(names(all.matched), ["APT", "unranked", "resupply"]);
  assert.deepEqual(names(all.unknown), ["unknown category", "missing category", "not exact"]);
  assert.deepEqual(all.unknown[0].reasons, ["공고 종류 정보 없음 또는 미확인"]);
  assert.equal(noticeCategory(all.unknown[0].notice), null);
  for (const [noticeType, name] of [["01", "APT"], ["04", "unranked"], ["06", "resupply"]]) {
    const result = run(data, { ...criteria, noticeType });
    assert.deepEqual(names(result.matched), [name]);
    assert.equal(result.matched[0].models.length, 1);
    assert.deepEqual(result.unknown, []);
  }
  const houseFiltered = run(data, { ...criteria, noticeType: "04", houseType: "01" });
  assert.deepEqual(houseFiltered.matched, []);
  assert.deepEqual(names(houseFiltered.unknown), ["unranked"]);
  assert.deepEqual(houseFiltered.unknown[0].reasons, ["주택 구분 정보 없음 또는 미확인"]);
});

test("remaining general uses only its dedicated dates, independently of normalized overall dates", () => {
  for (const noticeType of ["04", "06"]) {
    const data = [remaining("dedicated", noticeType, { GNRL_RCEPT_BGNDE: today, GNRL_RCEPT_ENDDE: today,
      models: [remainingModel({ SUPLY_HSHLDCO: 1, LTTOT_TOP_AMOUNT: "61000" }),
        remainingModel({ SUPLY_HSHLDCO: 0, LTTOT_TOP_AMOUNT: "59000" }),
        remainingModel({ HOUSE_TY: "qualifying", LTTOT_TOP_AMOUNT: "60000" })] }),
    remaining("no dedicated dates", noticeType, { SUBSCRPT_RCEPT_BGNDE: undefined, SUBSCRPT_RCEPT_ENDDE: undefined,
      GNRL_RNK1_CRSPAREA_RCPTDE: today, GNRL_RNK1_CRSPAREA_ENDDE: today }),
    remaining("past dedicated", noticeType, { GNRL_RCEPT_BGNDE: "2026-11-18", GNRL_RCEPT_ENDDE: "2026-11-19" }),
    remaining("future dedicated", noticeType, { GNRL_RCEPT_BGNDE: "2026-11-21", GNRL_RCEPT_ENDDE: "2026-11-21" })];
    const result = run(data, { noticeType, supplies: "general", period: "active", maxPrice: 60000 });
    assert.deepEqual(names(result.matched), ["dedicated"]);
    assert.deepEqual(result.matched[0].models.map(({ model }) => model.HOUSE_TY), ["qualifying"]);
    assert.deepEqual(names(result.unknown), ["no dedicated dates"]);
    assert.deepEqual(result.unknown[0].reasons, ["일반공급 접수일 정보 없음 또는 미확인"]);
    assert.deepEqual(names(run(data, { noticeType, supplies: "general", period: "upcoming" }).matched), ["future dedicated"]);
    const all = run(data, { noticeType, supplies: "all", period: "active" });
    assert.deepEqual(names(all.matched), data.map(notice => notice.HOUSE_NM));
    assert.deepEqual(all.matched[1].schedules[0], { supply: "all", scope: "전체", start: "2026-11-19", end: "2026-11-21", status: "active" });
  }
});

test("remaining special totals do not establish subtype allocations and known expired dates exclude", () => {
  for (const noticeType of ["04", "06"]) {
    const dates = { SPSPLY_RCEPT_BGNDE: today, SPSPLY_RCEPT_ENDDE: today };
    const data = [remaining("total only", noticeType, dates),
      remaining("zero total still no subtype count", noticeType, { ...dates, models: [remainingModel({ SPSPLY_HSHLDCO: 0 })] }),
      remaining("no special dates", noticeType),
      remaining("past special", noticeType, { ...dates, SPSPLY_RCEPT_BGNDE: "2026-11-19", SPSPLY_RCEPT_ENDDE: "2026-11-19" }),
      remaining("over price", noticeType, { ...dates, models: [remainingModel({ LTTOT_TOP_AMOUNT: 60001 })] })];
    for (const supply of ["newlywed", "first", "multiple", "parents", "institution"]) {
      const result = run(data, { noticeType, supplies: supply, maxPrice: 60000 });
      assert.deepEqual(result.matched, []);
      assert.deepEqual(names(result.unknown), ["total only", "zero total still no subtype count", "no special dates"]);
      assert.deepEqual(result.unknown[0].reasons, [`${SUPPLIES[supply].label} 배정 세대수 미확인`]);
      assert.match(result.unknown[2].reasons[0], /특별공급 접수일/);
    }
  }
});

test("AND predicates require the same housing model; only matching literal housing types are returned", () => {
  const split = notice("split", { models: [model({ LTTOT_TOP_AMOUNT: "80000" }),
    model({ LTTOT_TOP_AMOUNT: "45000", NWWDS_HSHLDCO: "0" }),
    model({ LTTOT_TOP_AMOUNT: "50000", SUPLY_AR: "115" })] });
  const valid = notice("valid", { models: [...split.models, model({ HOUSE_TY: "084.9900A", SUPLY_AR: "108.1000" })] });
  const result = run([split, valid], { supplies: "newlywed", maxPrice: "60000", maxArea: "112" });
  assert.deepEqual(names(result.matched), ["valid"]);
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.matched[0].models.map(({ model }) => model.HOUSE_TY), ["084.9900A"]);
  assert.equal(modelFacts(result.matched[0].models[0].model).area, 108.1);
  assert.deepEqual(result.counts, { total: 2, matched: 1, local: 1, unknown: 0 });
});

test("price in 만원 and supply area in m² use inclusive limits; blank is unlimited, zero is not", () => {
  const data = [notice("price", { models: [model({ LTTOT_TOP_AMOUNT: "60,000" })] })];
  assert.equal(run(data, { maxPrice: 60000, maxArea: 113.2 }).counts.matched, 1);
  assert.equal(run(data, { maxPrice: 59999 }).counts.matched, 0);
  assert.equal(run(data, { maxArea: 113.19 }).counts.matched, 0);
  assert.equal(run(data, { maxPrice: "", maxArea: " " }).counts.matched, 1);
  assert.equal(run(data, { maxPrice: 0 }).counts.matched, 0);
  assert.deepEqual(modelFacts(model({ LTTOT_TOP_AMOUNT: null, SUPLY_AR: " " })), { price: null, area: null });
  assert.deepEqual(modelFacts(model({ LTTOT_TOP_AMOUNT: "60,00", SUPLY_AR: "NaN" })), { price: null, area: null });
});

test("zero model price and area are unknown, not zero-priced or zero-sized matches", () => {
  const zeroFacts = model({ LTTOT_TOP_AMOUNT: "0", SUPLY_AR: 0 });
  const data = [notice("zero facts", { models: [zeroFacts] })];
  assert.deepEqual(modelFacts(zeroFacts), { price: null, area: null });
  const result = run(data, { supplies: "general", maxPrice: 0, maxArea: 0 });
  assert.deepEqual(result.matched, []);
  assert.deepEqual(names(result.unknown), ["zero facts"]);
  assert.deepEqual(result.unknown[0].reasons, ["주택형 최고 분양가 미확인", "공급면적 미확인"]);
  assert.deepEqual(names(run(data, { supplies: "general" }).matched), ["zero facts"]);
});

test("known zero count is excluded, missing model/count/price/area remain unknown only when relevant", () => {
  const data = [notice("zero", { models: [model({ NWWDS_HSHLDCO: "0" })] }),
    notice("missing fields", { models: [model({ NWWDS_HSHLDCO: null, LTTOT_TOP_AMOUNT: "", SUPLY_AR: undefined })] }),
    notice("unavailable", { modelStatus: "unavailable", models: [model()] }), notice("empty", { models: [] }),
    notice("mismatched and unknown", { models: [model({ NWWDS_HSHLDCO: "", LTTOT_TOP_AMOUNT: "70000" })] }),
    notice("no contract", { modelStatus: undefined })];
  const result = run(data, { supplies: "newlywed", maxPrice: 60000, maxArea: 120 });
  assert.deepEqual(names(result.matched), []);
  assert.deepEqual(names(result.unknown), ["missing fields", "unavailable", "empty", "no contract"]);
  assert.deepEqual(result.unknown[0].reasons, ["신혼부부 특별공급 배정 세대수 미확인", "주택형 최고 분양가 미확인", "공급면적 미확인"]);
  assert.match(result.unknown[1].reasons[0], /주택형 자료/);
  assert.equal(run(data).counts.matched, data.length);
  assert.equal(run(data, { maxPrice: 60000 }).counts.unknown, 4);
  assert.equal(supplyCount(model({ NWWDS_HSHLDCO: "-1" }), "newlywed"), null);
  assert.equal(supplyCount(model({ NWWDS_HSHLDCO: "0" }), "newlywed"), 0);
});

test("each documented supply option uses its own allocation field", () => {
  const fields = { general: "SUPLY_HSHLDCO", newlywed: "NWWDS_HSHLDCO", first: "LFE_FRST_HSHLDCO",
    multiple: "MNYCH_HSHLDCO", parents: "OLD_PARNTS_SUPORT_HSHLDCO", institution: "INSTT_RECOMEND_HSHLDCO" };
  for (const [supply, field] of Object.entries(fields)) {
    assert.equal(SUPPLIES[supply].field, field);
    const models = [{ [field]: "2" }];
    assert.equal(run([notice("with allocation", { models })], { supplies: supply }).counts.matched, 1);
  }
});

test("special dates override the overall dates; past special cannot qualify through general reception", () => {
  const data = [notice("past special", { SPSPLY_RCEPT_BGNDE: "2026-11-17", SPSPLY_RCEPT_ENDDE: "2026-11-19" }),
    notice("active special"), notice("upcoming special", { SPSPLY_RCEPT_BGNDE: "2026-11-21", SPSPLY_RCEPT_ENDDE: "2026-11-21" }),
    notice("missing special dates", { SPSPLY_RCEPT_BGNDE: null, SPSPLY_RCEPT_ENDDE: null }),
    notice("past even without start", { SPSPLY_RCEPT_BGNDE: null, SPSPLY_RCEPT_ENDDE: "2026-11-19", modelStatus: "unavailable" }),
    notice("inverted dates", { SPSPLY_RCEPT_BGNDE: "2026-11-22", SPSPLY_RCEPT_ENDDE: "2026-11-21" })];
  const all = run(data, { supplies: "first" });
  assert.deepEqual(names(all.matched), ["active special", "upcoming special"]);
  assert.deepEqual(names(all.unknown), ["missing special dates", "inverted dates"]);
  assert.match(all.unknown[0].reasons[0], /특별공급 접수일/);
  assert.deepEqual(names(run(data, { supplies: "first", period: "active" }).matched), ["active special"]);
  assert.deepEqual(names(run(data, { supplies: "first", period: "upcoming" }).matched), ["upcoming special"]);
  const general = run(data, { supplies: "general", period: "active" });
  assert.deepEqual(names(general.matched), ["past special", "active special", "upcoming special", "missing special dates", "inverted dates"]);
  assert.deepEqual(names(general.unknown), ["past even without start"]);
  assert.equal(general.matched[0].schedules[0].scope, "일반공급");
});

test("active special and overall dates do not make future or missing general dates active", () => {
  const future = notice("future general", {
    GNRL_RNK1_CRSPAREA_RCPTDE: "2026-11-21", GNRL_RNK1_CRSPAREA_ENDDE: "2026-11-21",
  });
  const missing = notice("missing general", { GNRL_RNK1_CRSPAREA_RCPTDE: null, GNRL_RNK1_CRSPAREA_ENDDE: " " });
  const data = [future, missing];
  assert.deepEqual(names(run(data, { supplies: "first", period: "active" }).matched), ["future general", "missing general"]);
  assert.equal(run(data, { supplies: "all", period: "active" }).counts.matched, 2);
  const active = run(data, { supplies: "general", period: "active" });
  assert.deepEqual(active.matched, []);
  assert.deepEqual(names(active.unknown), ["missing general"]);
  assert.deepEqual(active.unknown[0].schedules[0], {
    supply: "general", scope: "일반공급", start: null, end: null, status: "unknown",
  });
  assert.deepEqual(names(run(data, { supplies: "general", period: "upcoming" }).matched), ["future general"]);
});

test("every rank and area interval can match without assuming the user's rank or area", () => {
  for (const rank of ["RNK1", "RNK2"]) {
    for (const area of ["CRSPAREA", "ETC_AREA", "ETC_GG"]) {
      const data = [notice(`${rank} ${area}`, {
        SUBSCRPT_AREA_CODE_NM: "경기도",
        GNRL_RNK1_CRSPAREA_RCPTDE: null, GNRL_RNK1_CRSPAREA_ENDDE: null,
        [`GNRL_${rank}_${area}_RCPTDE`]: today, [`GNRL_${rank}_${area}_ENDDE`]: today,
      })];
      const result = run(data, { supplies: "general", period: "active", region: "서울" });
      assert.deepEqual(names(result.matched), [`${rank} ${area}`]);
    }
  }
});

test("general dates do not bridge gaps and a past interval does not hide an unresolved one", () => {
  const past = { GNRL_RNK1_CRSPAREA_RCPTDE: "2026-11-17", GNRL_RNK1_CRSPAREA_ENDDE: "2026-11-19" };
  const future = { GNRL_RNK2_ETC_AREA_RCPTDE: "2026-11-24", GNRL_RNK2_ETC_AREA_ENDDE: "2026-11-25" };
  const partial = { GNRL_RNK1_ETC_GG_RCPTDE: "2026-11-19", GNRL_RNK1_ETC_GG_ENDDE: null };
  const data = [notice("past only", past), notice("gap", { ...past, ...future }),
    notice("past with partial", { ...past, ...partial }),
    notice("future with partial", { ...past, ...future, ...partial }),
    notice("active with partial", { ...future, ...partial }),
    notice("past with ended partial", { ...past, GNRL_RNK2_ETC_GG_ENDDE: "2026-11-19" })];
  const active = run(data, { supplies: "general", period: "active" });
  assert.deepEqual(names(active.matched), ["active with partial"]);
  assert.deepEqual(names(active.unknown), ["past with partial", "future with partial"]);
  assert.match(active.unknown[0].reasons[0], /일반공급 접수일/);
  const any = run(data, { supplies: "general" });
  assert.deepEqual(names(any.matched), ["active with partial", "gap", "future with partial"]);
  assert.deepEqual(names(any.unknown), ["past with partial"]);
  assert.deepEqual(any.matched[1].schedules[0], {
    supply: "general", scope: "일반공급", start: "2026-11-24", end: "2026-11-25", status: "upcoming",
  });
});

test("known region/type/date mismatches exclude unknowns; missing relevant basic information remains unknown", () => {
  const data = [notice("not local", { SUBSCRPT_AREA_CODE_NM: "경기도", modelStatus: "unavailable" }),
    notice("not type", { HOUSE_DTL_SECD: "03", modelStatus: "unavailable" }),
    notice("past", { GNRL_RNK1_CRSPAREA_ENDDE: "2026-11-19", modelStatus: "unavailable" }),
    notice("upcoming", { GNRL_RNK1_CRSPAREA_RCPTDE: "2026-11-21", GNRL_RNK1_CRSPAREA_ENDDE: null, modelStatus: "unavailable" }),
    notice("no type", { HOUSE_DTL_SECD: null }), notice("no region", { SUBSCRPT_AREA_CODE_NM: null }),
    notice("no date", { GNRL_RNK1_CRSPAREA_ENDDE: null }), notice("local and type")];
  const result = run(data, { regionMode: "only", houseType: "01", supplies: "general", period: "active" });
  assert.deepEqual(names(result.matched), ["local and type"]);
  assert.deepEqual(names(result.unknown), ["no type", "no date", "no region"]);
  assert.match(result.unknown[0].reasons[0], /주택 구분/);
  assert.match(result.unknown[1].reasons[0], /일반공급 접수일/);
  assert.match(result.unknown[2].reasons[0], /공급 지역/);
  assert.deepEqual(names(run(data, { regionMode: "only", houseType: "03" }).matched), ["not type"]);
});

test("ranking remains region first, then active before upcoming and by relevant date with stable ties", () => {
  const data = [notice("other active", { SUBSCRPT_AREA_CODE_NM: "경기도" }),
    notice("local later upcoming", { RCEPT_BGNDE: "2026-11-24", RCEPT_ENDDE: "2026-11-29" }),
    notice("local active ends later", { RCEPT_ENDDE: "2026-11-22" }),
    notice("local earlier upcoming", { RCEPT_BGNDE: "2026-11-22", RCEPT_ENDDE: "2026-11-29" }),
    notice("local active ends sooner"), notice("local same")];
  const result = run(data);
  assert.deepEqual(names(result.matched), ["local active ends sooner", "local same", "local active ends later",
    "local earlier upcoming", "local later upcoming", "other active"]);
  assert.deepEqual(result.counts, { total: 6, matched: 6, local: 5, unknown: 0 });
  assert.deepEqual(run(data, { region: "제주", regionMode: "only" }).counts, { total: 6, matched: 0, local: 0, unknown: 0 });
});

test("interest recommendations are OR alternatives and never constrain manual search for exceptions", () => {
  const profile = { marital: "married", firsthome: true, children: "2", homeless: "no", age: "17" };
  assert.deepEqual(profileInterests(profile), ["newlywed", "first", "multiple"]);
  assert.deepEqual(profileInterests({ marital: "single", children: "1", firsthome: false }), []);
  assert.deepEqual(profileInterests({ marital: "unknown", firsthome: "true", children: null }), []);
  assert.deepEqual(profileInterests({ marital: "divorced", children: 2 }), ["multiple"]);
  const data = [notice("only first", { models: [model({ NWWDS_HSHLDCO: 0, MNYCH_HSHLDCO: 0 })] }),
    notice("unknown first", { models: [model({ NWWDS_HSHLDCO: 0, LFE_FRST_HSHLDCO: null, MNYCH_HSHLDCO: 0 })] }),
    notice("manual newlywed", { models: [model({ LFE_FRST_HSHLDCO: 0, MNYCH_HSHLDCO: 0 })] }),
    notice("none", { models: [model({ LFE_FRST_HSHLDCO: 0, NWWDS_HSHLDCO: 0, MNYCH_HSHLDCO: 0 })] })];
  const result = run(data, { supplies: profileInterests(profile) });
  assert.deepEqual(names(result.matched), ["only first", "manual newlywed"]);
  assert.deepEqual(result.matched[0].models[0].supplies, ["first"]);
  assert.deepEqual(names(result.unknown), ["unknown first"]);
  assert.deepEqual(names(run(data, { supplies: "newlywed" }).matched), ["manual newlywed"]);
  assert.deepEqual(names(run(data, { supplies: profileInterests({ marital: "single" }) }).matched), names(run(data).matched));
});

test("the checklist personalizes all supplied answers, acknowledges unknowns, and points to exception checks", () => {
  const profile = { age: "36", residence: "서울특별시", years: "3년 이상", marital: "single", children: 0,
    homeless: "no", income: "900만원 이상", assets: "2~4억원", account: "5년 이상", payments: "24회 이상", firsthome: true };
  const list = profileChecklist(profile);
  assert.deepEqual(list.map(row => row.answer), ["36세", "서울 · 3년 이상", "미혼", "0명", "주택 보유 세대원 있음",
    "900만원 이상", "2~4억원", "5년 이상", "24회 이상", "관심 표시"]);
  assert.match(list[2].guidance, /예비신혼·한부모/);
  assert.ok(list.every(row => row.guidance.includes("확인")));
  assert.equal(profileChecklist({ homeless: "unknown", income: " " })[4].answer, "미입력/모름");
  assert.equal(profileChecklist({ homeless: "unknown", income: " " })[5].answer, "미입력/모름");
  assert.equal(profileChecklist({})[9].answer, "미입력/모름");
});
