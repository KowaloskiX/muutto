// Thin Exa REST client (https://exa.ai/docs). Every call is logged so the UI can
// show a "what Exa did" trace panel (query, endpoint, latency).
const BASE = "https://api.exa.ai";

export type ExaTrace = { endpoint: string; summary: string; ms: number; ok: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(path: string, body: unknown, trace?: ExaTrace[], summary = ""): Promise<any> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
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

export async function search(body: Record<string, unknown>, trace?: ExaTrace[]): Promise<{ results: ExaResult[]; output?: any }> {
  return post("/search", body, trace, `search(${body.type ?? "auto"}): ${String(body.query).slice(0, 80)}`);
}

export async function contents(body: Record<string, unknown>, trace?: ExaTrace[]): Promise<{ results: ExaResult[]; statuses?: any[] }> {
  const urls = (body.urls as string[]) ?? [];
  return post("/contents", body, trace, `contents: ${urls.join(", ").slice(0, 80)}`);
}

export async function call(method: string, path: string, body?: unknown, trace?: ExaTrace[], summary = ""): Promise<any> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
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
  return {
    name: p.name,
    address,
    phone: p.phoneNumbers?.[0],
    website: p.websites?.[0],
    rating: p.rating?.score ? { score: p.rating.score, count: p.rating.count ?? 0 } : undefined,
    categories: p.categories ?? [],
    lat: p.location?.lat ?? p.latitude,
    lng: p.location?.lng ?? p.longitude,
    placeUrl: e?.id ?? e?.url,
  };
}

// Exa routes local-business queries into its Places index when the query is in
// English and names the city; places come back as `entities` on a result.
export async function findPlaces(
  trade: string,
  city: string,
  coords: { latitude: number; longitude: number },
  trace?: ExaTrace[],
): Promise<{ places: Place[]; web: ExaResult[] }> {
  // The places lane is phrasing-sensitive ("painters in Helsinki" hits, "painter in Helsinki" may not).
  const plural = trade.endsWith("s") ? trade : `${trade}s`;
  const phrasings = [`${plural} in ${city}`, `${trade} in ${city}`, `${city} ${trade}`];
  const runs = await Promise.all(
    phrasings.map((q) =>
      search({ query: q, type: "lite", numResults: 10, userLocation: { country: "FI", ...coords }, contents: { highlights: { maxCharacters: 400 } } }, trace).catch(() => ({ results: [] as ExaResult[] })),
    ),
  );
  for (const data of runs) {
    const places: Place[] = [];
    const web: ExaResult[] = [];
    for (const r of data.results ?? []) {
      const ents = (r.entities ?? []).filter((e: any) => e.type === "place");
      if (ents.length) ents.forEach((e: any) => { const p = parsePlace(e); if (p) places.push(p); });
      else web.push(r);
    }
    if (places.length) return { places, web };
  }
  return { places: [], web: runs[0]?.results ?? [] };
}

// ---- Service-specific company search ------------------------------------
// Places only fires for generic trades ("plumber in Espoo"). A specific job
// ("pipe relining") is better served by semantic search over company sites.
const NOT_A_CONTRACTOR = [
  "tori.fi", "fonecta.fi", "finder.fi", "urakkamaailma.fi", "fixmera.com", "facebook.com", "instagram.com", "linkedin.com",
  "yelp.com", "tripadvisor.com", "wikipedia.org", "youtube.com", "kilpailuttaja.fi", "rakentaja.fi", "oikotie.fi", "duunitori.fi",
  "asiakastieto.fi", "kauppalehti.fi", "yle.fi", "hs.fi", "taloon.com", "k-rauta.fi", "bauhaus.fi", "exa.ai",
  "suomiguide.fi", "profinder.fi", "yritysopas.fi", "palveluhaku.fi", "remontti.fi", "fixmate.fi", "mestarit.fi", "ytj.fi", "vainu.com", "proff.fi",
];

export type WebCompany = { name: string; website: string; url: string; title?: string; highlight?: string };

export async function findCompaniesWeb(service: string, city: string, trace?: ExaTrace[]): Promise<WebCompany[]> {
  const data = await search(
    {
      query: `local company offering ${service} in ${city}, Finland`,
      type: "auto",
      numResults: 15,
      userLocation: "FI",
      excludeDomains: NOT_A_CONTRACTOR,
      contents: { highlights: { query: `${service} in ${city}`, maxCharacters: 500 } },
    },
    trace,
  );
  const byOrigin = new Map<string, WebCompany>();
  for (const r of data.results ?? []) {
    let origin: string;
    try {
      origin = new URL(r.url).origin;
    } catch {
      continue;
    }
    if (byOrigin.has(origin)) continue;
    const ent = (r.entities ?? []).find((e: any) => e.type === "company")?.properties;
    const name = ent?.name ?? (r.title ?? new URL(r.url).hostname).split(/[|–—-]/)[0].trim();
    byOrigin.set(origin, { name, website: origin, url: r.url, title: r.title, highlight: r.highlights?.[0] });
  }
  return [...byOrigin.values()];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
