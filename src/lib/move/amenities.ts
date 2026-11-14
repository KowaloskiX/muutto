// Everyday services around an area centre.
//  1. OpenStreetMap via Overpass (ODbL): ONE batched query per area for pharmacy, grocery,
//     cafés, schools/kindergartens, parks and transit stops. Mirrors tried in turn; the public
//     servers are often at capacity, so each try is short.
//  2. City of Helsinki Service Map API (api.hel.fi/servicemap, covers Helsinki, Espoo, Vantaa
//     and Kauniainen; CC BY 4.0): public schools, daycare and playgrounds/sports parks. Used
//     for schools/daycare always (it is the authoritative municipal register) and for parks
//     if Overpass failed.
//  3. If Overpass failed: Exa Places for pharmacy / grocery / cafés (cited per place), and
//     Fintraffic Digitraffic rail stations (keyless) for the nearest train station.
import { cacheGet, cacheSet, HOUR } from "@/lib/cache";
import type { Criterion, LatLng, Place, Source, Status } from "./types";
import { BOX, RAIL_SOURCE, railStations } from "./region";
import { fetchJson, fmtM, haversineM, limiter, today, withTimeout } from "./util";

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

type Poi = { kind: Place["kind"]; name: string; geo: LatLng; distanceM: number; url?: string; sub?: string };
type RegionPoi = Omit<Poi, "distanceM">;

/* eslint-disable @typescript-eslint/no-explicit-any */
// ONE regional Overpass query for the whole capital region (pharmacies, cafés, groceries, parks,
// rail/metro/tram stops; ~1.5 MB, ~30 s when the public servers are healthy) instead of a query
// per area: far kinder to the shared servers, which are often at capacity. OSM POIs change
// slowly, so the result is reused for up to 24 h; every run tries to refresh it in the background.
const REGION_BBOX = `${BOX.minLat},${BOX.minLng},${BOX.maxLat},${BOX.maxLng}`;
const REGION_Q = `[out:json][timeout:120];(
nwr["amenity"~"^(pharmacy|cafe|school|kindergarten)$"](${REGION_BBOX});
nwr["shop"~"^(supermarket|convenience)$"](${REGION_BBOX});
way["leisure"="park"](${REGION_BBOX});
node["railway"~"^(station|halt|tram_stop)$"](${REGION_BBOX});
);out center tags qt;`;

function toPoi(e: any): RegionPoi | null {
  const t = e.tags ?? {};
  const geo = e.type === "node" ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : null;
  if (!geo) return null;
  const kind: Place["kind"] | null =
    t.amenity === "pharmacy" ? "pharmacy"
    : t.shop === "supermarket" || t.shop === "convenience" ? "grocery"
    : t.amenity === "cafe" ? "cafe"
    : t.amenity === "school" ? "school"
    : t.amenity === "kindergarten" ? "daycare"
    : t.leisure === "park" ? "park"
    : t.railway ? "transit"
    : null;
  if (!kind) return null;
  const sub = t.railway ? (t.station === "subway" || t.subway === "yes" ? "metro" : t.railway === "tram_stop" ? "tram" : "train") : t.shop;
  return { kind, sub, name: t.name || t.brand || (kind === "transit" ? `${sub} stop` : kind), geo, url: `https://www.openstreetmap.org/${e.type}/${e.id}` };
}

async function fetchRegion(): Promise<RegionPoi[]> {
  let last: unknown;
  for (const url of OVERPASS) {
    try {
      const d = await fetchJson<any>(url, { method: "POST", timeoutMs: 100_000, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(REGION_Q)}` });
      const pois = (d.elements ?? []).map(toPoi).filter(Boolean) as RegionPoi[];
      if (pois.length > 500) return pois;
      last = new Error("Overpass returned too few elements");
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("Overpass unavailable");
}

const g = globalThis as unknown as { __movePois?: { at: number; p: Promise<{ pois: RegionPoi[]; at: number }> } };
/** Regional POIs: cached (≤24 h) or an in-flight refresh. Starts the fetch if none is running. */
export function regionPois(): Promise<{ pois: RegionPoi[]; at: number }> {
  const hit = cacheGet<RegionPoi[]>("osm-pois", "region-v2", 24 * HOUR);
  if (hit && hit.ageMs < 6 * HOUR) return Promise.resolve({ pois: hit.value, at: hit.at });
  const cur = g.__movePois;
  if (!cur || Date.now() - cur.at > 150_000) {
    const p = fetchRegion().then((pois) => {
      cacheSet("osm-pois", "region-v2", pois);
      return { pois, at: Date.now() };
    });
    p.catch(() => undefined);
    g.__movePois = { at: Date.now(), p };
  }
  // A stale-but-valid copy beats waiting for a busy server.
  if (hit) return Promise.resolve({ pois: hit.value, at: hit.at });
  return g.__movePois!.p;
}

async function overpass(c: LatLng): Promise<{ pois: Poi[]; at: number }> {
  const r = await regionPois();
  const pois: Poi[] = [];
  for (const p of r.pois) {
    const lim = p.kind === "cafe" ? 800 : p.kind === "park" ? 1000 : p.kind === "grocery" ? 1200 : 1500;
    if (Math.abs(p.geo.lat - c.lat) > 0.015 || Math.abs(p.geo.lng - c.lng) > 0.03) continue;
    const d = Math.round(haversineM(c, p.geo));
    if (d <= lim) pois.push({ ...p, distanceM: d });
  }
  return { pois, at: r.at };
}

// ---- City Service Map (palvelukartta) ---------------------------------------
const SERVICEMAP = "https://api.hel.fi/servicemap/v2/unit/";
const SM_SCHOOL = "661,601,662,602"; // Finnish/Swedish basic education grades 1–6 and 7–9
const SM_DAYCARE = "663,603"; // Finnish/Swedish municipal daycare
const SM_PHARMACY = "57"; // pharmacies
const SM_PARK = "389,401,475,733"; // playgrounds, sports parks, playparks, outdoor areas
const smGate = limiter(4);

async function serviceMap(c: LatLng, services: string, kind: Place["kind"], radius: number): Promise<Poi[]> {
  const url = `${SERVICEMAP}?${new URLSearchParams({ lat: String(c.lat), lon: String(c.lng), distance: String(radius), service: services, page_size: "20", only: "name,location", format: "json" })}`;
  const d = await smGate(() => fetchJson<any>(url, { timeoutMs: 8_000 }));
  return (d.results ?? [])
    .filter((u: any) => u.location?.coordinates)
    .map((u: any) => {
      const geo = { lat: u.location.coordinates[1], lng: u.location.coordinates[0] };
      return { kind, name: u.name?.fi || u.name?.en || u.name?.sv || kind, geo, distanceM: Math.round(haversineM(c, geo)), url: `https://palvelukartta.hel.fi/fi/unit/${u.id}` } as Poi;
    });
}

// ---- Photon fallback (OpenStreetMap data via photon.komoot.io, keyless) -----------
// Photon is a text geocoder, so it only finds POIs whose name matches the query word. Finnish
// pharmacies are almost all named "... apteekki", and supermarkets carry chain names, so it
// works for those two; cafés are not reliably findable this way and stay unknown.
const photonGate = limiter(2);
async function photon(c: LatLng, words: string[], tag: string, kind: Poi["kind"], radiusM: number): Promise<Poi[]> {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  const bbox = [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat].map((x) => x.toFixed(5)).join(",");
  const out = new Map<string, Poi>();
  let answered = 0;
  for (const q of words) {
    const d = await photonGate(async () => {
      return fetchJson<any>(`https://photon.komoot.io/api/?${new URLSearchParams({ q, osm_tag: tag, limit: "50", bbox })}`, { timeoutMs: 5_000 });
    }).catch(() => null);
    if (d) answered++;
    for (const f of d?.features ?? []) {
      const pr = f.properties ?? {};
      const geo = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      const t = pr.osm_type === "N" ? "node" : pr.osm_type === "W" ? "way" : "relation";
      out.set(`${t}/${pr.osm_id}`, { kind, name: pr.name ?? kind, geo, distanceM: Math.round(haversineM(c, geo)), url: `https://www.openstreetmap.org/${t}/${pr.osm_id}` });
    }
  }
  if (!answered) throw new Error("Photon unavailable");
  return [...out.values()];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- Criteria -------------------------------------------------------------------
const band = (d: number | undefined, good: number, ok: number): Status => (d == null ? "unknown" : d <= good ? "good" : d <= ok ? "ok" : "poor");
const nearest = (ps: Poi[], kind: Poi["kind"], filter?: (p: Poi) => boolean) => ps.filter((p) => p.kind === kind && (!filter || filter(p))).sort((a, b) => a.distanceM - b.distanceM)[0];

function poiSource(p: Poi, label: string): Source {
  return { url: p.url ?? `https://www.openstreetmap.org/?mlat=${p.geo.lat}&mlon=${p.geo.lng}`, label, quote: `${p.name} — ${fmtM(p.distanceM)} from the area centre`, asOf: today() };
}

export type AmenityResult = { criteria: Criterion[]; places: Place[]; notes: string[] };

export async function measureAmenities(c: LatLng, opts: { hasKids: boolean }): Promise<AmenityResult> {
  const notes: string[] = [];
  let smPharmacies: Poi[] = [];
  const [osm, schools, daycares] = await Promise.all([
    withTimeout(overpass(c), 9_000, "still loading").catch((e) => (notes.push(`OpenStreetMap Overpass unavailable (${(e as Error).message}); using fallbacks`), null)),
    withTimeout(serviceMap(c, SM_SCHOOL, "school", 2500), 9_000).catch(() => null),
    withTimeout(serviceMap(c, SM_DAYCARE, "daycare", 2000), 9_000).catch(() => null),
    // Pharmacies are also in the municipal register; OSM misses some (e.g. inside shopping centres).
    withTimeout(serviceMap(c, SM_PHARMACY, "pharmacy", 1500), 9_000).catch(() => null),
  ]).then(([o, s, d, ph]) => {
    smPharmacies = (ph ?? []).map((p) => ({ ...p, sub: "servicemap" }));
    return [o, s, d] as const;
  });
  const osmLabel = "OpenStreetMap";
  let pois: Poi[] = osm?.pois ?? [];
  let fallbackLabel: Partial<Record<Poi["kind"], string>> = {};
  if (!osm) {
    const box = <T,>(p: Promise<T[]>) => withTimeout(p, 8_000).catch(() => null);
    const [ph, gr, cf, parks, rail] = await Promise.all([
      box(photon(c, ["apteekki"], "amenity:pharmacy", "pharmacy", 1500)),
      box(photon(c, ["market", "alepa"], "shop:supermarket", "grocery", 1200)),
      Promise.resolve([] as Poi[]),
      box(serviceMap(c, SM_PARK, "park", 1500)),
      railStations()
        .then((s) => s.map((x) => ({ kind: "transit" as const, sub: "train", name: `${x.name} station`, geo: x.geo, distanceM: Math.round(haversineM(c, x.geo)), url: RAIL_SOURCE })).filter((x) => x.distanceM < 3000))
        .catch(() => []),
    ]);
    pois = [...(ph ?? []), ...(gr ?? []), ...cf, ...(parks ?? []), ...rail];
    fallbackLabel = { park: "Helsinki region Service Map", transit: "Digitraffic rail stations" };
    if (ph) fallbackLabel.pharmacy = "OpenStreetMap (Photon)";
    if (gr) fallbackLabel.grocery = "OpenStreetMap (Photon)";
  }
  // Municipal register for schools/daycare (more complete than OSM for public schools).
  const civic = [...(schools ?? []), ...(daycares ?? [])];
  pois = [...pois.filter((p) => !(civic.length && (p.kind === "school" || p.kind === "daycare"))), ...civic];
  const civicLabel = civic.length ? "Helsinki region Service Map" : osmLabel;
  const labelFor = (k: Poi["kind"]) => (k === "school" || k === "daycare" ? civicLabel : fallbackLabel[k] ?? osmLabel);

  const criteria: Criterion[] = [];
  const unknown = (id: Criterion["id"], label: string, what: string): Criterion => ({ id, label, status: "unknown", value: null, detail: `${what}: source unavailable right now.`, sources: [] });
  const haveFor = (k: Poi["kind"]) => (k === "school" || k === "daycare" ? civic.length > 0 || !!osm : !!osm || k in fallbackLabel);

  // Pharmacy (OSM + municipal register, nearest wins)
  {
    const p = nearest([...pois, ...smPharmacies], "pharmacy");
    if (p) criteria.push({ id: "pharmacy", label: "Nearest pharmacy", status: band(p.distanceM, 500, 1200), value: fmtM(p.distanceM), detail: `${p.name} is ${fmtM(p.distanceM)} from the area centre (straight line).`, sources: [poiSource(p, p.sub === "servicemap" ? "Helsinki region Service Map" : labelFor("pharmacy"))] });
    else if (haveFor("pharmacy")) criteria.push({ id: "pharmacy", label: "Nearest pharmacy", status: osm ? "poor" : "unknown", value: osm ? "> 1.5 km" : null, detail: osm ? "No pharmacy within 1.5 km of the area centre in OpenStreetMap or the Helsinki region Service Map." : "No pharmacy named “apteekki” found within 1.5 km via Photon (Overpass unavailable, so this search is name-based).", sources: [] });
    else criteria.push(unknown("pharmacy", "Nearest pharmacy", "Pharmacies"));
  }
  // Grocery
  {
    const p = nearest(pois, "grocery", (x) => x.sub !== "convenience") ?? nearest(pois, "grocery");
    if (p) criteria.push({ id: "grocery", label: "Nearest grocery", status: band(p.distanceM, 400, 1000), value: fmtM(p.distanceM), detail: `${p.name} is ${fmtM(p.distanceM)} from the area centre.`, sources: [poiSource(p, labelFor("grocery"))] });
    else criteria.push(osm ? { id: "grocery", label: "Nearest grocery", status: "poor", value: "> 1.2 km", detail: "No supermarket or convenience store mapped within 1.2 km.", sources: [] } : unknown("grocery", "Nearest grocery", "Grocery stores"));
  }
  // Cafés
  {
    const cafes = pois.filter((p) => p.kind === "cafe");
    const within = cafes.filter((p) => p.distanceM <= 500);
    if (osm) {
      const n = within.length;
      criteria.push({
        id: "cafe",
        label: "Cafés within 500 m",
        status: n >= 5 ? "good" : n >= 1 ? "ok" : "poor",
        value: `${n} café${n === 1 ? "" : "s"}`,
        detail: n ? `${n} cafés mapped within 500 m; nearest: ${within.sort((a, b) => a.distanceM - b.distanceM)[0].name}.` : `No café mapped within 500 m${cafes.length ? `; nearest ${fmtM(Math.min(...cafes.map((x) => x.distanceM)))}` : ""}.`,
        sources: within.slice(0, 3).map((p) => poiSource(p, osmLabel)),
      });
    } else criteria.push(unknown("cafe", "Cafés within 500 m", "Café count (OpenStreetMap Overpass busy)"));
  }
  // School / daycare
  {
    const s = nearest(pois, "school");
    const d = nearest(pois, "daycare");
    if (s || d) {
      const st = opts.hasKids ? band(Math.min(s?.distanceM ?? Infinity, d?.distanceM ?? Infinity), 700, 1500) : band(s?.distanceM ?? d?.distanceM, 800, 1800);
      const parts = [s && `school ${fmtM(s.distanceM)}`, d && `daycare ${fmtM(d.distanceM)}`].filter(Boolean).join(" · ");
      criteria.push({
        id: "school",
        label: opts.hasKids ? "School & daycare" : "Nearest school",
        status: st,
        value: parts,
        detail: [s && `${s.name} (${fmtM(s.distanceM)})`, d && `${d.name} (${fmtM(d.distanceM)})`].filter(Boolean).join("; ") + ".",
        sources: [s, d].filter(Boolean).map((p) => poiSource(p!, labelFor(p!.kind))),
      });
    } else criteria.push(civic.length || osm ? { id: "school", label: "Nearest school", status: "poor", value: "> 2 km", detail: "No public school or daycare listed within 2 km.", sources: [] } : unknown("school", "Nearest school", "Schools"));
  }
  // Park
  {
    const p = nearest(pois, "park");
    if (p) criteria.push({ id: "park", label: osm ? "Nearest park" : "Nearest park / playground", status: band(p.distanceM, 300, 800), value: fmtM(p.distanceM), detail: `${p.name} (${osm ? "park centre" : "playground or sports park"}) is ${fmtM(p.distanceM)} away.`, sources: [poiSource(p, labelFor("park"))] });
    else criteria.push(osm ? { id: "park", label: "Nearest park", status: "poor", value: "> 1 km", detail: "No park mapped within 1 km.", sources: [] } : unknown("park", "Nearest park", "Parks"));
  }
  // Transit stops (the commute criterion carries the travel time)
  {
    const rail = nearest(pois, "transit", (x) => x.sub === "metro" || x.sub === "train");
    const tram = nearest(pois, "transit", (x) => x.sub === "tram");
    if (osm) {
      const best = [rail, tram].filter(Boolean).sort((a, b) => a!.distanceM - b!.distanceM)[0];
      const st: Status = rail && rail.distanceM <= 800 ? "good" : (tram && tram.distanceM <= 400) || (rail && rail.distanceM <= 1500) ? "ok" : "poor";
      criteria.push({
        id: "transit",
        label: "Rail / metro / tram stop",
        status: st,
        value: best ? `${best.sub} ${fmtM(best.distanceM)}` : "none ≤ 1.5 km",
        detail: best
          ? [rail && `${rail.name} (${rail.sub}) ${fmtM(rail.distanceM)}`, tram && `${tram.name} (tram) ${fmtM(tram.distanceM)}`].filter(Boolean).join("; ") + ". Bus stops not counted."
          : "No train, metro or tram stop mapped within 1.5 km (bus stops not counted).",
        sources: [rail, tram].filter(Boolean).map((p) => poiSource(p!, osmLabel)),
      });
    } else if (rail) {
      criteria.push({ id: "transit", label: "Nearest train station", status: band(rail.distanceM, 800, 1500), value: `train ${fmtM(rail.distanceM)}`, detail: `${rail.name} is ${fmtM(rail.distanceM)} away. Metro, tram and bus stops not checked (OpenStreetMap unavailable).`, sources: [{ url: "https://rata.digitraffic.fi/api/v1/metadata/stations", label: "Fintraffic Digitraffic (rail stations)", quote: `${rail.name}: ${rail.geo.lat.toFixed(4)}, ${rail.geo.lng.toFixed(4)}` }] });
    } else criteria.push(unknown("transit", "Rail / metro / tram stop", "Transit stops (no train station within 3 km; metro/tram/bus not checked)"));
  }

  const places: Place[] = [];
  for (const kind of ["pharmacy", "grocery", "cafe", "school", "daycare", "park", "transit"] as const) {
    pois
      .filter((p) => p.kind === kind)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, kind === "cafe" ? 5 : kind === "transit" ? 3 : 2)
      .forEach((p) => places.push({ name: p.name, kind, geo: p.geo, distanceM: p.distanceM, url: p.url }));
  }
  return { criteria, places, notes };
}
