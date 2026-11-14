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

export type Finding = { status: Status; label: string; text: string; quote?: string; sources: { url: string; quote?: string }[]; check?: Check };

// A sentence ends at . ! ? followed by a space or the end, so "systempoint.fi" stays whole.
const firstSentence = (t: string) => (t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t).trim();
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
    check: flag,
  };
}

export const VERDICT_LABEL: Record<Verdict, string> = { green: "Looks clear", yellow: "Clarify first", red: "Red flag", grey: "Checking" };

export const isTv = (k: Check) => k.group === "tilaajavastuu";
export const isDoc = (k: Check) => !!k.needsDocument;

/** The public tilaajavastuu register checks (not documents), in a fixed order so candidates compare at a glance. */
const REG_ORDER = ["tv-prepayment", "tv-employer", "tv-vat", "tv-trade-register", "tv-tax", "tv-insolvency", "tv-reliable-partner"];
const REG_NAME: Record<string, string> = {
  "tv-prepayment": "Prepayment",
  "tv-employer": "Employer",
  "tv-vat": "VAT",
  "tv-trade-register": "Trade reg.",
  "tv-tax": "Tax debt",
  "tv-insolvency": "Insolvency",
  "tv-reliable-partner": "Reliable partner",
};
export function publicRegisters(r?: CompanyReport): Check[] {
  if (!r) return [];
  const rank = (c: Check) => {
    const i = REG_ORDER.indexOf(c.id);
    return i < 0 ? REG_ORDER.length : i;
  };
  return r.checks.filter((c) => isTv(c) && !isDoc(c)).sort((a, b) => rank(a) - rank(b));
}
/** "Prepayment", "Trade reg.": from the check id, else the label without the "Tilaajavastuu:" prefix. */
export function regName(c: Check): string {
  if (REG_NAME[c.id]) return REG_NAME[c.id];
  const l = c.label.replace(/^Tilaajavastuu:\s*/i, "");
  return l.charAt(0).toUpperCase() + l.slice(1);
}
export { firstSentence };

/** How a register check reads in a matrix cell: quiet when clear, a short loud word when not. */
export type CellKind = "ok" | "missing" | "clarify" | "flag" | "na";
export function cellOf(c: Check): { kind: CellKind; word: string } {
  if (c.status === "green") return { kind: "ok", word: "Clear" };
  if (c.status === "red") return { kind: "flag", word: "Flag" };
  if (c.status === "grey") return { kind: "na", word: c.action ? "Check manually" : "No data" };
  return /\bnot listed\b|^not in\b/i.test(c.detail) ? { kind: "missing", word: "Missing" } : { kind: "clarify", word: "Clarify" };
}

/**
 * "Not listed: Työnantajarekisteri (employer register)": for a check about a register missing
 * from the source page, built only from the check's own label and detail.
 */
export function notListedLine(c: Check): string | null {
  if (c.status === "green" || !/\bnot listed\b|^not in\b/i.test(c.detail)) return null;
  const en = c.label.replace(/^Tilaajavastuu:\s*/i, "").trim();
  const fi = c.detail.match(/\(([a-zåäö-]*rekisteri[a-zåäö]*)\)/i)?.[1];
  if (!en) return null;
  return fi ? `Not listed: ${fi.charAt(0).toUpperCase()}${fi.slice(1)} (${en})` : `Not listed: ${en.charAt(0).toUpperCase()}${en.slice(1)}`;
}

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
