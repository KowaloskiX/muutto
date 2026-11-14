// "Keep looking for me": a daily Exa Monitor that searches the listing portals for new
// rentals/sales in the chosen areas within budget. Webhook delivery when PUBLIC_BASE_URL
// is a public https origin (signed, verified by /api/exa-webhook with the stored secret),
// otherwise the UI polls GET /api/move/watch?id=. Runs are summarised to listing pages only.
import { call, monitorRuns, search, triggerMonitor } from "@/lib/exa";
import { forgetMonitor, rememberMonitor } from "@/lib/exa-monitor";
import type { MoveIntent, WatchResult, WatchRuns } from "./types";

export const LISTING_DOMAINS = ["oikotie.fi", "vuokraovi.com", "etuovi.com", "sato.fi", "lumo.fi", "avara.fi"];

type Meta = { areas: string[]; budget?: number; tenure: "rent" | "buy"; size?: string };
const g = globalThis as unknown as { __moveWatch?: Map<string, Meta> };
const metas: Map<string, Meta> = (g.__moveWatch ??= new Map());

export function listingQuery(intent: Pick<MoveIntent, "tenure" | "budget" | "size">, areas: string[]): string {
  const what = intent.tenure === "buy" ? "Myytävä asunto" : "Vuokrattava asunto";
  const size = intent.size ? ` ${intent.size}` : "";
  const budget = intent.budget ? (intent.tenure === "buy" ? ` hinta alle ${intent.budget} €` : ` vuokra alle ${intent.budget} €/kk`) : "";
  return `${what}${size} ${areas.join(", ")}${budget} — uusi ilmoitus`.replace(/\s+/g, " ").trim();
}

export async function createListingMonitor(intent: MoveIntent, areas: string[], webhook: { url: string; live: boolean }): Promise<WatchResult> {
  const query = listingQuery(intent, areas);
  const base = {
    name: `Move watch: ${areas.join(", ").slice(0, 80)}`,
    trigger: { type: "interval", period: "1d" },
    metadata: { kind: "move-listings", areas: areas.join("|").slice(0, 200), budget: String(intent.budget ?? "") },
    webhook: { url: webhook.url },
  };
  const searchBody = { query, numResults: 15, contents: { highlights: { maxCharacters: 300 } } };
  let m;
  let domains: string[] | undefined = LISTING_DOMAINS;
  try {
    m = await call("POST", "/monitors", { ...base, search: { ...searchBody, includeDomains: LISTING_DOMAINS } }, undefined, `monitor: ${query}`);
  } catch (e) {
    // If the monitor search does not accept a domain filter, name the portals in the query instead.
    if (!/\b4\d\d\b/.test((e as Error).message)) throw e;
    domains = undefined;
    m = await call("POST", "/monitors", { ...base, search: { ...searchBody, query: `${query} (oikotie, vuokraovi, etuovi, SATO, Lumo)` } }, undefined, `monitor: ${query}`);
  }
  rememberMonitor(m, base.name); // keeps the one-time webhookSecret server-side
  metas.set(m.id, { areas, budget: intent.budget, tenure: intent.tenure, size: intent.size });
  await triggerMonitor(m.id).catch(() => null); // first run now, not tomorrow
  return { id: m.id, mode: webhook.live ? "live" : "polling", areas, query, ...(domains ? { domains } : {}) };
}

// Single listing pages (not search/category pages or articles).
const LISTING_PAGE = [
  /oikotie\.fi\/(vuokra-asunnot|myytavat-asunnot)\/[^/]+\/\d{6,}/,
  /vuokraovi\.com\/(en\/)?(kohde|rental)\/[a-z0-9]+/i,
  /etuovi\.com\/kohde\/[a-z0-9]+/i,
  /sato\.fi\/.+\/(asunto|apartment)\/[0-9a-f-]{20,}/i,
  /lumo\.fi\/vuokra-asunnot\/[^/]+\/[^/]+\/[^/]+\/[^/?#]+/i,
  /avara\.fi\/.+\/(asunto|kohde|vuokra-asunnot)\/[^/]+/i,
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function priceOf(s: string): number | undefined {
  const m = s.match(/(\d{1,3}(?:[  ]\d{3})+|\d{3,7})(?:,\d+)?\s*(?:€|eur)/i);
  return m ? Number(m[1].replace(/[  ]/g, "")) : undefined;
}

export async function listingRuns(id: string): Promise<WatchRuns> {
  const meta = metas.get(id);
  const runs = await monitorRuns(id);
  const data: any[] = runs?.data ?? [];
  const seen = new Set<string>();
  const items: WatchRuns["items"] = [];
  let skipped = 0;
  for (const run of data) {
    for (const r of run?.output?.results ?? []) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      if (!LISTING_PAGE.some((re) => re.test(r.url))) {
        skipped++;
        continue;
      }
      const blob = `${r.title ?? ""} ${(r.highlights ?? []).join(" ")}`;
      const price = priceOf(blob);
      const area = meta?.areas.find((a) => blob.toLowerCase().includes(a.replace(/^\d{5}\s*/, "").toLowerCase()));
      items.push({
        url: r.url,
        title: r.title || r.url,
        ...(r.publishedDate ? { date: r.publishedDate } : {}),
        source: new URL(r.url).hostname.replace(/^www\.|^asunnot\./, ""),
        ...(price ? { price } : {}),
        ...(price && meta?.budget ? { overBudget: price > meta.budget } : {}),
        ...(area ? { area } : {}),
      });
    }
  }
  for (const it of items) it.via = "monitor";
  let note: string | undefined;
  // Listing pages carry no published date, so the monitor's recency window can come back empty.
  // Then show listings Exa (re)crawled in the last 3 days for the same areas, and say so.
  if (!items.length && meta) {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const what = meta.tenure === "buy" ? "Myytävä asunto" : "Vuokrattava asunto";
    const res = await Promise.all(
      meta.areas.map((a) =>
        search({ query: `${what} ${meta.size ?? ""} ${a}`.trim(), numResults: 10, includeDomains: LISTING_DOMAINS, startCrawlDate: since, contents: { highlights: { maxCharacters: 300 } } })
          .then((r) => r.results.map((x) => ({ ...x, area: a })))
          .catch(() => []),
      ),
    );
    for (const r of res.flat()) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      if (!LISTING_PAGE.some((re) => re.test(r.url))) {
        skipped++;
        continue;
      }
      const price = priceOf(`${r.title ?? ""} ${(r.highlights ?? []).join(" ")}`);
      items.push({
        url: r.url,
        title: r.title || r.url,
        ...(r.publishedDate ? { date: r.publishedDate } : {}),
        source: new URL(r.url).hostname.replace(/^www\.|^asunnot\./, ""),
        ...(price ? { price } : {}),
        ...(price && meta.budget ? { overBudget: price > meta.budget } : {}),
        area: r.area,
        via: "search",
      });
    }
    if (items.length) note = "The monitor's latest run had no new dated pages; these are listing pages Exa crawled in the last 3 days for the same areas.";
  }
  items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const latest = data[0];
  return { id, runs: data.length, latest: latest ? { id: latest.id, status: latest.status, at: latest.completedAt ?? latest.createdAt } : null, items, skipped, ...(note ? { note } : {}) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function deleteListingMonitor(id: string) {
  await call("DELETE", `/monitors/${id}`);
  forgetMonitor(id);
  metas.delete(id);
}
