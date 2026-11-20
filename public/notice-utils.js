const regionAliases = new Map([
  ["서울", ["서울시", "서울특별시"]],
  ["부산", ["부산시", "부산광역시"]],
  ["대구", ["대구시", "대구광역시"]],
  ["인천", ["인천시", "인천광역시"]],
  ["광주", ["광주시", "광주광역시"]],
  ["대전", ["대전시", "대전광역시"]],
  ["울산", ["울산시", "울산광역시"]],
  ["세종", ["세종시", "세종특별자치시"]],
  ["경기", ["경기도"]],
  ["강원", ["강원도", "강원특별자치도"]],
  ["충북", ["충북도", "충청북도"]],
  ["충남", ["충남도", "충청남도"]],
  ["전북", ["전북도", "전라북도", "전라북", "전북특별자치도"]],
  ["전남", ["전남도", "전라남도"]],
  ["경북", ["경북도", "경상북도"]],
  ["경남", ["경남도", "경상남도"]],
  ["제주", ["제주도", "제주특별자치도"]],
].flatMap(([region, aliases]) => [region, ...aliases].map(alias => [alias, region])));

export function normalizeRegion(value) {
  return typeof value === "string" ? regionAliases.get(value.replace(/\s+/g, "")) ?? null : null;
}

export function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function rankNotices(notices, selectedRegion, asOf) {
  const region = normalizeRegion(selectedRegion);
  if (!isDateOnly(asOf)) return [];

  return notices.flatMap((notice, index) => {
    const start = notice?.RCEPT_BGNDE;
    const end = notice?.RCEPT_ENDDE;
    if (!isDateOnly(start) || !isDateOnly(end) || start > end || end < asOf) return [];

    const noticeRegion = normalizeRegion(notice.SUBSCRPT_AREA_CODE_NM);
    return [{ notice, index, isLocal: region !== null && noticeRegion === region,
      status: start <= asOf ? "active" : "upcoming", start, end }];
  }).sort((a, b) => Number(b.isLocal) - Number(a.isLocal)
    || Number(b.status === "active") - Number(a.status === "active")
    || (a.status === "active" ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start))
    || a.index - b.index)
    .map(({ index, ...row }) => row);
}

export function safeNoticeLink(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!/^https:\/\/(?:www\.)?applyhome\.co\.kr(?=[:/?#]|$)/i.test(candidate)
      || /[\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:"
      && ["applyhome.co.kr", "www.applyhome.co.kr"].includes(url.hostname)
      && !url.port && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => htmlEntities[character]);
}
