import { isDateOnly, normalizeRegion } from "./notice-utils.js";

export const CATEGORIES = Object.freeze({
  all: "전체 공고",
  "01": "일반 아파트",
  "04": "무순위",
  "06": "불법행위 재공급",
});

export function noticeCategory(notice) {
  const code = notice?.HOUSE_SECD;
  return typeof code === "string" && code !== "all" && Object.hasOwn(CATEGORIES, code) ? code : null;
}

export const SUPPLIES = Object.freeze({
  all: { label: "전체 공급" },
  general: { label: "일반공급", field: "SUPLY_HSHLDCO" },
  newlywed: { label: "신혼부부 특별공급", field: "NWWDS_HSHLDCO" },
  first: { label: "생애최초 특별공급", field: "LFE_FRST_HSHLDCO" },
  multiple: { label: "다자녀 특별공급", field: "MNYCH_HSHLDCO" },
  parents: { label: "노부모부양 특별공급", field: "OLD_PARNTS_SUPORT_HSHLDCO" },
  institution: { label: "기관추천 특별공급", field: "INSTT_RECOMEND_HSHLDCO" },
});

const generalDatePrefixes = [
  "GNRL_RNK1_CRSPAREA", "GNRL_RNK1_ETC_AREA", "GNRL_RNK1_ETC_GG",
  "GNRL_RNK2_CRSPAREA", "GNRL_RNK2_ETC_AREA", "GNRL_RNK2_ETC_GG",
];

function nonNegativeNumber(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
    value = Number(text.replaceAll(",", ""));
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER ? value : null;
}

// The model API already reports the maximum price in 만원 and area in m².
export function modelFacts(model) {
  return { price: nonNegativeNumber(model?.LTTOT_TOP_AMOUNT) || null, area: nonNegativeNumber(model?.SUPLY_AR) || null };
}

export function supplyCount(model, supply) {
  const count = nonNegativeNumber(model?.[SUPPLIES[supply]?.field]);
  return Number.isSafeInteger(count) ? count : null;
}

function assessInterval(supply, scope, [startRaw, endRaw], period, asOf) {
  const start = isDateOnly(startRaw) ? startRaw : null;
  const end = isDateOnly(endRaw) ? endRaw : null;
  if (start && end && start > end) {
    return { supply, scope, start: null, end: null, status: "unknown" };
  }
  if ((end && end < asOf) || (period === "active" && start && start > asOf)
      || (period === "upcoming" && start && start <= asOf)) return null;
  return { supply, scope, start, end, status: start && end ? (start <= asOf ? "active" : "upcoming") : "unknown" };
}

const statusOrder = { active: 0, upcoming: 1, unknown: 2 };
function compareSchedules(a, b) {
  return statusOrder[a.status] - statusOrder[b.status]
    || (a.status === "active" ? a.end.localeCompare(b.end)
      : a.status === "upcoming" ? a.start.localeCompare(b.start) : 0);
}

function scheduleFor(notice, category, supply, period, asOf) {
  const scope = supply === "general" ? "일반공급" : supply === "all" ? "전체" : "특별공급";
  let intervals;
  if (supply === "general") {
    if (category === "04" || category === "06") {
      // Overall reception is not evidence of a general supply schedule.
      intervals = [[notice.GNRL_RCEPT_BGNDE, notice.GNRL_RCEPT_ENDDE]];
    } else if (category === "01") {
      // A blank pair can be unused; keep any reported partial or malformed pair for assessment.
      const reported = value => value != null && (typeof value !== "string" || value.trim() !== "");
      intervals = generalDatePrefixes.map(prefix => [notice[`${prefix}_RCPTDE`], notice[`${prefix}_ENDDE`]])
        .filter(pair => pair.some(reported));
      if (!intervals.length) intervals = [[null, null]];
    } else {
      intervals = [[null, null]];
    }
  } else {
    intervals = supply === "all" ? [[notice.RCEPT_BGNDE, notice.RCEPT_ENDDE]]
      : [[notice.SPSPLY_RCEPT_BGNDE, notice.SPSPLY_RCEPT_ENDDE]];
  }
  return intervals.map(pair => assessInterval(supply, scope, pair, period, asOf))
    .filter(Boolean).sort(compareSchedules)[0] ?? null;
}

function orderedRows(rows) {
  for (const row of rows) row.schedules.sort(compareSchedules);
  return rows.sort((a, b) => Number(b.isLocal) - Number(a.isLocal)
    || compareSchedules(a.schedules[0], b.schedules[0]));
}

// A candidate is confirmed only when one model and one requested supply path
// satisfy every condition. An unknown only survives if no known condition fails on that path.
export function searchNotices(notices, criteria, asOf) {
  const matched = [], unknown = [];
  const counts = { total: notices.length, matched: 0, local: 0, unknown: 0 };
  if (!isDateOnly(asOf)) return { matched, unknown, counts };
  const region = normalizeRegion(criteria.region);
  const noticeType = criteria.noticeType ?? "all";
  const period = criteria.period ?? "all";
  const maxPrice = nonNegativeNumber(criteria.maxPrice);
  const maxArea = nonNegativeNumber(criteria.maxArea);
  const selected = Array.isArray(criteria.supplies) ? criteria.supplies : [criteria.supplies ?? "all"];
  const valid = [...new Set(selected.filter(value => Object.hasOwn(SUPPLIES, value)))];
  const supplies = !valid.length || valid.includes("all") ? ["all"] : valid;

  for (const notice of notices) {
    if (!notice || typeof notice !== "object") continue;
    const category = noticeCategory(notice);
    if (noticeType !== "all" && category !== noticeType) continue;
    const noticeRegion = normalizeRegion(notice.SUBSCRPT_AREA_CODE_NM);
    const isLocal = Boolean(region && noticeRegion === region);
    const basicIssues = [];
    if (!category) basicIssues.push("공고 종류 정보 없음 또는 미확인");
    if (criteria.regionMode === "only" && !isLocal) {
      if (region && noticeRegion) continue;
      basicIssues.push("공급 지역 정보 없음 또는 미확인");
    }
    if (criteria.houseType && criteria.houseType !== "all") {
      const type = typeof notice.HOUSE_DTL_SECD === "string" ? notice.HOUSE_DTL_SECD.trim() : "";
      if (/^\d{2}$/.test(type) && type !== criteria.houseType) continue;
      if (type !== criteria.houseType) basicIssues.push("주택 구분 정보 없음 또는 미확인");
    }

    const confirmedSchedules = new Set(), unresolvedSchedules = new Set();
    const confirmedModels = new Map(), unresolvedModels = new Map();
    const issues = new Set();
    const models = notice.modelStatus === "available" && Array.isArray(notice.models) ? notice.models : [];
    for (const supply of supplies) {
      const schedule = scheduleFor(notice, category, supply, period, asOf);
      if (!schedule) continue;
      const scheduleIssues = schedule.status === "unknown"
        ? [...basicIssues, `${schedule.scope} 접수일 정보 없음 또는 미확인`] : basicIssues;
      const modelRequired = supply !== "all" || maxPrice !== null || maxArea !== null;
      const addCandidate = (pathIssues, modelIndex = null) => {
        const [schedules, modelMap] = pathIssues.length
          ? [unresolvedSchedules, unresolvedModels] : [confirmedSchedules, confirmedModels];
        schedules.add(schedule);
        for (const issue of pathIssues) issues.add(issue);
        if (modelIndex !== null) {
          if (!modelMap.has(modelIndex)) modelMap.set(modelIndex, { model: models[modelIndex], supplies: [] });
          modelMap.get(modelIndex).supplies.push(supply);
        }
      };
      if (!modelRequired) {
        addCandidate(scheduleIssues);
        continue;
      }
      if (!models.length) {
        addCandidate([...scheduleIssues, "주택형 자료 미제공 또는 조회 불가"]);
        continue;
      }
      for (const [index, model] of models.entries()) {
        const count = supply === "all" ? null : supplyCount(model, supply);
        const { price, area } = modelFacts(model);
        if (count === 0 || (maxPrice !== null && price !== null && price > maxPrice)
            || (maxArea !== null && area !== null && area > maxArea)) continue;
        const pathIssues = [...scheduleIssues];
        if (supply !== "all" && count === null) pathIssues.push(`${SUPPLIES[supply].label} 배정 세대수 미확인`);
        if (maxPrice !== null && price === null) pathIssues.push("주택형 최고 분양가 미확인");
        if (maxArea !== null && area === null) pathIssues.push("공급면적 미확인");
        addCandidate(pathIssues, index);
      }
    }

    if (confirmedSchedules.size) {
      matched.push({ notice, isLocal, schedules: [...confirmedSchedules], models: [...confirmedModels.values()], reasons: [] });
    } else if (unresolvedSchedules.size) {
      unknown.push({ notice, isLocal, schedules: [...unresolvedSchedules], models: [...unresolvedModels.values()], reasons: [...issues] });
    }
  }

  counts.matched = matched.length;
  counts.local = matched.filter(row => row.isLocal).length;
  counts.unknown = unknown.length;
  return { matched: orderedRows(matched), unknown: orderedRows(unknown), counts };
}

// These intentionally suggest interests only; they never certify or exclude eligibility.
export function profileInterests(profile) {
  const result = [];
  if (profile.marital === "married") result.push("newlywed");
  if (profile.firsthome === true) result.push("first");
  const children = nonNegativeNumber(profile.children);
  if (Number.isSafeInteger(children) && children >= 2) result.push("multiple");
  return result;
}

export function profileChecklist(profile) {
  const unknown = "미입력/모름";
  const selected = value => typeof value === "string" && value.trim() ? value.trim() : unknown;
  const numberWithUnit = (value, unit) => {
    const parsed = nonNegativeNumber(value);
    return Number.isSafeInteger(parsed) ? `${parsed}${unit}` : unknown;
  };
  const region = normalizeRegion(profile.residence);
  const tenure = selected(profile.years);
  const answers = [
    ["나이", numberWithUnit(profile.age, "세"), "공고의 신청 기준일과 연령 요건을 확인하세요."],
    ["거주지·기간", `${region ?? unknown} · ${tenure}`, "공고의 우선공급 지역, 거주기간 산정 기준일과 증빙을 확인하세요."],
    ["혼인 상태", ({ married: "기혼", single: "미혼", divorced: "이혼·기타" })[profile.marital] ?? unknown,
      "혼인 인정 범위와 기준일, 예비신혼·한부모 등 예외 적용 여부를 공고에서 확인하세요."],
    ["미성년 자녀", numberWithUnit(profile.children, "명"), "자녀 인정 범위와 기준일을 확인하세요."],
    ["무주택 여부", ({ yes: "세대원 전원 무주택", no: "주택 보유 세대원 있음" })[profile.homeless] ?? unknown,
      "세대원 범위, 주택·분양권 소유 이력과 예외를 확인하세요."],
    ["가구소득", selected(profile.income), "가구원 범위, 소득 산정 방식과 공고별 소득 기준을 확인하세요."],
    ["총자산", selected(profile.assets), "공고에 적용되는 자산 평가·제외 항목과 기준을 확인하세요."],
    ["청약통장 가입기간", selected(profile.account), "통장 종류, 가입기간 기준일과 예치금 요건을 확인하세요."],
    ["납입 인정회차", selected(profile.payments), "실제 인정회차·인정금액과 공고의 요구 조건을 확인하세요."],
    ["생애최초 관심", profile.firsthome === true ? "관심 표시" : profile.firsthome === false ? "관심 표시 안 함" : unknown,
      "관심과 자격은 별개입니다. 본인·세대원의 과거 소유 이력과 공고의 요건을 확인하세요."],
  ];
  return answers.map(([label, answer, guidance]) => ({ label, answer, guidance }));
}
