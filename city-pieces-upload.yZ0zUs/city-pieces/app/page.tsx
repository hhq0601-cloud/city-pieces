"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Category = "住宿" | "地铁站" | "公交站" | "火车站" | "飞机场" | "餐饮" | "景点" | "小店" | "商场" | "实用";
type Priority = "必去" | "想去" | "备选";
type PlaceReview = "下次还去" | "避雷" | "";
type ArrivalStyle = "hotel" | "store" | "energy";
type Tab = "地图" | "地点" | "行程" | "设置";

type Place = {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: Category;
  priority: Priority;
  note: string;
  source: string;
  date: string;
  order: number;
  visited?: boolean;
  review?: PlaceReview;
};

type Trip = {
  id: string;
  city: string;
  startDate: string;
  endDate: string;
  hotel: string;
  arrival: string;
  hotelPlaceId?: string;
  arrivalPlaceId?: string;
  places: Place[];
};

type AMapInstance = {
  setCenter: (point: [number, number]) => void;
  setCity: (city: string) => void;
  setFitView: () => void;
  add: (marker: unknown) => void;
  addControl: (control: unknown) => void;
  plugin: (plugins: string[], callback: () => void) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    AMap?: {
      Map: new (target: HTMLElement, options: Record<string, unknown>) => AMapInstance;
      Marker: new (options: Record<string, unknown>) => { on: (event: string, cb: () => void) => void };
      Polyline: new (options: Record<string, unknown>) => unknown;
      Scale: new (options?: Record<string, unknown>) => unknown;
      PlaceSearch: new (options: Record<string, unknown>) => { search: (keyword: string, cb: (status: string, result: AMapSearchResult) => void) => void; searchNearBy: (keyword: string, center: [number, number], radius: number, cb: (status: string, result: AMapSearchResult) => void) => void };
      Walking: new (options: Record<string, unknown>) => AMapRouteService;
      Riding: new (options: Record<string, unknown>) => AMapRouteService;
      Driving: new (options: Record<string, unknown>) => AMapRouteService;
      Transfer: new (options: Record<string, unknown>) => AMapRouteService;
      plugin: (plugins: string[], callback: () => void) => void;
    };
  }
}

const STORE_KEY = "waymark-trips-v2";
type AMapPoi = { id: string; name: string; address?: string; location?: { lng: number; lat: number }; type?: string };
type Discovery = { poi: AMapPoi; category: Category };
const discoveryCache = new Map<string, Discovery[]>();
type AMapSearchResult = { poiList?: { pois?: AMapPoi[] } };
type AMapRouteResult = { routes?: { distance?: number; time?: number }[]; plans?: { distance?: number; time?: number }[] };
type AMapRouteService = { search: (from: [number, number], to: [number, number], cb: (status: string, result: AMapRouteResult) => void) => void };
type TravelMode = "步行" | "骑行" | "公交" | "打车";
const categoryMeta: Record<Category, { emoji: string; color: string }> = {
  住宿: { emoji: "🏨", color: "#6558D9" }, 地铁站: { emoji: "🚇", color: "#1479D2" }, 公交站: { emoji: "🚏", color: "#2784A8" }, 火车站: { emoji: "🚄", color: "#4263A8" }, 飞机场: { emoji: "✈️", color: "#5179B8" },
  餐饮: { emoji: "🍴", color: "#DF5A42" }, 景点: { emoji: "🏛️", color: "#25946C" }, 小店: { emoji: "🛍️", color: "#A052B8" }, 商场: { emoji: "🏬", color: "#C47A27" }, 实用: { emoji: "🧰", color: "#66717E" },
};
const modeMeta: Record<TravelMode, { color: string; emoji: string }> = {
  步行: { color: "#34A853", emoji: "🚶" }, 骑行: { color: "#3185FC", emoji: "🚲" },
  公交: { color: "#8B5CF6", emoji: "🚇" }, 打车: { color: "#F05A28", emoji: "🚕" },
};

const navIcons: Record<Tab, string> = { 地图: "⌖", 地点: "≡", 行程: "▤", 设置: "⚙" };
function placeEmoji(place: Pick<Place, "name" | "category">) {
  return categoryMeta[place.category].emoji;
}

function distanceKm(a: Place, b: Place) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function recommendedMode(km: number): TravelMode { return km <= 1.5 ? "步行" : km <= 5 ? "骑行" : km <= 15 ? "公交" : "打车"; }
function approximateMinutes(km: number, mode: TravelMode) {
  const speed: Record<TravelMode, number> = { 步行: 4.5, 骑行: 12, 公交: 18, 打车: 25 };
  const overhead: Record<TravelMode, number> = { 步行: 0, 骑行: 3, 公交: 8, 打车: 5 };
  return Math.max(1, Math.round(km / speed[mode] * 60 + overhead[mode]));
}
function buildSmartPlan(trip: Trip, style: ArrivalStyle = "hotel") {
  const dates = dateRange(trip.startDate, trip.endDate);
  const candidates = trip.places.filter((place) => !place.visited);
  if (!dates.length || !candidates.length) return trip;
  const priorityScore: Record<Priority, number> = { 必去: 0, 想去: 1, 备选: 2 };
  const isArrival = (place: Place) => place.id === trip.arrivalPlaceId || ["火车站", "飞机场"].includes(place.category) || (!!trip.arrival && place.name.includes(trip.arrival));
  const isHotel = (place: Place) => place.id === trip.hotelPlaceId || place.category === "住宿" || (!!trip.hotel && place.name.includes(trip.hotel));
  const arrival = candidates.find(isArrival);
  const hotel = candidates.find(isHotel);
  const remaining = candidates.filter((place) => place.id !== arrival?.id && place.id !== hotel?.id).sort((a, b) => priorityScore[a.priority] - priorityScore[b.priority]);
  const route: Place[] = [];
  if (arrival) route.push(arrival);
  const takeNearest = (origin: Place | undefined, filter: (place: Place) => boolean = () => true) => {
    if (!origin) return undefined;
    const choices = remaining.map((place, index) => ({ place, index })).filter(({ place }) => filter(place)).sort((a, b) => distanceKm(origin, a.place) - distanceKm(origin, b.place));
    if (!choices.length) return undefined;
    return remaining.splice(choices[0].index, 1)[0];
  };
  if (style === "hotel") {
    if (hotel) route.push(hotel);
    const food = takeNearest(hotel || arrival, (place) => place.category === "餐饮"); if (food) route.push(food);
  } else if (style === "store") {
    const nearby = takeNearest(arrival, (place) => ["景点", "商场", "餐饮", "小店"].includes(place.category)); if (nearby) route.push(nearby);
    if (hotel) route.push(hotel);
  } else {
    const activity = takeNearest(arrival, (place) => ["景点", "商场"].includes(place.category)); if (activity) route.push(activity);
    const food = takeNearest(activity || arrival, (place) => place.category === "餐饮"); if (food) route.push(food);
    if (hotel) route.push(hotel);
  }
  let current = route.at(-1) || remaining.shift();
  if (current && !route.some((place) => place.id === current?.id)) route.push(current);
  while (current && remaining.length) {
    let best = 0;
    for (let index = 1; index < remaining.length; index += 1) if (distanceKm(current, remaining[index]) < distanceKm(current, remaining[best])) best = index;
    current = remaining.splice(best, 1)[0]; route.push(current);
  }
  const perDay = Math.max(style === "hotel" ? 3 : 4, Math.ceil(route.length / dates.length));
  const plan = new Map(route.map((place, index) => [place.id, { date: dates[Math.min(dates.length - 1, Math.floor(index / perDay))], order: index % perDay }]));
  return { ...trip, places: trip.places.map((place) => plan.has(place.id) ? { ...place, ...plan.get(place.id) } : place) };
}
const routeModeUri: Record<TravelMode, string> = { 步行: "walk", 骑行: "ride", 公交: "bus", 打车: "car" };
function amapRouteUrl(from: Place, to: Place, mode: TravelMode) {
  return `https://uri.amap.com/navigation?from=${from.lng},${from.lat},${encodeURIComponent(from.name)}&to=${to.lng},${to.lat},${encodeURIComponent(to.name)}&mode=${routeModeUri[mode]}&src=city-pieces&coordinate=gaode&callnative=1`;
}
function inferCategory(poi: AMapPoi): Category {
  const text = `${poi.name} ${poi.type || ""}`;
  if (/地铁/.test(text)) return "地铁站"; if (/公交|巴士/.test(text)) return "公交站";
  if (/机场|航站楼/.test(text)) return "飞机场"; if (/火车|铁路|高铁|客运站/.test(text)) return "火车站";
  if (/酒店|宾馆|住宿/.test(text)) return "住宿"; if (/餐饮|餐厅|美食|咖啡|茶馆/.test(text)) return "餐饮";
  if (/商场|购物中心|百货/.test(text)) return "商场"; if (/风景|名胜|博物馆|公园|展览/.test(text)) return "景点";
  if (/购物|专卖店|零售/.test(text)) return "小店"; return "实用";
}

const sampleTrip: Trip = {
  id: "demo-shanghai",
  city: "上海",
  startDate: "2026-09-19",
  endDate: "2026-09-22",
  hotel: "静安寺附近酒店",
  arrival: "上海虹桥站",
  places: [],
};

function formatDate(value: string) {
  if (!value) return "未安排";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  if (!start || !end) return dates;
  const current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last && dates.length < 31) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] || character));
}
function safeSourceUrl(value: string) {
  const candidate = value.match(/https?:\/\/[^\s，。]+/)?.[0] || value.trim();
  try { const url = new URL(candidate); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
function isValidTrip(value: unknown): value is Trip {
  if (!value || typeof value !== "object") return false;
  const trip = value as Partial<Trip>;
  return typeof trip.city === "string" && trip.city.length <= 80 && typeof trip.startDate === "string" && typeof trip.endDate === "string" && Array.isArray(trip.places) && trip.places.length <= 1000 && trip.places.every((place) => place && typeof place.id === "string" && typeof place.name === "string" && place.name.length <= 200 && typeof place.lng === "number" && Number.isFinite(place.lng) && typeof place.lat === "number" && Number.isFinite(place.lat) && place.lng >= -180 && place.lng <= 180 && place.lat >= -90 && place.lat <= 90 && place.category in categoryMeta);
}

function encodeTrip(trip: Trip) {
  const bytes = new TextEncoder().encode(JSON.stringify(trip)); let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeTrip(value: string): Trip {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Trip;
}

function Home({ trips, onOpen, onCreate }: { trips: Trip[]; onOpen: (id: string) => void; onCreate: (trip: Trip) => void }) {
  const [creating, setCreating] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onCreate({
      id: uid("trip"), city: String(data.get("city")), startDate: String(data.get("startDate")), endDate: String(data.get("endDate")),
      hotel: String(data.get("hotel")), arrival: String(data.get("arrival")), places: [],
    });
    setCreating(false);
  };

  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="brand-heading"><span className="brand-icon" aria-hidden="true" /><div><span className="eyebrow">CITY PIECES · 城市拼图</span><h1>下一站，去哪里？</h1><p>把想去的地方拼进同一张地图。</p></div></div>
        <button className="round-button" onClick={() => setCreating(true)} aria-label="创建旅行">＋</button>
      </header>
      <section className="trip-grid">
        {trips.map((trip) => (
          <button className="trip-card" key={trip.id} onClick={() => onOpen(trip.id)}>
            <div className="trip-map-art"><span className="art-road road-one"/><span className="art-road road-two"/><i>⌖</i><b>{trip.places.length}</b></div>
            <div className="trip-card-body"><span>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span><h2>{trip.city}</h2><p>⌂ {trip.hotel || "住宿待定"}</p><p>↗ {trip.arrival || "抵达地点待定"}</p></div>
          </button>
        ))}
        <button className="new-trip-card" onClick={() => setCreating(true)}><span>＋</span><b>创建新旅行</b><small>从城市和日期开始</small></button>
      </section>
      <p className="local-note">数据仅保存在这台设备的浏览器中</p>
      {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}><form className="sheet form-sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><div><span className="eyebrow">NEW TRIP</span><h2>创建旅行</h2></div><button type="button" className="close" onClick={() => setCreating(false)}>×</button></div><label>城市名称<input name="city" required placeholder="例如：京都" /></label><div className="two-cols"><label>开始日期<input name="startDate" type="date" required /></label><label>结束日期<input name="endDate" type="date" required /></label></div><label>住宿地点<input name="hotel" placeholder="酒店或区域" /></label><label>抵达车站或机场<input name="arrival" placeholder="例如：关西国际机场" /></label><button className="primary" type="submit">创建并打开地图</button></form></div>}
    </main>
  );
}

type RouteSummary = { distance: number; time: number };
function MapCanvas({ trip, selected, routeFrom, routeTo, routeMode, onRoute, onSelect }: { trip: Trip; selected: Place | null; routeFrom: Place | null; routeTo: Place | null; routeMode: TravelMode; onRoute: (summary: RouteSummary | null) => void; onSelect: (place: Place) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<AMapInstance | null>(null);
  const key = process.env.NEXT_PUBLIC_AMAP_KEY;
  const readyForMap = Boolean(key);

  useEffect(() => {
    if (!key || !mapElement.current) return;
    let disposed = false;
    const init = () => {
      if (disposed || !window.AMap || !mapElement.current) return;
      mapInstance.current?.destroy();
      const center: [number, number] = trip.places[0] ? [trip.places[0].lng, trip.places[0].lat] : [121.4737, 31.2304];
      const map = new window.AMap.Map(mapElement.current, { zoom: 13, center, viewMode: "2D", features: ["bg", "road", "building"] });
      if (!trip.places.length) map.setCity(trip.city);
      map.addControl(new window.AMap.Scale());
      trip.places.forEach((place) => {
        const content = `<div class="favorite-marker-wrap"><div class="amap-custom-marker" style="--marker:${categoryMeta[place.category].color}">${placeEmoji(place)}</div><b>${escapeHtml(place.name)}</b></div>`;
        const marker = new window.AMap!.Marker({ position: [place.lng, place.lat], content, offset: [-18, -18] });
        marker.on("click", () => onSelect(place));
        map.add(marker);
      });
      const addDiscoveries = () => {
        if (!window.AMap) return;
        const addDiscoveryMarker = ({ poi, category }: Discovery) => {
          if (disposed || !poi.location || !window.AMap || trip.places.some((place) => place.name === poi.name)) return;
          const content = `<div class="discovery-marker"><span>${categoryMeta[category].emoji}</span><b>${escapeHtml(poi.name)}</b></div>`;
          const marker = new window.AMap.Marker({ position: [poi.location.lng, poi.location.lat], content, offset: [-17, -17] });
          marker.on("click", () => window.dispatchEvent(new CustomEvent<Discovery>("citypieces:discover", { detail: { poi, category } }))); map.add(marker);
        };
        const cached = discoveryCache.get(trip.city);
        if (cached) { cached.forEach(addDiscoveryMarker); return; }
        const found: Discovery[] = [];
        const queries: Array<[string, Category]> = [["地铁站", "地铁站"], ["火车站", "火车站"], ["机场", "飞机场"]];
        queries.forEach(([keyword, category]) => {
          const service = new window.AMap!.PlaceSearch({ city: trip.city, citylimit: true, pageSize: 6, extensions: "base" });
          service.search(keyword, (status, result) => {
            if (disposed || status !== "complete" || !window.AMap) return;
            (result.poiList?.pois || []).filter((poi) => poi.location).forEach((poi) => { const item = { poi, category }; found.push(item); addDiscoveryMarker(item); });
            discoveryCache.set(trip.city, found);
          });
        });
      };
      if (window.AMap.PlaceSearch) addDiscoveries(); else window.AMap.plugin(["AMap.PlaceSearch"], addDiscoveries);
      if (routeFrom && routeTo) {
        const plugin = routeMode === "步行" ? "AMap.Walking" : routeMode === "骑行" ? "AMap.Riding" : routeMode === "公交" ? "AMap.Transfer" : "AMap.Driving";
        window.AMap.plugin([plugin], () => {
          if (disposed || !window.AMap) return;
          const options = { map, city: trip.city, hideMarkers: true, autoFitView: true, outlineColor: "#ffffff", strokeColor: modeMeta[routeMode].color };
          const service = routeMode === "步行" ? new window.AMap.Walking(options) : routeMode === "骑行" ? new window.AMap.Riding(options) : routeMode === "公交" ? new window.AMap.Transfer({ ...options, policy: 0 }) : new window.AMap.Driving(options);
          service.search([routeFrom.lng, routeFrom.lat], [routeTo.lng, routeTo.lat], (status, result) => {
            if (disposed) return;
            const path = result.routes?.[0] || result.plans?.[0];
            onRoute(status === "complete" && path ? { distance: path.distance || 0, time: path.time || 0 } : null);
          });
        });
      } else { onRoute(null); if (trip.places.length > 1) map.setFitView(); }
      mapInstance.current = map;
    };
    if (window.AMap) { init(); return () => { disposed = true; mapInstance.current?.destroy(); mapInstance.current = null; }; }
    const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}&plugin=AMap.Scale`;
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);
    return () => { disposed = true; script.onload = null; mapInstance.current?.destroy(); mapInstance.current = null; };
  }, [key, trip, routeFrom, routeTo, routeMode, onRoute, onSelect]);

  return <div className="map-canvas" ref={mapElement}>{!readyForMap && <div className="map-unavailable"><span>🗺️</span><h2>需要连接高德地图</h2><p>配置 Web 端 Key 后，这里会显示真实街道、行政区、建筑、地铁站、收藏地点和准确比例尺。</p><code>NEXT_PUBLIC_AMAP_KEY</code></div>}{selected && <div className="map-focus"/>}</div>;
}

function PlaceSheet({ place, onSetRoute, onEdit, onNearby, onSave = (next) => window.dispatchEvent(new CustomEvent<Place>("citypieces:save-place", { detail: next })), onDelete = () => window.dispatchEvent(new CustomEvent<string>("citypieces:delete", { detail: place.id })), onClose }: { place: Place; onSetRoute: (role: "from" | "to", place: Place) => void; onEdit: () => void; onNearby: () => void; onSave?: (place: Place) => void; onDelete?: () => void; onClose: () => void }) {
  const sourceUrl = safeSourceUrl(place.source);
  const nearbyLabel = "🏬 附近3公里商场";
  return <div className="place-sheet"><div className="grabber"/><button className="close floating-close" onClick={onClose}>×</button><div className="place-heading"><span className="category-dot" style={{ "--marker": categoryMeta[place.category].color } as React.CSSProperties}>{placeEmoji(place)}</span><div><span className="tag">{place.category} · {place.priority}{place.visited ? " · ✓ 已去" : ""}</span><h2>{place.name}</h2><p>{place.address}</p></div></div><div className="visit-review"><button className={place.visited ? "active" : ""} onClick={() => onSave({ ...place, visited: !place.visited, review: place.visited ? "" : place.review })}>{place.visited ? "✓ 已去过" : "标记为已去"}</button><button disabled={!place.visited} className={place.review === "下次还去" ? "active return" : ""} onClick={() => onSave({ ...place, visited: true, review: place.review === "下次还去" ? "" : "下次还去" })}>💚 下次还去</button><button disabled={!place.visited} className={place.review === "避雷" ? "active avoid" : ""} onClick={() => onSave({ ...place, visited: true, review: place.review === "避雷" ? "" : "避雷" })}>⚠️ 避雷</button></div><div className="detail-grid one"><div><span>计划日期</span><b>{formatDate(place.date)}</b></div></div><div className="saved-fields"><span>我的备注</span><p>{place.note || "尚未填写备注"}</p><span>攻略来源</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">打开原始攻略 ↗</a> : <p>尚未添加有效来源链接</p>}</div><div className="place-tools"><button onClick={onEdit}>✎ 修改标记</button><button onClick={onNearby}>{nearbyLabel}</button><button className="delete-place" onClick={onDelete}>删除收藏</button></div><div className="route-pick-actions"><button onClick={() => onSetRoute("from", place)}>设为路线起点</button><button onClick={() => onSetRoute("to", place)}>设为路线终点</button></div></div>;
}

function EditPlace({ place, dates, onSave, onClose }: { place: Place; dates: string[]; onSave: (place: Place) => void; onClose: () => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const address = String(data.get("address")).trim();
    if (!name) { window.alert("地点名称不能为空"); return; }
    const category = String(data.get("category")) as Category;
    onSave({ ...place, name, address, category, priority: category === "住宿" ? "必去" : String(data.get("priority")) as Priority, date: String(data.get("date")), note: String(data.get("note")).trim(), source: String(data.get("source")).trim(), visited: data.get("visited") === "yes", review: String(data.get("review")) as PlaceReview });
    onClose();
  };
  return <div className="modal-backdrop align-end" onClick={onClose}><form className="sheet form-sheet tall-sheet edit-place-form" data-testid="edit-place-form" noValidate onSubmit={submit} onClick={(e) => e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><div><span className="eyebrow">EDIT PIECE</span><h2>修改地点信息</h2></div><button type="button" className="close" onClick={onClose}>×</button></div><div className="picked-place"><span>高德坐标已保留</span><b>{place.name}</b><small>经纬度不会因修改文字而变化</small></div><label>地点名称<input name="name" defaultValue={place.name} autoComplete="off" /></label><label>地址<input name="address" defaultValue={place.address} autoComplete="street-address" /></label><div className="two-cols"><label>标记类别<select name="category" defaultValue={place.category}>{(Object.keys(categoryMeta) as Category[]).map((c) => <option value={c} key={c}>{categoryMeta[c].emoji} {c}</option>)}</select></label><label>想去程度<select name="priority" defaultValue={place.priority}><option>必去</option><option>想去</option><option>备选</option></select></label></div><div className="two-cols"><label>到访状态<select name="visited" defaultValue={place.visited ? "yes" : "no"}><option value="no">还没去</option><option value="yes">已去过</option></select></label><label>我的评价<select name="review" defaultValue={place.review || ""}><option value="">暂不评价</option><option>下次还去</option><option>避雷</option></select></label></div><label>计划日期<select name="date" defaultValue={place.date}><option value="">未安排</option>{dates.map((d) => <option value={d} key={d}>{formatDate(d)}</option>)}</select></label><label>我的攻略备注<textarea name="note" rows={4} defaultValue={place.note} placeholder="记录路线、推荐菜、入口或其他攻略" /></label><label>攻略来源链接或分享文案<input name="source" type="text" inputMode="url" defaultValue={place.source} placeholder="可粘贴网页链接或完整分享文案" /></label><button className="primary" type="submit">保存全部修改</button></form></div>;
}

function NearbyMalls({ origin, onAdd, onClose }: { origin: Place; onAdd: (place: Place) => void; onClose: () => void }) {
  const [results, setResults] = useState<AMapPoi[]>([]); const [loading, setLoading] = useState(true); const [added, setAdded] = useState<string[]>([]);
  const isStation = false;
  useEffect(() => { if (!window.AMap) { const timer = window.setTimeout(() => setLoading(false), 0); return () => window.clearTimeout(timer); } const run = () => { const service = new window.AMap!.PlaceSearch({ pageSize: 10, extensions: "all", type: isStation ? "生活服务" : "购物服务" }); service.searchNearBy(isStation ? "行李寄存" : "商场", [origin.lng, origin.lat], isStation ? 2000 : 3000, (status, result) => { setResults(status === "complete" ? (result.poiList?.pois || []).filter((p) => p.location) : []); setLoading(false); }); }; if (window.AMap.PlaceSearch) run(); else window.AMap.plugin(["AMap.PlaceSearch"], run); }, [isStation, origin]);
  const add = (poi: AMapPoi) => { if (!poi.location || added.includes(poi.id)) return; onAdd({ id: uid("place"), name: poi.name, address: poi.address || "", lng: poi.location.lng, lat: poi.location.lat, category: isStation ? "实用" : "商场", priority: "备选", note: isStation ? "车站附近寄存候选；出发前请确认营业时间、容量和收费。" : "", source: "", date: origin.date, order: 99 }); setAdded((all) => [...all, poi.id]); };
  return <div className="modal-backdrop align-end" onClick={onClose}><section className="sheet form-sheet tall-sheet" onClick={(e) => e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><div><span className="eyebrow">{isStation ? "LUGGAGE · WITHIN 2 KM" : "WITHIN 3 KM"}</span><h2>{isStation ? "附近行李寄存" : "附近商场"}</h2><p className="sheet-subtitle">{isStation ? `查询 ${origin.name} 周边寄存点，请到高德核对实时信息` : `以 ${origin.name} 为中心，可作为休息或寻找洗手间的备选`}</p></div><button className="close" onClick={onClose}>×</button></div>{loading && <div className="empty">正在查询高德附近地点…</div>}<div className="search-results mall-results">{results.map((poi) => <button type="button" key={poi.id} onClick={() => add(poi)} disabled={added.includes(poi.id)}><span>{isStation ? "🧳" : "🏬"}</span><div><b>{poi.name}</b><small>{poi.address}</small></div><i>{added.includes(poi.id) ? "已标记" : "＋"}</i></button>)}</div>{!loading && !results.length && <div className="empty">附近没有查询到相关地点</div>}</section></div>;
}

function AddPlace({ city, dates, onClose, onAdd }: { city: string; dates: string[]; onClose: () => void; onAdd: (place: Place) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AMapPoi[]>([]);
  const [picked, setPicked] = useState<AMapPoi | null>(null);
  const [category, setCategory] = useState<Category>("景点");
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const search = () => {
    if (!query.trim()) return;
    if (!window.AMap) { setMessage("请先配置高德 API Key，再使用地点搜索"); return; }
    setSearching(true); setMessage("");
    if (window.AMap.PlaceSearch) runSearch();
    else window.AMap.plugin(["AMap.PlaceSearch"], runSearch);
    function runSearch() {
      const service = new window.AMap!.PlaceSearch({ city, citylimit: true, pageSize: 8, extensions: "all" });
      service.search(query, (status, result) => { const pois = status === "complete" ? result.poiList?.pois || [] : []; setResults(pois.filter((p) => p.location)); setSearching(false); if (!pois.length) setMessage("没有找到相关地点，请换个关键词"); });
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!picked?.location) { setMessage("请先从高德搜索结果中选择一个地点"); return; }
    const d = new FormData(event.currentTarget);
    onAdd({ id: uid("place"), name: picked.name, address: picked.address || city, lng: picked.location.lng, lat: picked.location.lat, category, priority: category === "住宿" ? "必去" : String(d.get("priority")) as Priority, note: String(d.get("note")), source: String(d.get("source")), date: String(d.get("date")), order: 99 });
    onClose();
  };
  return <div className="modal-backdrop align-end" onClick={onClose}><form className="sheet form-sheet tall-sheet add-place-form" noValidate onSubmit={submit} onClick={(e) => e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><div><span className="eyebrow">AMAP SEARCH</span><h2>搜索并标记地点</h2></div><button type="button" className="close" onClick={onClose}>×</button></div><div className="place-search"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder={`搜索${city}的餐馆、地铁站、商场…`} /><button type="button" onClick={search} disabled={searching}>{searching ? "搜索中" : "搜索"}</button></div>{message && <p className="search-message">{message}</p>}<div className="search-results">{results.map((poi) => <button type="button" key={poi.id} className={picked?.id === poi.id ? "picked" : ""} onClick={() => { setPicked(poi); setCategory(inferCategory(poi)); setResults([]); setMessage(""); }}><span>📍</span><div><b>{poi.name}</b><small>{poi.address || city}</small></div><i>{picked?.id === poi.id ? "✓" : ""}</i></button>)}</div>{picked ? <div className="picked-place"><span>已选择高德地点</span><b>{picked.name}</b><small>{picked.address || city}</small></div> : <p className="pick-hint">先搜索并选择正确地点；下面的分类、备注和攻略来源可以提前填写。</p>}<div className="form-section-title"><b>完善收藏信息</b><span>这些内容可以随时填写，选中地点后即可保存</span></div><div className="two-cols"><label>标记类别<select name="category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>{(Object.keys(categoryMeta) as Category[]).map((c) => <option value={c} key={c}>{categoryMeta[c].emoji} {c}</option>)}</select></label><label>想去程度<select name="priority"><option>必去</option><option>想去</option><option>备选</option></select></label></div><label>计划日期<select name="date"><option value="">未安排</option>{dates.map((d) => <option value={d} key={d}>{formatDate(d)}</option>)}</select></label><label>我的攻略备注<textarea name="note" rows={3} placeholder="例如：建议从南门进入；招牌菜是蟹粉面" /></label><label>攻略来源链接或分享文案<input name="source" type="text" inputMode="url" placeholder="可粘贴小红书、公众号、网页链接或分享内容" /></label><button className="primary" type="submit" disabled={!picked}>{picked ? "保存地点、备注和来源" : "请先选择高德地点"}</button></form></div>;
}

function PlacesList({ trip, onSelect }: { trip: Trip; onSelect: (place: Place) => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [priority, setPriority] = useState<Priority | "">("");
  const [date, setDate] = useState("");
  const toggle = (category: Category) => setCategories((all) => all.includes(category) ? all.filter((c) => c !== category) : [...all, category]);
  const visible = trip.places.filter((p) => (!categories.length || categories.includes(p.category)) && (!priority || p.priority === priority) && (!date || p.date === date));
  return <section className="content-page"><header className="page-header"><span className="eyebrow">SAVED PIECES</span><h1>{trip.city}的地点</h1><p>{trip.places.length} 个收藏 · 分类可多选</p></header><div className="filter-row emoji-filters"><button className={!categories.length ? "active" : ""} onClick={() => setCategories([])}>全部</button>{(Object.keys(categoryMeta) as Category[]).map((item) => <button key={item} className={categories.includes(item) ? "active" : ""} onClick={() => toggle(item)}><span>{categoryMeta[item].emoji}</span>{item}{categories.includes(item) && " ✓"}</button>)}</div><div className="subfilters"><button className={priority === "必去" ? "active" : ""} onClick={() => setPriority(priority === "必去" ? "" : "必去")}>必去</button><button className={priority === "备选" ? "active" : ""} onClick={() => setPriority(priority === "备选" ? "" : "备选")}>备选</button><select value={date} onChange={(e) => setDate(e.target.value)}><option value="">全部日期</option>{dateRange(trip.startDate, trip.endDate).map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}</select></div><div className="place-list">{visible.map((place) => <button className="place-row" key={place.id} onClick={() => onSelect(place)}><span className="category-dot" style={{ "--marker": categoryMeta[place.category].color } as React.CSSProperties}>{placeEmoji(place)}</span><div><h3>{place.name}</h3><p>{place.address}</p><span>{place.date ? formatDate(place.date) : "未安排"}</span></div><b className={`priority priority-${place.priority}`}>{place.priority}</b></button>)}{visible.length === 0 && <div className="empty">这个组合筛选下还没有地点</div>}</div></section>;
}

function RouteLeg({ from, to }: { from: Place; to: Place }) {
  const km = distanceKm(from, to); const mode = recommendedMode(km);
  return <a className="route-leg" href={amapRouteUrl(from, to, mode)} target="_blank" rel="noreferrer" style={{ "--route": modeMeta[mode].color } as React.CSSProperties}><i/><span>约{approximateMinutes(km, mode)}分钟 · 直线{km < 1 ? `${Math.round(km * 1000)}米` : `${km.toFixed(1)}公里`}</span><b>{modeMeta[mode].emoji} 可能适合{mode} <em>高德查实际路线 ↗</em></b></a>;
}

function Itinerary({ trip, onReorder, onAutoPlan = (style) => window.dispatchEvent(new CustomEvent<ArrivalStyle>("citypieces:auto-plan", { detail: style })) }: { trip: Trip; onReorder: (date: string, placeId: string, direction: -1 | 1) => void; onAutoPlan?: (style: ArrivalStyle) => void }) {
  const dates = dateRange(trip.startDate, trip.endDate);
  const [arrivalStyle, setArrivalStyle] = useState<ArrivalStyle>("hotel");
  const unscheduled = trip.places.filter((p) => !p.date).sort((a, b) => a.order - b.order);
  const renderPlace = (place: Place, index: number, items: Place[], date?: string) => <div key={place.id}>{items[index - 1] && <RouteLeg from={items[index - 1]} to={place}/>}<div className="schedule-row"><span className="order-number">{date ? String(index + 1).padStart(2, "0") : ""}</span><span className="place-emoji">{placeEmoji(place)}</span><div><h3>{place.name}</h3><p>{place.category} · {place.address}</p></div>{date && <div className="reorder"><button disabled={index === 0} onClick={() => onReorder(date, place.id, -1)}>↑</button><button disabled={index === items.length - 1} onClick={() => onReorder(date, place.id, 1)}>↓</button></div>}</div></div>;
  return <section className="content-page"><header className="page-header"><span className="eyebrow">ITINERARY</span><h1>每日行程</h1><p>点击推荐方式可直接在高德查看路线</p></header><div className="ai-planner"><div><span>✦ AI 抵达助手</span><b>先处理抵达、行李和体力</b><select value={arrivalStyle} onChange={(event) => setArrivalStyle(event.target.value as ArrivalStyle)}><option value="hotel">先去酒店 · 放行李休息/附近吃饭</option><option value="store">车站寄存 · 先玩附近</option><option value="energy">精力充沛 · 直接开始游玩</option></select><small>之后再按区域、距离和必去优先级顺路安排</small></div><button onClick={() => onAutoPlan(arrivalStyle)}>生成行程</button></div><div className="mode-key">{(Object.keys(modeMeta) as TravelMode[]).map((mode) => <span key={mode}><i style={{ background: modeMeta[mode].color }}/>{modeMeta[mode].emoji}{mode}</span>)}</div><div className="timeline">{dates.map((date, day) => { const items = trip.places.filter((p) => p.date === date).sort((a, b) => a.order - b.order); return <article className="day-card" key={date}><div className="day-title"><div><span>DAY {day + 1}</span><h2>{formatDate(date)}</h2></div><p>{items.length}个地点</p></div>{items.length ? items.map((place, index) => renderPlace(place, index, items, date)) : <div className="empty-day">暂未安排地点</div>}</article>; })}<article className="day-card unscheduled"><div className="day-title"><div><span>LATER</span><h2>未安排</h2></div><p>{unscheduled.length}个地点</p></div>{unscheduled.map((place, index) => renderPlace(place, index, unscheduled))}{!unscheduled.length && <div className="empty-day">没有未安排地点</div>}</article></div></section>;
}

function Settings({ trip, onBack, onDelete, onUpdate = (next) => window.dispatchEvent(new CustomEvent<Trip>("citypieces:save-trip", { detail: next })) }: { trip: Trip; onBack: () => void; onDelete: () => void; onUpdate?: (trip: Trip) => void }) {
  const [editingTrip, setEditingTrip] = useState(false);
  const exportTrip = () => { const blob = new Blob([JSON.stringify(trip, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `城市拼图-${trip.city}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const importTrip = (file?: File) => { if (!file || file.size > 2_000_000) { window.alert("请选择小于 2MB 的城市拼图 JSON 文件"); return; } const reader = new FileReader(); reader.onload = () => { try { const parsed: unknown = JSON.parse(String(reader.result)); if (!isValidTrip(parsed)) throw new Error("invalid"); const cleaned = { ...parsed, id: uid("trip"), places: parsed.places.map((place) => ({ ...place, source: safeSourceUrl(place.source || "") })) }; window.dispatchEvent(new CustomEvent<Trip>("citypieces:import", { detail: cleaned })); window.alert(`已导入“${parsed.city}”`); } catch { window.alert("这个文件不是有效或安全的城市拼图行程"); } }; reader.readAsText(file); };
  const shareTrip = async () => { const url = `${location.origin}${location.pathname}#trip=${encodeTrip(trip)}`; if (navigator.share) await navigator.share({ title: `城市拼图 · ${trip.city}`, text: `查看我的${trip.city}城市拼图`, url }); else { await navigator.clipboard.writeText(url); window.alert("分享链接已复制"); } };
  const hotels = trip.places.filter((place) => place.category === "住宿");
  const arrivals = trip.places.filter((place) => ["火车站", "飞机场"].includes(place.category));
  const chooseAnchor = (kind: "hotel" | "arrival", id: string) => {
    const place = trip.places.find((item) => item.id === id);
    if (kind === "hotel") onUpdate({ ...trip, hotelPlaceId: id || undefined, hotel: place?.name || trip.hotel });
    else onUpdate({ ...trip, arrivalPlaceId: id || undefined, arrival: place?.name || trip.arrival });
  };
  const saveTripInfo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const city = String(data.get("city")).trim();
    const startDate = String(data.get("startDate"));
    const endDate = String(data.get("endDate"));
    if (!city || !startDate || !endDate || startDate > endDate) { window.alert("请填写城市和正确的旅行日期"); return; }
    const validDates = new Set(dateRange(startDate, endDate));
    onUpdate({ ...trip, city, startDate, endDate, hotel: String(data.get("hotel")).trim(), arrival: String(data.get("arrival")).trim(), places: trip.places.map((place) => place.date && !validDates.has(place.date) ? { ...place, date: "", order: 99 } : place) });
    setEditingTrip(false);
  };
  return <section className="content-page"><header className="page-header settings-heading"><div><span className="eyebrow">CITY PIECES SETTINGS</span><h1>{trip.city}</h1><p>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</p></div><button onClick={() => setEditingTrip(true)}>编辑旅行资料</button></header><div className="settings-card anchor-settings"><div><span>🏨 真实住宿地点</span><select value={trip.hotelPlaceId || ""} onChange={(event) => chooseAnchor("hotel", event.target.value)}><option value="">尚未绑定高德地点</option>{hotels.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><small>先通过“＋”搜索并收藏住宿，再在这里选择</small></div><div><span>🚄/✈️ 真实抵达地点</span><select value={trip.arrivalPlaceId || ""} onChange={(event) => chooseAnchor("arrival", event.target.value)}><option value="">尚未绑定高德地点</option>{arrivals.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><small>绑定后智能排程会从准确坐标出发</small></div></div><div className="settings-card"><div><span>数据存储</span><b>仅此浏览器 · localStorage</b></div><div><span>高德地图</span><b>{process.env.NEXT_PUBLIC_AMAP_KEY ? "API Key 已配置" : "尚未配置 API Key"}</b></div></div><div className="share-card"><h2>带走或分享这块拼图</h2><p>分享链接包含当前行程副本；对方打开后会保存到自己的浏览器。</p><button onClick={shareTrip}>分享行程链接</button><button onClick={exportTrip}>导出 JSON 备份</button><label className="import-button">导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => importTrip(event.target.files?.[0])}/></label></div><p className="privacy-copy">城市拼图不会上传你的行程。清除浏览器数据将同时清除这里保存的旅行。</p><button className="secondary wide" onClick={onBack}>返回所有旅行</button><button className="danger wide" onClick={onDelete}>删除这次旅行</button>{editingTrip && <div className="modal-backdrop align-end" onClick={() => setEditingTrip(false)}><form className="sheet form-sheet tall-sheet" noValidate onSubmit={saveTripInfo} onClick={(event) => event.stopPropagation()}><div className="grabber"/><div className="sheet-title"><div><span className="eyebrow">EDIT TRIP</span><h2>修改旅行资料</h2></div><button type="button" className="close" onClick={() => setEditingTrip(false)}>×</button></div><label>城市名称<input name="city" defaultValue={trip.city} /></label><div className="two-cols"><label>开始日期<input name="startDate" type="date" defaultValue={trip.startDate} /></label><label>结束日期<input name="endDate" type="date" defaultValue={trip.endDate} /></label></div><label>住宿地点或区域<input name="hotel" defaultValue={trip.hotel} placeholder="例如：静安寺附近" /></label><label>抵达车站或机场<input name="arrival" defaultValue={trip.arrival} placeholder="例如：上海虹桥站" /></label><p className="form-note">缩短日期后，超出新日期范围的地点会移到“未安排”。</p><button className="primary" type="submit">保存旅行资料</button></form></div>}</section>;
}

function TripApp({ trip, onUpdate, onBack, onDelete }: { trip: Trip; onUpdate: (trip: Trip) => void; onBack: () => void; onDelete: () => void }) {
  const [tab, setTab] = useState<Tab>("地图");
  const [selected, setSelected] = useState<Place | null>(null);
  const [adding, setAdding] = useState(false);
  const [mapCategories, setMapCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);
  const [nearbyOrigin, setNearbyOrigin] = useState<Place | null>(null);
  const [routeFrom, setRouteFrom] = useState<Place | null>(null);
  const [routeTo, setRouteTo] = useState<Place | null>(null);
  const [routeMode, setRouteMode] = useState<TravelMode>("公交");
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  useEffect(() => { const saveTrip = (event: Event) => onUpdate((event as CustomEvent<Trip>).detail); window.addEventListener("citypieces:save-trip", saveTrip); return () => window.removeEventListener("citypieces:save-trip", saveTrip); }, [onUpdate]);
  useEffect(() => { const save = (event: Event) => { const place = (event as CustomEvent<Place>).detail; onUpdate({ ...trip, places: trip.places.map((item) => item.id === place.id ? place : item) }); setSelected(place); }; window.addEventListener("citypieces:save-place", save); return () => window.removeEventListener("citypieces:save-place", save); }, [onUpdate, trip]);
  useEffect(() => { const plan = (event: Event) => { if (!trip.places.some((place) => !place.visited)) { window.alert("还没有可安排的未到访地点"); return; } const style = (event as CustomEvent<ArrivalStyle>).detail || "hotel"; if (window.confirm("将按抵达场景、地点距离和必去优先级重新安排未到访地点，继续吗？")) onUpdate(buildSmartPlan(trip, style)); }; window.addEventListener("citypieces:auto-plan", plan); return () => window.removeEventListener("citypieces:auto-plan", plan); }, [onUpdate, trip]);
  useEffect(() => { const receive = (event: Event) => { const item = (event as CustomEvent<Discovery>).detail; if (!item.poi.location || trip.places.some((place) => place.name === item.poi.name)) return; const place: Place = { id: uid("place"), name: item.poi.name, address: item.poi.address || "", lng: item.poi.location.lng, lat: item.poi.location.lat, category: item.category, priority: "想去", note: "", source: "", date: "", order: 99 }; onUpdate({ ...trip, places: [...trip.places, place] }); setSelected(place); }; window.addEventListener("citypieces:discover", receive); return () => window.removeEventListener("citypieces:discover", receive); }, [onUpdate, trip]);
  useEffect(() => { const remove = (event: Event) => { const id = (event as CustomEvent<string>).detail; const place = trip.places.find((item) => item.id === id); if (!place || !window.confirm(`确定删除“${place.name}”吗？`)) return; onUpdate({ ...trip, places: trip.places.filter((item) => item.id !== id) }); if (routeFrom?.id === id) setRouteFrom(null); if (routeTo?.id === id) setRouteTo(null); setSelected(null); }; window.addEventListener("citypieces:delete", remove); return () => window.removeEventListener("citypieces:delete", remove); }, [onUpdate, routeFrom, routeTo, trip]);
  const selectPlace = (place: Place) => { setSelected(place); if (tab !== "地图") setTab("地图"); };
  const reorder = (date: string, placeId: string, direction: -1 | 1) => {
    const ordered = trip.places.filter((p) => p.date === date).sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((p) => p.id === placeId); const swap = ordered[index + direction];
    if (!swap) return;
    onUpdate({ ...trip, places: trip.places.map((p) => p.id === placeId ? { ...p, order: swap.order } : p.id === swap.id ? { ...p, order: ordered[index].order } : p) });
  };
  const visibleTrip = useMemo(() => ({ ...trip, places: mapCategories.length ? trip.places.filter((p) => mapCategories.includes(p.category)) : trip.places }), [trip, mapCategories]);
  const toggleMapCategory = (category: Category) => setMapCategories((all) => all.includes(category) ? all.filter((c) => c !== category) : [...all, category]);
  const receiveRoute = useCallback((summary: RouteSummary | null) => setRouteSummary(summary), []);
  const setRoutePoint = (role: "from" | "to", place: Place) => { if (role === "from") setRouteFrom(place); else setRouteTo(place); setSelected(null); };
  const modeUri: Record<TravelMode, string> = { 步行: "walk", 骑行: "ride", 公交: "bus", 打车: "car" };
  const routeUrl = routeFrom && routeTo ? `https://uri.amap.com/navigation?from=${routeFrom.lng},${routeFrom.lat},${encodeURIComponent(routeFrom.name)}&to=${routeTo.lng},${routeTo.lat},${encodeURIComponent(routeTo.name)}&mode=${modeUri[routeMode]}&src=waymark&coordinate=gaode&callnative=1` : "#";
  const addPlace = (place: Place) => {
    const isArrival = ["火车站", "飞机场"].includes(place.category);
    onUpdate({ ...trip, places: [...trip.places, place], ...(place.category === "住宿" && !trip.hotelPlaceId ? { hotelPlaceId: place.id, hotel: place.name } : {}), ...(isArrival && !trip.arrivalPlaceId ? { arrivalPlaceId: place.id, arrival: place.name } : {}) });
  };
  const savePlace = (place: Place) => { onUpdate({ ...trip, places: trip.places.map((item) => item.id === place.id ? place : item) }); setSelected(place); };
  return <main className="app-shell">{tab === "地图" && <><MapCanvas trip={visibleTrip} selected={selected} routeFrom={routeFrom} routeTo={routeTo} routeMode={routeMode} onRoute={receiveRoute} onSelect={setSelected}/><div className="map-top"><button className="back-chip" onClick={onBack}>‹</button><div><span>CITY PIECES · {formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span><h1>{trip.city}</h1></div><button className="avatar">{trip.city.slice(0, 1)}</button></div><div className="map-legend"><button className={!mapCategories.length ? "active" : ""} onClick={() => setMapCategories([])}>全部</button>{(Object.keys(categoryMeta) as Category[]).map((c) => <button key={c} className={mapCategories.includes(c) ? "active" : ""} onClick={() => toggleMapCategory(c)}><i style={{ background: categoryMeta[c].color }}/>{categoryMeta[c].emoji} {c}</button>)}</div>{(routeFrom || routeTo) && <section className="route-planner"><div className="route-points"><button onClick={() => setRouteFrom(null)}><i className="from-dot"/><span>{routeFrom?.name || "请选择起点"}</span></button><button onClick={() => setRouteTo(null)}><i className="to-dot"/><span>{routeTo?.name || "请选择终点"}</span></button><button className="clear-route" onClick={() => { setRouteFrom(null); setRouteTo(null); }}>×</button></div><div className="route-modes">{(Object.keys(modeMeta) as TravelMode[]).map((mode) => <button key={mode} className={routeMode === mode ? "active" : ""} onClick={() => setRouteMode(mode)}>{modeMeta[mode].emoji}<span>{mode}</span></button>)}</div>{routeFrom && routeTo && <div className="route-result"><div><b>{routeSummary ? `${Math.max(1, Math.round(routeSummary.time / 60))}分钟` : "正在查询真实路线…"}</b><span>{routeSummary ? `${routeSummary.distance < 1000 ? `${Math.round(routeSummary.distance)}米` : `${(routeSummary.distance / 1000).toFixed(1)}公里`} · 高德路线` : ""}</span></div><a href={routeUrl} target="_blank" rel="noreferrer">在高德继续导航 ↗</a></div>}</section>}<button className="locate" onClick={() => window.alert("开启定位后，高德地图会回到你的当前位置。")}>⌖</button>{selected && <PlaceSheet place={selected} onSave={savePlace} onSetRoute={setRoutePoint} onEdit={() => { setEditing(selected); setSelected(null); }} onNearby={() => { setNearbyOrigin(selected); setSelected(null); }} onClose={() => setSelected(null)}/>}</>}{tab === "地点" && <PlacesList trip={trip} onSelect={selectPlace}/>} {tab === "行程" && <Itinerary trip={trip} onReorder={reorder}/>} {tab === "设置" && <Settings trip={trip} onBack={onBack} onDelete={onDelete}/>}<button className="add-fab" onClick={() => setAdding(true)} aria-label="添加地点">＋</button><nav className="bottom-nav">{(["地图", "地点", "行程", "设置"] as Tab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); setSelected(null); }}><span>{navIcons[item]}</span><b>{item}</b></button>)}</nav>{adding && <AddPlace city={trip.city} dates={dateRange(trip.startDate, trip.endDate)} onClose={() => setAdding(false)} onAdd={addPlace}/>} {editing && <EditPlace place={editing} dates={dateRange(trip.startDate, trip.endDate)} onSave={savePlace} onClose={() => setEditing(null)}/>} {nearbyOrigin && <NearbyMalls origin={nearbyOrigin} onAdd={addPlace} onClose={() => setNearbyOrigin(null)}/>}</main>;
}

export default function HomePage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = localStorage.getItem(STORE_KEY);
      let saved: Trip[] = [sampleTrip];
      if (raw) { try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed)) saved = parsed.filter(isValidTrip); } catch { localStorage.removeItem(STORE_KEY); } }
      const sharedValue = location.hash.startsWith("#trip=") ? location.hash.slice(6) : "";
      if (sharedValue) {
        try { const shared = decodeTrip(sharedValue); const copy = { ...shared, id: uid("trip") }; setTrips([...saved, copy]); setActiveId(copy.id); history.replaceState(null, "", location.pathname); }
        catch { setTrips(saved); }
      } else setTrips(saved);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { const receive = (event: Event) => { const imported = (event as CustomEvent<Trip>).detail; setTrips((all) => [...all, imported]); setActiveId(imported.id); }; window.addEventListener("citypieces:import", receive); return () => window.removeEventListener("citypieces:import", receive); }, []);
  useEffect(() => { if (loaded) localStorage.setItem(STORE_KEY, JSON.stringify(trips)); }, [trips, loaded]);
  const active = useMemo(() => trips.find((t) => t.id === activeId), [trips, activeId]);
  if (!loaded) return <div className="loading">CITY PIECES</div>;
  if (!active) return <Home trips={trips} onOpen={setActiveId} onCreate={(trip) => { setTrips((all) => [...all, trip]); setActiveId(trip.id); }}/>;
  return <TripApp trip={active} onBack={() => setActiveId(null)} onUpdate={(next) => setTrips((all) => all.map((t) => t.id === next.id ? next : t))} onDelete={() => { setTrips((all) => all.filter((t) => t.id !== active.id)); setActiveId(null); }}/>;
}
