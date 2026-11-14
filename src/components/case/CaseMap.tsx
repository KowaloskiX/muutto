"use client";

// Leaflet map of the project site and the candidate subcontractors. Client-only: loaded
// with next/dynamic({ ssr: false }) from CaseFile, because Leaflet touches `window` on import.
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Verdict } from "./model";
import s from "./Case.module.css";

export type Pin = { key: string; lat: number; lng: number; label: string; rank?: number; verdict: Verdict; sub?: string };

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const sig = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 11);
    else map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 12 });
    // Only refit when the set of points changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  useEffect(() => {
    // The map lives in panels that open and resize (mobile sheet, drawer): keep tiles in sync.
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function CaseMap({ site, pins, selected, onSelect }: { site?: { lat: number; lng: number; label: string }; pins: Pin[]; selected?: string; onSelect: (key: string) => void }) {
  const points = useMemo<[number, number][]>(() => [...(site ? [[site.lat, site.lng] as [number, number]] : []), ...pins.map((p) => [p.lat, p.lng] as [number, number])], [site, pins]);
  const siteIcon = useMemo(() => L.divIcon({ className: s.leafIcon, html: `<span class="${s.sitePin}"><i></i></span>`, iconSize: [34, 34], iconAnchor: [17, 31] }), []);
  const center: [number, number] = points[0] ?? [60.2, 24.8];
  return (
    <MapContainer center={center} zoom={10} scrollWheelZoom={false} className={s.leaflet} attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={points} />
      {site && (
        <Marker position={[site.lat, site.lng]} icon={siteIcon} zIndexOffset={1000}>
          <Tooltip direction="top" offset={[0, -28]}>Project site · {site.label}</Tooltip>
        </Marker>
      )}
      {pins.map((p) => {
        const on = p.key === selected;
        const icon = L.divIcon({
          className: s.leafIcon,
          html: `<span class="${s.pin} ${s[`pin_${p.verdict}`]} ${on ? s.pinOn : ""}">${p.rank ?? "•"}</span>`,
          iconSize: on ? [34, 34] : [26, 26],
          iconAnchor: on ? [17, 17] : [13, 13],
        });
        return (
          <Marker key={p.key} position={[p.lat, p.lng]} icon={icon} zIndexOffset={on ? 900 : 0} eventHandlers={{ click: () => onSelect(p.key) }}>
            <Tooltip direction="top" offset={[0, -12]}>
              <b>{p.label}</b>
              {p.sub && (
                <>
                  <br />
                  {p.sub}
                </>
              )}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
