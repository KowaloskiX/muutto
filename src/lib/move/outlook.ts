// Two things about an area that change faster than any model's training data, both from Exa:
//  - future:  what is planned or starting in the next years (zoning plans, building projects, new
//             tram/metro lines) from city pages and local news, each with its date and passage;
//  - voices:  what residents say on forums (vauva.fi, Suomi24, Reddit) in the last 18 months.
// Items must name the area (whole word, see namesArea) and are shown as quotes, never summarised.
import { search, type ExaResult, type ExaTrace } from "@/lib/exa";
import type { Area } from "./types";
import { areaStems, namesArea } from "./news";
import { hostOf } from "./util";

const CITY: Record<string, string[]> = {
  Helsinki: ["hel.fi", "paatokset.hel.fi", "kaupunkiymparisto.hel.fi"],
  Espoo: ["espoo.fi"],
  Vantaa: ["vantaa.fi"],
  Kauniainen: ["kauniainen.fi"],
};
const NEWS = ["hs.fi", "helsinginuutiset.fi", "yle.fi", "länsiväylä.fi", "lansivayla.fi", "vantaansanomat.fi", "rakennuslehti.fi", "kauppalehti.fi"];
const FUTURE = /suunnitel|asemakaava|kaavaehdotus|rakentaminen alkaa|rakennetaan|valmistuu|valmistuvat|käynnistyy|tulossa|uusi raitiotie|raitiotie|metroasema|pikaratikka|planned|will be built|construction (?:will )?start|\b20(2[7-9]|3\d)\b/i;

export type FutureItem = NonNullable<Area["future"]>[number];
export type VoiceItem = NonNullable<Area["voices"]>[number];

const passage = (r: ExaResult, stems: string[]) => {
  const hs = (r.highlights ?? []).map((h) => h.replace(/\s+/g, " ").trim());
  return hs.find((h) => namesArea(h, stems)) ?? (namesArea(r.title ?? "", stems) ? hs[0] : undefined);
};

export async function areaFuture(area: { name: string; municipality: string }, trace: ExaTrace[]): Promise<FutureItem[]> {
  const stems = areaStems(area.name);
  if (!stems.length) return [];
  const short = area.name.split(/\s+-\s+/).pop()!.trim();
  const since = new Date(Date.now() - 365 * 86400_000).toISOString();
  const res = await search(
    {
      query: `${short} ${area.municipality}: tulevat rakennushankkeet, asemakaava, uudet asunnot, raitiotie, rakentaminen alkaa tai valmistuu 2027 2028 2029`,
      type: "auto",
      numResults: 10,
      startPublishedDate: since,
      includeDomains: [...(CITY[area.municipality] ?? []), ...NEWS],
      contents: { highlights: { query: `${short} plans construction starts completes new homes tram`, maxCharacters: 320 } },
    },
    trace,
  );
  const out: FutureItem[] = [];
  const seen = new Set<string>();
  for (const r of res.results ?? []) {
    const q = passage(r, stems);
    if (!q || !FUTURE.test(q) || seen.has(r.url)) continue;
    seen.add(r.url);
    const years = [...q.matchAll(/\b(20(?:2[6-9]|3\d))\b/g)].map((m) => m[1]);
    out.push({ title: (r.title ?? hostOf(r.url)).slice(0, 140), url: r.url, date: r.publishedDate?.slice(0, 10), quote: q.slice(0, 300), when: years.length ? [...new Set(years)].sort().join("–") : undefined });
    if (out.length >= 3) break;
  }
  return out;
}

export async function areaVoices(area: { name: string; municipality: string }, trace: ExaTrace[]): Promise<VoiceItem[]> {
  const stems = areaStems(area.name);
  if (!stems.length) return [];
  const short = area.name.split(/\s+-\s+/).pop()!.trim();
  const since = new Date(Date.now() - 548 * 86400_000).toISOString();
  const res = await search(
    {
      query: `asuminen ${short} ${area.municipality} kokemuksia naapurusto melu turvallisuus — living in ${short}`,
      type: "auto",
      numResults: 10,
      startPublishedDate: since,
      includeDomains: ["vauva.fi", "suomi24.fi", "reddit.com"],
      contents: { highlights: { query: `living in ${short}, neighbourhood, noise, safety, neighbours, would you move there`, maxCharacters: 280 } },
    },
    trace,
  );
  const out: VoiceItem[] = [];
  for (const r of res.results ?? []) {
    const q = passage(r, stems);
    if (!q || q.length < 50) continue;
    out.push({ title: (r.title ?? hostOf(r.url)).slice(0, 140), url: r.url, host: hostOf(r.url), date: r.publishedDate?.slice(0, 10), quote: q.slice(0, 280) });
    if (out.length >= 3) break;
  }
  return out;
}
