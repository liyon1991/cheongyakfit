export function supplyAddress(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const address = value.trim();
  return address && address !== "." && address !== ".." ? address : null;
}

export function kakaoAddressLink(value) {
  const address = supplyAddress(value);
  if (!address) return null;
  try {
    return `https://map.kakao.com/link/search/${encodeURIComponent(address)}`;
  } catch {
    return null;
  }
}

export function noticeMapId(notice) {
  const text = value => String(value ?? "").trim();
  const identity = [notice.HOUSE_SECD, notice.HOUSE_MANAGE_NO, notice.PBLANC_NO].map(text);
  if (identity.some(value => !value)) {
    identity.push(...[notice.HOUSE_NM, notice.HSSPLY_ADRES, notice.RCRIT_PBLANC_DE].map(text));
  }
  return JSON.stringify(identity);
}

export function geocodeCoordinates(row) {
  const number = value => typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
    ? Number(value) : NaN;
  const lat = number(row?.y);
  const lng = number(row?.x);
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
    ? { lat, lng } : null;
}

// The pool is shared across searches, so changing filters cannot multiply active requests.
export function createAddressLookup(geocode, concurrency = 3) {
  const cache = new Map();
  const running = new Map();
  const queued = [];

  function drain() {
    while (queued.length) {
      const job = queued[0];
      const { address, isCurrent, resolve } = job;
      if (!isCurrent()) {
        queued.shift();
        resolve(null);
      } else if (cache.has(address)) {
        queued.shift();
        resolve(cache.get(address));
      } else if (running.has(address)) {
        queued.shift();
        running.get(address).then(resolve);
      } else {
        if (running.size >= concurrency) break;
        queued.shift();
        const task = Promise.resolve().then(() => geocode(address)).then(result => {
          // Cache confirmed misses, but allow retries after service errors or timeouts.
          if (result !== undefined) cache.set(address, result);
          return result ?? null;
        }, () => null).finally(() => {
          running.delete(address);
          drain();
        });
        running.set(address, task);
        task.then(resolve);
      }
    }
  }

  return (address, isCurrent) => address ? new Promise(resolve => {
    queued.push({ address, isCurrent, resolve });
    drain();
  }) : Promise.resolve(null);
}
