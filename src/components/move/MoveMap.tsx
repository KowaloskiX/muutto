"use client";

// The move map: the workplace as a labelled black diamond, the ranked areas as numbered pins
// coloured by fit, listing dots, and each area's measured transit time as a small tag. No
// isochrone rings: we only draw what was measured. Client-only (next/dynamic, ssr: false).
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Pane, TileLayer, Tooltip, useMap } from "react-leaflet";
import { FIT_WORD, type Tone } from "./model";
import m from "@/components/case/Map.module.css";
import x from "./Move.module.css";

export type AreaPin = { key: string; lat: number; lng: number; label: string; rank?: number; tone: Tone; sub?: string; tag?: string };
export type ListingDot = { key: string; lat: number; lng: number; label: string; sub?: string };
type Work = { lat: number; lng: number; label: string };

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = {
  light: { base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
  dark: { base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
};
const ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const PAD = { paddingTopLeft: [48, 64] as L.PointTuple, paddingBottomRight: [48, 40] as L.PointTuple, maxZoom: 14 };
const TONE_VAR: Record<Tone, string> = { green: "success", yellow: "caution", red: "destructive", grey: "faint" };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fit(map: L.Map, points: [number, number][], animate: boolean) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView(points[0], 12, { animate });
    return;
  }
  const b = L.latLngBounds(points);
  if (animate) map.flyToBounds(b, { ...PAD, duration: 0.7 });
  else map.fitBounds(b, { ...PAD, animate: false });
}

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const sig = points.map((p) => p.join(",")).join(";");
  const latest = useRef(points);
  latest.current = points;
  const first = useRef(true);
  useEffect(() => {
    fit(map, points, !first.current && !reduced());
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  useEffect(() => {
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

const zOf = (p: AreaPin) => 500 - (p.rank ?? 40) * 10;

function Pins({ pins, hover, active, onSelect, onHover }: { pins: AreaPin[]; hover?: string; active?: string; onSelect: (k: string) => void; onHover?: (k?: string) => void }) {
  const refs = useRef<Record<string, L.Marker | null>>({});
  const sig = pins.map((p) => `${p.key}:${p.rank}:${p.tone}:${p.tag}`).join("|");
  const icons = useMemo(() => {
    const out: Record<string, L.DivIcon> = {};
    for (const p of pins)
      out[p.key] = L.divIcon({
        className: m.icon,
        html: `<span class="${x.pinWrap}"><span class="${m.pin} ${m[`v_${p.tone}`]}">${p.rank ?? "•"}</span>${p.tag ? `<em class="${x.pinTag}">${p.tag}</em>` : ""}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        tooltipAnchor: [0, -16],
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    for (const p of pins) {
      const mk = refs.current[p.key];
      if (!mk) continue;
      const on = p.key === hover || p.key === active;
      mk.getElement()?.classList.toggle(m.on, on);
      mk.setZIndexOffset(on ? 2000 : zOf(p));
    }
    if (prev.current && prev.current !== hover) refs.current[prev.current]?.closeTooltip();
    if (hover && hover !== active) refs.current[hover]?.openTooltip();
    prev.current = hover;
  }, [pins, hover, active, icons]);
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
          eventHandlers={{ click: () => onSelect(p.key), mouseover: () => onHover?.(p.key), mouseout: () => onHover?.(undefined) }}
        >
          <Tooltip direction="top" className={m.tip} opacity={1}>
            <b>{p.label}</b>
            <span className={m.tipV}>
              <i style={{ background: `var(--${TONE_VAR[p.tone]})` }} />
              {p.sub}
            </span>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

function ZoomBottomRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: "bottomright" }).addTo(map);
    map.attributionControl?.setPrefix(false);
    return () => {
      z.remove();
    };
  }, [map]);
  return null;
}

export default function MoveMap({
  work,
  pins,
  dots,
  hover,
  active,
  onSelect,
  onSelectListing,
  onHover,
}: {
  work?: Work;
  pins: AreaPin[];
  dots: ListingDot[];
  hover?: string;
  active?: string;
  onSelect: (key: string) => void;
  onSelectListing: (key: string) => void;
  onHover?: (key?: string) => void;
}) {
  const dark = useDark();
  const points = useMemo<[number, number][]>(() => [...(work ? [[work.lat, work.lng] as [number, number]] : []), ...pins.map((p) => [p.lat, p.lng] as [number, number])], [work, pins]);
  const workIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${m.site}"><i></i><b>Work</b></span>`, iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -14] }), []);
  const dotIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${x.dot}"></span>`, iconSize: [10, 10], iconAnchor: [5, 5], tooltipAnchor: [0, -8] }), []);
  const center: [number, number] = points[0] ?? [60.19, 24.94];
  const tones = new Set(pins.map((p) => p.tone));

  return (
    <div className={`${m.box} ${m.vars} ${x.mapBox}`}>
      <MapContainer center={center} zoom={11} maxZoom={17} scrollWheelZoom={false} zoomControl={false} className={m.leaflet} attributionControl>
        <TileLayer key={dark ? "dark" : "light"} attribution={ATTRIBUTION} url={(dark ? TILES.dark : TILES.light).base} maxZoom={17} maxNativeZoom={16} />
        <Pane name="labels" style={{ zIndex: 450 }} className={m.labels}>
          <TileLayer key={dark ? "dark-ref" : "light-ref"} url={(dark ? TILES.dark : TILES.light).ref} maxZoom={17} maxNativeZoom={16} opacity={0.9} />
        </Pane>
        <ZoomBottomRight />
        <Fit points={points} />
        {dots.map((d) => (
          <Marker key={d.key} position={[d.lat, d.lng]} icon={dotIcon} zIndexOffset={100} title={d.label} eventHandlers={{ click: () => onSelectListing(d.key) }}>
            <Tooltip direction="top" className={m.tip} opacity={1}>
              <b>{d.label}</b>
              {d.sub && <small>{d.sub}</small>}
            </Tooltip>
          </Marker>
        ))}
        {work && (
          <Marker position={[work.lat, work.lng]} icon={workIcon} zIndexOffset={3000} keyboard={false}>
            <Tooltip direction="top" className={m.tip} opacity={1}>
              <b>Work</b>
              <small>{work.label}</small>
            </Tooltip>
          </Marker>
        )}
        <Pins pins={pins} hover={hover} active={active} onSelect={onSelect} onHover={onHover} />
      </MapContainer>
      <div className={m.legend} aria-hidden>
        {work && (
          <span>
            <i className={m.lSite} />
            Work
          </span>
        )}
        {(["green", "yellow", "red"] as const)
          .filter((t) => tones.has(t))
          .map((t) => (
            <span key={t}>
              <i className={m.lDot} style={{ background: `var(--${TONE_VAR[t]})` }} />
              {FIT_WORD[t]}
            </span>
          ))}
        {dots.length > 0 && (
          <span>
            <i className={x.lListing} />
            Listing
          </span>
        )}
        {pins.some((p) => p.tag) && <span className={x.legendTag}>min = transit to work</span>}
      </div>
    </div>
  );
}
