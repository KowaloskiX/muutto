"use client";

// The move map. Four layers, one segmented switch (remembered per browser):
//  · Fit         — each area's postal-code outline filled by fit (pins where no outline came back)
//  · Drive time  — car-minute contours + reach slider (DriveTimeLayer; GET /api/move/heat: OSRM, no live traffic)
//  · Noise       — Helsinki noise survey 2022 (Lden) over Väylävirasto 2022 road + rail maps for the region (official WMS)
//  · Daily life  — the selected area's pharmacies, shops, cafés, schools, parks, stops + a 500 m circle
// Listings are price pins on every layer. Only measured data is drawn: no isochrones are invented.
// Client-only (next/dynamic, ssr: false) because Leaflet touches `window`.
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Pane, Polygon, TileLayer, Tooltip, WMSTileLayer, useMap } from "react-leaflet";
import type { Area, Place } from "@/lib/move/types";
import DriveTimeLayer, { DriveLegend, driveCaption, useHeat, useIso } from "./DriveTimeLayer";
import type { HeatScale } from "@/app/api/move/heat/route";
import { FIT_WORD, PLACE_WORD, placeGroup, type Tone } from "./model";
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
const NOISE_LAYER = "avoindata:Meluselvitys_2022_Helsinki_kadut_ja_maantiet_LAeq_7-22_NPM,avoindata:Meluselvitys_2022_Helsinki_juna_LAeq_7-22_NPM";
const NOISE_ATTR = 'Noise: <a href="https://kartta.hel.fi/">City of Helsinki</a> noise survey 2022 (CC BY 4.0)';
// Rest of the region: Finnish Transport Infrastructure Agency EU noise-directive maps 2022 (state roads
// + railways, daytime LAeq, CC BY 4.0), drawn under the Helsinki survey.
const VAYLA_WMS = "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows";
const VAYLA_LAYERS = "tiestotiedot:melu_paiva_maankad_22,ratatiedot:melu_paiva_rautatiet_22";
const VAYLA_ATTR = 'Noise: <a href="https://vayla.fi/">Väylävirasto</a> noise maps 2022 (CC BY 4.0)';
// The surveys' shared 5 dB classes, colours sampled from the city's own legend (Väylävirasto's matches).
const NOISE_BANDS = [
  { label: "40", color: "#d4ff7a" },
  { label: "45", color: "#aaff26" },
  { label: "50", color: "#26aa26" },
  { label: "55", color: "#ffff26" },
  { label: "60", color: "#ffdd7a" },
  { label: "65", color: "#ffaa26" },
  { label: "70", color: "#ff2626" },
  { label: "75+", color: "#a826ff" },
];
const PAD = { paddingTopLeft: [48, 72] as L.PointTuple, paddingBottomRight: [48, 48] as L.PointTuple, maxZoom: 14 };
const TONE_VAR: Record<Tone, string> = { green: "success", yellow: "caution", red: "destructive", grey: "faint" };
// SVG paths can't read CSS variables from attributes: the same status colours as globals.css, per theme.
const TONE_HEX: Record<"light" | "dark", Record<Tone, string>> = {
  light: { green: "#2b7a4b", yellow: "#b25e09", red: "#c4321f", grey: "#9a968d" },
  dark: { green: "#6cc08e", yellow: "#e6a15a", red: "#f07a68", grey: "#75726b" },
};

// Daily-life place icons: 16px stroke glyphs in a white disc, one colour per kind.
const PLACE_STYLE: Record<Place["kind"], { color: string; svg: string }> = {
  pharmacy: { color: "#c4321f", svg: '<path d="M6.5 2.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z" fill="currentColor" stroke="none"/>' },
  grocery: { color: "#b25e09", svg: '<path d="M2.5 6h11l-1.4 7h-8.2z"/><path d="M5.5 6 8 2.5 10.5 6"/>' },
  cafe: { color: "#7a5230", svg: '<path d="M3 6h8v3.5A3.5 3.5 0 0 1 7.5 13h-1A3.5 3.5 0 0 1 3 9.5z"/><path d="M11 7h1a1.6 1.6 0 0 1 0 3.2h-1"/>' },
  school: { color: "#2f5d9e", svg: '<path d="M1.5 6.5 8 3.5l6.5 3L8 9.5z"/><path d="M4.5 8v3c2 1.5 5 1.5 7 0V8"/>' },
  daycare: { color: "#2f5d9e", svg: '<circle cx="8" cy="5" r="2.2"/><path d="M4 14c0-3 1.8-5 4-5s4 2 4 5"/>' },
  park: { color: "#2b7a4b", svg: '<circle cx="8" cy="6.5" r="4"/><path d="M8 10.5V15"/>' },
  custom: { color: "#005032", svg: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="currentColor" stroke="none"/>' },
  transit: { color: "#6b4fa0", svg: '<rect x="3.5" y="2" width="9" height="10" rx="2"/><path d="M3.5 8h9M5.5 14.5l1-2.5M10.5 14.5l-1-2.5"/>' },
};
// The user's own criteria get one colour each (first, second, third), all with the star glyph.
const CUSTOM_COLORS = ["#005032", "#b0306a", "#1f6f8b"];
const placeColor = (p: Pick<Place, "kind" | "criterion">, customOrder: string[]) =>
  p.kind === "custom" ? CUSTOM_COLORS[Math.max(0, customOrder.indexOf(p.criterion ?? "")) % CUSTOM_COLORS.length] : PLACE_STYLE[p.kind].color;
const placeIcons = new Map<string, L.DivIcon>();
const placeIcon = (k: Place["kind"], color = PLACE_STYLE[k].color) => {
  const key = `${k}|${color}`;
  let ic = placeIcons.get(key);
  if (!ic) placeIcons.set(key, (ic = makePlaceIcon(k, color)));
  return ic;
};
const makePlaceIcon = (k: Place["kind"], color: string) =>
  L.divIcon({
    className: m.icon,
    html: `<span class="${x.placeIcon}" style="color:${color}"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PLACE_STYLE[k].svg}</svg></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    tooltipAnchor: [0, -10],
  });

const priceIcons = new Map<string, L.DivIcon>();
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
  // Once the user zooms or pans, the map stops fitting itself (until a different set of points,
  // i.e. a new search). It used to snap back on every resize or update.
  const userMoved = useRef(false);
  const prevSig = useRef(sig);
  useEffect(() => {
    const el = map.getContainer();
    const mark = () => (userMoved.current = true);
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("pointerdown", mark);
    el.addEventListener("touchstart", mark, { passive: true });
    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("pointerdown", mark);
      el.removeEventListener("touchstart", mark);
    };
  }, [map]);
  useEffect(() => {
    const before = new Set(prevSig.current.split(";"));
    const now = sig.split(";");
    const shared = now.filter((s) => before.has(s)).length;
    prevSig.current = sig;
    if (shared < now.length / 2) userMoved.current = false; // a different search: fit again
    if (userMoved.current) return;
    // Debounced: areas stream in quickly, and overlapping flights leave the map half-zoomed.
    const animate = !first.current && !reduced();
    const t = setTimeout(() => !userMoved.current && fitTo(map, latest.current, animate), first.current ? 0 : 350);
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
      t = setTimeout(() => !userMoved.current && fitTo(map, latest.current, false), 120);
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

/** One handler object per key that never changes identity (react-leaflet rebinds listeners when it does,
 *  which dropped mouseout events mid-hover); the latest callbacks are read through refs. */
function useStableHandlers(keys: string[], onSelect: (k: string) => void, onHover?: (k?: string) => void) {
  const sel = useRef(onSelect);
  const hov = useRef(onHover);
  sel.current = onSelect;
  hov.current = onHover;
  const cache = useRef<Record<string, L.LeafletEventHandlerFnMap>>({});
  for (const k of keys)
    cache.current[k] ??= {
      click: () => sel.current(k),
      mouseover: () => hov.current?.(k),
      mouseout: () => hov.current?.(undefined),
    };
  return cache.current;
}

function Pins({ pins, hover, active, small, onSelect, onHover }: { pins: AreaPin[]; hover?: string; active?: string; small?: boolean; onSelect: (k: string) => void; onHover?: (k?: string) => void }) {
  const refs = useRef<Record<string, L.Marker | null>>({});
  const sig = pins.map((p) => `${p.key}:${p.rank}:${p.tone}:${p.tag}`).join("|") + (small ? "s" : "");
  const handlers = useStableHandlers(pins.map((p) => p.key), onSelect, onHover);
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
    // Exactly one area tooltip at a time: close every other one (quick mouse moves left several open).
    for (const [k, mk] of Object.entries(refs.current)) if (k !== hover) mk?.closeTooltip();
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
          eventHandlers={handlers[p.key]}
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
  const shapeSig = shaped.map((p) => p.key).join("|");
  // Positions only change with the set of areas; recomputing them on hover made Leaflet redraw every shape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pos = useMemo(() => Object.fromEntries(shaped.map((p) => [p.key, positions(p.polygon!)])), [shapeSig]);
  const handlers = useStableHandlers(shaped.map((p) => p.key), onSelect, onHover);
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
              // Postal areas are published generalised (straight edges across blocks): draw them softly,
              // a firm outline only for the area in focus.
              weight: on ? 2 : outline ? 0.8 : 0.8,
              opacity: outline ? (on ? 0.6 : 0.2) : on ? 0.85 : 0.35,
              dashArray: on ? undefined : "2 4",
              lineJoin: "round",
              fillColor: fill,
              // No resting fill: the generalised coastline would spill colour over the sea.
              fillOpacity: outline ? 0 : on ? 0.22 : 0,
            }}
            eventHandlers={handlers[p.key]}
          />
        );
      })}
    </>
  );
}

/**
 * The scroll wheel scrolls the page until the map is clicked; then it zooms the map until the pointer
 * leaves it. A small hint says so. Dragging and the +/- buttons always work.
 */
function ScrollGate() {
  const map = useMap();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = map.getContainer();
    const enable = () => {
      map.scrollWheelZoom.enable();
      setOn(true);
    };
    const disable = () => {
      map.scrollWheelZoom.disable();
      setOn(false);
    };
    map.on("click", enable);
    map.on("dragstart", enable);
    el.addEventListener("mouseleave", disable);
    return () => {
      map.off("click", enable);
      map.off("dragstart", enable);
      el.removeEventListener("mouseleave", disable);
    };
  }, [map]);
  return on ? null : <div className={x.scrollHint}>Click the map to zoom with scroll</div>;
}

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
  const [scale, setScale] = useState<HeatScale>("city");
  // City scale: road-network isochrones (Valhalla); the OSRM grid is the region scale and the fallback.
  const iso = useIso(work, layer === "drive" && scale === "city");
  const heat = useHeat(work, layer === "drive" && (scale === "region" || !!iso?.error), scale);

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
  const customOrder = [...new Set(places.filter((p) => p.kind === "custom").map((p) => p.criterion ?? ""))];
  const kinds = [...new Map(places.map((p) => [placeGroup(p), placeColor(p, customOrder)] as const)).entries()];
  const dotIcon = useMemo(() => L.divIcon({ className: m.icon, html: `<span class="${x.dot}"></span>`, iconSize: [10, 10], iconAnchor: [5, 5], tooltipAnchor: [0, -8] }), []);
  const selListing = useRef(onSelectListing);
  selListing.current = onSelectListing;
  const dotH = useRef<Record<string, L.LeafletEventHandlerFnMap>>({});
  const dotHandlers = (k: string) => (dotH.current[k] ??= { click: () => selListing.current(k) });
  const priceIcon = (d: ListingDot) => {
    const key = d.price ?? "•";
    let ic = priceIcons.get(key);
    if (!ic) priceIcons.set(key, (ic = L.divIcon({ className: m.icon, html: `<span class="${x.pricePin}">${key}</span>`, iconSize: [0, 0], iconAnchor: [0, 0], tooltipAnchor: [0, -26] })));
    return ic;
  };

  let legend: React.ReactNode;
  let caption: React.ReactNode = null;
  if (layer === "drive") {
    legend = <DriveLegend scale={scale} />;
    caption = driveCaption(heat, !!work, iso, scale);
  } else if (layer === "noise") {
    legend = (
      <>
        <span className={x.lgTitle}>Traffic noise, daytime dB</span>
        <span className={x.noiseScale}>
          {NOISE_BANDS.map((b) => (
            <span key={b.label}>
              <i style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </span>
      </>
    );
    caption =
      "One measure everywhere: daytime average LAeq 7–22, 2022 surveys. Helsinki: the city's survey, every street and railway. Espoo, Vantaa and the commuter belt: Väylävirasto, state roads and railways (smaller city streets there are not mapped).";
  } else if (layer === "daily") {
    legend = kinds.length ? (
      <>
        {kinds.map(([label, color]) => (
          <span key={label}>
            <i className={x.lgPlace} style={{ color }} />
            {label}
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
      </>
    );
    caption = !hasShapes && pins.length ? "Postal-area outlines not available; areas shown as pins." : null;
  }

  return (
    <div className={x.mapWrap} data-tour="map">
      <div className={`${m.box} ${m.vars} ${x.mapBox}`}>
        <MapContainer center={center} zoom={11} maxZoom={17} scrollWheelZoom={false} zoomSnap={0.5} zoomDelta={0.5} wheelPxPerZoomLevel={120} wheelDebounceTime={30} zoomControl={false} className={m.leaflet} attributionControl>
          <ScrollGate />
          <TileLayer key={dark ? "dark" : "light"} attribution={ATTRIBUTION} url={(dark ? TILES.dark : TILES.light).base} maxZoom={17} maxNativeZoom={16} />
          {layer === "noise" && (
            <WMSTileLayer
              key="noise-vayla"
              url={VAYLA_WMS}
              params={{ layers: VAYLA_LAYERS, format: "image/png", transparent: true, version: "1.1.1" } as L.WMSParams}
              opacity={dark ? 0.45 : 0.5}
              attribution={VAYLA_ATTR}
              zIndex={4}
            />
          )}
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
          {layer === "drive" && (
            <DriveTimeLayer heat={heat} iso={iso} work={work} dots={dots} areas={pins.map((p) => ({ key: p.key, lat: p.lat, lng: p.lng, label: p.label }))} dark={dark} scale={scale} onScale={setScale} onSelectListing={onSelectListing} />
          )}
          {layer === "daily" && circle && (
            <Circle center={[circle.lat, circle.lng]} radius={500} interactive={false} pathOptions={{ color: dark ? "#f2f1ed" : "#0d1016", weight: 1.25, opacity: 0.6, dashArray: "4 5", fillOpacity: dark ? 0.06 : 0.04 }} />
          )}
          {layer === "daily" &&
            places.map((p, i) => (
              <Marker key={`${p.kind}-${p.name}-${i}`} position={[p.geo.lat, p.geo.lng]} icon={placeIcon(p.kind, placeColor(p, customOrder))} zIndexOffset={200}>
                <Tooltip direction="top" className={m.tip} opacity={1}>
                  <b>{p.name}</b>
                  <small>
                    {placeGroup(p)} · {p.distanceM < 1000 ? `${Math.round(p.distanceM)} m` : `${(p.distanceM / 1000).toFixed(1)} km`}
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
          {layer !== "drive" && dots.map((d) => (
            <Marker key={`${d.key}-${layer === "fit" || layer === "daily" ? "p" : "d"}`} position={[d.lat, d.lng]} icon={layer === "fit" || layer === "daily" ? priceIcon(d) : dotIcon} zIndexOffset={1500} title={d.label} eventHandlers={dotHandlers(d.key)}>
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
        <div className={x.layers} role="radiogroup" aria-label="Map layer" data-tour="layers">
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
