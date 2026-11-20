import { createAddressLookup, geocodeCoordinates, noticeMapId, supplyAddress } from "./map-utils.js";

const loadTimeout = 10000;
const addressTimeout = 6000;
let sdkPromise;

async function readPublicConfig() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), loadTimeout);
  try {
    const response = await fetch("/api/public-config", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Map configuration unavailable");
    const { kakaoMapsJavaScriptKey: key } = await response.json();
    return { key: typeof key === "string" && key.trim() ? key.trim() : null };
  } catch {
    return { key: null, failed: true };
  } finally {
    clearTimeout(timer);
  }
}

function loadKakaoSdk(key) {
  return sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let finished = false;
    const timer = setTimeout(fail, loadTimeout);
    function fail() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.remove();
      reject(new Error("Kakao Maps SDK unavailable"));
    }

    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?${new URLSearchParams({
      appkey: key, libraries: "services", autoload: "false",
    })}`;
    script.onerror = fail;
    script.onload = () => {
      try {
        const maps = globalThis.kakao?.maps;
        maps.load(() => {
          if (finished) return;
          if (!maps.Map || !maps.Marker || !maps.services?.Geocoder || !maps.services.Status) return fail();
          finished = true;
          clearTimeout(timer);
          resolve(maps);
        });
      } catch {
        fail();
      }
    };
    try {
      document.head.append(script);
    } catch {
      fail();
    }
  });
}

function locateAddress(maps, geocoder, address) {
  return new Promise(resolve => {
    // undefined = transient failure (retry on a later search); null = no coordinates.
    const timer = setTimeout(resolve, addressTimeout);
    function finish(value) {
      clearTimeout(timer);
      resolve(value);
    }
    try {
      geocoder.addressSearch(address, (rows, status) => {
        if (status === maps.services.Status.ZERO_RESULT) return finish(null);
        if (status !== maps.services.Status.OK) return finish(undefined);
        // Avoid selecting an arbitrary result when the given address is ambiguous.
        finish(Array.isArray(rows) && rows.length === 1 ? geocodeCoordinates(rows[0]) : null);
      });
    } catch {
      finish(undefined);
    }
  });
}

const mapFailure = "카카오 지도를 불러오지 못했습니다. 공고 카드의 ‘카카오맵에서 주소 검색’을 이용하세요.";

export function createNoticeMap({ panel, viewport, canvas, placeholder, status, selectionStatus, enableButton, list, root }) {
  let config;
  let contextPromise;
  let revision = 0;
  let enabled = false;
  let overviewRevision = -1;
  let records = new Map();
  let matched = [];
  let selection;
  let map;
  let infoWindow;
  const markers = new Map();

  const configPromise = readPublicConfig().then(value => {
    config = value;
    root.classList.toggle("map-unavailable", !config.key);
    if (overviewRevision !== revision) showIdleStatus();
    return value;
  });

  function showIdleStatus() {
    const hasResults = records.size > 0;
    const empty = revision && !hasResults ? "현재 검색 결과가 없습니다. " : "";
    if (!config) status.textContent = `${empty}지도 설정을 확인하는 중입니다.`;
    else if (!config.key) status.textContent = empty + (config.failed
      ? "지도 설정을 불러오지 못했습니다. 주소가 있는 공고는 카카오맵에서 직접 검색할 수 있습니다."
      : "내장 지도를 사용하려면 카카오맵 JavaScript 키 설정이 필요합니다. 주소가 있는 공고는 카카오맵에서 직접 검색할 수 있습니다.");
    else if (!revision) status.textContent = "공고를 불러오면 공급위치를 볼 수 있습니다.";
    else if (!hasResults) status.textContent = "현재 검색 결과가 없습니다.";
    else if (!matched.length) status.textContent = "조건에 일치하는 공고가 없습니다. ‘정보 확인 필요’ 공고는 카드에서 하나씩 볼 수 있습니다.";
    else if (!matched.some(record => record.address)) status.textContent = `조건 일치 ${matched.length}건 중 지도 표시 0건 · 위치 확인 불가 ${matched.length}건 (주소 없음).`;
    else status.textContent = `조건 일치 공고 ${matched.length}건의 위치를 지도에서 확인할 수 있습니다.`;
    enableButton.hidden = !config?.key || enabled || !matched.some(record => record.address);
  }

  async function getContext() {
    const { key } = await configPromise;
    if (!key) return null;
    return contextPromise ??= loadKakaoSdk(key).then(maps => {
      const geocoder = new maps.services.Geocoder();
      return { maps, lookup: createAddressLookup(address => locateAddress(maps, geocoder, address)) };
    });
  }

  function showMap(maps, point) {
    if (!map) {
      map = new maps.Map(canvas, { center: point, level: 5 });
      infoWindow = new maps.InfoWindow({ disableAutoPan: true });
      if (typeof ResizeObserver === "function") {
        new ResizeObserver(() => {
          if (placeholder.hidden) {
            const center = map.getCenter();
            map.relayout();
            map.setCenter(center);
          }
        }).observe(viewport);
      }
    }
    if (!placeholder.hidden) {
      canvas.removeAttribute("aria-hidden");
      viewport.classList.add("has-map");
      placeholder.hidden = true;
      map.relayout();
      map.setCenter(point);
    }
  }

  function removeMarker(id) {
    const current = markers.get(id);
    if (!current) return;
    current.maps.event.removeListener(current.marker, "click", current.onClick);
    current.marker.setMap(null);
    markers.delete(id);
  }

  function addMarker(maps, record, point) {
    if (markers.has(record.id)) return markers.get(record.id).marker;
    showMap(maps, point);
    const marker = new maps.Marker({ map, position: point, clickable: true });
    const onClick = () => {
      if (records.get(record.id) === record && markers.get(record.id)?.marker === marker) {
        activate(record);
        displaySelection(record, marker);
      }
    };
    maps.event.addListener(marker, "click", onClick);
    markers.set(record.id, { maps, marker, onClick });
    return marker;
  }

  function setPressed() {
    for (const button of list.querySelectorAll(".map-select")) {
      const pressed = button.dataset.mapId === selection?.record.id;
      button.setAttribute("aria-pressed", String(pressed));
      button.closest("article").classList.toggle("map-selected", pressed);
    }
  }

  function activate(record) {
    infoWindow?.close();
    const previous = selection?.record;
    if (previous && !previous.matched && previous !== record) removeMarker(previous.id);
    selection = { record };
    setPressed();
    return selection;
  }

  function displaySelection(record, marker) {
    const title = `${record.matched ? "" : "정보 확인 필요 · "}${record.name}`;
    const content = document.createElement("div");
    content.className = "map-popup";
    const name = document.createElement("strong");
    name.textContent = title;
    const address = document.createElement("span");
    address.textContent = record.address;
    content.append(name, address);
    infoWindow.setContent(content);
    map.setLevel(5);
    map.panTo(marker.getPosition());
    infoWindow.open(map, marker);
    selectionStatus.textContent = `${title} · ${record.address}`;
  }

  async function loadOverview() {
    if (!matched.some(record => record.address) || overviewRevision === revision) return;
    const generation = revision;
    overviewRevision = generation;
    const isCurrent = () => revision === generation;
    const rows = matched;
    status.textContent = `조건 일치 공고 ${rows.length}건의 주소를 확인하는 중입니다.`;
    try {
      const context = await getContext();
      if (!isCurrent()) return;
      if (!context) return showIdleStatus();
      const { maps, lookup } = context;
      const results = await Promise.all(rows.map(record => lookup(record.address, isCurrent)));
      if (!isCurrent()) return;
      const points = new Map();
      let shown = 0;
      for (const [i, coordinate] of results.entries()) {
        if (!coordinate) continue;
        const point = new maps.LatLng(coordinate.lat, coordinate.lng);
        addMarker(maps, rows[i], point);
        points.set(`${coordinate.lat},${coordinate.lng}`, point);
        shown++;
      }
      if (!selection && points.size === 1) {
        map.setLevel(5);
        map.setCenter(points.values().next().value);
      } else if (!selection && points.size > 1) {
        const bounds = new maps.LatLngBounds();
        points.forEach(point => bounds.extend(point));
        map.setBounds(bounds, 44);
      }
      const missed = rows.length - shown;
      status.textContent = `조건 일치 ${rows.length}건 중 지도 표시 ${shown}건${missed ? ` · 위치 확인 불가 ${missed}건. 주소가 있는 공고는 카카오맵에서 직접 검색할 수 있습니다.` : "."}`;
    } catch {
      if (isCurrent()) status.textContent = mapFailure;
    }
  }

  function enable() {
    enabled = true;
    enableButton.hidden = true;
    void loadOverview();
  }

  async function select(record) {
    const current = activate(record);
    const isCurrent = () => selection === current;
    const label = record.matched ? "" : "정보 확인 필요 · ";
    selectionStatus.textContent = `${label}${record.name} · 위치를 확인하는 중입니다.`;
    try {
      const context = await getContext();
      if (!isCurrent()) return;
      if (!context) {
        selectionStatus.textContent = "공고 카드의 ‘카카오맵에서 주소 검색’을 이용하세요.";
        return;
      }
      const { maps, lookup } = context;
      const coordinate = await lookup(record.address, isCurrent);
      if (!isCurrent()) return;
      if (!coordinate) {
        selectionStatus.textContent = `${label}${record.name} · 공고 주소의 위치를 확인하지 못했습니다. 카카오맵에서 주소를 직접 검색해 보세요.`;
        return;
      }
      const marker = addMarker(maps, record, new maps.LatLng(coordinate.lat, coordinate.lng));
      displaySelection(record, marker);
    } catch {
      if (isCurrent()) selectionStatus.textContent = mapFailure;
    }
  }

  enableButton.addEventListener("click", enable);
  list.addEventListener("click", event => {
    const button = event.target.closest(".map-select");
    const record = button && records.get(button.dataset.mapId);
    if (!record?.address) return;
    void select(record);
    enable();
    panel.querySelector("h2").focus({ preventScroll: true });
    panel.scrollIntoView({ block: "nearest" });
  });

  return {
    setNotices(matchedItems, unknownItems) {
      revision++;
      selection = undefined;
      infoWindow?.close();
      markers.forEach((_marker, id) => removeMarker(id));
      viewport.classList.remove("has-map");
      canvas.setAttribute("aria-hidden", "true");
      placeholder.hidden = false;
      selectionStatus.textContent = "";
      function toRecord({ notice }, matched) {
        return { id: noticeMapId(notice), name: notice.HOUSE_NM || "공고명 미제공", address: supplyAddress(notice.HSSPLY_ADRES), matched };
      }
      matched = matchedItems.map(item => toRecord(item, true));
      records = new Map([...matched, ...unknownItems.map(item => toRecord(item, false))].map(record => [record.id, record]));
      setPressed();
      if (enabled) void loadOverview();
      if (overviewRevision !== revision) showIdleStatus();
    },
  };
}
