import test from "node:test";
import assert from "node:assert/strict";
import { publicConfig } from "./public-config.js";

test("public config explicitly exposes only the browser JavaScript key", () => {
  assert.deepEqual(publicConfig({ KAKAO_MAPS_JAVASCRIPT_KEY: " public-browser-key ",
    DATA_GO_KR_SERVICE_KEY: "private-data-key", KAKAO_REST_API_KEY: "private-rest-key",
    KAKAO_ADMIN_KEY: "private-admin-key", RENDER_API_KEY: "private-render-key" }),
  { kakaoMapsJavaScriptKey: "public-browser-key" });
});

test("missing or blank map configuration is optional", () => {
  assert.deepEqual(publicConfig({}), { kakaoMapsJavaScriptKey: null });
  assert.deepEqual(publicConfig({ KAKAO_MAPS_JAVASCRIPT_KEY: "  " }), { kakaoMapsJavaScriptKey: null });
});
