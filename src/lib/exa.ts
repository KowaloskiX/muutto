// Thin Exa REST client (https://exa.ai/docs). Every call is logged so the UI can
// show a "what Exa did" trace panel (query, endpoint, latency).
const BASE = "https://api.exa.ai";

import { cached, HOUR } from "./cache";

/** `cached`: served from the response cache (a real Exa response from an earlier identical request). */
export type ExaTrace = { endpoint: string; summary: string; ms: number; ok: boolean; cached?: boolean };

// ---- Rate limiting --------------------------------------------------------
// Exa answers 429 once a key goes past ~10 requests in flight/second. One /api/find
// fans out ~20 calls (4 companies x service/reputation/site/id), and judges may run
// queries side by side, so without this most checks silently came back "failed".
// Process-wide limiter: at most MAX_PER_SEC starts per rolling second and
// MAX_INFLIGHT open requests; 429/5xx are retried with backoff.
const MAX_PER_SEC = Number(process.env.EXA_MAX_QPS ?? 8);
const MAX_INFLIGHT = Number(process.env.EXA_MAX_INFLIGHT ?? 10);
const starts: number[] = [];
let inflight = 0;
const waiters: (() => void)[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] >= 1000) starts.shift();
    if (starts.length < MAX_PER_SEC && inflight < MAX_INFLIGHT) {
      starts.push(now);
      inflight++;
      return;
    }
    if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiters.push(r));
    else await sleep(1000 - (now - starts[0]) + 5);
  }
}
function release() {
  inflight--;
  waiters.shift()?.();
}

async function limitedFetch(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await acquire();
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // Connection reset / DNS hiccup: retry once. A timeout is not retried (it would double the wait).
      if ((e as Error).name === "TimeoutError" || attempt >= 1) throw e;
      await sleep(300 + Math.random() * 300);
      continue;
    } finally {
      release();
    }
    const retryable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || attempt >= 3) return res;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 4000) : 400 * 2 ** attempt + Math.random() * 300);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Identical /search and /contents requests within an hour reuse the earlier response:
// same input -> same companies and same evidence on a re-run, and no extra Exa spend.
const EXA_TTL = Number(process.env.EXA_CACHE_TTL_MS ?? HOUR);

async function post(path: string, body: unknown, trace?: ExaTrace[], summary = "", extraHeaders?: Record<string, string>): Promise<any> {
  const key = JSON.stringify([path, body, extraHeaders ?? null]);
  const t0 = Date.now();
  let fresh: ExaTrace | undefined;
  let r: Awaited<ReturnType<typeof cached<any>>>;
  try {
    r = await cached("exa", key, EXA_TTL, async () => {
      const local: ExaTrace[] = [];
      try {
        return await postLive(path, body, local, summary, extraHeaders);
      } finally {
        fresh = local[0];
      }
    });
  } catch (e) {
    trace?.push(fresh ?? { endpoint: path, summary, ms: Date.now() - t0, ok: false });
    throw e;
  }
  if (r.hit) trace?.push({ endpoint: path, summary: `${summary} (cached ${Math.round(r.ageMs / 60000)} min ago)`, ms: Date.now() - t0, ok: true, cached: true });
  else trace?.push(fresh ?? { endpoint: path, summary, ms: Date.now() - t0, ok: true });
  return r.value;
}

async function postLive(path: string, body: unknown, trace?: ExaTrace[], summary = "", extraHeaders?: Record<string, string>): Promise<any> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const t0 = Date.now();
  const res = await limitedFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  trace?.push({ endpoint: path, summary, ms, ok: res.ok });
  if (!res.ok) throw new Error(`Exa ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export type ExaResult = {
  url: string;
  title?: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
  entities?: any[];
};

export async function search(body: Record<string, unknown>, trace?: ExaTrace[], opts?: { beta?: string }): Promise<{ results: ExaResult[]; output?: any }> {
  const tag = opts?.beta ? ` [beta ${opts.beta.replace(/-\d{4}-\d{2}-\d{2}$/, "")}]` : "";
  return post("/search", body, trace, `search(${body.type ?? "auto"})${tag}: ${String(body.query).slice(0, 80)}`, opts?.beta ? { "Exa-Beta": opts.beta } : undefined);
}

// Dynamic highlights (beta): one character budget shared across all results, so
// the most relevant pages get longer passages and weak ones a short line.
// Incompatible with highlights.maxCharacters. Measured on "pipe relining Espoo"
// (15 results): 7,293 -> 5,045 highlight chars (-31%) at the same request cost.
export const DYNAMIC_HIGHLIGHTS_BETA = "dynamic-highlights-2026-08-28";
export const dynamicHighlightsEnabled = () => process.env.EXA_DYNAMIC_HIGHLIGHTS !== "0";

/**
 * Search with dynamic highlights; falls back to per-result maxCharacters if the
 * beta is rejected (header retired, key not enrolled).
 */
export async function searchDynamic(
  body: Record<string, unknown>,
  highlights: { query?: string; maxTotalCharacters: number; fallbackMaxCharacters: number },
  trace?: ExaTrace[],
): Promise<{ results: ExaResult[]; output?: any }> {
  const { fallbackMaxCharacters, ...dyn } = highlights;
  const contents = (body.contents as Record<string, unknown> | undefined) ?? {};
  if (dynamicHighlightsEnabled()) {
    try {
      return await search({ ...body, contents: { ...contents, highlights: { ...dyn, dynamic: true } } }, trace, { beta: DYNAMIC_HIGHLIGHTS_BETA });
    } catch (e) {
      if (!/\b4\d\d\b/.test((e as Error).message)) throw e;
    }
  }
  return search({ ...body, contents: { ...contents, highlights: { query: dyn.query, maxCharacters: fallbackMaxCharacters } } }, trace);
}

export async function contents(body: Record<string, unknown>, trace?: ExaTrace[]): Promise<{ results: ExaResult[]; statuses?: any[] }> {
  const urls = (body.urls as string[]) ?? [];
  return post("/contents", body, trace, `contents: ${urls.join(", ").slice(0, 80)}`);
}

export async function call(method: string, path: string, body?: unknown, trace?: ExaTrace[], summary = ""): Promise<any> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const t0 = Date.now();
  const res = await limitedFetch(`${BASE}${path}`, {
    method,
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  trace?.push({ endpoint: `${method} ${path}`, summary, ms: Date.now() - t0, ok: res.ok });
  if (!res.ok) throw new Error(`Exa ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ---- Monitors: "keep watching this company" ------------------------------
export async function createCompanyMonitor(name: string, domain: string | undefined, webhookUrl: string, trace?: ExaTrace[]) {
  return call(
    "POST",
    "/monitors",
    {
      name: `Watch: ${name}`,
      search: {
        query: `${name} ${domain ?? ""} konkurssi OR yrityssaneeraus OR reklamaatio OR asiakasvalitus OR uutinen`,
        numResults: 10,
        contents: { highlights: true },
      },
      trigger: { type: "interval", period: "1d" },
      metadata: { company: name, domain: domain ?? "" },
      webhook: { url: webhookUrl },
    },
    trace,
    `monitor: ${name}`,
  );
}

export const triggerMonitor = (id: string) => call("POST", `/monitors/${id}/trigger`, {});
export const monitorRuns = (id: string) => call("GET", `/monitors/${id}/runs`);

export const NOT_A_CONTRACTOR = [
  "tori.fi", "fonecta.fi", "finder.fi", "urakkamaailma.fi", "fixmera.com", "facebook.com", "instagram.com", "linkedin.com",
  "yelp.com", "tripadvisor.com", "wikipedia.org", "youtube.com", "kilpailuttaja.fi", "rakentaja.fi", "oikotie.fi", "duunitori.fi",
  "asiakastieto.fi", "kauppalehti.fi", "yle.fi", "hs.fi", "taloon.com", "k-rauta.fi", "bauhaus.fi", "exa.ai",
  "suomiguide.fi", "profinder.fi", "yritysopas.fi", "palveluhaku.fi", "remontti.fi", "fixmate.fi", "mestarit.fi", "ytj.fi", "vainu.com", "proff.fi",
  // more directories / marketplaces / lead-gen sites seen in results
  "remppatori.fi", "urakkatori.fi", "kilpailutakaikki.fi", "eniro.fi", "sortter.fi", "tarjouspalvelu.fi", "kotikatu.fi", "palvelutori.fi",
  "veted.eu", "yritystele.fi", "yrityshaku.fi", "katalogi.fi", "infoweb.fi", "01.fi", "taloyhtio.net", "google.com", "maps.app.goo.gl",
  "trustpilot.com", "reddit.com", "x.com", "twitter.com", "tiktok.com", "kotitalousvahennys.fi", "vero.fi", "suomi.fi", "prh.fi",
  "hintaopas.fi", "rakennusteollisuus.fi", "motiva.fi", "sahkoala.fi", "tukes.fi", "duuni.fi", "mol.fi",
];
const isDirectory = (url: string) => {
  let host: string;
  try {
    host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return true;
  }
  return NOT_A_CONTRACTOR.some((d) => host === d || host.endsWith(`.${d}`));
};

// ---- Places -------------------------------------------------------------
export type Place = {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: { score: number; count: number };
  categories: string[];
  lat?: number;
  lng?: number;
  placeUrl?: string;
};

function parsePlace(e: any): Place | null {
  const p = e?.properties ?? e;
  if (!p?.name) return null;
  const a = p.address;
  const address =
    typeof a === "string"
      ? a
      : [a?.street, a?.postcode, a?.locality ?? a?.region].filter(Boolean).join(", ") || undefined;
  // Some listings stuff keywords into the name: "ACS-Sähkö | Sähköasennukset | Sähköurakointi | …".
  const name = String(p.name).split(/\s+[|•·]\s+/)[0].trim();
  const website = p.websites?.[0];
  return {
    name,
    address,
    phone: p.phoneNumbers?.[0],
    // A listing whose "website" is a directory page (finder.fi/…) has no own site to verify.
    website: website && !isDirectory(website) ? website : undefined,
    rating: p.rating?.score ? { score: p.rating.score, count: p.rating.count ?? 0 } : undefined,
    categories: p.categories ?? [],
    lat: p.location?.lat ?? p.latitude,
    lng: p.location?.lng ?? p.longitude,
    placeUrl: e?.id ?? e?.url,
  };
}

// Exa routes local-business queries into its Places index when the query is in
// English and names the city; places come back as `entities` on a result.
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
};

export async function findPlaces(
  trade: string,
  city: string,
  coords: { latitude: number; longitude: number },
  trace?: ExaTrace[],
  opts?: { plurals?: string[]; fi?: string; maxKm?: number },
): Promise<{ places: Place[]; web: ExaResult[] }> {
  // The places lane is phrasing-sensitive ("painters in Helsinki" hits, "painter in Helsinki" may not).
  const plurals = (opts?.plurals ?? []).map((x) => x.trim()).filter(Boolean);
  if (!plurals.length) plurals.push(/s$/i.test(trade) ? trade : `${trade}s`);
  const maxKm = opts?.maxKm ?? 35;
  const run = (q: string) =>
    search({ query: q, type: "lite", numResults: 10, userLocation: { country: "FI", ...coords }, contents: { highlights: { maxCharacters: 400 } } }, trace).catch(
      () => ({ results: [] as ExaResult[] }),
    );
  const collect = (runs: { results: ExaResult[] }[]) => {
    for (const data of runs) {
      const places: Place[] = [];
      const web: ExaResult[] = [];
      for (const r of data.results ?? []) {
        const ents = (r.entities ?? []).filter((e: any) => e.type === "place");
        if (ents.length) ents.forEach((e: any) => { const p = parsePlace(e); if (p) places.push(p); });
        else web.push(r);
      }
      // A listing far from the requested place (e.g. Helsinki results for Rovaniemi) is not local.
      const near = places.filter((p) => p.lat == null || p.lng == null || distKm({ lat: coords.latitude, lng: coords.longitude }, { lat: p.lat, lng: p.lng }) <= maxKm);
      if (near.length) return { places: near, web };
    }
    return null;
  };
  const english = [...new Set([...plurals.slice(0, 3).map((p) => `${p} in ${city}`), `${trade} in ${city}`])].slice(0, 4);
  const runs = await Promise.all(english.map(run));
  const hit = collect(runs);
  if (hit) return hit;
  // English category found nothing: try the Finnish category word ("hammaslääkäri Tampere").
  const fi = opts?.fi?.trim();
  if (fi && fi.toLowerCase() !== trade.toLowerCase()) {
    const fiRuns = await Promise.all([`${fi} ${city}`, `${fi} in ${city}`].map(run));
    const fiHit = collect(fiRuns);
    if (fiHit) return fiHit;
  }
  return { places: [], web: runs[0]?.results ?? [] };
}

// ---- Service-specific company search ------------------------------------
// Places only fires for generic trades ("plumber in Espoo"). A specific job
// ("pipe relining") is better served by semantic search over company sites.


// Aggregator pages that list many firms ("10 best plumbers in Espoo", /yritykset/).
function looksLikeListing(url: string, title?: string): boolean {
  if (/\/(yritykset|yrityshaku|hakemisto|directory|companies|listing)\b/i.test(url)) return true;
  return /\b(\d+\s+(best|parasta|top)|top\s*\d+|parhaat|vertailu|compare)\b/i.test(title ?? "");
}

const flatName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
const LEGAL = /\b(oy|oyj|ab|ky|tmi|ay|ltd)\b/i;

/**
 * Page titles are "Service City | Brand" or "Brand – slogan". Pick the segment that names
 * the business (matches the domain or carries a legal form); if none does, the domain is a
 * better name than an SEO title like "Kiukaan asennus".
 */
export function nameFromTitle(title: string | undefined, hostname: string): string {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  const stem = host.split(".").slice(-2)[0] ?? host;
  const fstem = flatName(stem);
  const segs = (title ?? "").split(/\s+[|–—:-]\s+|\s*[|–—]\s*|\s+I\s+/).map((x) => x.trim()).filter((x) => x.length > 1);
  const score = (seg: string) => {
    const f = flatName(seg);
    let sc = 0;
    if (f && fstem && (fstem.includes(f) || f.includes(fstem))) sc += 4;
    else if (seg.split(/\s+/).some((w) => flatName(w).length >= 4 && fstem.includes(flatName(w)))) sc += 2;
    if (LEGAL.test(seg)) sc += 2;
    return sc;
  };
  const best = segs.map((seg) => ({ seg, sc: score(seg) })).sort((a, b) => b.sc - a.sc)[0];
  if (best && best.sc > 0) return best.seg.slice(0, 60);
  const pretty = stem.replace(/-/g, " ");
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

export type WebCompany = { name: string; website: string; url: string; title?: string; highlight?: string };

function webCompanies(results: ExaResult[]): WebCompany[] {
  const byOrigin = new Map<string, WebCompany>();
  for (const r of results) {
    let origin: string;
    try {
      origin = new URL(r.url).origin;
    } catch {
      continue;
    }
    if (byOrigin.has(origin) || isDirectory(r.url) || looksLikeListing(r.url, r.title)) continue;
    const ent = (r.entities ?? []).find((e: any) => e.type === "company")?.properties;
    const name = ent?.name ?? nameFromTitle(r.title, new URL(r.url).hostname);
    byOrigin.set(origin, { name, website: origin, url: r.url, title: r.title, highlight: r.highlights?.[0] });
  }
  return [...byOrigin.values()];
}

/**
 * Company sites offering the service in the place. Runs the English phrase and, when
 * given, the Finnish one in parallel (Finnish small businesses rarely have English pages),
 * then interleaves the two lists.
 */
export async function findCompaniesWeb(service: string, city: string, trace?: ExaTrace[], opts?: { serviceFi?: string }): Promise<WebCompany[]> {
  // Budget 2500: below ~4000 Exa honours the shared budget (plus a ~200-char floor per result);
  // at 4000 we measured it falling back to ~4k chars per result, so keep it well under.
  const one = (query: string, hl: string) =>
    searchDynamic(
      { query, type: "auto", numResults: 12, userLocation: "FI", excludeDomains: NOT_A_CONTRACTOR },
      { query: hl, maxTotalCharacters: 2500, fallbackMaxCharacters: 500 },
      trace,
    );
  const fi = opts?.serviceFi?.trim();
  const useFi = !!fi && fi.toLowerCase() !== service.toLowerCase();
  const [en, fin] = await Promise.all([
    one(`local company offering ${service} in ${city}, Finland`, `${service} in ${city}`).catch(() => ({ results: [] as ExaResult[] })),
    useFi ? one(`${fi} ${city} yritys`, `${fi} ${city}`).catch(() => ({ results: [] as ExaResult[] })) : Promise.resolve({ results: [] as ExaResult[] }),
  ]);
  const a = webCompanies(en.results ?? []);
  const b = webCompanies(fin.results ?? []);
  const out = new Map<string, WebCompany>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) for (const w of [a[i], b[i]]) if (w && !out.has(w.website)) out.set(w.website, w);
  return [...out.values()];
}

// ---- B2B: subcontractor sourcing + Exa company index ----------------------
// Exa's `category: "company"` index returns an entity per company site with
// headcount (workforce.total), annual revenue and founding year: capacity signals
// the open trade register (PRH) does not publish.

export type CompanyProfile = {
  name: string;
  website: string;
  /** Exa company-index page the figures come from (cite it as the source). */
  entityUrl?: string;
  foundedYear?: number;
  employees?: number;
  /** Annual revenue as Exa reports it (currency not stated by the index). */
  revenue?: number;
  city?: string;
  description?: string;
};

export function companyProfileOf(r: ExaResult): CompanyProfile | null {
  const ent = (r.entities ?? []).find((e: any) => e.type === "company");
  const p = ent?.properties;
  if (!p?.name) return null;
  let website: string;
  try {
    website = new URL(r.url).origin;
  } catch {
    return null;
  }
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);
  return {
    name: String(p.name),
    website,
    entityUrl: typeof ent.id === "string" ? ent.id : undefined,
    foundedYear: num(p.foundedYear),
    employees: num(p.workforce?.total),
    revenue: num(p.financials?.revenueAnnual),
    city: p.headquarters?.city ?? undefined,
    description: typeof p.description === "string" ? p.description.slice(0, 600) : undefined,
  };
}

/** Exa company-index profile for one company site (null when Exa has none). */
export async function companyProfile(domain: string, name: string, trace?: ExaTrace[]): Promise<CompanyProfile | null> {
  const data = await search({ query: name || domain, category: "company", numResults: 3, includeDomains: [domain] }, trace).catch(() => ({ results: [] as ExaResult[] }));
  for (const r of data.results ?? []) {
    const p = companyProfileOf(r);
    if (p) return p;
  }
  return null;
}

export type SubcontractorHit = WebCompany & { profile?: CompanyProfile };

/**
 * Construction subcontractors for a trade in an area: Exa's company index (with headcount
 * and revenue) plus semantic search over company sites for references to similar projects
 * (taloyhtiö / linjasaneeraus / urakka), in Finnish and English. Interleaved, de-duplicated.
 */
export async function findSubcontractorsWeb(
  service: string,
  city: string,
  trace?: ExaTrace[],
  opts?: { serviceFi?: string; tradeFi?: string; scope?: string },
): Promise<SubcontractorHit[]> {
  const fi = opts?.serviceFi?.trim() || opts?.tradeFi?.trim() || service;
  const scope = opts?.scope?.trim();
  const companyIdx = search(
    { query: `${fi} urakointi ${city}`, category: "company", numResults: 15, userLocation: "FI" },
    trace,
  ).catch(() => ({ results: [] as ExaResult[] }));
  const site = (query: string, hl: string) =>
    searchDynamic(
      { query, type: "auto", numResults: 12, userLocation: "FI", excludeDomains: NOT_A_CONTRACTOR },
      { query: hl, maxTotalCharacters: 2500, fallbackMaxCharacters: 500 },
      trace,
    ).catch(() => ({ results: [] as ExaResult[] }));
  const [idx, fiRefs, en] = await Promise.all([
    companyIdx,
    site(`${fi} urakoitsija ${city} referenssit taloyhtiöt${scope ? ` ${scope}` : ""}`, `${fi} urakka referenssit ${city}`),
    site(`construction subcontractor company for ${service} in ${city}, Finland, references of apartment building projects`, `${service} contractor ${city} references`),
  ]);
  const profiles = new Map<string, CompanyProfile>();
  for (const r of idx.results ?? []) {
    const p = companyProfileOf(r);
    if (p && !isDirectory(r.url)) profiles.set(p.website, p);
  }
  const fromIdx: SubcontractorHit[] = [...profiles.values()].map((p) => ({ name: p.name, website: p.website, url: p.website, title: p.name, highlight: p.description?.slice(0, 300), profile: p }));
  const lists: SubcontractorHit[][] = [fromIdx, webCompanies(fiRefs.results ?? []), webCompanies(en.results ?? [])];
  const out = new Map<string, SubcontractorHit>();
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++)
    for (const l of lists) {
      const w = l[i];
      if (w && !out.has(w.website)) out.set(w.website, { ...w, profile: w.profile ?? profiles.get(w.website) });
    }
  return [...out.values()];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
