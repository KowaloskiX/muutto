// Geocoding for any Finnish place (city, municipality, district, station...) via
// OpenStreetMap Nominatim. Usage policy: max 1 request/second, identifying User-Agent,
// cache results. We keep an in-process cache and a serial 1.1 s gate.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "kilpailutus-hackathon-demo";

export type GeoPoint = {
  lat: number;
  lng: number;
  /** Municipality (kunta) the point is in, Finnish name, e.g. "Helsinki" for Kallio. */
  municipality?: string;
  /** Short human label, e.g. "Kallio, Helsinki". */
  label: string;
  source: "nominatim" | "llm" | "default";
};

const cache = new Map<string, Promise<GeoPoint | null>>();
let gate: Promise<void> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialise Nominatim calls: each waits for the previous one plus 1.1 s. */
function slot(): Promise<void> {
  const mine = gate.then(() => undefined);
  gate = mine.then(() => sleep(1100)).then(() => undefined);
  return mine;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function municipalityOf(addr: any): string | undefined {
  // In Finnish OSM data "municipality" is the sub-region (seutukunta) and "village" a
  // village inside a municipality, so only city/town name the kunta itself.
  const m = addr?.city ?? addr?.town;
  return m && !/seutukunta$/i.test(m) ? m : undefined;
}

async function nominatimOnce(q: string): Promise<GeoPoint | null> {
  await slot();
  const url = `${NOMINATIM}?${new URLSearchParams({ format: "json", countrycodes: "fi", limit: "1", addressdetails: "1", "accept-language": "fi", q })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = (await res.json()) as any[];
  const r = rows?.[0];
  if (!r) return null;
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const municipality = municipalityOf(r.address);
  const first = String(r.name || r.display_name || q).split(",")[0].trim();
  const label = municipality && first.toLowerCase() !== municipality.toLowerCase() ? `${first}, ${municipality}` : municipality ?? first;
  return { lat, lng, municipality, label, source: "nominatim" };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function geocode(q: string): Promise<GeoPoint | null> {
  const key = q.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = nominatimOnce(q.trim()).catch(() => null);
  cache.set(key, p);
  // Don't cache transient failures forever.
  p.then((v) => { if (!v) setTimeout(() => cache.delete(key), 60_000); });
  return p;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const flat = (s?: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
// Mainland Finland + Åland, roughly.
const inFinland = (p: { lat: number; lng: number }) => p.lat > 59.4 && p.lat < 70.2 && p.lng > 19 && p.lng < 31.7;

export const DEFAULT_PLACE: GeoPoint = { lat: 60.205, lng: 24.655, municipality: "Espoo", label: "Espoo", source: "default" };

/**
 * Resolve the place a user named. The LLM gives a first guess (most specific place,
 * municipality, lat/lng); Nominatim confirms or corrects it. A Nominatim hit is
 * trusted when it agrees with the LLM's municipality or lies within 40 km of its guess
 * (place names repeat across Finland: there are many "Kallio"s).
 */
export async function resolvePlace(guess: { place: string; municipality: string; lat: number; lng: number }): Promise<GeoPoint | null> {
  const llm = Number.isFinite(guess.lat) && Number.isFinite(guess.lng) && inFinland(guess) ? { lat: guess.lat, lng: guess.lng } : null;
  const muni = guess.municipality.trim();
  const place = guess.place.trim();
  const withMuni = place && muni && !flat(place).includes(flat(muni)) ? `${place}, ${muni}` : "";
  const tries = [...new Set([withMuni, place, muni].filter(Boolean))];
  for (const q of tries) {
    const g = await geocode(q);
    if (!g) continue;
    const agrees = (muni && flat(g.municipality) === flat(muni)) || (llm && distanceKm(llm, g) < 40) || (!llm && !muni);
    if (!agrees) continue;
    if (g.municipality || !muni) return g;
    return { ...g, municipality: muni, label: flat(g.label) === flat(muni) ? muni : `${g.label}, ${muni}` };
  }
  if (llm) {
    const label = guess.place && muni && flat(guess.place) !== flat(muni) ? `${guess.place}, ${muni}` : muni || guess.place;
    return { ...llm, municipality: muni || undefined, label, source: "llm" };
  }
  return null;
}
