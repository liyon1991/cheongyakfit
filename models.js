export async function fetchModels(fetchPage, notice) {
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const body = await fetchPage({ page: String(page), perPage: "100",
      "cond[HOUSE_MANAGE_NO::EQ]": String(notice.HOUSE_MANAGE_NO),
      "cond[PBLANC_NO::EQ]": String(notice.PBLANC_NO) });
    if (!Array.isArray(body.data) || !Number.isInteger(body.matchCount) || body.matchCount < 0
        || body.data.some(row => !row || String(row.HOUSE_MANAGE_NO) !== String(notice.HOUSE_MANAGE_NO)
          || String(row.PBLANC_NO) !== String(notice.PBLANC_NO))) {
      throw new Error("Invalid housing model response");
    }
    rows.push(...body.data);
    if (rows.length >= body.matchCount) return rows;
    if (!body.data.length) throw new Error("Incomplete housing models");
  }
  throw new Error("Housing model pagination limit exceeded");
}

// Limit concurrent upstream calls and preserve notices when model data fails.
export async function enrichNotices(notices, fetchPage) {
  const result = new Array(notices.length);
  let next = 0;
  async function worker() {
    while (next < notices.length) {
      const index = next++;
      const notice = notices[index];
      try {
        const models = await fetchModels(fetchPage, notice);
        result[index] = { ...notice, models, modelStatus: models.length ? "available" : "unavailable",
          modelsFetchedAt: new Date().toISOString() };
      } catch {
        result[index] = { ...notice, models: [], modelStatus: "unavailable", modelsFetchedAt: null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, notices.length) }, worker));
  return result;
}
