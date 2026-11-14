import { NextResponse } from "next/server";

// GET /api/move/heat?lat=&lng= — car travel time to the workplace on a regular ~1 km grid
// (a 25 km disc around it), for drive-time contours on the move map.
// OSRM table requests (public keyless demo server, routing on OpenStreetMap), ≤ 99 origins each,
// sent one after another with a short pause. Free-flow road times: no live traffic.
// Grid points OSRM has to snap more than SNAP_MAX metres to reach a road (sea, large forest) and
// points outside the disc are null, never guessed. Cached in memory 24 h per workplace (~100 m).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RADIUS_KM = 25;
const STEP_KM = 1;
const SNAP_MAX = 500; // metres
const BATCH = 99;
const PAUSE_MS = 150;
const TTL = 24 * 3600 * 1000;
const OSRM = "https://router.project-osrm.org/table/v1/driving";

export type HeatGrid = {
  /** South-west grid point; rows go north (lat0 + y·dLat), columns go east (lng0 + x·dLng). */
  lat0: number;
  lng0: number;
  dLat: number;
  dLng: number;
  nx: number;
  ny: number;
  /** Car minutes to work, row-major (index = y·nx + x); null = not routable or outside the disc. */
  min: (number | null)[];
};
export type HeatResponse = {
  work: { lat: number; lng: number };
  stepKm: number;
  grid: HeatGrid;
  /** Points routed / points dropped as off the road network. */
  routed: number;
  dropped: number;
  source: { label: string; url: string; note: string };
  fetchedAt: string;
  tookMs: number;
};

const cache = new Map<string, { at: number; data: HeatResponse }>();
const inflight = new Map<string, Promise<HeatResponse>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type OsrmTable = { code: string; message?: string; durations?: (number | null)[][]; sources?: { distance: number }[] };

async function table(work: { lat: number; lng: number }, pts: { lat: number; lng: number }[]): Promise<OsrmTable> {
  const coords = [work, ...pts].map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const sources = pts.map((_, i) => i + 1).join(";");
  const url = `${OSRM}/${coords}?sources=${sources}&destinations=0&annotations=duration`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "muutto-hackathon-demo" }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as OsrmTable;
    // The demo server rate-limits; back off once or twice, then give up.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`OSRM HTTP ${res.status}`);
  }
}

async function build(lat: number, lng: number): Promise<HeatResponse> {
  const t0 = Date.now();
  const work = { lat, lng };
  const dLat = STEP_KM / 110.574;
  const dLng = STEP_KM / (111.32 * Math.cos((lat * Math.PI) / 180));
  const n = Math.ceil(RADIUS_KM / STEP_KM);
  const nx = 2 * n + 1;
  const ny = 2 * n + 1;
  const lat0 = lat - n * dLat;
  const lng0 = lng - n * dLng;
  const min: (number | null)[] = new Array(nx * ny).fill(null);
  const todo: { i: number; lat: number; lng: number }[] = [];
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      if (Math.hypot(x - n, y - n) * STEP_KM > RADIUS_KM) continue;
      todo.push({ i: y * nx + x, lat: lat0 + y * dLat, lng: lng0 + x * dLng });
    }
  let routed = 0;
  let dropped = 0;
  for (let k = 0; k < todo.length; k += BATCH) {
    if (k) await sleep(PAUSE_MS);
    const chunk = todo.slice(k, k + BATCH);
    const t = await table(work, chunk);
    if (t.code !== "Ok" || !t.durations) throw new Error(`OSRM: ${t.message ?? t.code}`);
    chunk.forEach((p, j) => {
      const sec = t.durations![j]?.[0];
      const snap = t.sources?.[j]?.distance ?? Infinity;
      if (sec == null || snap > SNAP_MAX) {
        dropped++;
        return;
      }
      routed++;
      min[p.i] = Math.round((sec / 60) * 10) / 10;
    });
  }
  return {
    work,
    stepKm: STEP_KM,
    grid: { lat0, lng0, dLat, dLng, nx, ny, min },
    routed,
    dropped,
    source: { label: "OSRM, OpenStreetMap", url: "https://project-osrm.org/", note: "Car, typical free-flow driving time; no live traffic." },
    fetchedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
  };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  // The capital region and a margin around it; anything else is not this product's map.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.8 || lat > 60.7 || lng < 24.2 || lng > 25.7)
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data, { headers: { "Cache-Control": "public, max-age=3600" } });
  let p = inflight.get(key);
  if (!p) {
    // Build on the rounded point so every caller in the cache bucket gets the same grid.
    p = build(+lat.toFixed(3), +lng.toFixed(3));
    inflight.set(key, p);
  }
  try {
    const data = await p;
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: `Drive-time grid unavailable: ${(e as Error).message}` }, { status: 502 });
  } finally {
    inflight.delete(key);
  }
}
