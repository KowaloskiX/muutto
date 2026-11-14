// The search region: Helsinki, Espoo, Vantaa, Kauniainen and the commuter belt (Uusimaa
// municipalities with commuter rail or good road links). Also the commuter-rail stations
// (Fintraffic Digitraffic, keyless, CC BY 4.0) used to estimate public-transport commutes
// from the belt, where trains, not road distance, decide travel time.
import { cached, HOUR } from "@/lib/cache";
import type { LatLng } from "./types";
import { fetchJson, haversineM } from "./util";

export const KUNTA: Record<string, string> = {
  "091": "Helsinki",
  "049": "Espoo",
  "092": "Vantaa",
  "235": "Kauniainen",
  "257": "Kirkkonummi",
  "245": "Kerava",
  "186": "Järvenpää",
  "858": "Tuusula",
  "753": "Sipoo",
  "543": "Nurmijärvi",
  "927": "Vihti",
  "638": "Porvoo",
  "444": "Lohja",
};
export const CORE = new Set(["Helsinki", "Espoo", "Vantaa", "Kauniainen"]);
/** Only offered when within the commute limit (they are far). */
export const FAR = new Set(["Porvoo", "Lohja"]);

/** lat/lng box around the whole region. */
export const BOX = { minLat: 60.0, maxLat: 60.65, minLng: 23.85, maxLng: 25.95 };
export const inBox = (p: LatLng) => p.lat > BOX.minLat && p.lat < BOX.maxLat && p.lng > BOX.minLng && p.lng < BOX.maxLng;

export type RailStation = { name: string; geo: LatLng; code: string };

export async function railStations(): Promise<RailStation[]> {
  const r = await cached("digitraffic-rail", "stations-v2", 24 * HOUR, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await fetchJson<any[]>("https://rata.digitraffic.fi/api/v1/metadata/stations", { timeoutMs: 10_000, headers: { "Digitraffic-User": "muutto-junction-demo", "Accept-Encoding": "gzip" } });
    return d
      .filter((s) => s.passengerTraffic && s.countryCode === "FI" && s.type === "STATION" && inBox({ lat: s.latitude, lng: s.longitude }))
      .map((s) => ({ name: String(s.stationName).replace(/ asema$/, ""), code: s.stationShortCode, geo: { lat: s.latitude, lng: s.longitude } }));
  });
  return r.value;
}

export const RAIL_SOURCE = "https://rata.digitraffic.fi/api/v1/metadata/stations";

const nearestStation = (p: LatLng, st: RailStation[]) => st.map((s) => ({ s, km: haversineM(p, s.geo) / 1000 })).sort((a, b) => a.km - b.km)[0];

/**
 * Public-transport estimate in minutes (NOT a timetable result), the faster of:
 *  - road: road distance at a 22 km/h door-to-door average + 6 min to reach a stop;
 *  - rail: reach the nearest station (4 min/km + 4 min wait), ride at 60 km/h along 1.15 × the
 *    straight line between stations (+5 min on long rides, where a change is likely), then from the station
 *    nearest work (4 min/km). Only used when both stations are within 3 km.
 */
export function transitEstimate(o: LatLng, work: LatLng, roadKm: number | null, st: RailStation[]): { min: number; via?: string } {
  const road = Math.round(6 + ((roadKm ?? (haversineM(o, work) / 1000) * 1.3) / 22) * 60);
  if (!st.length) return { min: road };
  const a = nearestStation(o, st);
  const b = nearestStation(work, st);
  if (!a || !b || a.km > 3 || b.km > 3 || a.s.code === b.s.code) return { min: road };
  const rideKm = (haversineM(a.s.geo, b.s.geo) / 1000) * 1.15;
  const rail = Math.round(a.km * 4 + 4 + rideKm + (rideKm > 25 ? 5 : 0) + b.km * 4);
  return rail < road ? { min: rail, via: `${a.s.name} → ${b.s.name} by train` } : { min: road };
}
