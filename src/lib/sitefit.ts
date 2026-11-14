// B2B subcontractor relevance without extra LLM or Exa calls: does a candidate do this
// trade (registered line of business from the open trade register + their own text) and
// are they near the site (registered street address, map listing coordinates, or a
// service area named on their site)? Used to pick which candidates to vet and to adjust
// the final fit score.
import { distanceKm } from "./geo";
import { domainOf, prhByName, type PrhCompany } from "./prh";

// ---- Locality ----------------------------------------------------------------
// Approximate centre of each Finnish postcode area (first two digits). Postcode areas are
// compact (00 Helsinki, 33 Tampere, 90 Oulu...), so this places a registered address
// within ~30 km without a geocoding call.
const POSTCODE_AREA: Record<string, [number, number]> = {
  "00": [60.19, 24.94], "01": [60.3, 25.04], "02": [60.2, 24.68], "03": [60.33, 24.4], "04": [60.46, 25.1], "05": [60.6, 24.86], "06": [60.4, 25.66], "07": [60.47, 26.1], "08": [60.25, 24.07], "09": [60.32, 23.75],
  "10": [60.02, 23.45], "11": [60.74, 24.77], "12": [60.72, 24.45], "13": [61.0, 24.46], "14": [60.93, 24.5], "15": [60.98, 25.66], "16": [60.93, 25.6], "17": [61.2, 25.5], "18": [61.2, 26.03], "19": [61.5, 26.0],
  "20": [60.45, 22.27], "21": [60.45, 22.2], "22": [60.1, 19.94], "23": [60.8, 21.4], "24": [60.38, 23.13], "25": [60.2, 23.0], "26": [61.13, 21.5], "27": [61.2, 22.1], "28": [61.48, 21.8], "29": [61.55, 21.9],
  "30": [60.81, 23.62], "31": [60.85, 23.4], "32": [60.85, 23.06], "33": [61.5, 23.76], "34": [61.9, 23.9], "35": [61.68, 24.36], "36": [61.46, 24.07], "37": [61.4, 23.75], "38": [61.35, 22.9], "39": [61.75, 23.1],
  "40": [62.24, 25.75], "41": [62.35, 25.95], "42": [61.86, 25.19], "43": [62.7, 25.25], "44": [62.6, 25.73], "45": [60.87, 26.7], "46": [60.8, 26.7], "47": [60.85, 26.5], "48": [60.47, 26.95], "49": [60.57, 27.2],
  "50": [61.69, 27.27], "51": [61.75, 27.6], "52": [61.4, 26.9], "53": [61.06, 28.19], "54": [61.0, 28.0], "55": [61.17, 28.77], "56": [61.3, 28.9], "57": [61.87, 28.88], "58": [61.9, 29.1], "59": [61.55, 29.5],
  "60": [62.79, 22.84], "61": [62.7, 22.6], "62": [62.95, 23.2], "63": [62.6, 23.6], "64": [62.4, 21.4], "65": [63.1, 21.62], "66": [63.1, 21.9], "67": [63.84, 23.13], "68": [63.67, 22.7], "69": [63.8, 23.8],
  "70": [62.89, 27.68], "71": [63.05, 27.6], "72": [62.9, 26.9], "73": [63.2, 28.0], "74": [63.56, 27.19], "75": [63.54, 29.14], "76": [62.3, 27.13], "77": [62.6, 27.1], "78": [62.31, 27.87], "79": [62.3, 28.6],
  "80": [62.6, 29.76], "81": [63.0, 29.9], "82": [62.1, 30.1], "83": [62.73, 29.0], "84": [64.07, 24.54], "85": [63.9, 24.2], "86": [64.27, 24.82], "87": [64.22, 27.73], "88": [64.13, 28.4], "89": [64.9, 29.0],
  "90": [65.01, 25.47], "91": [64.95, 25.5], "92": [64.68, 24.48], "93": [65.6, 27.8], "94": [65.74, 24.56], "95": [65.85, 24.15], "96": [66.5, 25.73], "97": [66.7, 26.0], "98": [66.71, 27.43], "99": [68.0, 26.5],
};

// Regions (maakunta) with an approximate centre and the stems Finnish firms use to name
// their service area ("Pohjois-Pohjanmaan alueella", "Lahden seudulla").
const REGIONS: { at: [number, number]; stems: string[] }[] = [
  { at: [60.3, 24.9], stems: ["uusimaa", "uudellamaa", "uudenmaa", "paakaupunkiseu", "capital region"] },
  { at: [60.5, 22.5], stems: ["varsinais-suom", "varsinaissuom", "lounais-suom", "turun seu", "turun talousalue"] },
  { at: [61.5, 22.0], stems: ["satakun"] },
  { at: [60.95, 24.4], stems: ["kanta-ham", "hameenlinnan seu"] },
  { at: [61.6, 23.8], stems: ["pirkanmaa", "tampereen seu", "tampereen talousalue"] },
  { at: [61.1, 25.7], stems: ["paijat-ham", "paijathame", "lahden seu", "lahden talousalue"] },
  { at: [60.7, 26.8], stems: ["kymenlaak", "kaakkois-suom"] },
  { at: [61.1, 28.2], stems: ["etela-karjal", "kaakkois-suom"] },
  { at: [61.8, 27.7], stems: ["etela-savo", "etela-savossa"] },
  { at: [63.0, 27.5], stems: ["pohjois-savo", "kuopion seu"] },
  { at: [62.7, 30.0], stems: ["pohjois-karjal", "joensuun seu"] },
  { at: [62.4, 25.6], stems: ["keski-suom", "jyvaskylan seu"] },
  { at: [62.8, 23.0], stems: ["etela-pohjanma", "seinajoen seu"] },
  { at: [63.1, 21.8], stems: ["pohjanmaa", "pohjanmaan", "vaasan seu"] },
  { at: [63.8, 23.5], stems: ["keski-pohjanma", "kokkolan seu"] },
  { at: [64.9, 25.8], stems: ["pohjois-pohjanma", "oulun seu", "oulun talousalue", "oulun alue"] },
  { at: [64.3, 28.0], stems: ["kainuu", "kainuun"] },
  { at: [67.0, 26.0], stems: ["lappi", "lapin "] },
];

export const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const flat = (t: string) => fold(t).replace(/[^a-z0-9]+/g, "");

export type Located = { lat: number; lng: number; municipality: string };

/** "Koskelonkuja 1 02920 ESPOO" or "Pekantie 3, 90900, Pohjois-Pohjanmaa" -> postcode-area centre (+ town when given). */
export function locateAddress(address: string): Located | null {
  const m = /\b(\d{5})\b,?\s*([\p{L}][\p{L} .-]*)?$/u.exec(address.trim()) ?? /\b(\d{5})\b/.exec(address);
  if (!m) return null;
  const at = POSTCODE_AREA[m[1].slice(0, 2)];
  if (!at) return null;
  // Only an upper-case post office is a town ("ESPOO"); "Pohjois-Pohjanmaa" is a region.
  const town = m[2] && m[2] === m[2].toUpperCase() ? m[2].trim().replace(/\s+(AS|KK|MLK)$/i, "") : "";
  return { lat: at[0], lng: at[1], municipality: town ? town.charAt(0) + town.slice(1).toLowerCase() : "" };
}

// Finnish consonant gradation in place names: Turku -> Turun, Lahti -> Lahden, Kotka -> Kotkan.
const GRADATION: [RegExp, string][] = [[/kku$/, "ku"], [/kki$/, "ki"], [/ppi$/, "pi"], [/tti$/, "ti"], [/nki$/, "ngi"], [/nti$/, "nni"], [/lti$/, "lli"], [/rti$/, "rri"], [/hti$/, "hdi"], [/ku$/, "uu"], [/ti$/, "di"]];

/** Inflection-proof stems of a place name: "turku" -> ["turk", "turu"], "lahti" -> ["laht", "lahd"]. */
export function placeStems(name: string): string[] {
  const x = fold(name).trim();
  if (x.length < 3) return [];
  const out = [x.slice(0, Math.max(4, x.length - 2))];
  const g = GRADATION.find(([re]) => re.test(x));
  if (g) {
    const weak = x.replace(g[0], g[1]);
    out.push(weak.slice(0, Math.max(4, weak.length - 2)));
  }
  return out;
}

/** Service-area stems for the site: municipality, district and region. */
export function areaStems(site: { lat: number; lng: number }, names: string[]): string[] {
  const own = names.flatMap(placeStems);
  const region = [...REGIONS].sort((a, b) => distanceKm(site, { lat: a.at[0], lng: a.at[1] }) - distanceKm(site, { lat: b.at[0], lng: b.at[1] }))[0];
  return [...new Set([...own, ...(region?.stems ?? [])])];
}

const NATIONWIDE = /koko suome|koko maa|valtakunnallisesti|ympari suomen|kaikkialle suomeen|kaikkialla suomessa|nationwide|throughout finland|all over finland|across finland/;
const AREA_WORD = /toimi|palvel|alueel|alueen|seudul|seudun|lahikun|talousalue|ymparisto|kattaa|urakoimme|serve|operat|area|region/;
const BREAK = /[.!?|#\n]/;

/** Their own text names the site's town/region as where they work, or says they work nationwide. */
export function servesArea(text: string, stems: string[]): "area" | "nationwide" | null {
  const t = fold(text);
  for (const st of stems) {
    for (let i = t.indexOf(st); i >= 0; i = t.indexOf(st, i + st.length)) {
      // Same sentence, close by: "Toimialueemme kattaa Lahden seudun", "Turussa ja lähikunnissa".
      const before = t.slice(Math.max(0, i - 50), i).split(BREAK).pop() ?? "";
      const after = t.slice(i, i + st.length + 30).split(BREAK)[0];
      if (AREA_WORD.test(before) || AREA_WORD.test(after)) return "area";
    }
  }
  return NATIONWIDE.test(t) ? "nationwide" : null;
}

// ---- Trade fit ---------------------------------------------------------------
// Registered main line of business (TOL), matched by its English/Finnish label so it works
// for TOL 2008 and TOL 2025 codes alike.
const CONSTRUCTION =
  /construction|installation|demolition|roofing|plastering|painting|glazing|joinery|floor and wall|site preparation|civil engineering|masonry|bricklaying|insulation|building completion|scaffold|rakentami|asennus|purku|kattorakent|rappaus|maalaus|lasitus|rakennuspuusep|lattia|maarakennus|eristy|viimeistely/i;
const GENERAL = /construction of (residential|buildings)|development of building projects|asuinrakennusten|asuin- ja muiden rakennusten|talonrakentami|rakennuttami/i;
const INFRA = /civil engineering|roads|railways|utility projects|water projects|bridges|tunnels|teiden|rautateiden|vesihuolto|yleisten verkkojen|maa- ja vesirakent/i;
const OFF =
  /consultancy|consulting|engineering design|architectural|technical testing|testing and analysis|laborator|wholesale|retail|agents involved|manufacture|employment|software|computer|real estate|management|advertising|accounting|research|holding|financial|legal|rental and leasing|konsult|insinööri|tekninen testaus|tukkukauppa|vähittäiskauppa|valmistus|henkilöstö|vuokraus|kiinteistö|tutkimus/i;

// Job wording -> labels of the registered lines that do that trade. Generic table over
// construction trades (keys match the parsed service/trade, English or Finnish).
const TRADE_LINES: [RegExp, RegExp][] = [
  [/electric|sähkö|sahko/i, /electrical installation|sähköasennus/i],
  [/plumb|pipe|putki|lvi|hvac|heating|ventilat|ilmanvaiht|viemär|sprinkl|sewer/i, /plumbing|heat and air|ventilat|lämpö-, vesijohto|lvi|ilmastointi/i],
  [/demoli|purku|purkam|strip.?out/i, /demolition|remediation|materials recovery|dismantl|purku|kunnostus|materiaalien/i],
  [/asbest|haitta-aine|hazardous/i, /demolition|remediation|materials recovery|insulation|industrial cleaning|purku|eristy/i],
  [/waterproof|vedeneris|kosteuseris|bitumi|membrane/i, /roofing|insulation|other specialised|other specialized|building completion|other construction installation|floor and wall|kattorakent|eristy|muu rakennusten viimeistely|erikoistunut rakennustoiminta/i],
  [/roof|katto|vesikat/i, /roofing|kattorakent|other specialised|other specialized/i],
  [/insulat|eristy|eriste/i, /insulation|other construction installation|eristy/i],
  [/paint|maalau|maalari/i, /painting|maalaus/i],
  [/floor|lattia|tiling|tile|laatoit|laatt/i, /floor and wall|lattia|tiling/i],
  [/plaster|rappau|facade|julkisivu|masonry|muuraus/i, /plastering|masonry|bricklaying|rappaus|muuraus|other specialised|other specialized/i],
  [/scaffold|teline/i, /scaffold|other specialised|other specialized|rental and leasing of construction|teline/i],
  [/excavat|groundwork|earthwork|maanrakennus|kaivu|site prep|pohjarakenn|landscap|piha/i, /site preparation|civil engineering|landscape|maarakennus|maanrakennus|pohjarakenn/i],
  [/window|ikkuna|door|ovi|joiner|puusep|carpent|kirvesm/i, /joinery|glazing|carpentry|puusep|lasitus|other building completion/i],
  [/concrete|betoni/i, /concrete|other specialised|other specialized|betoni/i],
  [/glazing|lasitus|balcony|parveke/i, /glazing|lasitus|other specialised|other specialized|joinery/i],
  [/elevator|lift|hissi/i, /other construction installation|lifts|hissi/i],
];
const GENERAL_JOB = /general contract|main contract|building contractor|construction company|renovation contractor|refurbishment contractor|rakennusliike|pääurakoit|kokonaisurak|korjausrakentaminen$|construction management/i;

export type TradeMatch = "trade" | "specialist" | "general" | "infra" | "off" | "unknown";

export type TradeProfile = {
  /** Registered lines that do this trade (null: no table entry for this job). */
  lines: RegExp | null;
  /** The job itself is general contracting, so a general builder is not off-trade. */
  generalJob: boolean;
};

export function tradeProfile(jobText: string): TradeProfile {
  const hits = TRADE_LINES.filter(([job]) => job.test(jobText)).map(([, line]) => line.source);
  return { lines: hits.length ? new RegExp(hits.join("|"), "i") : null, generalJob: GENERAL_JOB.test(jobText) };
}

/** How a registered line of business fits the job's trade. */
export function classifyLine(label: string | undefined, job: TradeProfile): TradeMatch {
  if (!label) return "unknown";
  if (job.lines?.test(label)) return "trade";
  if (GENERAL.test(label)) return job.generalJob ? "trade" : "general";
  if (INFRA.test(label)) return "infra";
  if (CONSTRUCTION.test(label)) return "specialist";
  if (OFF.test(label)) return "off";
  return "unknown";
}

// ---- Trade words in their own text ------------------------------------------
// Finnish trade compounds: "sisäpurku", "asbestipurku" and "purkutyö" share the head
// "purku", so the head is matched on its own too (folded, no diacritics).
const HEADS = ["purku", "asbest", "maalaus", "laatoit", "rappaus", "pinnoit", "teline", "sahko", "putki", "lattia", "ikkuna", "julkisivu", "vesikat", "ilmanvaih", "eristy", "katto", "betoni", "kaivu", "piha"];
const GENERIC_WORD = /^(instal|contra|servic|compan|subcon|work|urako|asenn|asent|palve|yrity|renov|repai|korja|remon|saneer|constr|rakenn|build|proje|remov|tyot|tyo$|for$|and$|the$|with|interi|sisa$|liike|firma|yhtio|group|oy$)/;

export type TradeWords = { primary: string[]; heads: string[] };

export function tradeWords(parts: string[]): TradeWords {
  const words = parts.join(" ").split(/[\s,/()-]+/).map((x) => flat(x)).filter((x) => x.length >= 4);
  // A word that starts with a head ("purkuliike", "sähköasennus") is that trade: keep the head.
  const primary = [...new Set(words.filter((x) => !GENERIC_WORD.test(x)).map((x) => HEADS.find((h) => x.startsWith(h)) ?? x.slice(0, Math.max(4, Math.min(6, x.length - 2)))))];
  const heads = [...new Set(words.flatMap((w) => HEADS.filter((h) => w.includes(h))))].filter((h) => !primary.some((p) => p.startsWith(h) || h.startsWith(p)));
  return { primary, heads };
}

/** 0 = no trade words, 1 = only a compound head ("purku"), 2 = the trade itself, 3 = in their name or domain. */
export function textTrade(text: string, w: TradeWords, name = ""): 0 | 1 | 2 | 3 {
  if (name && w.primary.some((st) => flat(name).includes(st))) return 3;
  const t = flat(text);
  if (w.primary.some((st) => t.includes(st))) return 2;
  if (w.heads.some((h) => t.includes(h))) return 1;
  return 0;
}

// Text that says "not a contractor for this": consultancy, labs, product sellers, associations.
const NOT_CONTRACTOR_TEXT =
  /®|™|osallistuvat yritykset|hankkeessa mukana|insinööritoimisto|insinoritoimisto|rakennuttajatoimisto|konsultointi|konsulttipalvel|kuntotutkimu|kuntotarkast|sisäilmatutkimu|laboratorio|laboratory|analyysi|maahantuo|jälleenmyy|verkkokauppa|webshop|online store|tukkukauppa|manufacturer|valmistaja|\bry\b|liitto ry|association|consulting|engineering services|design office|suunnittelutoimisto|expert services|asiantuntijapalvelu/i;
const MAIN_CONTRACTOR_TEXT = /pääurakoitsij|rakennusliike|kokonaisurak|uudisrakentami|kvr-urak|allianssi|yhteistoiminta|rakennamme|general contractor|main contractor|täyden palvelun rakennus/i;

// ---- Register match by name (no key, free) ----------------------------------
const core = (n: string) => flat(n.replace(/\b(oy|oyj|ab|ky|tmi|ay|ltd|group|yhtiöt|konserni)\b/gi, ""));

/** The trade-register entry for a candidate: same website, or an unambiguous name match. */
export async function registryFor(name: string, website: string | undefined): Promise<PrhCompany | null> {
  const domain = domainOf(website);
  const key = core(name);
  if (key.length < 4) return null;
  const hits = await prhByName(name.replace(/\s+(Oy|Oyj|Ab|Ky|Tmi|Ay)$/i, "")).catch(() => [] as PrhCompany[]);
  const live = hits.filter((c) => !c.situations.length);
  const sameSite = (c: PrhCompany) => !!domain && !!c.website && (domainOf(c.website) === domain || flat((domainOf(c.website) ?? "").split(".")[0]) === flat(domain.split(".")[0]));
  const bySite = live.find(sameSite);
  if (bySite) return bySite;
  // A different registered website is a different company with a similar name.
  const named = live.filter((c) => (!c.website || sameSite(c)) && (core(c.name) === key || (live.length === 1 && core(c.name).startsWith(key))));
  return named.length === 1 ? named[0] : null;
}

// ---- Scoring -----------------------------------------------------------------
export type FitInput = {
  name: string;
  website?: string;
  /** Map listing address ("Pekantie 3, 90900, Pohjois-Pohjanmaa"). */
  address?: string;
  /** Title, highlight and company-index description: what we know of their own text. */
  text: string;
  employees?: number;
  /** Map listing coordinates, when the candidate came from a listing. */
  lat?: number;
  lng?: number;
  profileCity?: string;
  registry?: Pick<PrhCompany, "mainBusinessLine" | "addresses"> | null;
};

export type SiteFit = {
  /** Registered main line of business and how it fits the trade. */
  tradeLine?: { label: string; match: TradeMatch };
  /** Their name/domain names the trade (3), their text does (2), only a related compound head (1), or neither (0). */
  textTrade: 0 | 1 | 2 | 3;
  /** Municipality of the registered street address (else postal address). */
  municipality?: string;
  /** Municipality of the registered postal address when it differs. */
  postalMunicipality?: string;
  /** Distance from the site in km, from the registered address or map listing (approximate, postcode area). */
  distanceKm?: number;
  /** Their site names the site's town or region as service area ("area") or says they work nationwide. */
  servesArea?: "area" | "nationwide";
  local: "near" | "region" | "far" | "unknown";
  /** Their text mentions the site's town or region somewhere (weak: may be one reference). */
  mentionsArea?: boolean;
  /** Text reads like a consultancy, lab, product seller or association rather than a contractor. */
  notContractor?: boolean;
  /** Text reads like a main contractor (general builder) while the job is a specialist trade. */
  mainContractor?: boolean;
  /** Website on an unusual top-level domain for a Finnish firm (e.g. a parked ".cc" look-alike). */
  oddDomain?: boolean;
};

const USUAL_TLD = /\.(fi|com|net|eu|org|info|io|ax|se|ee|biz|co)$/;

export type FitContext = { site: { lat: number; lng: number }; areaStems: string[]; words: TradeWords; job: TradeProfile };

export function siteFit(c: FitInput, ctx: FitContext): SiteFit {
  const label = c.registry?.mainBusinessLine;
  const tt = textTrade(c.text, ctx.words, `${c.name} ${(domainOf(c.website) ?? "").split(".")[0]}`);
  const located = (c.registry?.addresses ?? []).map(locateAddress).filter((x): x is Located => !!x);
  const dists = located.map((l) => distanceKm(ctx.site, l));
  if (c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)) dists.push(distanceKm(ctx.site, { lat: c.lat, lng: c.lng }));
  else if (c.address) {
    const l = locateAddress(c.address);
    if (l) dists.push(distanceKm(ctx.site, l));
  }
  const distance = dists.length ? Math.round(Math.min(...dists)) : undefined;
  const serves = servesArea(c.text, ctx.areaStems) ?? undefined;
  const profileLocal = !!c.profileCity && ctx.areaStems.some((st) => fold(c.profileCity!).includes(st));
  const local: SiteFit["local"] =
    distance != null ? (distance <= 60 ? "near" : distance <= 110 ? "region" : "far") : profileLocal ? "near" : serves === "area" ? "region" : "unknown";
  const muni = located[0]?.municipality || undefined;
  const postal = located.find((l) => l.municipality && l.municipality !== muni)?.municipality;
  const generalJob = ctx.job.generalJob;
  return {
    ...(label ? { tradeLine: { label, match: classifyLine(label, ctx.job) } } : {}),
    textTrade: tt,
    ...(muni ? { municipality: muni } : {}),
    ...(postal ? { postalMunicipality: postal } : {}),
    ...(distance != null ? { distanceKm: distance } : {}),
    ...(serves ? { servesArea: serves } : {}),
    local,
    ...(ctx.areaStems.some((st) => fold(`${c.text} ${c.website ?? ""}`).includes(st)) ? { mentionsArea: true } : {}),
    ...(NOT_CONTRACTOR_TEXT.test(`${c.name} ${c.text}`) ? { notContractor: true } : {}),
    ...(!generalJob && tt < 2 && MAIN_CONTRACTOR_TEXT.test(`${c.name} ${c.text}`) ? { mainContractor: true } : {}),
    ...(c.website && !USUAL_TLD.test(domainOf(c.website) ?? "") ? { oddDomain: true } : {}),
  };
}

/** Pre-verification score: higher = vet first. Trade fit dominates, then locality. */
export function preScore(f: SiteFit, employees?: number): number {
  let s = [0, 1.5, 3, 4][f.textTrade];
  const m = f.tradeLine?.match;
  const named = f.textTrade >= 2;
  // Specialists often register under a broad line (a demolition firm as a general builder
  // or a scrap dealer), so the register weighs less when their own text names the trade.
  if (m === "trade") s += 2;
  else if (m === "general") s -= named ? 1.5 : 2.5;
  else if (m === "infra") s -= named ? 1 : 2;
  else if (m === "off") s -= named ? 1 : 4;
  if (f.notContractor && !(m === "trade" || m === "specialist")) s -= 2;
  if (f.mainContractor) s -= 1;
  if (f.oddDomain) s -= 2;
  s += { near: 2, region: 1, unknown: f.mentionsArea ? 0.5 : 0, far: f.servesArea ? -0.5 : -3 }[f.local];
  if ((employees ?? 0) >= 5) s += 0.5;
  return s;
}

/** Fit-score adjustment (0-100 scale) after verification, from the same signals. */
export function fitAdjust(f: SiteFit): number {
  let d = 0;
  const m = f.tradeLine?.match;
  if (m === "off") d -= f.textTrade >= 2 ? 8 : 25;
  else if (m === "general") d -= f.textTrade >= 2 ? 6 : 12;
  else if (m === "infra") d -= 8;
  else if (m === "trade") d += 3;
  if (f.local === "far") d -= f.servesArea ? 4 : 15;
  else if (f.local === "near") d += 2;
  return d;
}
