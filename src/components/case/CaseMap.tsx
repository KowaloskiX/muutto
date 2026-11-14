"use client";

// The case map: a full-width band under the project header with the project site and the candidate
// subcontractors. Client-only: loaded with next/dynamic({ ssr: false }) from CaseFile, because
// Leaflet touches `window` on import. Basemap: Esri Canvas (keyless; CARTO now watermarks keyless use).
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CaretDown } from "@phosphor-icons/react";
import { Circle, MapContainer, Marker, Pane, TileLayer, Tooltip, useMap } from "react-leaflet";
import { fmtKm, type Verdict } from "./model";
import m from "./Map.module.css";

export type Pin = { key: string; lat: number; lng: number; label: string; rank?: number; verdict: Verdict; sub?: string; fit?: number; km?: number };
type Site = { lat: number; lng: number; label: string };

const WORD: Record<Verdict, string> = { green: "Clear", yellow: "Clarify", red: "Red flag", grey: "Checking" };
const RINGS = [10, 25];
// Esri Canvas basemaps: keyless, with attribution. Light Gray in light mode, Dark Gray in dark; the
// place-name labels are a separate reference layer drawn above the base.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = {
  light: { base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
  dark: { base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
};
const ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const PAD = { paddingTopLeft: [44, 60] as L.PointTuple, paddingBottomRight: [44, 36] as L.PointTuple, maxZoom: 14 };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fit(map: L.Map, points: [number, number][], animate: boolean) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView(points[0], 11, { animate });
    return;
  }
  const b = L.latLngBounds(points);
  if (animate) map.flyToBounds(b, { ...PAD, duration: 0.7 });
  else map.fitBounds(b, { ...PAD, animate: false });
}

/** Fits the site and every pin; flies smoothly when the set changes, refits when the band resizes. */
function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const sig = points.map((p) => p.join(",")).join(";");
  const latest = useRef(points);
  latest.current = points;
  const first = useRef(true);
  useEffect(() => {
    fit(map, points, !first.current && !reduced());
    first.current = false;
    // Only refit when the set of points changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  useEffect(() => {
    // The band narrows when the drawer opens: keep tiles in sync and refit so no pin falls outside.
    const el = map.getContainer();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      clearTimeout(t);
      t = setTimeout(() => fit(map, latest.current, false), 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

function useDark() {
  const [dark, setDark] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const q = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return dark;
}

/** Marker z-order: the better rank sits on top when pins overlap; the focused one above all. */
const zOf = (p: Pin) => 500 - (p.rank ?? 40) * 10;

function Pins({ pins, selected, active, onSelect, onHover }: { pins: Pin[]; selected?: string; active?: string; onSelect: (key: string) => void; onHover?: (key: string) => void }) {
  const refs = useRef<Record<string, L.Marker | null>>({});
  // Icons stay stable across hover changes (only rank and verdict rebuild them), so the
  // enlarge-on-focus is a CSS transition on the same element rather than a swapped node.
  const iconSig = pins.map((p) => `${p.key}:${p.rank}:${p.verdict}`).join("|");
  const icons = useMemo(() => {
    const out: Record<string, L.DivIcon> = {};
    for (const p of pins)
      out[p.key] = L.divIcon({
        className: m.icon,
        html: `<span class="${m.pin} ${m[`v_${p.verdict}`]}">${p.rank ?? "•"}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        tooltipAnchor: [0, -16],
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconSig]);

  // Focus (hovered row or open drawer): enlarge, raise, and show the hovered row's tooltip.
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    for (const p of pins) {
      const mk = refs.current[p.key];
      if (!mk) continue;
      const on = p.key === selected || p.key === active;
      mk.getElement()?.classList.toggle(m.on, on);
      mk.setZIndexOffset(on ? 2000 : zOf(p));
    }
    if (prev.current && prev.current !== selected) refs.current[prev.current]?.closeTooltip();
    if (selected && selected !== active) refs.current[selected]?.openTooltip();
    prev.current = selected;
  }, [pins, selected, active, icons]);

  return (
    <>
      {pins.map((p) => (
        <Marker
          key={p.key}
          ref={(mk) => {
            refs.current[p.key] = mk;
          }}
          position={[p.lat, p.lng]}
          icon={icons[p.key]}
          zIndexOffset={zOf(p)}
          title={p.label}
          eventHandlers={{ click: () => onSelect(p.key), mouseover: () => onHover?.(p.key) }}
        >
          <Tooltip direction="top" className={m.tip} opacity={1}>
            <b>{p.label}</b>
            <span className={m.tipV}>
              <i style={{ background: `var(--${p.verdict === "green" ? "success" : p.verdict === "yellow" ? "caution" : p.verdict === "red" ? "destructive" : "faint"})` }} />
              {[WORD[p.verdict], p.fit != null ? `fit ${p.fit}` : "", p.km != null ? fmtKm(p.km) : ""].filter(Boolean).join(" · ")}
            </span>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

function Rings({ site, dark }: { site: Site; dark: boolean }) {
  const ring = dark ? "rgb(242 241 237)" : "rgb(13 16 22)";
  return (
    <>
      {RINGS.map((r) => (
        <Circle key={r} center={[site.lat, site.lng]} radius={r * 1000} interactive={false} pathOptions={{ color: ring, opacity: 0.32, weight: 1, dashArray: "3 5", fill: r === RINGS[0], fillColor: ring, fillOpacity: 0.025 }} />
      ))}
      {RINGS.map((r) => (
        <Marker
          key={`l${r}`}
          position={[site.lat + r / 111.32, site.lng]}
          interactive={false}
          keyboard={false}
          icon={L.divIcon({ className: m.icon, html: `<span class="${m.ringLabel}">${r} km</span>`, iconSize: [0, 0] })}
        />
      ))}
    </>
  );
}

export default function CaseMap({
  site,
  pins,
  selected,
  active,
  hint,
  onSelect,
  onHover,
}: {
  site?: Site;
  pins: Pin[];
  /** Hovered row: its pin grows and shows its tooltip. */
  selected?: string;
  /** The candidate open in the drawer: its pin stays enlarged. */
  active?: string;
  /** A note under the map, e.g. when no site was given. */
  hint?: string;
  onSelect: (key: string) => void;
  onHover?: (key: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const dark = useDark();
  const points = useMemo<[number, number][]>(() => [...(site ? [[site.lat, site.lng] as [number, number]] : []), ...pins.map((p) => [p.lat, p.lng] as [number, number])], [site, pins]);
  const siteIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${m.site}"><i></i><b>Site</b></span>`, iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -14] }), []);
  const center: [number, number] = points[0] ?? [60.2, 24.8];
  const kms = pins.map((p) => p.km).filter((x): x is number => x != null);
  const within = kms.length ? Math.max(...kms) : undefined;
  const summary = [site?.label, pins.length ? `${pins.length} on the map` : "", within != null ? `all within ${fmtKm(within)}` : ""].filter(Boolean).join(" · ");
  const verdicts = new Set(pins.map((p) => p.verdict));

  return (
    <section className={`${m.band} ${m.vars}`} aria-labelledby="case-map-h">
      <div className={m.head}>
        <h2 id="case-map-h">Map</h2>
        {summary && <span className={m.sum}>{summary}</span>}
        <button type="button" className={m.toggle} onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-controls="case-map">
          {open ? "Hide map" : "Show map"}
          <CaretDown weight="bold" className={open ? m.up : ""} aria-hidden />
        </button>
      </div>
      {open && (
        <div id="case-map" className={m.box}>
          <MapContainer center={center} zoom={10} maxZoom={16} scrollWheelZoom={false} zoomControl={false} className={m.leaflet} attributionControl>
            <TileLayer key={dark ? "dark" : "light"} attribution={ATTRIBUTION} url={(dark ? TILES.dark : TILES.light).base} maxZoom={16} maxNativeZoom={16} />
            <Pane name="labels" style={{ zIndex: 450 }} className={m.labels}>
              <TileLayer key={dark ? "dark-ref" : "light-ref"} url={(dark ? TILES.dark : TILES.light).ref} maxZoom={16} maxNativeZoom={16} opacity={0.9} />
            </Pane>
            <ZoomBottomRight />
            <Fit points={points} />
            {site && <Rings site={site} dark={dark} />}
            {site && (
              <Marker position={[site.lat, site.lng]} icon={siteIcon} zIndexOffset={3000} keyboard={false}>
                <Tooltip direction="top" className={m.tip} opacity={1}>
                  <b>Project site</b>
                  <small>{site.label}</small>
                </Tooltip>
              </Marker>
            )}
            <Pins pins={pins} selected={selected} active={active} onSelect={onSelect} onHover={onHover} />
          </MapContainer>
          <div className={m.legend} aria-hidden>
            {site && (
              <span>
                <i className={m.lSite} />
                Site
              </span>
            )}
            {(["green", "yellow", "red"] as const)
              .filter((v) => verdicts.has(v))
              .map((v) => (
                <span key={v}>
                  <i className={m.lDot} style={{ background: `var(--${v === "green" ? "success" : v === "yellow" ? "caution" : "destructive"})` }} />
                  {WORD[v]}
                </span>
              ))}
            {site && (
              <span className={m.legendRings}>
                <i className={m.lRing} />
                {RINGS.join(" / ")} km
              </span>
            )}
          </div>
        </div>
      )}
      {open && hint && <small className={m.hint}>{hint}</small>}
    </section>
  );
}

function ZoomBottomRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "bottomright" }).addTo(map);
    map.attributionControl?.setPrefix(false); // keep the credit line short; the tile credits stay
    return () => {
      z.remove();
    };
  }, [map]);
  return null;
}
