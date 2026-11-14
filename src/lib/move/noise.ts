// Traffic noise at an area, from official noise surveys queried point-by-point (WFS + CQL
// INTERSECTS, keyless):
//  - Helsinki: City of Helsinki noise survey 2022, streets + highways and railways, daytime LAeq 7–22
//    (kartta.hel.fi avoindata, CC BY 4.0). Full street coverage: no polygon = below 45 dB.
//  - Espoo / Vantaa / Kauniainen: Finnish Transport Infrastructure Agency (Väylävirasto) EU
//    noise-directive maps 2022 for state roads and railways, daytime LAeq (CC BY 4.0). City
//    streets are NOT covered there, so a quiet reading is reported as "no major-road noise".
// We sample 5 points (centre + 4 × 300 m) and report the median and the loudest band.
import type { Criterion, LatLng, Source } from "./types";
import { fetchJson, limiter, offset } from "./util";

const HEL = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const VAYLA = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows";
const gate = limiter(6);

type Layer = { url: string; type: string; label: string; field: "db_lo" | "melu_db"; metric: string };
// Daytime LAeq 7–22 everywhere, so Helsinki and the rest of the region share one measure and one scale.
const HEL_ROAD: Layer = { url: HEL, type: "avoindata:Meluselvitys_2022_Helsinki_kadut_ja_maantiet_LAeq_7-22_NPM", label: "City of Helsinki noise survey 2022 (streets, day LAeq 7–22)", field: "db_lo", metric: "LAeq,day" };
const HEL_RAIL: Layer = { url: HEL, type: "avoindata:Meluselvitys_2022_Helsinki_juna_LAeq_7-22_NPM", label: "City of Helsinki noise survey 2022 (railways, day LAeq 7–22)", field: "db_lo", metric: "LAeq,day" };
const VAYLA_ROAD: Layer = { url: VAYLA, type: "tiestotiedot:melu_paiva_maankad_22", label: "Väylävirasto noise map 2022 (state roads, day LAeq)", field: "melu_db", metric: "LAeq,day" };
const VAYLA_RAIL: Layer = { url: VAYLA, type: "ratatiedot:melu_paiva_rautatiet_22", label: "Väylävirasto noise map 2022 (railways, day LAeq)", field: "melu_db", metric: "LAeq,day" };

function featureUrl(l: Layer, p: LatLng, json = true) {
  return `${l.url}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: l.type,
    ...(json ? { outputFormat: "application/json" } : {}),
    propertyName: l.field,
    CQL_FILTER: `INTERSECTS(geom,SRID=4326;POINT(${p.lng.toFixed(5)} ${p.lat.toFixed(5)}))`,
  })}`;
}

/** Lower bound of the noise band at a point (dB), 0 when below the mapped range. */
async function bandAt(l: Layer, p: LatLng): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await gate(() => fetchJson<any>(featureUrl(l, p), { timeoutMs: 8_000 }));
  let best = 0;
  for (const f of d.features ?? []) {
    const v = f.properties?.[l.field];
    const lo = typeof v === "number" ? v : Number(String(v ?? "").match(/(\d+)/)?.[1]);
    if (Number.isFinite(lo)) best = Math.max(best, lo);
  }
  return best;
}

const bandLabel = (lo: number) => (lo <= 0 ? "< 45 dB" : lo >= 75 ? "> 75 dB" : `${lo}–${lo + 5} dB`);

export async function measureNoise(c: LatLng, municipality: string): Promise<Criterion> {
  const helsinki = municipality === "Helsinki";
  const layers = helsinki ? [HEL_ROAD, HEL_RAIL] : [VAYLA_ROAD, VAYLA_RAIL];
  const pts = [c, offset(c, 300, 0), offset(c, 300, 90), offset(c, 300, 180), offset(c, 300, 270)];
  let perPoint: number[];
  const hits: { layer: Layer; p: LatLng; lo: number }[] = [];
  try {
    perPoint = await Promise.all(
      pts.map(async (p) => {
        const vals = await Promise.all(layers.map(async (l) => ({ l, lo: await bandAt(l, p) })));
        const top = vals.sort((a, b) => b.lo - a.lo)[0];
        if (top.lo > 0) hits.push({ layer: top.l, p, lo: top.lo });
        return top.lo;
      }),
    );
  } catch (e) {
    return { id: "noise", label: "Traffic noise", status: "unknown", value: null, detail: `Noise survey service unavailable (${(e as Error).message}).`, sources: [] };
  }
  const sorted = [...perPoint].sort((a, b) => a - b);
  const med = sorted[2];
  const max = sorted[4];
  const loud = perPoint.filter((x) => x >= 55).length;
  const sources: Source[] = (hits.length ? hits.sort((a, b) => b.lo - a.lo).slice(0, 2) : [{ layer: layers[0], p: c, lo: 0 }]).map((h) => ({
    url: featureUrl(h.layer, h.p),
    label: h.layer.label,
    quote: `${h.p.lat.toFixed(4)}, ${h.p.lng.toFixed(4)}: ${bandLabel(h.lo)} ${h.layer.metric}`,
    asOf: "2022",
  }));
  if (helsinki) {
    const status = med < 55 && loud <= 1 ? "good" : med < 60 ? "ok" : "poor";
    return {
      id: "noise",
      label: "Traffic noise",
      status,
      value: `${bandLabel(med)} Lden`,
      detail: `Median of 5 points (centre + 300 m around) is ${bandLabel(med)} Lden; loudest ${bandLabel(max)}; ${loud}/5 points at 55 dB or more (WHO road-noise guideline: 53 dB Lden). Helsinki 2022 survey, streets + rail.`,
      sources,
    };
  }
  // Partial coverage outside Helsinki: never call it "good".
  const status = max >= 60 && loud >= 2 ? "poor" : "ok";
  return {
    id: "noise",
    label: "Major-road noise",
    status,
    value: max > 0 ? `${bandLabel(med)} (max ${bandLabel(max)})` : "No major-road noise mapped",
    detail:
      max > 0
        ? `${loud}/5 sampled points lie in a 55 dB+ zone of a state road or railway (daytime LAeq, 2022). City streets are not covered by this map.`
        : `None of the 5 sampled points lies in a mapped noise zone of a state road or railway (2022). City streets are not covered by this map, so local street noise is unknown.`,
    sources,
  };
}
