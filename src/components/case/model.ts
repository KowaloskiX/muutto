// The case file is derived from the chat's state: nothing here is stored twice.
import type { Ranked, Why } from "@/lib/rationale";
import type { CompanyReport, Check, Status } from "@/lib/verify";
import type { Place } from "@/lib/exa";
import { keyFinding } from "@/components/chat/Bubbles";

export type Verdict = Status;

/** One subcontractor in the case file: ranked (search finished), live (still being checked) or checked on its own. */
export type Cand = {
  key: string;
  name: string;
  domain?: string;
  site?: string;
  place: Place;
  report?: CompanyReport;
  why: Why[];
  fit?: number;
  rank?: number;
  status: "scanning" | "done" | "failed";
  origin: "ranked" | "live" | "checked";
};

export const hostOf = (u?: string) => {
  if (!u) return "";
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export const keyOf = (report: CompanyReport | undefined, place: Place, domain?: string) => report?.domain ?? domain ?? (hostOf(place.website) || report?.name || place.name);

export function fromRanked(r: Ranked, rank?: number, origin: Cand["origin"] = "ranked"): Cand {
  return {
    key: keyOf(r.report, r.place),
    name: r.report.name || r.place.name,
    domain: r.report.domain || hostOf(r.place.website ?? r.report.website) || undefined,
    site: r.place.website ?? r.report.website,
    place: r.place,
    report: r.report,
    why: r.why,
    fit: r.fit,
    rank,
    status: "done",
    origin,
  };
}

/**
 * Red: any red finding. Yellow: any yellow public check or reason (a reviews issue or an
 * ID/website mismatch is surfaced even when the fit is high), or a middling fit. Grey: not checked yet.
 */
export function verdict(c: Cand): Verdict {
  if (!c.report || c.status !== "done") return "grey";
  const st = [...c.report.checks.filter((k) => !k.needsDocument).map((k) => k.status), ...c.why.map((w) => w.status)];
  if (st.includes("red")) return "red";
  if (st.includes("yellow") || (c.fit != null && c.fit < 60)) return "yellow";
  return "green";
}

export type Finding = { status: Status; label: string; text: string; quote?: string; sources: { url: string; quote?: string }[] };

const firstSentence = (t: string) => (t.match(/[^.!?]+[.!?]+/)?.[0] ?? t).trim();
const tidy = (q: string, n = 160) => {
  const t = q.replace(/[#*|`>]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t;
};

/** The one finding that explains the verdict: the chat's key finding, or the public check that made it yellow/red. */
export function findingOf(c: Cand): Finding | null {
  if (!c.report || c.status !== "done") return null;
  const v = verdict(c);
  const k = keyFinding({ place: c.place, report: c.report, why: c.why, fit: c.fit ?? 0 });
  if (v === "green" || v === "grey" || (k && k.status === v)) return k;
  const flag = c.report.checks.find((x) => !x.needsDocument && x.status === v);
  if (!flag) return k;
  const ev = flag.evidence.filter((e) => e.url && /^https?:/i.test(e.url));
  const q = ev.find((e) => e.quote && e.quote.trim().length > 12)?.quote;
  const detail = flag.detail.replace(/^Found \d+ issue\(s\) in reviews or news\.\s*/, "");
  const label = flag.label.replace(/^Tilaajavastuu:\s*/i, "");
  return {
    status: v,
    label: v === "red" ? "Red flag" : "Clarify first",
    text: `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${firstSentence(detail)}`,
    quote: q ? tidy(q) : undefined,
    sources: ev.map((e) => ({ url: e.url, quote: e.quote })),
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = { green: "Looks clear", yellow: "Clarify first", red: "Red flag", grey: "Checking" };

export const isTv = (k: Check) => k.group === "tilaajavastuu";
export const isDoc = (k: Check) => !!k.needsDocument;

/** "6/9 checks · 3 docs to request": the tilaajavastuu checklist when present, else every check. */
export function compliance(r?: CompanyReport) {
  if (!r) return null;
  const tv = r.checks.filter(isTv);
  const base = tv.length ? tv : r.checks;
  const verified = base.filter((k) => !k.needsDocument && k.status === "green").length;
  const docs = r.documents?.length ?? base.filter(isDoc).length;
  const red = base.filter((k) => k.status === "red").length;
  return { verified, total: base.length, docs, red, b2b: tv.length > 0 };
}

/** What to geocode for a candidate without coordinates: the registered address, else the listing's. */
export function addressOf(c: Cand): string | undefined {
  const a = c.report?.registry?.addresses?.find((x) => x && /\d{5}/.test(x)) ?? c.report?.registry?.addresses?.[0] ?? c.place.address ?? c.report?.profile?.city;
  return a?.trim() || undefined;
}

export type LatLng = { lat: number; lng: number };

export function km(a: LatLng, b: LatLng) {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const fmtKm = (d: number) => (d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`);

// ---- client-side geocoding through /api/geocode (memoised per address) ----------
export type Geo = LatLng & { label?: string; precision?: string };
const geoMemo = new Map<string, Promise<Geo | null>>();

export function geocodeClient(q: string): Promise<Geo | null> {
  const key = q.trim().toLowerCase();
  const hit = geoMemo.get(key);
  if (hit) return hit;
  const p = fetch("/api/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: [q] }) })
    .then((r) => (r.ok ? r.json() : { results: [] }))
    .then((d: { results?: (Geo | null)[] }) => d.results?.[0] ?? null)
    .catch(() => null);
  geoMemo.set(key, p);
  p.then((v) => {
    if (!v) setTimeout(() => geoMemo.delete(key), 60_000);
  });
  return p;
}
