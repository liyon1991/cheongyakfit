import { isDateOnly } from "./public/notice-utils.js";

export function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function currentNotices(rows, asOf, source = "apt") {
  const seen = new Set();
  return rows.map(row => source === "remaining" ? { ...row,
    RCEPT_BGNDE: row.SUBSCRPT_RCEPT_BGNDE, RCEPT_ENDDE: row.SUBSCRPT_RCEPT_ENDDE
  } : row).filter(row => {
    if (!(source === "remaining" ? ["04", "06"] : ["01"]).includes(row.HOUSE_SECD) || !isDateOnly(row.RCRIT_PBLANC_DE)
        || row.RCRIT_PBLANC_DE > asOf || !isDateOnly(row.RCEPT_BGNDE)
        || !isDateOnly(row.RCEPT_ENDDE) || row.RCEPT_BGNDE > row.RCEPT_ENDDE
        || row.RCEPT_ENDDE < asOf) return false;
    const id = `${row.HOUSE_SECD}:${row.HOUSE_MANAGE_NO}:${row.PBLANC_NO}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function fetchCurrentNotices(fetchPage, asOf, source = "apt") {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    // The remaining-unit API documents no reception-end filter; scan every page.
    const body = await fetchPage({ page: String(page), perPage: "100",
      ...(source === "apt" ? { "cond[RCEPT_ENDDE::GTE]": asOf } : {}) });
    if (!Array.isArray(body.data) || !Number.isInteger(body.matchCount)
        || body.matchCount < 0) throw new Error("Invalid upstream pagination");
    rows.push(...body.data);
    if (rows.length >= body.matchCount) return currentNotices(rows, asOf, source);
    if (!body.data.length) throw new Error("Incomplete upstream results");
  }
  throw new Error("Upstream pagination limit exceeded");
}
