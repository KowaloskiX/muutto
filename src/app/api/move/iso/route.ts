import { NextResponse } from "next/server";

// GET /api/move/iso?lat=&lng= — car isochrones from the workplace that follow the actual road
// network: Valhalla on OpenStreetMap (FOSSGIS public server, keyless). Its limits are 60 min and
// 4 contours per request: ?step=5 (default) returns 5…60 min in three requests for a quick first
// answer; ?step=1 returns every minute, fetching only the 48 minutes not already cached.
// Free-flow road times, no live traffic. Static geography: cached 24 h per point.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALHALLA = "https://valhalla1.openstreetmap.de/isochrone";
const MAX_MIN = 60;
const TTL = 24 * 3600 * 1000;

type Geometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export type IsoResponse = {
  work: { lat: number; lng: number };
  /** Minute spacing of `contours`: 5 (quick first answer) or 1 (every minute up to 60). */
  step: 1 | 5;
  /** One polygon per minute value, lng/lat GeoJSON (coordinates rounded to ~10 m). */
  contours: { min: number; geometry: Geometry }[];
  source: { label: string; url: string; note: string };
  fetchedAt: string;
  tookMs: number;
};

// Per workplace: every contour fetched so far (minute -> geometry), so the 1-minute set reuses
// the 5-minute one. Requests for the same point are serialised to stay polite to the public server.
type Entry = { at: number; byMin: Map<number, Geometry>; queue: Promise<unknown> };
const store = new Map<string, Entry>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const roundGeom = (g: Geometry): Geometry =>
  g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map((ring) => ring.map(([x, y]) => [r4(x), r4(y)])) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map((ring) => ring.map(([x, y]) => [r4(x), r4(y)]))) };

async function request(lat: number, lng: number, times: number[]) {
  const json = JSON.stringify({ locations: [{ lat, lon: lng }], costing: "auto", contours: times.map((time) => ({ time })), polygons: true, denoise: 0.2, generalize: 40 });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(json)}`, { headers: { "User-Agent": "muutto-hackathon-demo" }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as { features?: { properties?: { contour?: number }; geometry: Geometry }[] };
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`Valhalla HTTP ${res.status}`);
  }
}

async function ensure(lat: number, lng: number, mins: number[]): Promise<Map<number, Geometry>> {
  const key = `${lat},${lng}`;
  let e = store.get(key);
  if (!e || Date.now() - e.at > TTL) {
    e = { at: Date.now(), byMin: new Map(), queue: Promise.resolve() };
    store.set(key, e);
  }
  const entry = e;
  const run = entry.queue.then(async () => {
    const missing = mins.filter((m) => !entry.byMin.has(m));
    for (let k = 0; k < missing.length; k += 4) {
      if (k) await sleep(250);
      const d = await request(lat, lng, missing.slice(k, k + 4));
      for (const f of d.features ?? []) {
        const min = Number(f.properties?.contour);
        if (Number.isFinite(min) && (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon")) entry.byMin.set(min, roundGeom(f.geometry));
      }
    }
    return entry.byMin;
  });
  entry.queue = run.catch(() => undefined);
  return run;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.8 || lat > 60.7 || lng < 24.2 || lng > 25.7)
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  const step: 1 | 5 = u.searchParams.get("step") === "1" ? 1 : 5;
  const mins = Array.from({ length: MAX_MIN / step }, (_, i) => (i + 1) * step);
  const t0 = Date.now();
  try {
    const byMin = await ensure(+lat.toFixed(3), +lng.toFixed(3), mins);
    const contours = mins.filter((m) => byMin.has(m)).map((m) => ({ min: m, geometry: byMin.get(m)! }));
    if (!contours.length) throw new Error("no contours returned");
    const data: IsoResponse = {
      work: { lat: +lat.toFixed(3), lng: +lng.toFixed(3) },
      step,
      contours,
      source: { label: "Valhalla, OpenStreetMap", url: "https://valhalla1.openstreetmap.de/", note: "Car, typical free-flow driving along the road network; no live traffic." },
      fetchedAt: new Date().toISOString(),
      tookMs: Date.now() - t0,
    };
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: `Road isochrones unavailable: ${(e as Error).message}` }, { status: 502 });
  }
}
