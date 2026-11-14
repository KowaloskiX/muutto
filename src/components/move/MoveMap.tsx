"use client";

// The move map. Four layers, one segmented switch (remembered per browser):
//  · Fit         — each area's postal-code outline filled by fit (pins where no outline came back)
//  · Drive time  — car minutes to work on a hex grid (GET /api/move/heat: OSRM on OpenStreetMap, no live traffic)
//  · Noise       — City of Helsinki noise survey 2022, road and street traffic Lden (official WMS)
//  · Daily life  — the selected area's pharmacies, shops, cafés, schools, parks, stops + a 500 m circle
// Listings are price pins on every layer. Only measured data is drawn: no isochrones are invented.
// Client-only (next/dynamic, ssr: false) because Leaflet touches `window`.
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Pane, Polygon, TileLayer, Tooltip, WMSTileLayer, useMap } from "react-leaflet";
import type { Area, Place } from "@/lib/move/types";
import type { HeatResponse } from "@/app/api/move/heat/route";
import { FIT_WORD, PLACE_WORD, type Tone } from "./model";
import m from "@/components/case/Map.module.css";
import x from "./Move.module.css";

export type AreaPin = {
  key: string;
  lat: number;
  lng: number;
  label: string;
  rank?: number;
  tone: Tone;
  sub?: string;
  tag?: string;
  polygon?: Area["polygon"];
};
export type ListingDot = { key: string; lat: number; lng: number; label: string; sub?: string; price?: string };
export type Spot = { lat: number; lng: number; label: string };
type Layer = "fit" | "drive" | "noise" | "daily";

const LAYERS: { id: Layer; label: string; short: string }[] = [
  { id: "fit", label: "Fit", short: "Fit" },
  { id: "drive", label: "Drive time", short: "Drive" },
  { id: "noise", label: "Noise", short: "Noise" },
  { id: "daily", label: "Daily life", short: "Daily" },
];
const LAYER_KEY = "muutto:map-layer";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = {
  light: { base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
  dark: { base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, ref: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
};
const ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const NOISE_WMS = "https://kartta.hel.fi/ws/geoserver/avoindata/wms";
const NOISE_LAYER = "avoindata:Meluselvitys_2022_Helsinki_kadut_ja_maantiet_Lden";
const NOISE_LEGEND = `${NOISE_WMS}?service=WMS&request=GetLegendGraphic&format=image/png&layer=${NOISE_LAYER}`;
const NOISE_ATTR = 'Noise: <a href="https://kartta.hel.fi/">City of Helsinki</a> noise survey 2022 (CC BY 4.0)';
const PAD = { paddingTopLeft: [48, 72] as L.PointTuple, paddingBottomRight: [48, 48] as L.PointTuple, maxZoom: 14 };
const TONE_VAR: Record<Tone, string> = { green: "success", yellow: "caution", red: "destructive", grey: "faint" };
// SVG paths can't read CSS variables from attributes: the same status colours as globals.css, per theme.
const TONE_HEX: Record<"light" | "dark", Record<Tone, string>> = {
  light: { green: "#2b7a4b", yellow: "#b25e09", red: "#c4321f", grey: "#9a968d" },
  dark: { green: "#6cc08e", yellow: "#e6a15a", red: "#f07a68", grey: "#75726b" },
};

// Drive-time bins (minutes), darkest = closest. One hue, light to dark.
const BINS: { max: number; label: string; color: string }[] = [
  { max: 10, label: "≤10", color: "#0b5a3a" },
  { max: 20, label: "≤20", color: "#3d8a5c" },
  { max: 30, label: "≤30", color: "#86b88a" },
  { max: 45, label: "≤45", color: "#c9ddb2" },
  { max: Infinity, label: ">45", color: "#ece4cf" },
];
const binOf = (min: number) => BINS.find((b) => min <= b.max) ?? BINS[BINS.length - 1];

// Daily-life place icons: 16px stroke glyphs in a white disc, one colour per kind.
const PLACE_STYLE: Record<Place["kind"], { color: string; svg: string }> = {
  pharmacy: { color: "#c4321f", svg: '<path d="M6.5 2.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z" fill="currentColor" stroke="none"/>' },
  grocery: { color: "#b25e09", svg: '<path d="M2.5 6h11l-1.4 7h-8.2z"/><path d="M5.5 6 8 2.5 10.5 6"/>' },
  cafe: { color: "#7a5230", svg: '<path d="M3 6h8v3.5A3.5 3.5 0 0 1 7.5 13h-1A3.5 3.5 0 0 1 3 9.5z"/><path d="M11 7h1a1.6 1.6 0 0 1 0 3.2h-1"/>' },
  school: { color: "#2f5d9e", svg: '<path d="M1.5 6.5 8 3.5l6.5 3L8 9.5z"/><path d="M4.5 8v3c2 1.5 5 1.5 7 0V8"/>' },
  daycare: { color: "#2f5d9e", svg: '<circle cx="8" cy="5" r="2.2"/><path d="M4 14c0-3 1.8-5 4-5s4 2 4 5"/>' },
  park: { color: "#2b7a4b", svg: '<circle cx="8" cy="6.5" r="4"/><path d="M8 10.5V15"/>' },
  transit: { color: "#6b4fa0", svg: '<rect x="3.5" y="2" width="9" height="10" rx="2"/><path d="M3.5 8h9M5.5 14.5l1-2.5M10.5 14.5l-1-2.5"/>' },
};
const placeIcon = (k: Place["kind"]) =>
  L.divIcon({
    className: m.icon,
    html: `<span class="${x.placeIcon}" style="color:${PLACE_STYLE[k].color}"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PLACE_STYLE[k].svg}</svg></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    tooltipAnchor: [0, -10],
  });

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fitTo(map: L.Map, points: [number, number][], animate: boolean) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView(points[0], 13, { animate });
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
    // Debounced: areas stream in quickly, and overlapping flights leave the map half-zoomed.
    const animate = !first.current && !reduced();
    const t = setTimeout(() => fitTo(map, latest.current, animate), first.current ? 0 : 350);
    first.current = false;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  useEffect(() => {
    const el = map.getContainer();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      clearTimeout(t);
      t = setTimeout(() => fitTo(map, latest.current, false), 120);
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

/** GeoJSON [lng, lat] rings → Leaflet [lat, lng] positions (Polygon or MultiPolygon). */
function positions(g: NonNullable<Area["polygon"]>): L.LatLngExpression[][] | L.LatLngExpression[][][] {
  const ring = (r: number[][]) => r.map(([lng, lat]) => [lat, lng] as [number, number]);
  return g.type === "Polygon" ? g.coordinates.map(ring) : g.coordinates.map((poly) => poly.map(ring));
}

const zOf = (p: AreaPin) => 500 - (p.rank ?? 40) * 10;

function Pins({ pins, hover, active, small, onSelect, onHover }: { pins: AreaPin[]; hover?: string; active?: string; small?: boolean; onSelect: (k: string) => void; onHover?: (k?: string) => void }) {
  const refs = useRef<Record<string, L.Marker | null>>({});
  const sig = pins.map((p) => `${p.key}:${p.rank}:${p.tone}:${p.tag}`).join("|") + (small ? "s" : "");
  const icons = useMemo(() => {
    const out: Record<string, L.DivIcon> = {};
    for (const p of pins)
      out[p.key] = L.divIcon({
        className: m.icon,
        html: `<span class="${x.pinWrap} ${small ? x.pinSmall : ""}"><span class="${m.pin} ${m[`v_${p.tone}`]}">${p.rank ?? "•"}</span>${p.tag && !small ? `<em class="${x.pinTag}">${p.tag}</em>` : ""}</span>`,
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

function Shapes({ pins, hover, active, dark, onSelect, onHover, outline }: { pins: AreaPin[]; hover?: string; active?: string; dark: boolean; onSelect: (k: string) => void; onHover?: (k?: string) => void; outline?: boolean }) {
  const shaped = pins.filter((p) => p.polygon);
  const pos = useMemo(() => Object.fromEntries(shaped.map((p) => [p.key, positions(p.polygon!)])), [shaped]);
  const ink = dark ? "#f2f1ed" : "#0d1016";
  return (
    <>
      {shaped.map((p) => {
        const on = p.key === hover || p.key === active;
        const fill = TONE_HEX[dark ? "dark" : "light"][p.tone];
        return (
          <Polygon
            key={`${p.key}-${outline ? "o" : "f"}`}
            positions={pos[p.key] as L.LatLngExpression[][]}
            pathOptions={{
              color: outline ? ink : on ? ink : fill,
              weight: on ? 2.5 : outline ? 1 : 1.25,
              opacity: outline ? (on ? 0.7 : 0.25) : on ? 0.9 : 0.7,
              dashArray: outline ? "3 4" : undefined,
              fillColor: fill,
              fillOpacity: outline ? 0 : on ? 0.42 : 0.24,
            }}
            eventHandlers={{ click: () => onSelect(p.key), mouseover: () => onHover?.(p.key), mouseout: () => onHover?.(undefined) }}
          >
            {!outline && (
              <Tooltip sticky className={m.tip} opacity={1}>
                <b>{p.label}</b>
                <span className={m.tipV}>
                  <i style={{ background: fill }} />
                  {p.sub}
                </span>
              </Tooltip>
            )}
          </Polygon>
        );
      })}
    </>
  );
}

/** Hexes coloured by car minutes; circumradius from the grid spacing. */
function Heat({ data, dark }: { data: HeatResponse; dark: boolean }) {
  const hexes = useMemo(() => {
    const R = data.spacingKm / Math.sqrt(3);
    return data.cells.map((c) => {
      const kLat = 110.574;
      const kLng = 111.32 * Math.cos((c.lat * Math.PI) / 180);
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = ((60 * i + 30) * Math.PI) / 180;
        pts.push([c.lat + (R * Math.sin(a)) / kLat, c.lng + (R * Math.cos(a)) / kLng]);
      }
      return { c, pts, bin: binOf(c.min) };
    });
  }, [data]);
  return (
    <Pane name="heat" style={{ zIndex: 420 }}>
      {hexes.map(({ c, pts, bin }) => (
        <Polygon key={`${c.lat},${c.lng}`} positions={pts} pathOptions={{ stroke: true, color: bin.color, weight: 0.5, opacity: 0.5, fillColor: bin.color, fillOpacity: dark ? 0.36 : 0.5 }}>
          <Tooltip sticky className={m.tip} opacity={1}>
            <b>{Math.round(c.min)} min by car</b>
            <small>free-flow, no live traffic</small>
          </Tooltip>
        </Polygon>
      ))}
    </Pane>
  );
}

type HeatState = { key: string; data?: HeatResponse; error?: string };

export default function MoveMap({
  work,
  pins,
  dots,
  places,
  placesFor,
  circle,
  airStations,
  hover,
  active,
  onSelect,
  onSelectListing,
  onHover,
}: {
  work?: Spot;
  pins: AreaPin[];
  dots: ListingDot[];
  /** Daily-life layer: the places of the selected (or best) area. */
  places: Place[];
  placesFor?: string;
  /** Centre of the 500 m circle: the open listing, else the selected area. */
  circle?: Spot;
  /** Air-quality stations, only when the API gave their coordinates. */
  airStations?: Spot[];
  hover?: string;
  active?: string;
  onSelect: (key: string) => void;
  onSelectListing: (key: string) => void;
  onHover?: (key?: string) => void;
}) {
  const dark = useDark();
  const [layer, setLayerState] = useState<Layer>("fit");
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAYER_KEY) as Layer | null;
      if (v && LAYERS.some((l) => l.id === v)) setLayerState(v);
    } catch {
      /* storage blocked */
    }
  }, []);
  const setLayer = (l: Layer) => {
    setLayerState(l);
    try {
      localStorage.setItem(LAYER_KEY, l);
    } catch {
      /* storage blocked */
    }
  };

  // Drive-time grid: fetched once per workplace, only when the layer is opened.
  const [heat, setHeat] = useState<HeatState | undefined>();
  const heatKey = work ? `${work.lat.toFixed(3)},${work.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (layer !== "drive" || !work || heat?.key === heatKey) return;
    let stop = false;
    setHeat({ key: heatKey });
    fetch(`/api/move/heat?lat=${work.lat}&lng=${work.lng}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as HeatResponse;
      })
      .then((data) => !stop && setHeat({ key: heatKey, data }))
      .catch((e: Error) => !stop && setHeat({ key: heatKey, error: e.message }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, heatKey]);

  const points = useMemo<[number, number][]>(() => [...(work ? [[work.lat, work.lng] as [number, number]] : []), ...pins.map((p) => [p.lat, p.lng] as [number, number])], [work, pins]);
  // Daily life zooms to the focused area: its places and the 500 m circle.
  const dailyPoints = useMemo<[number, number][]>(() => {
    const pts = places.map((p) => [p.geo.lat, p.geo.lng] as [number, number]);
    if (circle) {
      const dLat = 500 / 110574;
      const dLng = 500 / (111320 * Math.cos((circle.lat * Math.PI) / 180));
      pts.push([circle.lat - dLat, circle.lng - dLng], [circle.lat + dLat, circle.lng + dLng]);
    }
    return pts;
  }, [places, circle]);
  const workIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${m.site}"><i></i><b>Work</b></span>`, iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -14] }), []);
  const center: [number, number] = points[0] ?? [60.19, 24.94];
  const tones = new Set(pins.map((p) => p.tone));
  const hasShapes = pins.some((p) => p.polygon);
  const kinds = [...new Set(places.map((p) => p.kind))];
  const dotIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${x.dot}"></span>`, iconSize: [10, 10], iconAnchor: [5, 5], tooltipAnchor: [0, -8] }), []);
  const priceIcon = (d: ListingDot) =>
    L.divIcon({ className: m.icon, html: `<span class="${x.pricePin}">${d.price ?? "•"}</span>`, iconSize: [0, 0], iconAnchor: [0, 0], tooltipAnchor: [0, -26] });

  let legend: React.ReactNode;
  let caption: React.ReactNode = null;
  if (layer === "drive") {
    legend = (
      <>
        <span className={x.lgTitle}>Car to work, min</span>
        {BINS.map((b) => (
          <span key={b.label}>
            <i className={x.lgSwatch} style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </>
    );
    caption = !work ? (
      "No workplace location, so no drive times."
    ) : heat?.error ? (
      <span className={x.capErr}>{heat.error}</span>
    ) : !heat?.data ? (
      "Routing a grid around the workplace…"
    ) : (
      <>
        Car, typical ({heat.data.source.label}) — no live traffic. {heat.data.cells.length} cells of {heat.data.spacingKm} km; {heat.data.dropped} off-road points (sea, forest) left blank.
      </>
    );
  } else if (layer === "noise") {
    legend = (
      <>
        <span className={x.lgTitle}>Road traffic noise, Lden dB</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={x.lgImg} src={NOISE_LEGEND} alt="Noise classes 40 to 75 dB" />
      </>
    );
    caption = "Streets and roads, Lden (day-evening-night). City of Helsinki noise survey 2022; covers Helsinki only, not Espoo or Vantaa.";
  } else if (layer === "daily") {
    legend = kinds.length ? (
      <>
        {kinds.map((k) => (
          <span key={k}>
            <i className={x.lgPlace} style={{ color: PLACE_STYLE[k].color }} />
            {PLACE_WORD[k]}
          </span>
        ))}
        {circle && (
          <span>
            <i className={m.lRing} />
            500 m
          </span>
        )}
      </>
    ) : (
      <span>No places returned{placesFor ? ` for ${placesFor}` : ""}</span>
    );
    caption = placesFor ? `Everyday places around ${placesFor}${circle ? `; circle = 500 m around ${circle.label}` : ""}. Open another area to switch.` : null;
  } else {
    legend = (
      <>
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
        {pins.some((p) => p.tag) && <span className={x.legendTag}>min = transit to work</span>}
      </>
    );
    caption = !hasShapes && pins.length ? "Postal-area outlines not available; areas shown as pins." : null;
  }

  return (
    <div className={x.mapWrap}>
      <div className={`${m.box} ${m.vars} ${x.mapBox}`}>
        <MapContainer center={center} zoom={11} maxZoom={17} scrollWheelZoom={false} zoomControl={false} className={m.leaflet} attributionControl>
          <TileLayer key={dark ? "dark" : "light"} attribution={ATTRIBUTION} url={(dark ? TILES.dark : TILES.light).base} maxZoom={17} maxNativeZoom={16} />
          {layer === "noise" && (
            <WMSTileLayer
              key="noise"
              url={NOISE_WMS}
              params={{ layers: NOISE_LAYER, format: "image/png", transparent: true, version: "1.1.1" } as L.WMSParams}
              opacity={dark ? 0.55 : 0.6}
              attribution={NOISE_ATTR}
              zIndex={5}
            />
          )}
          <Pane name="labels" style={{ zIndex: 450 }} className={m.labels}>
            <TileLayer key={dark ? "dark-ref" : "light-ref"} url={(dark ? TILES.dark : TILES.light).ref} maxZoom={17} maxNativeZoom={16} opacity={0.9} />
          </Pane>
          <ZoomBottomRight />
          <Fit points={layer === "daily" && places.length ? dailyPoints : points} />
          {layer === "fit" && <Shapes pins={pins} hover={hover} active={active} dark={dark} onSelect={onSelect} onHover={onHover} />}
          {layer === "daily" && <Shapes pins={pins} hover={hover} active={active} dark={dark} onSelect={onSelect} onHover={onHover} outline />}
          {layer === "drive" && heat?.data && <Heat data={heat.data} dark={dark} />}
          {layer === "daily" && circle && (
            <Circle center={[circle.lat, circle.lng]} radius={500} interactive={false} pathOptions={{ color: dark ? "#f2f1ed" : "#0d1016", weight: 1.25, opacity: 0.6, dashArray: "4 5", fillOpacity: dark ? 0.06 : 0.04 }} />
          )}
          {layer === "daily" &&
            places.map((p, i) => (
              <Marker key={`${p.kind}-${p.name}-${i}`} position={[p.geo.lat, p.geo.lng]} icon={placeIcon(p.kind)} zIndexOffset={200}>
                <Tooltip direction="top" className={m.tip} opacity={1}>
                  <b>{p.name}</b>
                  <small>
                    {PLACE_WORD[p.kind]} · {p.distanceM < 1000 ? `${Math.round(p.distanceM)} m` : `${(p.distanceM / 1000).toFixed(1)} km`}
                  </small>
                </Tooltip>
              </Marker>
            ))}
          {(airStations ?? []).map((s) => (
            <Marker key={`air-${s.lat},${s.lng}`} position={[s.lat, s.lng]} icon={L.divIcon({ className: m.icon, html: `<span class="${x.airPin}">AQ</span>`, iconSize: [22, 22], iconAnchor: [11, 11] })}>
              <Tooltip direction="top" className={m.tip} opacity={1}>
                <b>Air-quality station</b>
                <small>{s.label}</small>
              </Tooltip>
            </Marker>
          ))}
          {dots.map((d) => (
            <Marker key={`${d.key}-${layer === "fit" || layer === "daily" ? "p" : "d"}`} position={[d.lat, d.lng]} icon={layer === "fit" || layer === "daily" ? priceIcon(d) : dotIcon} zIndexOffset={1500} title={d.label} eventHandlers={{ click: () => onSelectListing(d.key) }}>
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
          <Pins pins={pins} hover={hover} active={active} small={layer !== "fit"} onSelect={onSelect} onHover={onHover} />
        </MapContainer>
        <div className={`${m.legend} ${x.legend}`} aria-live="polite">
          {legend}
        </div>
        <div className={x.layers} role="radiogroup" aria-label="Map layer">
          {LAYERS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={layer === l.id} className={layer === l.id ? x.layerOn : ""} onClick={() => setLayer(l.id)}>
              <span className={x.lFull}>{l.label}</span>
              <span className={x.lShort}>{l.short}</span>
            </button>
          ))}
        </div>
      </div>
      {caption && <small className={x.mapCaption}>{caption}</small>}
    </div>
  );
}
