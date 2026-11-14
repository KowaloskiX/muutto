// Stage "areas": candidate neighbourhoods = Statistics Finland Paavo postal-code areas
// (keyless WFS, CC BY 4.0) in Helsinki, Espoo, Vantaa and Kauniainen. The dataset is
// static (published yearly), so it is cached for 24 h. A quick prior picks ~8 areas
// within reach of work; real routing (OSRM) then refines the order.
import { cached, HOUR } from "@/lib/cache";
import type { LatLng, Source } from "./types";
import { fetchJson, haversineM, tm35ToWgs } from "./util";
import { CORE, FAR, KUNTA, transitEstimate, type RailStation } from "./region";

const KUNTA_FILTER = `kunta IN (${Object.keys(KUNTA).map((k) => `'${k}'`).join(",")})`;
const LAYER_CANDIDATES = ["postialue:pno_tilasto_2026", "postialue:pno_tilasto_2025", "postialue:pno_tilasto"];
const WFS = "https://geo.stat.fi/geoserver/postialue/wfs";

export type PaavoArea = {
  postalCode: string;
  name: string;
  nameSv?: string;
  municipality: string;
  center: LatLng;
  population: number;
  /** Median income of inhabitants (€/yr), Paavo hr_mtu. */
  medianIncome?: number;
  /** Median household disposable income (€/yr), Paavo tr_mtu. */
  medianHouseholdIncome?: number;
  meanAge?: number;
  under18?: number;
  over65?: number;
  households?: number;
  householdsWithKids?: number;
  rentedHouseholds?: number;
  ownedHouseholds?: number;
  areaKm2: number;
  year: number;
  layer: string;
  /** Simplified outline, WGS84 [lng, lat], ≤ ~200 points. */
  polygon?: AreaPolygon;
};

export type AreaPolygon = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

// ---- Douglas–Peucker simplification (planar, in degrees scaled by cos(lat)) ----
function dp(pts: number[][], tol: number): number[][] {
  if (pts.length <= 4) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [pts[a][0] * k, pts[a][1]];
    const [bx, by] = [pts[b][0] * k, pts[b][1]];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] * k - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > best) (best = d), (bi = i);
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : pts;
}

/** Closed rings start and end on the same point, which breaks DP's baseline: split at the farthest vertex. */
function dpRing(ring: number[][], tol: number): number[][] {
  if (ring.length <= 8) return ring;
  let far = 1;
  let best = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > best) (best = d), (far = i);
  }
  const a = dp(ring.slice(0, far + 1), tol);
  const b = dp(ring.slice(far), tol);
  return [...a, ...b.slice(1)];
}

const round5 = (r: number[][]) => r.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);

export function simplify(geom: { type: string; coordinates: number[][][][] | number[][][] }, maxPts = 200): AreaPolygon | undefined {
  const polys = (geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates]) as number[][][][];
  if (!polys?.length) return undefined;
  // Drop holes and slivers (islets): keep outer rings of the parts with ≥ 3% of the largest ring's points.
  const outers = polys.map((p) => p[0]).filter(Boolean);
  const maxLen = Math.max(...outers.map((r) => r.length));
  const parts = outers
    .filter((r) => r.length >= Math.max(4, maxLen * 0.03))
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
  for (let tol = 0.00005; tol < 0.05; tol *= 1.6) {
    const s = parts.map((r) => dpRing(r, tol));
    if (s.reduce((n, r) => n + r.length, 0) <= maxPts) {
      return s.length === 1 ? { type: "Polygon", coordinates: [round5(s[0])] } : { type: "MultiPolygon", coordinates: s.map((r) => [round5(r)]) };
    }
  }
  return undefined;
}

export type Candidate = PaavoArea & { id: string; distKm: number; prior: number; estMin: number };

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);

async function loadLayer(layer: string): Promise<PaavoArea[]> {
  const ages = "he_0_2,he_3_6,he_7_12,he_13_15,he_16_17,he_65_69,he_70_74,he_75_79,he_80_84,he_85_,he_kika";
  const props = `postinumeroalue,nimi,namn,kunta,euref_x,euref_y,he_vakiy,hr_mtu,tr_mtu,te_taly,te_laps,te_vuok_as,te_omis_as,pinta_ala,vuosi,${ages}`;
  const url = `${WFS}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layer,
    outputFormat: "application/json",
    propertyName: props,
    CQL_FILTER: KUNTA_FILTER,
  })}`;
  const geoUrl = `${WFS}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    propertyName: "postinumeroalue,geom",
    CQL_FILTER: KUNTA_FILTER,
  })}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, g] = await Promise.all([fetchJson<any>(url, { timeoutMs: 15_000 }), fetchJson<any>(geoUrl, { timeoutMs: 20_000 }).catch(() => null)]);
  const shapes = new Map<string, AreaPolygon | undefined>();
  for (const f of g?.features ?? []) if (f.geometry) shapes.set(String(f.properties?.postinumeroalue), simplify(f.geometry));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (d.features ?? []).map((f: any) => {
    const p = f.properties;
    return {
      postalCode: String(p.postinumeroalue),
      name: String(p.nimi),
      nameSv: p.namn || undefined,
      municipality: KUNTA[p.kunta] ?? p.kunta,
      center: tm35ToWgs(p.euref_x, p.euref_y),
      population: num(p.he_vakiy) ?? 0,
      medianIncome: num(p.hr_mtu),
      medianHouseholdIncome: num(p.tr_mtu),
      meanAge: num(p.he_kika),
      under18: ["he_0_2", "he_3_6", "he_7_12", "he_13_15", "he_16_17"].reduce((t, k) => t + (num(p[k]) ?? 0), 0),
      over65: ["he_65_69", "he_70_74", "he_75_79", "he_80_84", "he_85_"].reduce((t, k) => t + (num(p[k]) ?? 0), 0),
      households: num(p.te_taly),
      householdsWithKids: num(p.te_laps),
      rentedHouseholds: num(p.te_vuok_as),
      ownedHouseholds: num(p.te_omis_as),
      areaKm2: (num(p.pinta_ala) ?? 0) / 1e6,
      year: Number(p.vuosi) || 0,
      layer,
      polygon: shapes.get(String(p.postinumeroalue)),
    } satisfies PaavoArea;
  });
}

export async function paavoAreas(): Promise<PaavoArea[]> {
  const r = await cached("paavo", "region-v5", 24 * HOUR, async () => {
    let last: unknown;
    for (const layer of LAYER_CANDIDATES) {
      try {
        const rows = await loadLayer(layer);
        if (rows.length > 50) return rows;
      } catch (e) {
        last = e;
      }
    }
    throw last ?? new Error("Paavo WFS returned no areas");
  });
  return r.value;
}

export function paavoSource(a: PaavoArea): Source {
  return {
    url: `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${a.layer}&outputFormat=application/json&CQL_FILTER=postinumeroalue='${a.postalCode}'`,
    label: `Statistics Finland Paavo ${a.year || ""}`.trim(),
    quote: `${a.postalCode} ${a.name} (${a.municipality}): ${a.population.toLocaleString("en-US")} residents${a.meanAge ? `, mean age ${a.meanAge}` : ""}${a.medianHouseholdIncome ? `, median household income €${a.medianHouseholdIncome.toLocaleString("en-US")}/yr` : ""}`,
  };
}

/**
 * Pick candidate areas by ESTIMATED commute (not straight-line radius): the faster of a road
 * estimate and a commuter-rail estimate, so 35–45 min limits can surface Kerava, Järvenpää or
 * Kirkkonummi. The prior (never shown as a fact): shorter estimated commute dominates; tiny
 * areas are dropped; families lean to areas with more households with children; a tight budget
 * leans away from the highest-income areas (the only price proxy before listings are read).
 * When priorities favour space / price / quiet / family, some slots go to suburbs.
 */
export function pickCandidates(
  all: PaavoArea[],
  work: LatLng,
  stations: RailStation[],
  opts: { maxCommuteMin: number; hasKids: boolean; tenure: "rent" | "buy"; budget?: number; preferSuburbs?: boolean; n?: number },
): Candidate[] {
  const maxMin = opts.maxCommuteMin;
  const incomes = all.map((a) => a.medianIncome ?? 0).filter(Boolean).sort((a, b) => a - b);
  const p80 = incomes[Math.floor(incomes.length * 0.8)] ?? Infinity;
  const tight = opts.tenure === "rent" ? (opts.budget ?? Infinity) < 1200 : (opts.budget ?? Infinity) < 220_000;
  const scored = all
    .filter((a) => a.population >= 1500)
    .map((a) => {
      const distKm = haversineM(work, a.center) / 1000;
      const est = transitEstimate(a.center, work, null, stations).min;
      let prior = 1 - est / (maxMin * 1.2);
      prior += Math.min(0.15, a.population / 150_000);
      if (opts.hasKids && a.households) prior += 0.25 * ((a.householdsWithKids ?? 0) / a.households);
      if (tight && (a.medianIncome ?? 0) > p80) prior -= 0.15;
      return { ...a, id: `${a.postalCode} ${a.name}`, distKm, prior, estMin: est } satisfies Candidate;
    })
    .filter((c) => c.estMin <= maxMin * 1.2 && (!FAR.has(c.municipality) || c.estMin <= maxMin))
    .sort((a, b) => b.prior - a.prior);
  const n = opts.n ?? 14;
  const out: Candidate[] = [];
  const take = (c: Candidate) => {
    // Spread the shortlist: skip an area whose centre is within 900 m of one already picked.
    if (out.length >= n || out.some((o) => o.id === c.id || haversineM(o.center, c.center) < 900)) return;
    out.push(c);
  };
  if (opts.preferSuburbs) scored.filter((c) => !CORE.has(c.municipality) || (c.areaKm2 > 0 && c.population / c.areaKm2 < 4000)).slice(0, Math.ceil(n * 0.4)).forEach(take);
  scored.forEach(take);
  return out.sort((a, b) => b.prior - a.prior);
}
