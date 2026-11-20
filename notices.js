import { isDateOnly } from "./public/notice-utils.js";

export function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function currentNotices(rows, asOf) {
  const seen = new Set();
  return rows.filter(row => {
    if (row.HOUSE_SECD !== "01" || !isDateOnly(row.RCRIT_PBLANC_DE)
        || row.RCRIT_PBLANC_DE > asOf || !isDateOnly(row.RCEPT_BGNDE)
        || !isDateOnly(row.RCEPT_ENDDE) || row.RCEPT_BGNDE > row.RCEPT_ENDDE
        || row.RCEPT_ENDDE < asOf) return false;
    const id = `${row.HOUSE_MANAGE_NO}:${row.PBLANC_NO}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function fetchCurrentNotices(fetchPage, asOf) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const body = await fetchPage({ page: String(page), perPage: "100",
      "cond[RCEPT_ENDDE::GTE]": asOf });
    if (!Array.isArray(body.data) || !Number.isInteger(body.matchCount)
        || body.matchCount < 0) throw new Error("Invalid upstream pagination");
    rows.push(...body.data);
    if (rows.length >= body.matchCount) return currentNotices(rows, asOf);
    if (!body.data.length) throw new Error("Incomplete upstream results");
  }
  throw new Error("Upstream pagination limit exceeded");
}
