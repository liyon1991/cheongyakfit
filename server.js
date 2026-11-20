import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { normalizeServiceKey } from "./api-key.js";
import { fetchCurrentNotices, koreaDate } from "./notices.js";
import { enrichNotices, modelEndpoint } from "./models.js";
import { publicConfig } from "./public-config.js";

dotenv.config({ path: fileURLToPath(new URL(".env", import.meta.url)) });

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_KEY = normalizeServiceKey(process.env.DATA_GO_KR_SERVICE_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/public-config", (_req, res) => {
  res.set("Cache-Control", "no-store").json(publicConfig());
});

function requireKey(res) {
  if (!SERVICE_KEY) {
    res.status(503).json({
      error: "서버에 공공데이터포털 인증키가 등록되지 않았습니다. Render 환경변수 DATA_GO_KR_SERVICE_KEY를 설정해 주세요."
    });
    return false;
  }
  return true;
}
async function callOpenApi(endpoint, params = {}, raw = false) {
  const url = new URL(`https://api.odcloud.kr/api/${endpoint}`);
  url.searchParams.set("serviceKey", SERVICE_KEY);
  url.searchParams.set("page", "1");
  url.searchParams.set("perPage", "30");
  url.searchParams.set("returnType", "JSON");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}`);
  }
  if (raw) return body;
  if (body?.data && Array.isArray(body.data)) return body.data;
  if (body?.response?.body?.items?.item) {
    const item = body.response.body.items.item;
    return Array.isArray(item) ? item : [item];
  }
  return [];
}

let noticeCache;
let noticeRequest;
async function getNotices() {
  const asOf = koreaDate();
  if (noticeCache?.asOf === asOf && Date.now() - Date.parse(noticeCache.fetchedAt) < 300000) return noticeCache;
  if (noticeRequest?.asOf === asOf) return noticeRequest.promise;
  const request = { asOf };
  request.promise = Promise.all([
    fetchCurrentNotices(params => callOpenApi(
      "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail", params, true
    ), asOf),
    fetchCurrentNotices(params => callOpenApi(
      "ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail", params, true
    ), asOf, "remaining")
  ]).then(groups => enrichNotices(groups.flat(), (params, notice) => callOpenApi(
    modelEndpoint(notice), params, true
  ))).then(data => {
    noticeCache = { source: "한국부동산원 청약홈 APT·무순위·불법행위 재공급 분양정보", asOf,
      fetchedAt: new Date().toISOString(), count: data.length, data };
    return noticeCache;
  }).finally(() => { if (noticeRequest === request) noticeRequest = undefined; });
  noticeRequest = request;
  return request.promise;
}

app.get("/api/notices", async (_req, res) => {
  if (!requireKey(res)) return;
  try {
    res.set("Cache-Control", "no-store").json(await getNotices());
  } catch (error) {
    console.error("notice API error:", error.name);
    res.status(502).json({ error: "청약 공고를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

app.get("/api/competition", async (req, res) => {
  if (!requireKey(res)) return;
  const { houseManageNo, pblancNo } = req.query;
  if (!houseManageNo || !pblancNo) {
    return res.status(400).json({ error: "houseManageNo와 pblancNo가 필요합니다." });
  }
  try {
    const data = await callOpenApi(
      "ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet",
      {
        "cond[HOUSE_MANAGE_NO::EQ]": String(houseManageNo),
        "cond[PBLANC_NO::EQ]": String(pblancNo)
      }
    );
    res.json({ source: "한국부동산원 청약홈 경쟁률 조회 서비스", count: data.length, data });
  } catch (error) {
    console.error("competition API error:", error.name);
    res.status(502).json({ error: "경쟁률을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "cheongyakfit" }));

app.listen(PORT, () => console.log(`CheongyakFit running on ${PORT}`));
