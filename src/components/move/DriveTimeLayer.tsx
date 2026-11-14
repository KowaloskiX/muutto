"use client";

// "Drive time" layer of the move map. Car minutes to work on a ~1 km grid (GET /api/move/heat:
// OSRM on OpenStreetMap, free-flow, no live traffic) contoured into smooth bands (≤10/20/30/45 min)
// with labelled lines. Off-road points (sea, forest) count as unreachable, so bands never spill
// over water. Click the map for the actual OSRM route from that point; listings are coloured by
// their own routed drive time (one OSRM table call). Nothing is interpolated into a listing's value.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { contours } from "d3-contour";
import { CircleMarker, Marker, Pane, Polygon, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { HeatResponse, HeatScale } from "@/app/api/move/heat/route";
import type { IsoResponse } from "@/app/api/move/iso/route";
import m from "@/components/case/Map.module.css";
import x from "./Move.module.css";

type Pt = { lat: number; lng: number };
type Dot = { key: string; lat: number; lng: number; label: string; sub?: string; price?: string };
type AreaPt = { key: string; lat: number; lng: number; label: string };

/** Bands, dark (close) to light (far). */
export const DRIVE_BANDS = [
  { max: 10, color: "#0b5a3a" },
  { max: 20, color: "#2f7d55" },
  { max: 30, color: "#6fa77c" },
  { max: 45, color: "#b4cf9f" },
] as const;
/** Weekend reach: how far the car gets in a few hours (region scale). */
const REGION_BANDS = [
  { max: 30, color: "#0b5a3a" },
  { max: 60, color: "#2f7d55" },
  { max: 90, color: "#6fa77c" },
  { max: 120, color: "#b4cf9f" },
  { max: 180, color: "#dcd8b8" },
] as const;
type Band = { max: number; color: string };
const BANDS: Record<HeatScale, readonly Band[]> = { city: DRIVE_BANDS, region: REGION_BANDS };
export const SCALE_UI: Record<HeatScale, { max: number; start: number; step: number; label: string }> = {
  city: { max: 60, start: 30, step: 1, label: "City · 1 h" },
  region: { max: 180, start: 120, step: 5, label: "Region · 3 h" },
};
const FAR = "#9a968d";
export const driveColor = (min: number) => DRIVE_BANDS.find((b) => min <= b.max)?.color ?? FAR;
const fmtT = (t: number) => (t < 60 ? `${t} min` : t % 60 ? `${Math.floor(t / 60)} h ${t % 60} min` : `${t / 60} h`);
const OSRM = "https://router.project-osrm.org";
const NOTE = "OSRM, typical, no live traffic";

export type HeatState = { key: string; data?: HeatResponse; error?: string };
export type IsoState = { key: string; data?: IsoResponse; error?: string };

/** Road-network isochrones (Valhalla), fetched once per workplace while the city layer is shown. */
export function useIso(work: Pt | undefined, active: boolean): IsoState | undefined {
  const [iso, setIso] = useState<IsoState | undefined>();
  const key = work ? `${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (!active || !work || iso?.key === key) return;
    let stop = false;
    setIso({ key });
    fetch(`/api/move/iso?lat=${work.lat}&lng=${work.lng}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as IsoResponse;
      })
      .then((data) => !stop && setIso({ key, data }))
      .catch((e: Error) => !stop && setIso({ key, error: e.message }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  return iso;
}

/** Fetches the drive-time grid once per workplace, only while the layer is shown. */
export function useHeat(work: Pt | undefined, active: boolean, scale: HeatScale = "city"): HeatState | undefined {
  const [heat, setHeat] = useState<HeatState | undefined>();
  const key = work ? `${scale}:${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (!active || !work || heat?.key === key) return;
    let stop = false;
    setHeat({ key });
    fetch(`/api/move/heat?lat=${work.lat}&lng=${work.lng}${scale === "region" ? "&scale=region" : ""}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as HeatResponse;
      })
      .then((data) => !stop && setHeat({ key, data }))
      .catch((e: Error) => !stop && setHeat({ key, error: e.message }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  return heat;
}

export function DriveLegend({ scale = "city" }: { scale?: HeatScale }) {
  return (
    <>
      <span className={x.lgTitle}>{scale === "region" ? "By car from work" : "Car to work"}</span>
      {BANDS[scale].map((b) => (
        <span key={b.max}>
          <i className={x.lgSwatch} style={{ background: b.color }} />≤{fmtT(b.max)}
        </span>
      ))}
    </>
  );
}

export function driveCaption(heat: HeatState | undefined, hasWork: boolean, iso?: IsoState, scale: HeatScale = "city"): React.ReactNode {
  if (!hasWork) return "No workplace location, so no drive times.";
  if (scale === "city" && iso?.data)
    return `Car, typical — isochrones along the road network (${iso.data.source.label}), no live traffic. Listing times: OSRM. Click the map for a route.`;
  if (scale === "city" && iso && !iso.error)
    return (
      <span className={x.capBusy}>
        <i aria-hidden /> Tracing drive times along the road network…
      </span>
    );
  if (heat?.error) return <span className={x.capErr}>{heat.error}</span>;
  if (!heat?.data)
    return (
      <span className={x.capBusy}>
        <i aria-hidden /> Computing drive times… (routing ~2,000 points the first time, about 10 s)
      </span>
    );
  const d = heat.data;
  const ferry = d.scale === "region" ? ` Grid ends ${Math.round(((d.grid.nx - 1) / 2) * d.stepKm)} km from work.` : "";
  return `Car, typical (${d.source.label}) — no live traffic. ${d.routed.toLocaleString("en-US")} points on a ${d.stepKm} km grid; ${d.dropped.toLocaleString("en-US")} off-road points (sea, forest) left blank.${ferry} Click the map for a route.`;
}

type Ring = [number, number][];

/**
 * Contour input: negated minutes ("value ≥ −T" = "minutes ≤ T"); unreachable = very far.
 * Drawing only: a small off-road gap (a pond, a park) whose routable neighbours surround it
 * (≥ 5 of 8) takes their median, so single points don't punch holes in the bands. Sea and larger
 * blank areas stay unreachable. Listing times never use this; they are routed one by one.
 */
function contourValues(d: HeatResponse): number[] {
  const g = d.grid;
  let cur = g.min.slice();
  for (let pass = 0; pass < 2; pass++) {
    const next = cur.slice();
    for (let y = 0; y < g.ny; y++)
      for (let x = 0; x < g.nx; x++) {
        const i = y * g.nx + x;
        if (cur[i] != null) continue;
        const nb: number[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= g.nx || yy >= g.ny) continue;
            const v = cur[yy * g.nx + xx];
            if (v != null) nb.push(v);
          }
        if (nb.length >= 5) next[i] = nb.sort((a, b) => a - b)[Math.floor(nb.length / 2)];
      }
    cur = next;
  }
  return cur.map((v) => (v == null ? -1e4 : -v));
}

/** Smooth bands ≤10/20/30/45 min (d3-contour on contourValues). */
function bands(d: HeatResponse) {
  const g = d.grid;
  const vals = contourValues(d);
  const B = BANDS[d.scale ?? "city"];
  const gen = contours()
    .size([g.nx, g.ny])
    .thresholds(B.map((b) => -b.max));
  // Grid point i sits at pixel centre i + 0.5 in d3-contour space.
  const toLL = ([cx, cy]: number[]): [number, number] => [g.lat0 + (cy - 0.5) * g.dLat, g.lng0 + (cx - 0.5) * g.dLng];
  return gen(vals)
    .map((c) => {
      const band = B.find((b) => -b.max === c.value)!;
      const polys = c.coordinates.map((poly) => poly.map((ring) => ring.map(toLL) as Ring));
      // Label at the northernmost point of the largest outer ring (north of Helsinki is land).
      let best: Ring | undefined;
      for (const p of polys) if (!best || p[0].length > best.length) best = p[0];
      const label = best?.reduce((a, b) => (b[0] > a[0] ? b : a));
      return { band, polys, label };
    })
    .sort((a, b) => b.band.max - a.band.max);
}

/** GeoJSON (lng/lat) Polygon or MultiPolygon → Leaflet polygons of [lat, lng] rings. */
function toPolys(g: IsoResponse["contours"][number]["geometry"]): Ring[][] {
  const flip = (r: number[][]) => r.map(([lng, lat]) => [lat, lng] as [number, number]);
  return g.type === "Polygon" ? [g.coordinates.map(flip)] : g.coordinates.map((p) => p.map(flip));
}
const northmost = (polys: Ring[][]) => {
  let best: Ring | undefined;
  for (const p of polys) if (!best || p[0].length > best.length) best = p[0];
  return best?.reduce((a, b) => (b[0] > a[0] ? b : a));
};
function isoBands(d: IsoResponse) {
  return DRIVE_BANDS.map((band) => {
    const c = d.contours.find((x) => x.min === band.max);
    const polys = c ? toPolys(c.geometry) : [];
    return { band: band as Band, polys, label: northmost(polys) };
  })
    .filter((b) => b.polys.length)
    .sort((a, b) => b.band.max - a.band.max);
}
function isoZone(d: IsoResponse, t: number): Ring[][] {
  const c = d.contours.find((x) => x.min === t);
  return c ? toPolys(c.geometry) : [];
}

/** One reach zone: everything routable within `t` minutes. */
function reach(d: HeatResponse, t: number): Ring[][] {
  if (t <= 0) return [];
  const g = d.grid;
  const vals = contourValues(d);
  const toLL = ([cx, cy]: number[]): [number, number] => [g.lat0 + (cy - 0.5) * g.dLat, g.lng0 + (cx - 0.5) * g.dLng];
  const c = contours().size([g.nx, g.ny]).thresholds([-t])(vals)[0];
  return c ? c.coordinates.map((poly) => poly.map((ring) => ring.map(toLL) as Ring)) : [];
}

type Route = { from: Pt; loading: boolean; line?: [number, number][]; min?: number; km?: number; error?: string };

function ClickRoute({ work, onRoute }: { work: Pt; onRoute: (r: Route | undefined) => void }) {
  useMapEvents({
    click: (e) => {
      const from = { lat: e.latlng.lat, lng: e.latlng.lng };
      onRoute({ from, loading: true });
      fetch(`${OSRM}/route/v1/driving/${from.lng.toFixed(5)},${from.lat.toFixed(5)};${work.lng.toFixed(5)},${work.lat.toFixed(5)}?overview=simplified&geometries=geojson`)
        .then((r) => r.json())
        .then((j: { code: string; message?: string; routes?: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[] }) => {
          const r = j.routes?.[0];
          if (j.code !== "Ok" || !r) throw new Error(j.message ?? j.code);
          onRoute({ from, loading: false, line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), min: r.duration / 60, km: r.distance / 1000 });
        })
        .catch((err: Error) => onRoute({ from, loading: false, error: `No route: ${err.message}` }));
    },
  });
  return null;
}

/** Each listing's own drive time: one OSRM table call (listings → work). */
function useRoutedMinutes(dots: { key: string; lat: number; lng: number }[], work: Pt | undefined, active: boolean) {
  const [mins, setMins] = useState<Record<string, number | null>>({});
  const sig = `${work?.lat},${work?.lng}|` + dots.map((d) => `${d.lat.toFixed(5)},${d.lng.toFixed(5)}`).join(";");
  useEffect(() => {
    if (!active || !work || !dots.length) return;
    let stop = false;
    const pts = dots.slice(0, 99);
    const coords = [work, ...pts].map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    fetch(`${OSRM}/table/v1/driving/${coords}?sources=${pts.map((_, i) => i + 1).join(";")}&destinations=0&annotations=duration`)
      .then((r) => r.json())
      .then((j: { code: string; durations?: (number | null)[][] }) => {
        if (stop || j.code !== "Ok" || !j.durations) return;
        const out: Record<string, number | null> = {};
        pts.forEach((d, i) => {
          const s = j.durations![i]?.[0];
          out[d.key] = s == null ? null : s / 60;
        });
        setMins(out);
      })
      .catch(() => {
        /* listings stay neutral; no time is invented */
      });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sig]);
  return mins;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Region scale zooms out to the routed disc; back on city scale the map returns to the workplace. */
function FitScale({ heat, scale, work }: { heat?: HeatState; scale: HeatScale; work?: Pt }) {
  const map = useMap();
  const d = heat?.data;
  useEffect(() => {
    if (scale === "region" && d?.scale === "region") {
      // Fit to what is reachable within the slider's range, not the whole (mostly empty) grid square.
      const g = d.grid;
      let s = 90, n = -90, w = 180, e = -180;
      g.min.forEach((v, i) => {
        if (v == null || v > SCALE_UI.region.max) return;
        const lat = g.lat0 + Math.floor(i / g.nx) * g.dLat;
        const lng = g.lng0 + (i % g.nx) * g.dLng;
        s = Math.min(s, lat);
        n = Math.max(n, lat);
        w = Math.min(w, lng);
        e = Math.max(e, lng);
      });
      if (n > s)
        map.flyToBounds(
          [
            [s, w],
            [n, e],
          ],
          { padding: [16, 16], duration: reducedMotion() ? 0 : 0.8 },
        );
    } else if (scale === "city" && work) map.flyTo([work.lat, work.lng], 11, { duration: reducedMotion() ? 0 : 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, d]);
  return null;
}

export default function DriveTimeLayer({
  heat,
  iso,
  work,
  dots,
  areas,
  dark,
  scale,
  onScale,
  onSelectListing,
}: {
  heat?: HeatState;
  iso?: IsoState;
  work?: Pt;
  dots: Dot[];
  areas: AreaPt[];
  dark: boolean;
  scale: HeatScale;
  onScale: (s: HeatScale) => void;
  onSelectListing: (key: string) => void;
}) {
  const roads = scale === "city" && !!iso?.data;
  const ui = roads ? { ...SCALE_UI.city, step: 5 } : SCALE_UI[scale];
  const ready = roads || !!heat?.data;
  const status = scale === "city" ? (iso?.error ? heat : iso) : heat;
  const shapes = useMemo(() => (roads ? isoBands(iso!.data!) : heat?.data ? bands(heat.data) : []), [roads, iso?.data, heat?.data]);
  const [route, setRoute] = useState<Route | undefined>();
  // Listings and area centres, each routed to work (one OSRM table call).
  const targets = useMemo(() => [...dots.map((d) => ({ key: d.key, lat: d.lat, lng: d.lng })), ...areas.map((a) => ({ key: `area:${a.key}`, lat: a.lat, lng: a.lng }))], [dots, areas]);
  const lm = useRoutedMinutes(targets, work, true);
  const line = dark ? "#e9e7e1" : "#0d1016";
  const accent = dark ? "#8fc9a8" : "#005032";

  // The time slider: the reach zone for "within T minutes", recomputed live from the grid.
  const [t, setT] = useState<number>(ui.start);
  useEffect(() => setT(SCALE_UI[scale].start), [scale]);
  useEffect(() => {
    if (roads) setT((v) => Math.max(5, Math.round(v / 5) * 5));
  }, [roads]);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | undefined>(undefined);
  const zone = useMemo(() => (roads ? isoZone(iso!.data!, t) : heat?.data ? reach(heat.data, t) : []), [roads, iso?.data, heat?.data, t]);
  const zoneLabel = useMemo(() => {
    let best: Ring | undefined;
    for (const p of zone) if (!best || p[0].length > best.length) best = p[0];
    return best?.reduce((a, b) => (b[0] > a[0] ? b : a));
  }, [zone]);
  const play = () => {
    if (reducedMotion()) {
      setT(ui.max);
      return;
    }
    if (raf.current) cancelAnimationFrame(raf.current);
    setPlaying(true);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 4000);
      setT(Math.round((k * ui.max) / ui.step) * ui.step);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => (raf.current ? cancelAnimationFrame(raf.current) : undefined), []);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel.current) return;
    L.DomEvent.disableClickPropagation(panel.current);
    L.DomEvent.disableScrollPropagation(panel.current);
  }, [!!status]);
  const known = dots.filter((d) => lm[d.key] != null);
  const inL = known.filter((d) => lm[d.key]! <= t).length;
  const knownA = areas.filter((a) => lm[`area:${a.key}`] != null);
  const inA = knownA.filter((a) => lm[`area:${a.key}`]! <= t).length;

  return (
    <>
      <Pane name="drive" style={{ zIndex: 420 }}>
        {shapes.map((s) => (
          <Polygon
            key={s.band.max}
            positions={s.polys}
            interactive={false}
            pathOptions={{ color: s.band.color, weight: 1, opacity: dark ? 0.55 : 0.45, fillColor: s.band.color, fillOpacity: dark ? 0.07 : 0.08, lineJoin: "round" }}
          />
        ))}
        {zone.length > 0 && (
          <>
            {/* soft edge: a wide faint stroke under the crisp one */}
            <Polygon positions={zone} interactive={false} pathOptions={{ color: accent, weight: 9, opacity: 0.12, fill: false, lineJoin: "round" }} />
            <Polygon positions={zone} interactive={false} pathOptions={{ color: accent, weight: 1.75, opacity: 0.9, fillColor: accent, fillOpacity: dark ? 0.26 : 0.3, lineJoin: "round" }} />
          </>
        )}
      </Pane>
      {zoneLabel && (
        <Marker position={zoneLabel} interactive={false} keyboard={false} zIndexOffset={2500} icon={L.divIcon({ className: m.icon, html: `<span class="${x.isoLabel} ${x.isoNow}" style="--c:${accent}">${fmtT(t)}</span>`, iconSize: [0, 0] })} />
      )}
      {shapes.map(
        (s) =>
          s.label &&
          s.band.max !== t && (
            <Marker
              key={`l${s.band.max}`}
              position={s.label}
              interactive={false}
              keyboard={false}
              icon={L.divIcon({ className: m.icon, html: `<span class="${x.isoLabel}" style="--c:${s.band.color}">${fmtT(s.band.max)}</span>`, iconSize: [0, 0] })}
            />
          ),
      )}
      {work && <ClickRoute work={work} onRoute={setRoute} />}
      {route?.line && <Polyline positions={route.line} interactive={false} pathOptions={{ color: line, weight: 3, opacity: 0.85, lineCap: "round" }} />}
      {route && (
        <CircleMarker key={`${route.from.lat},${route.from.lng},${route.loading}`} center={[route.from.lat, route.from.lng]} radius={5} pathOptions={{ color: dark ? "#0d1016" : "#fff", weight: 2, fillColor: line, fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -6]} className={m.tip} opacity={1}>
            {route.loading ? (
              <small>Routing…</small>
            ) : route.error ? (
              <small>{route.error}</small>
            ) : (
              <>
                <b>
                  {Math.round(route.min!)} min by car · {route.km!.toFixed(1)} km
                </b>
                <small>{NOTE}</small>
              </>
            )}
          </Tooltip>
        </CircleMarker>
      )}
      {dots.map((d) => {
        const v = lm[d.key];
        const html = v != null ? `<span class="${x.drivePin}" style="--c:${driveColor(v)}">${Math.round(v)}′</span>` : `<span class="${x.dot}"></span>`;
        return (
          <Marker
            key={`${d.key}-drive-${v ?? "x"}`}
            position={[d.lat, d.lng]}
            icon={L.divIcon({ className: m.icon, html, iconSize: v != null ? [26, 18] : [10, 10], iconAnchor: v != null ? [13, 9] : [5, 5], tooltipAnchor: [0, -10] })}
            zIndexOffset={1500}
            title={d.label}
            eventHandlers={{ click: () => onSelectListing(d.key) }}
          >
            <Tooltip direction="top" className={m.tip} opacity={1}>
              <b>{d.label}</b>
              <small>{v != null ? `${Math.round(v)} min by car to work (${NOTE})` : v === null ? "No car route found" : "Drive time loading…"}</small>
              {d.sub && <small>{d.sub}</small>}
            </Tooltip>
          </Marker>
        );
      })}
      <FitScale heat={heat} scale={scale} work={work} />
      {status && (
        <div ref={panel} className={x.reachPanel}>
          <div className={x.scaleSwitch} role="radiogroup" aria-label="Reach scale">
            {(Object.keys(SCALE_UI) as HeatScale[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} className={scale === s ? x.scaleOn : ""} onClick={() => onScale(s)}>
                {SCALE_UI[s].label}
              </button>
            ))}
          </div>
          <div className={x.reachTop}>
            <label htmlFor="reach-t">
              Reachable by car in <b>{fmtT(t)}</b>
            </label>
            <button type="button" className={x.playBtn} onClick={play} disabled={playing || !ready} aria-label={`Play 0 to ${fmtT(ui.max)}`}>
              {playing ? "Playing" : "Play"}
            </button>
          </div>
          <input
            id="reach-t"
            type="range"
            min={0}
            max={ui.max}
            step={ui.step}
            disabled={!ready}
            value={t}
            onChange={(e) => {
              if (raf.current) cancelAnimationFrame(raf.current);
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            style={{ "--p": `${(t / ui.max) * 100}%` } as React.CSSProperties}
          />
          <small>
            {!ready ? (status.error ? "Unavailable" : scale === "region" ? "Routing ~2,000 points across southern Finland…" : "Tracing the road network…") : null}
            {ready && (dots.length ? `${inL} of ${dots.length} listings` : "No listings")}
            {ready && areas.length ? ` · ${inA} of ${areas.length} areas` : ""}
            {ready && (known.length < dots.length || knownA.length < areas.length) ? " (routing…)" : ""}
          </small>
        </div>
      )}
    </>
  );
}
