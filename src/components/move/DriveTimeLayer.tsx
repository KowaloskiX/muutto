"use client";

// "Drive time" layer of the move map. Car minutes to work on a ~1 km grid (GET /api/move/heat:
// OSRM on OpenStreetMap, free-flow, no live traffic) contoured into smooth bands (≤10/20/30/45 min)
// with labelled lines. Off-road points (sea, forest) count as unreachable, so bands never spill
// over water. Click the map for the actual OSRM route from that point; listings are coloured by
// their own routed drive time (one OSRM table call). Nothing is interpolated into a listing's value.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { contours } from "d3-contour";
import { CircleMarker, Marker, Pane, Polygon, Polyline, Tooltip, useMapEvents } from "react-leaflet";
import type { HeatResponse } from "@/app/api/move/heat/route";
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
const FAR = "#9a968d";
export const driveColor = (min: number) => DRIVE_BANDS.find((b) => min <= b.max)?.color ?? FAR;
const OSRM = "https://router.project-osrm.org";
const NOTE = "OSRM, typical, no live traffic";

export type HeatState = { key: string; data?: HeatResponse; error?: string };

/** Fetches the drive-time grid once per workplace, only while the layer is shown. */
export function useHeat(work: Pt | undefined, active: boolean): HeatState | undefined {
  const [heat, setHeat] = useState<HeatState | undefined>();
  const key = work ? `${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (!active || !work || heat?.key === key) return;
    let stop = false;
    setHeat({ key });
    fetch(`/api/move/heat?lat=${work.lat}&lng=${work.lng}`)
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

export function DriveLegend() {
  return (
    <>
      <span className={x.lgTitle}>Car to work</span>
      {DRIVE_BANDS.map((b) => (
        <span key={b.max}>
          <i className={x.lgSwatch} style={{ background: b.color }} />≤{b.max} min
        </span>
      ))}
    </>
  );
}

export function driveCaption(heat: HeatState | undefined, hasWork: boolean): React.ReactNode {
  if (!hasWork) return "No workplace location, so no drive times.";
  if (heat?.error) return <span className={x.capErr}>{heat.error}</span>;
  if (!heat?.data)
    return (
      <span className={x.capBusy}>
        <i aria-hidden /> Computing drive times… (routing ~2,000 points the first time, about 10 s)
      </span>
    );
  const d = heat.data;
  return `Car, typical (${d.source.label}) — no live traffic. ${d.routed.toLocaleString("en-US")} points on a ${d.stepKm} km grid; ${d.dropped.toLocaleString("en-US")} off-road points (sea, forest) left blank. Click the map for a route.`;
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
  const gen = contours()
    .size([g.nx, g.ny])
    .thresholds(DRIVE_BANDS.map((b) => -b.max));
  // Grid point i sits at pixel centre i + 0.5 in d3-contour space.
  const toLL = ([cx, cy]: number[]): [number, number] => [g.lat0 + (cy - 0.5) * g.dLat, g.lng0 + (cx - 0.5) * g.dLng];
  return gen(vals)
    .map((c) => {
      const band = DRIVE_BANDS.find((b) => -b.max === c.value)!;
      const polys = c.coordinates.map((poly) => poly.map((ring) => ring.map(toLL) as Ring));
      // Label at the northernmost point of the largest outer ring (north of Helsinki is land).
      let best: Ring | undefined;
      for (const p of polys) if (!best || p[0].length > best.length) best = p[0];
      const label = best?.reduce((a, b) => (b[0] > a[0] ? b : a));
      return { band, polys, label };
    })
    .sort((a, b) => b.band.max - a.band.max);
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

export default function DriveTimeLayer({ heat, work, dots, areas, dark, onSelectListing }: { heat?: HeatState; work?: Pt; dots: Dot[]; areas: AreaPt[]; dark: boolean; onSelectListing: (key: string) => void }) {
  const shapes = useMemo(() => (heat?.data ? bands(heat.data) : []), [heat?.data]);
  const [route, setRoute] = useState<Route | undefined>();
  // Listings and area centres, each routed to work (one OSRM table call).
  const targets = useMemo(() => [...dots.map((d) => ({ key: d.key, lat: d.lat, lng: d.lng })), ...areas.map((a) => ({ key: `area:${a.key}`, lat: a.lat, lng: a.lng }))], [dots, areas]);
  const lm = useRoutedMinutes(targets, work, true);
  const line = dark ? "#e9e7e1" : "#0d1016";
  const accent = dark ? "#8fc9a8" : "#005032";

  // The time slider: the reach zone for "within T minutes", recomputed live from the grid.
  const [t, setT] = useState(30);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | undefined>(undefined);
  const zone = useMemo(() => (heat?.data ? reach(heat.data, t) : []), [heat?.data, t]);
  const zoneLabel = useMemo(() => {
    let best: Ring | undefined;
    for (const p of zone) if (!best || p[0].length > best.length) best = p[0];
    return best?.reduce((a, b) => (b[0] > a[0] ? b : a));
  }, [zone]);
  const play = () => {
    if (reducedMotion()) {
      setT(60);
      return;
    }
    if (raf.current) cancelAnimationFrame(raf.current);
    setPlaying(true);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 4000);
      setT(Math.round(k * 60));
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
  }, [heat?.data]);
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
        <Marker position={zoneLabel} interactive={false} keyboard={false} zIndexOffset={2500} icon={L.divIcon({ className: m.icon, html: `<span class="${x.isoLabel} ${x.isoNow}" style="--c:${accent}">${t} min</span>`, iconSize: [0, 0] })} />
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
              icon={L.divIcon({ className: m.icon, html: `<span class="${x.isoLabel}" style="--c:${s.band.color}">${s.band.max} min</span>`, iconSize: [0, 0] })}
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
      {heat?.data && (
        <div ref={panel} className={x.reachPanel}>
          <div className={x.reachTop}>
            <label htmlFor="reach-t">
              Reachable by car in <b>{t} min</b>
            </label>
            <button type="button" className={x.playBtn} onClick={play} disabled={playing} aria-label="Play 0 to 60 minutes">
              {playing ? "Playing" : "Play"}
            </button>
          </div>
          <input
            id="reach-t"
            type="range"
            min={0}
            max={60}
            step={1}
            value={t}
            onChange={(e) => {
              if (raf.current) cancelAnimationFrame(raf.current);
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            style={{ "--p": `${(t / 60) * 100}%` } as React.CSSProperties}
          />
          <small>
            {dots.length ? `${inL} of ${dots.length} listings` : "No listings"}
            {areas.length ? ` · ${inA} of ${areas.length} areas` : ""}
            {known.length < dots.length || knownA.length < areas.length ? " (routing…)" : ""}
          </small>
        </div>
      )}
    </>
  );
}
