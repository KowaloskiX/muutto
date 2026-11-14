import { diskGet, diskSet } from "./reach-disk";

// GET /api/move/heat?lat=&lng=[&scale=region] — car travel time to the workplace on a regular grid:
// ~1 km within 25 km (city), or ~10 km within 260 km (region), for drive-time contours on the move map.
// OSRM table requests (public keyless demo server, routing on OpenStreetMap), ≤ 99 origins each,
// sent one after another with a short pause. Free-flow road times: no live traffic.
// Grid points OSRM has to snap more than SNAP_MAX metres to reach a road (sea, large forest) and
// points outside the disc are null, never guessed. Cached in memory 24 h per workplace (~100 m).

// city: ~1 km grid, 25 km (the commute question). region: ~10 km grid, 260 km (weekend reach:
// how far you get in a few hours). Rural roads are sparse, so the region tolerates a longer snap.
const SCALES = {
  city: { radiusKm: 25, stepKm: 1, snapMax: 500 },
  region: { radiusKm: 260, stepKm: 10, snapMax: 3000 },
} as const;
export type HeatScale = keyof typeof SCALES;
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
  scale: HeatScale;
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

async function build(lat: number, lng: number, scale: HeatScale): Promise<HeatResponse> {
  const { radiusKm: RADIUS_KM, stepKm: STEP_KM, snapMax: SNAP_MAX } = SCALES[scale];
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
    scale,
    stepKm: STEP_KM,
    grid: { lat0, lng0, dLat, dLng, nx, ny, min },
    routed,
    dropped,
    source: { label: "OSRM, OpenStreetMap", url: "https://project-osrm.org/", note: "Car, typical free-flow driving time; no live traffic." },
    fetchedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
  };
}



/** Cached drive-time grid for a workplace (memory, then disk, then OSRM). Shared by the route and the warm-up. */
export async function getHeat(lat: number, lng: number, scale: HeatScale): Promise<HeatResponse> {
  const la = +lat.toFixed(3), ln = +lng.toFixed(3);
  const key = `${scale}:${la},${ln}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const disk = diskGet<HeatResponse>(`heat-${key}`, TTL);
  if (disk) {
    cache.set(key, { at: Date.now(), data: disk });
    return disk;
  }
  let p = inflight.get(key);
  if (!p) {
    p = build(la, ln, scale).then((data) => {
      cache.set(key, { at: Date.now(), data });
      diskSet(`heat-${key}`, data);
      return data;
    });
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return p;
}
