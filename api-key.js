export function normalizeServiceKey(value = "") {
  const key = value.trim();
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}
