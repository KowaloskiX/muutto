// Local news and city decisions about works near an area (Exa, last ~6 months): building
// sites, blasting, street works, traffic arrangements, noise permits. This is information
// that changes weekly and is not in any model's training data. Relevance and tone are
// decided by keywords (no LLM): an item must name the area, and works/noise words make it
// "negative" for someone looking for a quiet home.
import { search, type ExaResult, type ExaTrace } from "@/lib/exa";
import type { Area, Criterion, Source } from "./types";
import { hostOf } from "./util";

const CITY_DOMAINS: Record<string, string[]> = {
  Helsinki: ["paatokset.hel.fi", "hel.fi", "uutiset.hel.fi", "stadinliikenne.fi"],
  Espoo: ["espoo.fi"],
  Vantaa: ["vantaa.fi"],
  Kauniainen: ["kauniainen.fi"],
  Kirkkonummi: ["kirkkonummi.fi"],
  Kerava: ["kerava.fi"],
  Järvenpää: ["jarvenpaa.fi"],
  Tuusula: ["tuusula.fi"],
  Sipoo: ["sipoo.fi"],
  Nurmijärvi: ["nurmijarvi.fi"],
  Vihti: ["vihti.fi"],
  Porvoo: ["porvoo.fi"],
  Lohja: ["lohja.fi"],
};
const NEWS_EXCLUDE = ["oikotie.fi", "vuokraovi.com", "etuovi.com", "facebook.com", "instagram.com", "tori.fi", "linkedin.com", "tiktok.com", "youtube.com", "wikipedia.org"];

const WORKS = /räjäyt|louhin|paalu|työmaa|rakennustyö|rakentamis|purku|purkaa|katutyö|kaivu|remontt|saneer|liikennejärjest|kiertotie|suljet|sulkeutu|poikkeusjärjest|melu|meluilmoitus|tärin|blasting|construction|roadworks|noise|demolition|detour|closure/i;
const POSITIVE = /avataan|avautuu|valmistu|valmis |uusi puisto|kunnostettu|opens|opened|completed|new park/i;

/** Word stems of the area name that survive Finnish inflection (Kallio -> "Kalli": Kalliossa, Kallion). */
export function areaStems(name: string): string[] {
  return name
    .split(/[\s,/–-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !/^(helsinki|espoo|vantaa|kauniainen|kirkkonummi|kerava|järvenpää|tuusula|sipoo|nurmijärvi|vihti|porvoo|lohja|keskusta|etelä|pohjois|itä|länsi|keskus)$/i.test(w))
    .map((w) => w.slice(0, Math.max(5, w.length - 2)));
}

/**
 * Does the text name the area? Whole words only, capitalised as a place name, starting with a stem.
 * Many area names are also common nouns (Kallio = rock, Mäki = hill): "Kalliota louhitaan" means
 * "rock is being quarried". The partitive (vowel + -ta/-tä) is the usual form for the noun and
 * rare for a place, so those words don't count. Ablative/elative (Kalliolta, Kalliosta) still do.
 */
export function namesArea(text: string, stems: string[]): boolean {
  const words = text.match(/\p{Lu}[\p{L}]*/gu) ?? [];
  return words.some((w) => stems.some((s) => w.startsWith(s[0].toUpperCase() + s.slice(1).toLowerCase())) && !/[aeiouyäö]t[aä]$/i.test(w));
}

export type NewsItem = Area["news"][number] & { works: boolean; source: Source };

function toItem(r: ExaResult, stems: string[]): NewsItem | null {
  const hay = `${r.title ?? ""} ${(r.highlights ?? []).join(" ")}`;
  if (!namesArea(hay, stems)) return null;
  const hl = (r.highlights ?? []).find((h) => namesArea(h, stems)) ?? r.highlights?.[0] ?? "";
  const works = WORKS.test(hay);
  const tone: NewsItem["tone"] = works ? "negative" : POSITIVE.test(hay) ? "positive" : "neutral";
  const date = r.publishedDate?.slice(0, 10);
  const quote = hl.replace(/\s+/g, " ").trim().slice(0, 280);
  return { title: (r.title ?? hostOf(r.url)).slice(0, 160), url: r.url, date, quote, tone, works, source: { url: r.url, label: hostOf(r.url), quote, asOf: date } };
}

export async function areaNews(area: { name: string; municipality: string }, trace: ExaTrace[]): Promise<{ items: NewsItem[]; ok: boolean }> {
  const since = new Date(Date.now() - 183 * 86400_000).toISOString();
  const stems = areaStems(area.name);
  if (!stems.length) return { items: [], ok: true };
  const place = `${area.name.split(/\s+-\s+/).pop()} ${area.municipality}`;
  const hlQuery = `${place} työmaa räjäytys melu katutyöt liikennejärjestelyt rakentaminen`;
  const [news, city] = await Promise.allSettled([
    search(
      {
        query: `${place}: rakennustyömaa, räjäytystyöt, katutyöt, melu tai liikennejärjestelyt alueella`,
        type: "auto",
        numResults: 8,
        startPublishedDate: since,
        excludeDomains: NEWS_EXCLUDE,
        userLocation: "FI",
        contents: { highlights: { query: hlQuery, maxCharacters: 320 } },
      },
      trace,
    ),
    search(
      {
        query: `${place} rakentaminen katutyö meluilmoitus päätös`,
        type: "auto",
        numResults: 6,
        startPublishedDate: since,
        includeDomains: CITY_DOMAINS[area.municipality] ?? [],
        contents: { highlights: { query: hlQuery, maxCharacters: 320 } },
      },
      trace,
    ),
  ]);
  const ok = news.status === "fulfilled" || city.status === "fulfilled";
  const results = [...(city.status === "fulfilled" ? city.value.results : []), ...(news.status === "fulfilled" ? news.value.results : [])];
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const it = toItem(r, stems);
    if (it) items.push(it);
  }
  // Works first, then newest.
  items.sort((a, b) => Number(b.works) - Number(a.works) || (b.date ?? "").localeCompare(a.date ?? ""));
  return { items: items.slice(0, 3), ok };
}

export function constructionCriterion(items: NewsItem[], ok: boolean): Criterion {
  if (!ok) return { id: "construction", label: "Construction & works", status: "unknown", value: null, detail: "News search unavailable right now.", sources: [] };
  const works = items.filter((i) => i.works);
  const status = works.length === 0 ? "good" : works.length <= 2 ? "ok" : "poor";
  return {
    id: "construction",
    label: "Construction & works",
    status,
    value: works.length ? `${works.length} report${works.length > 1 ? "s" : ""}` : "None found",
    detail: works.length
      ? `${works.length} recent item${works.length > 1 ? "s" : ""} about works, blasting or traffic arrangements in this area; latest: “${works[0].title}”${works[0].date ? ` (${works[0].date})` : ""}.`
      : "Exa search of local news and city pages from the last 6 months found no works, blasting or noise items naming this area (absence of reports, not a guarantee).",
    sources: works.map((w) => w.source),
  };
}
