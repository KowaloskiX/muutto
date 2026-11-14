// Fallback for the trade register when PRH's open-data API is unreachable (outage, refused
// connections). Used ONLY after a live PRH call failed; PRH stays the primary source.
//
// Source: Exa's stored copy of the public YTJ company page (tietopalvelu.ytj.fi/yritys/<id>),
// which is the register's own web view ("Voimassaolevat rekisteröinnit"), else Asiakastieto's
// "Rekisteritiedot" page, which republishes the YTJ register list ("Lähde: YTJ"). Both are
// read from Exa's index (no live crawl of YTJ, which is down too), parsed with regexes, and
// every company carries `fallback` provenance so checks can cite the page and its date.
// Nothing is inferred: a register that the page does not list as active is "not listed",
// never "not registered".
import { contents, search, type ExaResult, type ExaTrace } from "./exa";
import type { PrhCompany } from "./prh";

export type RegistryFallback = {
  source: "fallback";
  /** Human name of the page's publisher, e.g. "YTJ (Exa's stored copy)". */
  site: string;
  url: string;
  /** Date the copy was taken (YYYY-MM-DD) when the page or Exa states it. */
  asOf?: string;
};

const YTJ = (id: string) => `https://tietopalvelu.ytj.fi/yritys/${id}`;
const DOMAINS = ["tietopalvelu.ytj.fi", "asiakastieto.fi"];

const fiDate = (d?: string) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(d ?? "");
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
};
const isoDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** "Koskelonkuja 1 B 51, 02920 Espoo" -> PRH style "Koskelonkuja 1 B 51 02920 ESPOO". */
const prhAddress = (a: string) => clean(a.replace(/,/g, " ")).replace(/\b(\d{5})\s+(.+)$/, (_, pc, city) => `${pc} ${String(city).toUpperCase()}`);

// Words that only appear when the register records an insolvency or dissolution.
const SITUATION = /\b(konkurssi\w*|selvitystil\w*|yrityssaneeraus\w*|lakannut|purettu|poistettu kaupparekisteristä)/i;

type Regs = Pick<PrhCompany, "inTradeRegister" | "inPrepaymentRegister" | "vatLiable" | "employerRegister">;
function regsFrom(active: string[]): Regs {
  const has = (re: RegExp) => active.some((a) => re.test(a));
  return {
    inTradeRegister: has(/^kaupparekisteri/i),
    inPrepaymentRegister: has(/^ennakkoperintärekisteri/i),
    vatLiable: has(/^arvonlisävero/i),
    employerRegister: has(/^työnantajarekisteri/i),
  };
}

function base(id: string, url: string, site: string, asOf?: string): Omit<PrhCompany, "name" | keyof Regs> {
  return { businessId: id, otherNames: [], situations: [], addresses: [], raw: null, fallback: { source: "fallback", site, url, asOf } };
}

/** The YTJ company page as Exa stored it (markdown tables). */
export function parseYtjPage(text: string, url: string, publishedDate?: string): PrhCompany | null {
  const id = /\/yritys\/(\d{7}-\d)/.exec(url)?.[1];
  if (!id || !text.includes(id)) return null;
  const regSec = /Voimassaolevat rekisteröinnit([\s\S]*?)(?:Rekisterihistoria|##\s*Ennakkoperintä|$)/.exec(text)?.[1];
  if (!regSec) return null;
  const rows = [...regSec.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*\|/gm)]
    .filter((m) => !/^rekisteri$|^-+$/i.test(m[1]) && !/rekisteröimätön|^ei\b|poistettu/i.test(m[2]));
  const active = rows.map((m) => m[1]);
  // PRH's registrationDate is the trade-register entry date; the Y-tunnus date otherwise.
  const tradeRegDate = rows.find((m) => /^kaupparekisteri/i.test(m[1]))?.[3];
  if (!active.length) return null;
  const row = (label: string) => new RegExp(`^\\|\\s*${label}(?:\\s+${label})?\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]*?)\\s*\\|`, "m").exec(text);
  const name = row("Toiminimi")?.[1];
  if (!name) return null;
  // Auxiliary names: the "Aputoiminimi" row plus continuation rows "| | Name | date | | |".
  const aux: string[] = [];
  const auxAt = text.search(/^\|\s*Aputoiminimi/m);
  if (auxAt >= 0) {
    for (const line of text.slice(auxAt).split("\n")) {
      const m = /^\|\s*(?:Aputoiminimi(?:\s+Aputoiminimi)?)?\s*\|\s*([^|]+?)\s*\|/.exec(line);
      if (!m || (aux.length && !/^\|\s*\|/.test(line))) break;
      aux.push(m[1]);
    }
  }
  const line = row("Päätoimiala")?.[1];
  const lm = line ? /^(\d{5})\s+(.+)$/.exec(line) : null;
  const visit = row("Käyntiosoite")?.[1];
  const post = row("Postiosoite")?.[1];
  const web = row("Verkkosivut")?.[1];
  const boiler = text.replace(/#### Tietoa verovelkarekisteristä[\s\S]*?(?=\n## |$)/, "");
  const situation = SITUATION.exec(boiler)?.[1];
  return {
    ...base(id, url, "YTJ company page (Exa's stored copy)", fiDate(/Tiedot haettu\s+([\d.]+)/.exec(text)?.[1]) ?? isoDay(publishedDate)),
    name: clean(name),
    otherNames: aux.map(clean).filter((n) => n && n !== name),
    registrationDate: fiDate(tradeRegDate) ?? fiDate(row("Y-tunnus")?.[2]),
    website: web && !/näytä/i.test(web) ? web : undefined,
    mainBusinessLine: lm ? lm[2] : line,
    mainBusinessLineCode: lm?.[1],
    ...regsFrom(active),
    situations: situation ? [situation.toLowerCase()] : [],
    addresses: [...new Set([visit, post].filter((a): a is string => !!a && /\d{5}/.test(a)).map(prhAddress))],
  };
}

/** Asiakastieto's company page: republishes the YTJ register list. */
export function parseAsiakastietoPage(text: string, url: string, publishedDate?: string): PrhCompany | null {
  const idDigits = /asiakastieto\.fi\/yritykset\/fi\/[^/]+\/(\d{8})\//.exec(url)?.[1];
  if (!idDigits) return null;
  const id = `${idDigits.slice(0, 7)}-${idDigits[7]}`;
  if (!text.includes(id)) return null;
  // Only the company's own section: the page ends in product blurbs (ESG, credit reports).
  const own = text.split(/##\s*Tilaajavastuuraportti|##\s*Yrityskuvaus|##\s*Rating Alfa/)[0];
  const table = /\|\s*Rekisterin nimi\s*\|[^\n]*\n\|[-| ]+\|\n((?:\|[^\n]*\|\n?)+)/.exec(own)?.[1];
  const tradeRegDate = table ? /^\|\s*Kaupparekisteri\s*\|\s*([\d.]+)/m.exec(table)?.[1] : undefined;
  const active = table
    ? [...table.matchAll(/^\|\s*([^|\n]+?)\s*\|/gm)].map((m) => m[1])
    : [...(/Aktiivinen:\s*\n((?:\s*-\s*[^\n]+\n?)+)/.exec(own)?.[1] ?? "").matchAll(/-\s*([^\n]+)/g)].map((m) => m[1].trim());
  if (!active.length) return null;
  const field = (label: string) => new RegExp(`(?:^|\\n)${label}\\s*\\n(?::\\s*)?\\n?([^\\n]+)`).exec(own)?.[1]?.replace(/^:\s*/, "").trim();
  const name = field("Toiminimi") ?? /^#\s+(.+?)\s*$/m.exec(own)?.[1];
  if (!name) return null;
  const year = /Toiminta käynnistynyt\s*\n:\s*(\d{4})/.exec(own)?.[1];
  const web = field("Kotisivu");
  const situation = SITUATION.exec(own)?.[1];
  return {
    ...base(id, url, "Asiakastieto (register data from YTJ, Exa's stored copy)", isoDay(publishedDate)),
    name: clean(name),
    // Trade-register date from the register table; else the start year only (no invented day).
    registrationDate: fiDate(tradeRegDate) ?? year,
    website: web && /\./.test(web) ? web : undefined,
    ...regsFrom(active),
    situations: situation ? [situation.toLowerCase()] : [],
    addresses: [...new Set([field("Käyntiosoite"), field("Postiosoite")].filter((a): a is string => !!a && /\d{5}/.test(a)).map(prhAddress))],
  };
}

function parseResult(r: ExaResult): PrhCompany | null {
  const text = r.text ?? "";
  if (/tietopalvelu\.ytj\.fi\/yritys\//.test(r.url)) return parseYtjPage(text, r.url, r.publishedDate);
  if (/asiakastieto\.fi\/yritykset\//.test(r.url)) return parseAsiakastietoPage(text, r.url, r.publishedDate);
  return null;
}

/** Best page per business ID: the YTJ copy, then Asiakastieto's register page, then its overview. */
const rank = (c: PrhCompany) => (c.fallback?.url.includes("ytj.fi") ? 3 : c.fallback?.url.endsWith("/rekisteritiedot") ? 2 : 1);
function bestById(results: ExaResult[]): PrhCompany[] {
  const out = new Map<string, PrhCompany>();
  for (const r of results) {
    const c = parseResult(r);
    if (!c) continue;
    const prev = out.get(c.businessId);
    if (!prev || rank(c) > rank(prev)) out.set(c.businessId, c);
  }
  return [...out.values()];
}

/** Register data for one business ID from public pages Exa has stored. */
export async function fallbackByBusinessId(businessId: string, trace?: ExaTrace[]): Promise<PrhCompany | null> {
  // Same request body as the tax-debt read (tilaajavastuu.ytjTaxDebt): one Exa call serves both.
  const url = YTJ(businessId);
  const direct = await contents({ urls: [url], text: { maxCharacters: 12000 }, livecrawlTimeout: 6000 }, trace).catch(() => null);
  const r = direct?.results?.[0];
  const ytj = r?.text ? parseYtjPage(r.text, url, r.publishedDate) : null;
  if (ytj) return ytj;
  const data = await search({ query: businessId, numResults: 6, includeDomains: DOMAINS, contents: { text: { maxCharacters: 6000 } } }, trace).catch(() => null);
  return bestById(data?.results ?? []).find((c) => c.businessId === businessId) ?? null;
}

/** Register entries matching a company name, from public pages Exa has stored (callers filter by name/website). */
export async function fallbackByName(name: string, trace?: ExaTrace[]): Promise<PrhCompany[]> {
  const data = await search({ query: `${name} Y-tunnus`, numResults: 8, includeDomains: DOMAINS, contents: { text: { maxCharacters: 6000 } } }, trace).catch(() => null);
  return bestById(data?.results ?? []);
}

/** "From YTJ company page (Exa's stored copy, 24.10.2026)": for check details. */
export function fallbackNote(f: RegistryFallback): string {
  const when = f.asOf ? `, copy dated ${f.asOf.split("-").reverse().join(".")}` : ", date of the copy not stated";
  return `From ${f.site}${when}: the live register (PRH open data) was unreachable.`;
}
