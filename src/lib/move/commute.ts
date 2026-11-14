// Commute from an area (or listing) to the workplace.
//  - Car: OSRM over OpenStreetMap (public demo router.project-osrm.org; FOSSGIS mirror as
//    fallback). No traffic: "typical free-flow" time.
//  - Bike / walk: FOSSGIS OSRM bike and foot profiles (routing.openstreetmap.de).
//  - Public transport: Digitransit HSL journey planner when DIGITRANSIT_KEY is set (weekday
//    08:30 arrival). Without a key we give a clearly flagged distance-based estimate.
//  - Rush hour: Fintraffic Digitraffic road sensors (TMS/LAM, keyless, CC BY 4.0) publish
//    live speed as % of free-flow per direction. We read the stations on the car route.
//    That is a *live* reading, so carRushMin is only filled when the run happens during the
//    weekday morning rush (07:00–09:30 Helsinki time); otherwise null.
import { cached, HOUR } from "@/lib/cache";
import type { Commute, LatLng, Source } from "./types";
import { fetchJson, haversineM, helsinkiParts, limiter, nextWeekdayAt, withTimeout } from "./util";
import { inBox, railStations, RAIL_SOURCE, transitEstimate } from "./region";

const OSRM_CAR = ["https://router.project-osrm.org/table/v1/driving", "https://routing.openstreetmap.de/routed-car/table/v1/driving"];
const OSRM_BIKE = "https://routing.openstreetmap.de/routed-bike/table/v1/driving";
const OSRM_FOOT = "https://routing.openstreetmap.de/routed-foot/table/v1/driving";
const osrmGate = limiter(3);
// The FOSSGIS servers answer 429 to bursts: one request at a time, spaced, one retry.
const fossgisGate = limiter(1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ll = (p: LatLng) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

type Table = { min: (number | null)[]; km: (number | null)[] };

/** Durations from every origin to `dest` in one OSRM table request. */
async function osrmTable(base: string, origins: LatLng[], dest: LatLng): Promise<Table> {
  const coords = [dest, ...origins].map(ll).join(";");
  const sources = origins.map((_, i) => i + 1).join(";");
  const url = `${base}/${coords}?sources=${sources}&destinations=0&annotations=duration,distance`;
  const once = () => fetchJson<any>(url, { timeoutMs: 12_000 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = base.includes("openstreetmap.de")
    ? await fossgisGate(async () => {
        try {
          return await once();
        } catch (e) {
          if (!/429|5\d\d/.test((e as Error).message)) throw e;
          await sleep(1500);
          return once();
        } finally {
          await sleep(350);
        }
      })
    : await osrmGate(once);
  if (d.code !== "Ok") throw new Error(`OSRM ${d.code}`);
  return {
    min: origins.map((_, i) => (d.durations?.[i]?.[0] != null ? Math.round(d.durations[i][0] / 60) : null)),
    km: origins.map((_, i) => (d.distances?.[i]?.[0] != null ? d.distances[i][0] / 1000 : null)),
  };
}

async function carTable(origins: LatLng[], dest: LatLng): Promise<Table & { base: string }> {
  let last: unknown;
  for (const base of OSRM_CAR) {
    try {
      return { ...(await osrmTable(base, origins, dest)), base };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const directions = (engine: string, a: LatLng, b: LatLng) =>
  `https://www.openstreetmap.org/directions?engine=${engine}&route=${a.lat.toFixed(5)}%2C${a.lng.toFixed(5)}%3B${b.lat.toFixed(5)}%2C${b.lng.toFixed(5)}`;

// ---- Digitransit (only with a key) ------------------------------------------
const DIGITRANSIT = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const digiGate = limiter(4);

async function digitransitMin(from: LatLng, to: LatLng, arriveBy: string): Promise<{ min: number; legs: string } | null> {
  const key = process.env.DIGITRANSIT_KEY;
  if (!key) return null;
  const query = `query($o: PlanCoordinateInput!, $d: PlanCoordinateInput!, $t: OffsetDateTime!) {
    planConnection(origin: {location: {coordinate: $o}}, destination: {location: {coordinate: $d}}, dateTime: {latestArrival: $t}, first: 3) {
      edges { node { duration legs { mode route { shortName } } } }
    }
  }`;
  const d = await digiGate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>(DIGITRANSIT, {
      method: "POST",
      timeoutMs: 10_000,
      headers: { "Content-Type": "application/json", "digitransit-subscription-key": key },
      body: JSON.stringify({ query, variables: { o: { latitude: from.lat, longitude: from.lng }, d: { latitude: to.lat, longitude: to.lng }, t: arriveBy } }),
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = (d?.data?.planConnection?.edges ?? []).map((e: any) => e.node).filter((n: any) => typeof n?.duration === "number");
  if (!nodes.length) return null;
  const best = nodes.sort((a, b) => a.duration - b.duration)[0];
  const legs = (best.legs ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.mode !== "WALK")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l: any) => `${String(l.mode).toLowerCase()}${l.route?.shortName ? ` ${l.route.shortName}` : ""}`)
    .join(" → ");
  return { min: Math.round(best.duration / 60), legs: legs || "walk" };
}

// ---- Digitraffic TMS (rush-hour signal) -------------------------------------
const TMS_HEADERS = { "Digitraffic-User": "muutto-junction-demo", "Accept-Encoding": "gzip" };
type TmsStation = { id: number; name: string; lat: number; lng: number };

async function tmsStations(): Promise<TmsStation[]> {
  const r = await cached("digitraffic-tms", "stations-v1", 24 * HOUR, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await fetchJson<any>("https://tie.digitraffic.fi/api/tms/v1/stations", { timeoutMs: 12_000, headers: TMS_HEADERS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (d.features ?? []).map((f: any) => ({ id: f.id, name: f.properties?.name ?? String(f.id), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  });
  // Capital region bbox only.
  return r.value.filter((s: TmsStation) => inBox(s));
}

type TmsReading = { id: number; pctFreeFlow: number[]; measuredAt?: string };
let tmsMemo: { at: number; p: Promise<Map<number, TmsReading>> } | null = null;

/** Live sensor data for all stations, memoised 60 s (one 3 MB gzip download per run). */
function tmsData(): Promise<Map<number, TmsReading>> {
  if (tmsMemo && Date.now() - tmsMemo.at < 60_000) return tmsMemo.p;
  const p = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await fetchJson<any>("https://tie.digitraffic.fi/api/tms/v1/stations/data", { timeoutMs: 15_000, headers: TMS_HEADERS });
    const m = new Map<number, TmsReading>();
    for (const s of d.stations ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (s.sensorValues ?? []).filter((x: any) => /^KESKINOPEUS_5MIN_LIUKUVA_SUUNTA\d_VVAPAAS\d$/.test(x.name) && typeof x.value === "number" && x.value > 0);
      if (v.length) m.set(s.id, { id: s.id, pctFreeFlow: v.map((x: { value: number }) => x.value), measuredAt: v[0].measuredTime });
    }
    return m;
  })();
  tmsMemo = { at: Date.now(), p };
  p.catch(() => (tmsMemo = null));
  return p;
}

/** OSRM car route geometry (simplified) from `from` to `to`. */
async function carRoute(from: LatLng, to: LatLng): Promise<LatLng[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await osrmGate(() => fetchJson<any>(`https://router.project-osrm.org/route/v1/driving/${ll(from)};${ll(to)}?overview=simplified&geometries=geojson`, { timeoutMs: 10_000 }));
  return (d.routes?.[0]?.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ lat, lng }));
}

export type RouteTraffic = { stations: number; pctFreeFlow: number; measuredAt?: string; names: string[] };

/** Live speed (% of free flow, slower direction) at TMS stations within 150 m of the car route. */
export async function routeTraffic(from: LatLng, to: LatLng): Promise<RouteTraffic | null> {
  const [route, stations, data] = await Promise.all([carRoute(from, to), tmsStations(), tmsData()]);
  if (route.length < 2) return null;
  // Densify the simplified polyline to ~100 m steps so the 150 m buffer test is fair.
  const pts: LatLng[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const steps = Math.max(1, Math.ceil(haversineM(a, b) / 100));
    for (let k = 0; k < steps; k++) pts.push({ lat: a.lat + ((b.lat - a.lat) * k) / steps, lng: a.lng + ((b.lng - a.lng) * k) / steps });
  }
  const near = stations.filter((s) => pts.some((p) => haversineM(p, s) < 150));
  const readings = near.map((s) => ({ s, r: data.get(s.id) })).filter((x) => x.r);
  if (!readings.length) return null;
  const pcts = readings.map((x) => Math.min(...x.r!.pctFreeFlow));
  const pct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  return { stations: readings.length, pctFreeFlow: Math.min(pct, 100), measuredAt: readings[0].r!.measuredAt, names: readings.map((x) => x.s.name).slice(0, 4) };
}

/** Walking times only (slow server): run in the background while areas are measured. */
export async function walkTimes(origins: LatLng[], work: LatLng): Promise<{ min: (number | null)[]; sources: (Source | null)[] }> {
  const t = await osrmTable(OSRM_FOOT, origins, work);
  return { min: t.min, sources: origins.map((o, i) => (t.min[i] != null ? { url: directions("fossgis_osrm_foot", o, work), label: "OSRM · OpenStreetMap (walk)", quote: `${t.min[i]} min on foot` } : null)) };
}

export const isMorningRush = () => {
  const p = helsinkiParts();
  const t = p.hour * 60 + p.minute;
  return p.weekday !== "Sat" && p.weekday !== "Sun" && t >= 7 * 60 && t <= 9 * 60 + 30;
};

// ---- Public API -------------------------------------------------------------
export type BatchCommute = { commutes: Commute[]; carKm: (number | null)[]; failures: string[] };

/** Car/bike/walk for many origins at once (3 OSRM table calls), plus transit per origin. */
export async function batchCommute(origins: LatLng[], work: LatLng, opts: { walk?: boolean } = {}): Promise<BatchCommute> {
  const failures: string[] = [];
  const [car, bike, foot] = await Promise.all([
    carTable(origins, work).catch((e) => (failures.push(`car routing: ${(e as Error).message}`), null)),
    osrmTable(OSRM_BIKE, origins, work).catch((e) => (failures.push(`bike routing: ${(e as Error).message}`), null)),
    // The foot server is sometimes slow (10 s measured); walking time is the least decisive mode.
    opts.walk === false ? Promise.resolve(null) : withTimeout(osrmTable(OSRM_FOOT, origins, work), 5_000, "timeout").catch((e) => (failures.push(`walk routing: ${(e as Error).message}`), null)),
  ]);
  const arriveBy = nextWeekdayAt(8, 30);
  const hasKey = !!process.env.DIGITRANSIT_KEY;
  const stations = await railStations().catch(() => []);
  const transit = hasKey
    ? await Promise.all(origins.map((o) => digitransitMin(o, work, arriveBy).catch(() => null)))
    : origins.map(() => null);
  if (hasKey && transit.every((t) => t == null)) failures.push("Digitransit returned no itineraries");

  const commutes = origins.map((o, i): Commute => {
    const sources: Source[] = [];
    const carMin = car?.min[i] ?? null;
    const bikeMin = bike?.min[i] ?? null;
    const walkMin = foot?.min[i] ?? null;
    const carKm = car?.km[i] ?? null;
    if (carMin != null)
      sources.push({ url: directions("fossgis_osrm_car", o, work), label: "OSRM · OpenStreetMap (car, no traffic)", quote: `${carMin} min, ${carKm?.toFixed(1)} km by road` });
    if (bikeMin != null) sources.push({ url: directions("fossgis_osrm_bike", o, work), label: "OSRM · OpenStreetMap (bike)", quote: `${bikeMin} min by bike` });
    if (walkMin != null) sources.push({ url: directions("fossgis_osrm_foot", o, work), label: "OSRM · OpenStreetMap (walk)", quote: `${walkMin} min on foot` });
    let transitMin: number | null = null;
    let estimate = false;
    const t = transit[i];
    if (t) {
      transitMin = t.min;
      sources.push({
        url: `https://reittiopas.hsl.fi/reitti/${encodeURIComponent(`::${o.lat},${o.lng}`)}/${encodeURIComponent(`::${work.lat},${work.lng}`)}`,
        label: "Digitransit (HSL journey planner)",
        quote: `${t.min} min door to door, arriving by ${arriveBy.slice(11, 16)} on ${arriveBy.slice(0, 10)}: ${t.legs}`,
        asOf: arriveBy.slice(0, 10),
      });
    } else {
      // Honest fallback, flagged as an estimate (see transitEstimate).
      const est = transitEstimate(o, work, carKm, stations);
      transitMin = est.min;
      estimate = true;
      if (est.via) sources.push({ url: RAIL_SOURCE, label: "Digitraffic rail stations (estimate)", quote: `Estimate via ${est.via}` });
    }
    return { transitMin, carMin, carRushMin: null, bikeMin, walkMin, sources, estimate };
  });
  return { commutes, carKm: car?.km ?? origins.map(() => null), failures };
}

export const TRANSIT_ESTIMATE_NOTE =
  "Public-transport time is an estimate, not a timetable result (no Digitransit key is configured): the faster of road distance at 22 km/h + 6 min, or a commuter-rail estimate (walk to the nearest station, train at 60 km/h, walk from the station nearest work).";
