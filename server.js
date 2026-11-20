import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { normalizeServiceKey } from "./api-key.js";

dotenv.config({ path: fileURLToPath(new URL(".env", import.meta.url)) });

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_KEY = normalizeServiceKey(process.env.DATA_GO_KR_SERVICE_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

function requireKey(res) {
  if (!SERVICE_KEY) {
    res.status(503).json({
      error: "서버에 공공데이터포털 인증키가 등록되지 않았습니다. Render 환경변수 DATA_GO_KR_SERVICE_KEY를 설정해 주세요."
    });
    return false;
  }
  return true;
}
async function callOpenApi(endpoint, params = {}) {
  const url = new URL(`https://api.odcloud.kr/api/${endpoint}`);
  url.searchParams.set("serviceKey", SERVICE_KEY);
  url.searchParams.set("page", "1");
  url.searchParams.set("perPage", "30");
  url.searchParams.set("returnType", "JSON");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.response?.body?.items || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (body?.data && Array.isArray(body.data)) return body.data;
  if (body?.response?.body?.items?.item) {
    const item = body.response.body.items.item;
    return Array.isArray(item) ? item : [item];
  }
  return [];
}

app.get("/api/notices", async (_req, res) => {
  if (!requireKey(res)) return;
  try {
    const data = await callOpenApi(
      "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"
    );
    res.json({ source: "한국부동산원 청약홈 분양정보 조회 서비스", count: data.length, data });
  } catch (error) {
    console.error("notice API error:", error);
    res.status(502).json({ error: `청약 공고 API 오류: ${error.message}` });
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
    console.error("competition API error:", error);
    res.status(502).json({ error: `경쟁률 API 오류: ${error.message}` });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "cheongyakfit" }));

app.listen(PORT, () => console.log(`CheongyakFit running on ${PORT}`));
