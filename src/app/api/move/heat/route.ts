import { NextResponse } from "next/server";

// GET /api/move/heat?lat=&lng= — car travel time to the workplace for a hex grid around it.
// One OSRM table request per ≤ 99 origins (public keyless demo server, routing on OpenStreetMap),
// sent one after another. Free-flow road times: no live traffic. Points that OSRM has to snap more
// than SNAP_MAX metres to reach a road (sea, large parks) are dropped, not guessed.
// Static geography, so results are kept in memory for 24 h per workplace (rounded to ~100 m).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RADIUS_KM = 22;
const SPACING_KM = 2.2;
const SNAP_MAX = 600; // metres
const BATCH = 99;
const TTL = 24 * 3600 * 1000;
const OSRM = "https://router.project-osrm.org/table/v1/driving";

export type HeatCell = { lat: number; lng: number; min: number };
export type HeatResponse = {
  work: { lat: number; lng: number };
  spacingKm: number;
  cells: HeatCell[];
  /** Grid points dropped because they are off the road network (water etc.) or had no route. */
  dropped: number;
  source: { label: string; url: string; note: string };
  fetchedAt: string;
};

const cache = new Map<string, { at: number; data: HeatResponse }>();
const inflight = new Map<string, Promise<HeatResponse>>();

/** Pointy-top hex grid centres within RADIUS_KM of the workplace. */
function grid(lat: number, lng: number): { lat: number; lng: number }[] {
  const kmLat = 110.574;
  const kmLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const rowH = (SPACING_KM * Math.sqrt(3)) / 2;
  const rows = Math.ceil(RADIUS_KM / rowH);
  const cols = Math.ceil(RADIUS_KM / SPACING_KM) + 1;
  const out: { lat: number; lng: number }[] = [];
  for (let r = -rows; r <= rows; r++) {
    const y = r * rowH;
    const off = Math.abs(r) % 2 ? SPACING_KM / 2 : 0;
    for (let c = -cols; c <= cols; c++) {
      const x = c * SPACING_KM + off;
      if (Math.hypot(x, y) > RADIUS_KM) continue;
      out.push({ lat: +(lat + y / kmLat).toFixed(5), lng: +(lng + x / kmLng).toFixed(5) });
    }
  }
  return out;
}

type OsrmTable = { code: string; message?: string; durations?: (number | null)[][]; sources?: { distance: number }[] };

async function table(work: { lat: number; lng: number }, pts: { lat: number; lng: number }[]): Promise<OsrmTable> {
  const coords = [work, ...pts].map((p) => `${p.lng},${p.lat}`).join(";");
  const sources = pts.map((_, i) => i + 1).join(";");
  const url = `${OSRM}/${coords}?sources=${sources}&destinations=0&annotations=duration`;
  const res = await fetch(url, { headers: { "User-Agent": "muutto-hackathon-demo" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  return (await res.json()) as OsrmTable;
}

async function build(lat: number, lng: number): Promise<HeatResponse> {
  const work = { lat, lng };
  const pts = grid(lat, lng);
  const cells: HeatCell[] = [];
  let dropped = 0;
  for (let i = 0; i < pts.length; i += BATCH) {
    const chunk = pts.slice(i, i + BATCH);
    const t = await table(work, chunk);
    if (t.code !== "Ok" || !t.durations) throw new Error(`OSRM: ${t.message ?? t.code}`);
    chunk.forEach((p, j) => {
      const sec = t.durations![j]?.[0];
      const snap = t.sources?.[j]?.distance ?? Infinity;
      if (sec == null || snap > SNAP_MAX) {
        dropped++;
        return;
      }
      cells.push({ ...p, min: Math.round((sec / 60) * 10) / 10 });
    });
  }
  return {
    work,
    spacingKm: SPACING_KM,
    cells,
    dropped,
    source: { label: "OSRM, OpenStreetMap", url: "https://project-osrm.org/", note: "Car, typical free-flow driving time; no live traffic." },
    fetchedAt: new Date().toISOString(),
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
    p = build(+lat.toFixed(5), +lng.toFixed(5));
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
