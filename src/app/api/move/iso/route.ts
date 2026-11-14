import { NextResponse } from "next/server";

// GET /api/move/iso?lat=&lng= — car isochrones from the workplace that follow the actual road
// network: Valhalla on OpenStreetMap (FOSSGIS public server, keyless). Its limits are 60 min and
// 4 contours per request, so the 5…60 min contours (every 5 min) come from three requests sent one
// after another. Free-flow road times, no live traffic. Static geography: cached 24 h per point.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALHALLA = "https://valhalla1.openstreetmap.de/isochrone";
const STEPS = Array.from({ length: 12 }, (_, i) => (i + 1) * 5);
const TTL = 24 * 3600 * 1000;

type Geometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export type IsoResponse = {
  work: { lat: number; lng: number };
  /** One polygon per minute value (5, 10, … 60), lng/lat GeoJSON. */
  contours: { min: number; geometry: Geometry }[];
  source: { label: string; url: string; note: string };
  fetchedAt: string;
  tookMs: number;
};

const cache = new Map<string, { at: number; data: IsoResponse }>();
const inflight = new Map<string, Promise<IsoResponse>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function build(lat: number, lng: number): Promise<IsoResponse> {
  const t0 = Date.now();
  const contours: IsoResponse["contours"] = [];
  for (let k = 0; k < STEPS.length; k += 4) {
    if (k) await sleep(300);
    const d = await request(lat, lng, STEPS.slice(k, k + 4));
    for (const f of d.features ?? []) {
      const min = Number(f.properties?.contour);
      if (Number.isFinite(min) && (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon")) contours.push({ min, geometry: f.geometry });
    }
  }
  if (!contours.length) throw new Error("no contours returned");
  contours.sort((a, b) => a.min - b.min);
  return {
    work: { lat, lng },
    contours,
    source: { label: "Valhalla, OpenStreetMap", url: "https://valhalla1.openstreetmap.de/", note: "Car, typical free-flow driving along the road network; no live traffic." },
    fetchedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
  };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.8 || lat > 60.7 || lng < 24.2 || lng > 25.7)
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=3600" } });
  let p = inflight.get(key);
  if (!p) {
    p = build(+lat.toFixed(3), +lng.toFixed(3));
    inflight.set(key, p);
  }
  try {
    const data = await p;
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: `Road isochrones unavailable: ${(e as Error).message}` }, { status: 502 });
  } finally {
    inflight.delete(key);
  }
}
