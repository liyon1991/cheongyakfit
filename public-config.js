export function publicConfig(env = process.env) {
  const key = env.KAKAO_MAPS_JAVASCRIPT_KEY;
  return { kakaoMapsJavaScriptKey: typeof key === "string" && key.trim() ? key.trim() : null };
}
