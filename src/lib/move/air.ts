// Air quality from the Finnish Meteorological Institute open data WFS (keyless, CC BY 4.0):
// stored query urban::observations::airquality::hourly::multipointcoverage, which carries
// HSY's and FMI's urban monitoring stations. One request for the whole capital region per
// run (memoised 5 min); each area uses its nearest station.
// Finnish air quality index (ilmanlaatuindeksi): 1 good, 2 satisfactory, 3 fair, 4 poor, 5 very poor.
import type { Criterion, LatLng } from "./types";
import { fetchText, haversineM } from "./util";
import { BOX } from "./region";

type Station = { name: string; geo: LatLng; fmisid?: string; latestAqi?: number; latestAt?: string; avgAqi24?: number; no2?: number; pm25?: number; pm10?: number; hours: number };

const BASE = "https://opendata.fmi.fi/wfs";
const PARAMS = "AQINDEX_PT1H_avg,NO2_PT1H_avg,PM25_PT1H_avg,PM10_PT1H_avg";
let memo: { at: number; p: Promise<Station[]> } | null = null;

function queryUrl(): string {
  const start = new Date(Date.now() - 24 * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  return `${BASE}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "getFeature",
    storedquery_id: "urban::observations::airquality::hourly::multipointcoverage",
    bbox: `${BOX.minLng},${BOX.minLat},${BOX.maxLng},${BOX.maxLat}`,
    parameters: PARAMS,
    starttime: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
  })}`;
}

async function load(): Promise<Station[]> {
  const xml = await fetchText(queryUrl(), { timeoutMs: 15_000 });
  // Station names and positions.
  const names = new Map<string, { name: string; fmisid?: string }>();
  for (const m of xml.matchAll(/<gml:Point gml:id="point-(\d+)"[^>]*>\s*<gml:name>([^<]+)<\/gml:name>\s*<gml:pos>([\d.]+)\s+([\d.]+)/g)) {
    names.set(`${Number(m[3]).toFixed(4)},${Number(m[4]).toFixed(4)}`, { name: m[2].trim(), fmisid: m[1] });
  }
  const positions = xml.match(/<gmlcov:positions>([\s\S]*?)<\/gmlcov:positions>/)?.[1]?.trim().split(/\n/) ?? [];
  const values = xml.match(/<gml:doubleOrNilReasonTupleList>([\s\S]*?)<\/gml:doubleOrNilReasonTupleList>/)?.[1]?.trim().split(/\n/) ?? [];
  const byStation = new Map<string, { t: number; v: number[] }[]>();
  positions.forEach((row, i) => {
    const [lat, lng, t] = row.trim().split(/\s+/).map(Number);
    const v = (values[i] ?? "").trim().split(/\s+/).map(Number);
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key)!.push({ t, v });
  });
  const out: Station[] = [];
  for (const [key, rows] of byStation) {
    const [lat, lng] = key.split(",").map(Number);
    const meta = names.get(key);
    const valid = rows.filter((r) => Number.isFinite(r.v[0])).sort((a, b) => a.t - b.t);
    const last = valid[valid.length - 1];
    const lastOf = (i: number) => [...rows].reverse().find((r) => Number.isFinite(r.v[i]))?.v[i];
    out.push({
      name: meta?.name ?? key,
      fmisid: meta?.fmisid,
      geo: { lat, lng },
      latestAqi: last?.v[0],
      latestAt: last ? new Date(last.t * 1000).toISOString() : undefined,
      avgAqi24: valid.length ? valid.reduce((s, r) => s + r.v[0], 0) / valid.length : undefined,
      no2: lastOf(1),
      pm25: lastOf(2),
      pm10: lastOf(3),
      hours: valid.length,
    });
  }
  return out.filter((s) => s.latestAqi != null);
}

function stations(): Promise<Station[]> {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.p;
  const p = load();
  memo = { at: Date.now(), p };
  p.catch(() => (memo = null));
  return p;
}

const AQI_LABEL = ["", "Good", "Satisfactory", "Fair", "Poor", "Very poor"];

export async function measureAir(c: LatLng): Promise<Criterion> {
  let list: Station[];
  try {
    list = await stations();
  } catch (e) {
    return { id: "air", label: "Air quality", status: "unknown", value: null, detail: `FMI air-quality service unavailable (${(e as Error).message}).`, sources: [] };
  }
  const near = list.map((s) => ({ s, d: haversineM(c, s.geo) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 10000) return { id: "air", label: "Air quality", status: "unknown", value: null, detail: "No urban air-quality station within 10 km.", sources: [] };
  const { s, d } = near;
  const idx = Math.round(s.avgAqi24 ?? s.latestAqi!);
  const status = idx <= 2 ? "good" : idx === 3 ? "ok" : "poor";
  const km = (d / 1000).toFixed(1);
  const pollutants = [s.no2 != null && `NO₂ ${s.no2.toFixed(1)} µg/m³`, s.pm25 != null && `PM2.5 ${s.pm25.toFixed(1)} µg/m³`, s.pm10 != null && `PM10 ${s.pm10.toFixed(1)} µg/m³`].filter(Boolean).join(", ");
  return {
    id: "air",
    label: "Air quality",
    status,
    value: `${AQI_LABEL[idx] ?? "?"} (AQI ${idx})`,
    detail: `Nearest station ${s.name} (${km} km): 24-h average index ${s.avgAqi24?.toFixed(1)} over ${s.hours} h, latest hour AQI ${s.latestAqi}${pollutants ? `; ${pollutants}` : ""}. A single day's reading, not an annual average.`,
    sources: [
      {
        url: queryUrl(),
        label: "FMI open data (urban air quality)",
        quote: `${s.name}: AQINDEX_PT1H_avg ${s.latestAqi} at ${s.latestAt}`,
        asOf: s.latestAt,
      },
    ],
  };
}
