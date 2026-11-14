// Small shared helpers for the /api/move pipeline: fetch with timeout, a concurrency pool,
// TM35FIN -> WGS84 conversion (Statistics Finland publishes centroids in EPSG:3067), and
// Helsinki-time helpers. No data lives here.
import type { LatLng } from "./types";

export const UA = "muutto-junction-demo (hackathon prototype)";

export async function fetchJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { "User-Agent": UA, Accept: "application/json", ...(rest.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const { timeoutMs = 10_000, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { "User-Agent": UA, ...(rest.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.text();
}

/** Runs `fn` over items with at most `n` in flight; keeps order. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** A simple shared limiter for one host (e.g. max 4 concurrent WFS calls). */
export function limiter(max: number) {
  let active = 0;
  const q: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => q.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      q.shift()?.();
    }
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Point `m` metres from `p` towards bearing `deg`. */
export function offset(p: LatLng, m: number, deg: number): LatLng {
  const r = (deg * Math.PI) / 180;
  return { lat: p.lat + (m * Math.cos(r)) / 111_320, lng: p.lng + (m * Math.sin(r)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

/** ETRS-TM35FIN (EPSG:3067) -> WGS84, inverse transverse Mercator on GRS80. */
export function tm35ToWgs(e: number, n: number): LatLng {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lon0 = (27 * Math.PI) / 180;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = e - 500000;
  const M = n / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const T1 = Math.tan(phi1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lng: (lon * 180) / Math.PI };
}

/** Wall-clock parts of `d` in Europe/Helsinki. */
export function helsinkiParts(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { y: parts.year, m: parts.month, d: parts.day, hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: parts.weekday as string };
}

/** Helsinki UTC offset like "+02:00" at instant `d`. */
export function helsinkiOffset(d = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+02:00";
}

/** Next weekday (Mon–Fri, strictly after today) at hh:mm Helsinki time, as an ISO string with offset. */
export function nextWeekdayAt(hh: number, mm: number, from = new Date()): string {
  const d = new Date(from.getTime());
  for (let i = 1; i <= 7; i++) {
    const c = new Date(d.getTime() + i * 86400_000);
    const p = helsinkiParts(c);
    if (p.weekday !== "Sat" && p.weekday !== "Sun") return `${p.y}-${p.m}-${p.d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${helsinkiOffset(c)}`;
  }
  return from.toISOString();
}

export const today = () => new Date().toISOString().slice(0, 10);
export const fmtM = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtEur = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
export const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
