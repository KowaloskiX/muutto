// Small TTL cache for real API results (Exa responses, LLM intent parses, per-company
// verification reports). Nothing here is invented: every value was produced by an
// earlier live call and carries the time it was fetched (`at`), so the UI can say
// "checked 12 min ago". Lives in process memory (kept across dev hot reloads via
// globalThis) and is mirrored to a JSON file in the OS temp dir so a server restart
// before the demo doesn't lose the warm-up. KILP_CACHE=0 disables it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Entry = { v: unknown; at: number };
type Store = { map: Map<string, Entry>; inflight: Map<string, Promise<unknown>>; loaded: boolean; timer?: ReturnType<typeof setTimeout> };

const FILE = process.env.KILP_CACHE_FILE || join(tmpdir(), "kilpailutus-cache", "cache-v1.json");
const MAX_ENTRIES = 3000;
// Nothing older than this is ever served, whatever TTL a caller asks for.
const HARD_MAX_AGE = 24 * 3600 * 1000;

const g = globalThis as unknown as { __kilpCache?: Store };
const store: Store = (g.__kilpCache ??= { map: new Map(), inflight: new Map(), loaded: false });

export const cacheEnabled = () => process.env.KILP_CACHE !== "0";

// LIVE mode (default): every search, register read and report is computed fresh on each
// request. Only map geocodes (static addresses, Nominatim allows 1 req/s) are reused, and
// identical Exa calls are de-duplicated for 2 minutes so one run never pays twice.
// KILP_LIVE=0 turns the full replay cache back on (offline backup for a flaky venue network).
export const liveMode = () => process.env.KILP_LIVE !== "0";
// Static open datasets (postal areas, sensor/station metadata) may be reused for 24 h.
const LIVE_MAX_AGE: Record<string, number> = { geo: HARD_MAX_AGE, exa: 30 * 60_000, paavo: HARD_MAX_AGE, "digitraffic-tms": HARD_MAX_AGE, "digitraffic-rail": HARD_MAX_AGE, "osm-pois": HARD_MAX_AGE };

function load() {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const rows = JSON.parse(readFileSync(FILE, "utf8")) as [string, Entry][];
    const now = Date.now();
    for (const [k, e] of rows) if (now - e.at < HARD_MAX_AGE && !store.map.has(k)) store.map.set(k, e);
  } catch {
    /* no file yet / unreadable: start empty */
  }
}

function persistSoon() {
  if (store.timer) return;
  store.timer = setTimeout(() => {
    store.timer = undefined;
    try {
      mkdirSync(join(FILE, ".."), { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify([...store.map.entries()]));
      renameSync(tmp, FILE);
    } catch {
      /* memory cache still works */
    }
  }, 1500);
  store.timer.unref?.();
}

const k = (ns: string, key: string) => `${ns}:${createHash("sha1").update(key).digest("hex")}`;

export type Hit<T> = { value: T; at: number; ageMs: number };

/** A cached value no older than `maxAgeMs`, or undefined. */
export function cacheGet<T>(ns: string, key: string, maxAgeMs: number): Hit<T> | undefined {
  if (!cacheEnabled()) return undefined;
  if (liveMode()) {
    const cap = LIVE_MAX_AGE[ns] ?? 0;
    if (!cap) return undefined;
    maxAgeMs = Math.min(maxAgeMs, cap);
  }
  load();
  const e = store.map.get(k(ns, key));
  if (!e) return undefined;
  const ageMs = Date.now() - e.at;
  if (ageMs > Math.min(maxAgeMs, HARD_MAX_AGE)) return undefined;
  return { value: e.v as T, at: e.at, ageMs };
}

export function cacheSet<T>(ns: string, key: string, value: T, at = Date.now()): void {
  if (!cacheEnabled()) return;
  load();
  const id = k(ns, key);
  store.map.delete(id); // re-insert so Map order stays oldest-first
  store.map.set(id, { v: value, at });
  while (store.map.size > MAX_ENTRIES) store.map.delete(store.map.keys().next().value!);
  persistSoon();
}

/**
 * Return a cached value younger than `ttlMs`, else run `fn` once (concurrent callers
 * with the same key share one in-flight call) and cache its result. Failures are not cached.
 */
export async function cached<T>(ns: string, key: string, ttlMs: number, fn: () => Promise<T>): Promise<Hit<T> & { hit: boolean }> {
  const hit = cacheGet<T>(ns, key, ttlMs);
  if (hit) return { ...hit, hit: true };
  if (!cacheEnabled()) return { value: await fn(), at: Date.now(), ageMs: 0, hit: false };
  const id = k(ns, key);
  let p = store.inflight.get(id) as Promise<T> | undefined;
  if (!p) {
    p = fn().then((v) => {
      cacheSet(ns, key, v);
      return v;
    });
    store.inflight.set(id, p);
    p.then(
      () => store.inflight.delete(id),
      () => store.inflight.delete(id),
    );
  }
  const value = await p;
  return { value, at: Date.now(), ageMs: 0, hit: false };
}

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
