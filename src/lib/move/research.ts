// Deep research on ONE listing: the "what next" after the area search.
//
// Two lanes run side by side so the user sees findings within seconds and the deep lane
// still lands inside the 60 s budget:
//   1. Orchestrated lane: read the listing page (Exa /contents, livecrawl), extract its facts
//      (one askJson call), then one scoped Exa /search per question — building, city decisions,
//      landlord reviews/news/official info, street works in the last 6 months — and structure
//      the highlights with one more askJson call.
//   2. Deep lane: an Exa Agent run (effort "low", ~40 s measured) researching the same building,
//      landlord and street with an output schema that demands a verbatim quote + URL per item.
//
// Hard rule: nothing is invented. Every finding carries a verbatim quote that is checked to
// appear in the source text Exa returned (search highlights, or the page re-read via
// /contents for agent citations). Anything that does not verify is dropped and counted.
// What we looked for and did not find is reported in `unknowns`.
import { z } from "zod";
import { call, contents, search, type ExaResult, type ExaTrace } from "@/lib/exa";
import { askJson, assertLlmBudget } from "@/lib/llm";
import type { Listing, ListingResearch, MoveIntent, ResearchEvent, Source } from "./types";

type Emit = (e: ResearchEvent) => void;
type Tone = "neutral" | "negative" | "positive";
type Severity = "low" | "medium" | "high";
type Section = "building" | "landlord" | "surroundings";

const AGENT_DEADLINE_MS = Number(process.env.MOVE_AGENT_DEADLINE_MS ?? 55_000);
const AGENT_OFF = process.env.MOVE_RESEARCH_AGENT === "0";
const SIX_MONTHS_MS = 183 * 86400_000;

// ---- Text helpers -------------------------------------------------------------

/** Normalise for quote matching: case, unicode forms, dashes, quotes, soft hyphens, whitespace, markdown emphasis. */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[­​-‍﻿]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[“”„«»"]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/[*_#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const loose = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** True when the quote (or each part between ellipses) appears verbatim in the text. */
export function quoteIn(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const parts = quote.split(/\.\.\.|…|\[\.\.\.\]/).map((p) => p.trim()).filter((p) => loose(p).length >= 10);
  if (!parts.length) return false;
  const n = norm(text);
  const l = loose(text);
  return parts.every((p) => n.includes(norm(p)) || l.includes(loose(p)));
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const LABELS: Record<string, string> = {
  "paatokset.hel.fi": "Helsinki city decisions",
  "hel.fi": "City of Helsinki",
  "espoo.fi": "City of Espoo",
  "vantaa.fi": "City of Vantaa",
  "keskustelu.suomi24.fi": "Suomi24 forum",
  "reddit.com": "Reddit",
  "yle.fi": "Yle",
  "hs.fi": "Helsingin Sanomat",
  "infraohjelmahelsinki.fi": "Helsinki infra programme",
  "exa.ai": "Exa places (reviews)",
};
function sourceOf(url: string, quote?: string, asOf?: string): Source {
  const h = host(url);
  return { url, label: LABELS[h] ?? h, ...(quote ? { quote: clip(quote.replace(/\s+/g, " ").trim(), 400) } : {}), ...(asOf ? { asOf: asOf.slice(0, 10) } : {}) };
}

/** Street name + house number ("Matinraitti 11 D" -> "Matinraitti 11"). */
export function streetOf(address: string | undefined): { street?: string; name?: string } {
  if (!address) return {};
  const first = address.split(",")[0].trim();
  const m = first.match(/^(.+?)\s+(\d+(?:\s*[-–]\s*\d+)?)/);
  if (!m) return { street: first || undefined, name: first || undefined };
  return { street: `${m[1]} ${m[2].replace(/\s+/g, "")}`, name: m[1] };
}

const CITIES = ["Helsinki", "Espoo", "Vantaa", "Kauniainen"];
const cityOf = (...s: (string | undefined)[]) => {
  const hay = s.filter(Boolean).join(" ");
  return CITIES.find((c) => new RegExp(`\\b${c}`, "i").test(hay));
};

const LISTING_HOSTS = ["oikotie.fi", "vuokraovi.com", "etuovi.com", "vuokraturva.fi", "tori.fi", "blok.ai"];
const BIG_LANDLORDS: { re: RegExp; name: string; domain: string }[] = [
  { re: /\bSATO\b/i, name: "SATO", domain: "sato.fi" },
  { re: /\b(Lumo|Kojamo)\b/i, name: "Lumo (Kojamo)", domain: "lumo.fi" },
  { re: /\bAvara\b/i, name: "Avara", domain: "avara.fi" },
  { re: /\bHeka\b|Helsingin kaupungin asunnot/i, name: "Heka", domain: "hekaoy.fi" },
  { re: /\bY-S[äa]{2}ti[öo]\b/i, name: "Y-Säätiö", domain: "ysaatio.fi" },
];

// ---- Exa helpers ------------------------------------------------------------------

type ExaSummary = { relevant: boolean; finding: string; quote: string; tone: Tone; risk: string };
type Ev = { id: string; url: string; title: string; date?: string; text: string; lane: string; full?: string; summary?: ExaSummary };

// Exa structured summaries: used instead of the LLM synthesis when OpenAI is unavailable
// (no key / shared daily cap reached). Exa writes one finding per page; we still verify
// its quote against the page text before showing it.
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean", description: "true only if the page is about the exact place/landlord asked about" },
    finding: { type: "string", description: "One short English sentence with the fact and its date/year; empty if not relevant" },
    quote: { type: "string", description: "One sentence copied verbatim from the page that supports the finding" },
    tone: { type: "string", enum: ["neutral", "negative", "positive"] },
    risk: { type: "string", description: "Consequence for a tenant ONLY if the page states a planned/ongoing renovation, works or a problem; else empty" },
  },
  required: ["relevant", "finding", "quote", "tone", "risk"],
};

async function scoped(lane: string, body: Record<string, unknown>, trace: ExaTrace[], hlQuery: string, summaryQuery?: string): Promise<Ev[]> {
  try {
    const r = await search(
      {
        type: "auto",
        numResults: 8,
        userLocation: "FI",
        ...body,
        contents: {
          highlights: { query: hlQuery, maxCharacters: 900 },
          ...(summaryQuery ? { text: { maxCharacters: 12000 }, summary: { query: summaryQuery, schema: SUMMARY_SCHEMA } } : {}),
        },
      },
      trace,
    );
    return (r.results ?? []).map((x: ExaResult & { summary?: string }) => {
      let summary: ExaSummary | undefined;
      try {
        summary = x.summary ? (JSON.parse(x.summary) as ExaSummary) : undefined;
      } catch {
        summary = undefined;
      }
      return { id: "", url: x.url, title: x.title ?? x.url, date: x.publishedDate ?? undefined, text: (x.highlights ?? []).join("\n…\n"), lane, full: x.text, summary };
    });
  } catch {
    return [];
  }
}

const mentions = (e: Ev, needles: string[]) => {
  const hay = loose(`${e.title} ${e.url} ${e.text}`);
  return needles.some((n) => n && hay.includes(loose(n)));
};

// ---- Listing extraction ---------------------------------------------------------------

const Extract = z.object({
  address: z.string().nullable().describe("Street address of the apartment exactly as written, with postal code and city if given"),
  district: z.string().nullable().describe("Neighbourhood / kaupunginosa as written"),
  housingCompany: z.string().nullable().describe("Housing company / property company name (taloyhtiö, As Oy, Kiinteistö Oy) as written"),
  builtYear: z.number().nullable(),
  energyClass: z.string().nullable().describe("Energy class as written, e.g. 'C (2018)'"),
  landlordName: z.string().nullable().describe("Who rents it out: company/agency name as written (SATO, Lumo, Avara, an LKV agency...) or null"),
  landlordKind: z.enum(["agency", "company", "private", "unknown"]),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  formUrl: z.string().nullable().describe("Application / contact form URL written in the text, if any"),
  renovations: z
    .array(
      z.object({
        what: z.string().describe("English, short: 'Pipe renovation (linjasaneeraus)', 'Facade renovation', ..."),
        year: z.string().nullable(),
        status: z.enum(["done", "planned", "unknown"]),
        quote: z.string().describe("Verbatim passage from the text"),
      }),
    )
    .describe("Renovations the text mentions (done or planned). Empty if none are mentioned."),
  facts: z
    .array(z.object({ label: z.string().describe("English: Rent, Deposit, Lease term, Water fee, Availability, Pets, Smoking, Heating, Furnished, Insurance, Other costs"), value: z.string().describe("English, short"), quote: z.string().describe("Verbatim from the text") }))
    .describe("Rental terms stated in the text, max 10"),
});
type Extracted = z.infer<typeof Extract>;

function lineAround(text: string, needle: string): string | undefined {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return undefined;
  const a = Math.max(0, text.lastIndexOf("\n", i) + 1, i - 160);
  let b = text.indexOf("\n", i + needle.length);
  if (b < 0 || b - i > 200) b = Math.min(text.length, i + needle.length + 120);
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Years mentioned in a passage that are after the construction year ("2013" for a 1962 building). */
function yearsIn(s: string, builtYear?: number): string | undefined {
  const ys = [...new Set((s.match(/\b(19[5-9]\d|20[0-4]\d)\b/g) ?? []).filter((y) => !builtYear || Number(y) > builtYear))];
  return ys.length ? ys.slice(0, 2).join("–") : undefined;
}

/** True when an OpenAI call can be made right now (key set, shared daily cap not reached). */
function llmAvailable(): boolean {
  if (!process.env.OPENAI_API_KEY) return false;
  try {
    assertLlmBudget();
    return true;
  } catch {
    return false;
  }
}

type Reno = { what: string; year?: string; status: "done" | "planned" | "unknown"; quote: string };

const RENO_WORDS: [RegExp, string][] = [
  [/putkiremont|linjasaneera|putkisto|vesijohto|viemär/i, "Pipe renovation (linjasaneeraus)"],
  [/julkisivu/i, "Facade renovation"],
  [/vesikat|kattoremont|katon (uusi|korja)/i, "Roof renovation"],
  [/ikkun/i, "Window renovation"],
  [/peruskorja/i, "Major renovation (peruskorjaus)"],
  [/hissi/i, "Lift work"],
  [/parveke/i, "Balcony renovation"],
  [/sähkö(remont|saneera|nousu)/i, "Electrical renovation"],
];

/**
 * Pattern extraction from Finnish listing pages (oikotie, vuokraovi, etuovi, SATO, Lumo
 * layouts): works without an LLM and is the ground truth the LLM output is checked against.
 * Every value comes with the exact line it was read from.
 */
export function regexListing(text: string) {
  const lines = text.split("\n").map((l) => l.replace(/^[\s#*-]+/, "").trim()).filter(Boolean);
  const after = (re: RegExp, max = 120): { value: string; quote: string } | undefined => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const rest = lines[i].slice((m.index ?? 0) + m[0].length).replace(/^[\s:]+/, "").trim();
      if (rest) return { value: rest.slice(0, max), quote: lines[i].slice(0, 300) };
      const next = lines[i + 1];
      if (next && next.length <= max) return { value: next, quote: `${lines[i]} ${next}` };
    }
    return undefined;
  };
  const year = after(/^(Rakennusvuosi|Valmistumis\S*vuosi|Year of construction|Year built|Käyttöönottovuosi)\b/i);
  const ym = year?.value.match(/\b(1[89]\d\d|20[0-4]\d)\b/) ?? text.match(/Taloyhtiön käyttöönottovuosi:?\s*(1[89]\d\d|20[0-4]\d)/i);
  const builtYear = ym ? { value: Number(ym[1]), quote: year?.quote ?? ym[0] } : undefined;

  const COMPANY = /\b(Asunto Oy|As\.? Oy|Asunto-osakeyhtiö|Kiinteistö Oy|Kiint\. Oy|Bostads Ab|Fastighets Ab)\s+[^\n,.;]{2,60}/i;
  const hcLine = after(/^(Taloyhtiön nimi|Taloyhtiö|Housing company|Kiinteistö)\b(?!ssä)/i);
  const hc = hcLine && COMPANY.test(hcLine.value) ? hcLine.value.match(COMPANY)![0].trim() : text.match(COMPANY)?.[0].trim();

  const en = after(/^Energialuokka|^Energy class/i, 40);
  const energy = en && /^[A-G]\b/.test(en.value) ? { value: en.value.replace(/\s+/g, " "), quote: en.quote } : undefined;

  const factDefs: [string, RegExp][] = [
    ["Rent", /^(Vuokra\/kk|Vuokra|Rent)$/i],
    ["Deposit", /^(Vuokravakuus|Vakuus|Takuuvuokra|Deposit|Security deposit)\b/i],
    ["Lease term", /^(Vuokra-aika|Vuokrasopimuksen kesto|Lease term|Rental period)\b/i],
    ["Availability", /^(Vapautuminen|Vapautuu|Lisätietoa vapautumisesta|Availability|Available from)\b/i],
    ["Water fee", /^(Vesimaksu|Water fee|Water charge)\b/i],
    ["Pets", /^(Lemmikit sallittu|Lemmikkieläimet sallittu|Pets allowed)\b/i],
    ["Home insurance", /^(Kotivakuutus|Home insurance)\b/i],
    ["Heating", /^(Lämmitysjärjestelmä|Lämmitys|Heating)\b/i],
    ["Furnished", /^(Kalustettu|Furnished)\b/i],
  ];
  const facts: { label: string; value: string; quote: string }[] = [];
  for (const [label, re] of factDefs) {
    const f = after(re, 140);
    if (!f) continue;
    const value = f.value.replace(/^[:\s]+/, "").trim();
    // A value that is itself the next label (empty field on the page) is not a value.
    if (!/[\p{L}\p{N}]/u.test(value) || /^(Lisätietoja|Lisätiedot|Palvelut|Muut ehdot|\/\s*kk)$/i.test(value) || factDefs.some(([, r]) => r.test(value))) continue;
    facts.push({ label, value, quote: f.quote });
  }

  // Renovation sentences: keep the sentence that names the work; status from tense/keywords.
  const renovations: Reno[] = [];
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  for (const raw of sentences) {
    const at = raw.search(/(remont|saneera|korja|uusi(ttu|ttiin|taan)|renovat)/i);
    if (at < 0) continue;
    // Page text is flattened: drop the headings / bullet fragments before the sentence proper.
    const cut = Math.max(raw.lastIndexOf("#", at), raw.lastIndexOf(" - ", at), raw.lastIndexOf("|", at));
    const sent = raw.slice(cut + 1).replace(/^[#\s|-]+/, "").trim();
    if (sent.length > 400 || sent.length < 15) continue;
    if (/kunto(luokitus)?\s*:?\s*(hyvä|tyydyttävä)$/i.test(sent)) continue;
    const kind = RENO_WORDS.find(([re]) => re.test(sent));
    if (!kind) continue;
    const planned = /(suunnit|tulossa|alkaa|alkamassa|tullaan|tehdään|planned|upcoming|PTS|kunnossapitotarve)/i.test(sent) && !/(tehty|valmistui|valmistunut|tehtiin|uusittu|uusittiin|completed|done)/i.test(sent);
    const done = /(tehty|valmistui|valmistunut|tehtiin|uusittu|uusittiin|remontoitu|saanut|saaneet|completed|done|renovated)/i.test(sent);
    const yr = sent.match(/\b(19[5-9]\d|20[0-4]\d)\b/g);
    if (renovations.some((r) => r.what === kind[1] && r.quote === sent)) continue;
    renovations.push({ what: kind[1], year: yr ? yr.join("–") : undefined, status: planned ? "planned" : done ? "done" : "unknown", quote: sent.trim() });
    if (renovations.length >= 8) break;
  }

  // Landlord / agency
  const contactHead = text.match(/Ota yhteyttä vuokranantajaan\s*\n+\s*#*\s*([^\n#]{2,60})/i)?.[1]?.trim();
  const lkv = text.match(/\b([A-ZÄÖÅ][\wÄÖÅäöå&.\- ]{1,40}?\s(?:LKV|Oy LKV|Kiinteistövälitys|Vuokravälitys)(?:\s?Oy)?)\b/)?.[1]?.trim();
  const landlord = contactHead && !/^(Lisätiedot|Puhelin|Sähköposti)/i.test(contactHead) ? contactHead : lkv;
  const phoneM = text.match(/(?:puh\.?|p\.|tel\.?|phone|puhelin)?\s*((?:\+358|0)[\s-]?\d{1,3}[\s-]?\d{3,4}[\s-]?\d{2,4})(?!\d)/i);
  const phone = phoneM && digits(phoneM[1]).length >= 8 && digits(phoneM[1]).length <= 12 && !/^(19|20)\d\d/.test(phoneM[1]) ? phoneM[1].trim() : undefined;
  const contactName =
    text.match(/(?:Lisätietoa kohteesta antaa|Lisätietoja antaa|Kohdetta välittää:?|Yhteyshenkilö:?|Contact person:?)\s+([A-ZÄÖÅ][a-zäöå]+ [A-ZÄÖÅ][a-zäöå-]+)/)?.[1] ?? undefined;

  return { builtYear, housingCompany: hc, energy, facts, renovations, landlord, phone, contactName };
}

// ---- Synthesis of search evidence ------------------------------------------------------

const Synth = z.object({
  findings: z.array(
    z.object({
      section: z.enum(["building", "landlord", "surroundings"]),
      evidence: z.string().describe("Evidence id, e.g. E3"),
      text: z.string().describe("One plain English sentence saying what the source states, with its date/year if given. No speculation."),
      quote: z.string().describe("Verbatim passage copied from that evidence (max ~300 chars), in the original language"),
      tone: z.enum(["neutral", "negative", "positive"]),
      renovation: z.object({ what: z.string(), year: z.string().nullable() }).nullable().describe("Set when the finding is a renovation of THIS building"),
    }),
  ),
  risks: z.array(
    z.object({
      text: z.string().describe("Consequence for a tenant, only as far as the source supports it"),
      severity: z.enum(["low", "medium", "high"]),
      evidence: z.string(),
      quote: z.string(),
    }),
  ),
  questions: z.array(z.string()).describe("3-5 concrete questions to ask at the viewing, each tied to a finding or to something we could not find"),
});

const SYNTH_SYSTEM = `You structure research about one rental apartment in the Helsinki region for a newcomer.
You get the listing facts and numbered evidence passages (E1, E2, ...) from web pages.
Rules:
- Only use the evidence. Every finding and risk cites exactly one evidence id and copies a verbatim quote from THAT passage (same language, same characters).
- Building findings must be about this exact address or housing company, not a neighbouring one. Landlord findings must be about this landlord. Surroundings: works, blasting, noise, street closures, tram/metro works, openings/closures near the street or in the district.
- Skip passages that are generic, about a different place, or older news that no longer matters (e.g. works finished years ago) unless it is a building renovation (those matter whenever they happened).
- A risk is only allowed when a source states the fact behind it (e.g. "pipe renovation planned for 2027" -> noise and possible rent change). Never invent dates, amounts or causes.
- If nothing relevant exists for a section, return no findings for it. Fewer, solid findings beat many weak ones.
- Questions: specific to this apartment, e.g. ask whether the pipe renovation is done when the building is old and no source says so.`;

// ---- Agent lane -----------------------------------------------------------------------

type AgentItem = { section: Section; text: string; quote: string; sourceUrl: string; tone: Tone };
type AgentRisk = { text: string; severity: Severity; quote: string; sourceUrl: string };
type AgentOut = { findings: AgentItem[]; risks: AgentRisk[]; questions: string[]; costDollars?: number };

const g = globalThis as unknown as { __moveAgentRuns?: Map<string, { id: string; at: number }> };
const agentRuns = (g.__moveAgentRuns ??= new Map());

function agentSchema() {
  const str = { type: "string" };
  return {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section: { type: "string", enum: ["building", "landlord", "surroundings"] },
            text: { ...str, description: "One plain English sentence stating what the source says (with date/year)" },
            quote: { ...str, description: "Verbatim passage copied from the source page, original language, max 300 characters" },
            sourceUrl: { type: "string", format: "uri" },
            tone: { type: "string", enum: ["neutral", "negative", "positive"] },
          },
          required: ["section", "text", "quote", "sourceUrl", "tone"],
        },
      },
      risks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: str,
            severity: { type: "string", enum: ["low", "medium", "high"] },
            quote: { ...str, description: "Verbatim passage from the source that states the underlying fact" },
            sourceUrl: { type: "string", format: "uri" },
          },
          required: ["text", "severity", "quote", "sourceUrl"],
        },
      },
      questions: { type: "array", items: str },
    },
    required: ["findings", "risks", "questions"],
  };
}

function agentQuery(p: { priorities?: string[]; street?: string; address?: string; district?: string; city?: string; housingCompany?: string; builtYear?: number; landlord?: string; listingUrl: string }) {
  const where = [p.address ?? p.street, p.district, p.city].filter(Boolean).join(", ");
  return (
    `Research a rental apartment for someone moving to the Helsinki region: ${where}, Finland` +
    `${p.housingCompany ? ` (housing company: ${p.housingCompany})` : ""}${p.builtYear ? `, building from ${p.builtYear}` : ""}` +
    `${p.landlord ? `, rented out by ${p.landlord}` : ""}. Listing: ${p.listingUrl}\n\n` +
    `First read the listing to identify the housing company (taloyhtiö), construction year and landlord. Then find, with a verbatim quote and the source URL for every item:\n` +
    `1. building: renovations done or planned for THIS building (putkiremontti/linjasaneeraus, julkisivu, katto, ikkunat, hissi), building permits or city decisions about this address (e.g. paatokset.hel.fi), housing company news.\n` +
    `2. landlord: tenant experiences, complaints or praise about ${p.landlord ?? "the landlord or letting agency named in the listing"} as a landlord (forums such as Suomi24 or Reddit, review pages, news), and official tenant information if it is a large landlord (SATO, Lumo/Kojamo, Avara, Heka...).\n` +
    `3. surroundings: construction works, blasting (louhinta), street works, noise, tram/metro works, notable openings or closures on this street or in ${p.district ?? "the district"} in the last 6 months.\n` +
    `Also give risks a tenant should know (only when a source states the underlying fact) and 3-5 questions to ask at the viewing.\n` +
    (p.priorities?.length ? `The tenant cares most about: ${p.priorities.slice(0, 5).join(", ")}.\n` : "") +
    `Write text in English, keep quotes in the original language copied exactly. Do NOT add items for things you did not find; leave the list short instead. Never cite the listing page itself for building history.`
  );
}

async function startAgent(query: string, cacheKey: string, trace: ExaTrace[]): Promise<string> {
  const prev = agentRuns.get(cacheKey);
  if (prev && Date.now() - prev.at < 3600_000) return prev.id;
  const run = await call("POST", "/agent/runs", { query, effort: "low", outputSchema: agentSchema() }, trace, "agent(low): listing deep research");
  agentRuns.set(cacheKey, { id: run.id, at: Date.now() });
  return run.id as string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function waitAgent(id: string, deadline: number, trace: ExaTrace[], onPoll: (status: string) => void): Promise<AgentOut | "timeout" | "failed"> {
  for (;;) {
    let run: any;
    try {
      run = await call("GET", `/agent/runs/${encodeURIComponent(id)}`, undefined, trace, "agent poll");
    } catch {
      run = null;
    }
    const status = run?.status ?? "unknown";
    onPoll(status);
    if (status === "completed") {
      const s = run.output?.structured ?? {};
      const cost = typeof run.costDollars === "number" ? run.costDollars : run.costDollars?.total;
      return {
        findings: (s.findings ?? []).filter((f: any) => f?.quote && f?.sourceUrl && f?.text),
        risks: (s.risks ?? []).filter((r: any) => r?.quote && r?.sourceUrl && r?.text),
        questions: (s.questions ?? []).filter((q: any) => typeof q === "string"),
        costDollars: typeof cost === "number" ? cost : undefined,
      };
    }
    if (status === "failed" || status === "cancelled") return "failed";
    if (Date.now() + 2500 > deadline) return "timeout";
    await new Promise((r) => setTimeout(r, 2500));
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- Main ---------------------------------------------------------------------------------

export async function researchListing(listing: Listing, intent: MoveIntent | undefined, emit: Emit): Promise<ListingResearch> {
  const t0 = Date.now();
  const trace: ExaTrace[] = [];
  let llmCalls = 0;
  let dropped = 0;
  const steps: ListingResearch["steps"] = [];
  const step = (label: string, detail?: string) => {
    steps.push({ label, ...(detail ? { detail } : {}), at: Date.now() - t0 });
    emit({ type: "step", label, ...(detail ? { detail } : {}) });
  };

  const building: NonNullable<ListingResearch["building"]> = { renovations: [], notes: [] };
  const reviews: { text: string; source: Source; tone: Tone }[] = [];
  const surroundings: ListingResearch["surroundings"] = [];
  const risks: ListingResearch["risks"] = [];
  const questions: string[] = [];
  const facts: NonNullable<ListingResearch["facts"]> = [];
  const unknowns: string[] = [];
  const seen = new Set<string>(); // url + quote prefix, to merge both lanes without duplicates

  const own: { host?: string } = {}; // landlord's own domain, set once the listing is read
  const ownSite = (url: string) => !!own.host && (host(url) === own.host || host(url).endsWith(`.${own.host}`));
  const addFinding = (section: Section | "risk", text: string, source: Source, extra: { tone?: Tone; severity?: Severity; via: "listing" | "search" | "agent"; renovation?: { what: string; year?: string } }) => {
    const key = `${source.url}|${loose(source.quote ?? text).slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (section === "building") {
      if (extra.renovation) building.renovations.push({ what: extra.renovation.what, ...(extra.renovation.year ? { year: extra.renovation.year } : {}), source });
      else building.notes.push({ text, source });
    } else if (section === "landlord") reviews.push({ text, source, tone: extra.tone ?? "neutral" });
    else if (section === "surroundings") surroundings.push({ text, source, tone: extra.tone ?? "neutral" });
    else risks.push({ text, severity: extra.severity ?? "low", source });
    emit({ type: "finding", section, text, source, ...(extra.tone ? { tone: extra.tone } : {}), ...(extra.severity ? { severity: extra.severity } : {}), via: extra.via });
  };

  // ---- Deep lane: Exa Agent, started first so its ~40 s overlap everything else ----
  const agentP: Promise<AgentOut | "timeout" | "failed" | "off"> = AGENT_OFF
    ? Promise.resolve("off")
    : (async () => {
        try {
          const a0 = listing.address ?? listing.title;
          const id = await startAgent(
            agentQuery({ priorities: intent?.priorities, street: streetOf(a0).street, address: a0, district: listing.areaId?.replace(/^\d{5}\s*/, ""), city: cityOf(a0, listing.title, listing.areaId), landlord: listing.contact?.company, listingUrl: listing.url }),
            listing.url,
            trace,
          );
          step("Deep research agent started", "Exa Agent reads the listing and further sources on the building, landlord and street");
          let last = "";
          let beat = Date.now();
          return await waitAgent(id, t0 + AGENT_DEADLINE_MS, trace, (st) => {
            // A visible heartbeat every ~8 s keeps the trace alive (and the stream from idling).
            if ((st !== last && st !== "completed") || (st === "running" && Date.now() - beat > 8000)) {
              step("Deep research agent", st === "running" ? `reading sources… ${Math.round((Date.now() - t0) / 1000)} s` : st);
              beat = Date.now();
            }
            last = st;
          });
        } catch {
          return "failed";
        }
      })();

  // ---- 1. Read the listing ----
  // Live crawl first (is it still on the market?), Exa's stored copy when the live page is
  // short (removed listings keep only a stub) or the portal refuses crawlers.
  step("Reading the listing", host(listing.url));
  let pageText = "";
  let pageAsOf: string | undefined;
  let liveText = "";
  try {
    const r = await contents({ urls: [listing.url], text: { maxCharacters: 20000 }, livecrawl: "preferred", livecrawlTimeout: 8000 }, trace);
    const res = r.results?.[0];
    liveText = res?.text ?? "";
    const crawled = r.statuses?.[0]?.source === "crawled";
    pageText = liveText;
    pageAsOf = crawled ? new Date().toISOString() : res?.publishedDate ?? undefined;
    if (pageText.length < 1500) {
      const c = await contents({ urls: [listing.url], text: { maxCharacters: 20000 } }, trace).catch(() => null);
      const stored = c?.results?.[0];
      if ((stored?.text?.length ?? 0) > pageText.length) {
        pageText = stored!.text!;
        pageAsOf = stored!.publishedDate ?? undefined;
      }
    }
  } catch (e) {
    emit({ type: "error", message: `Could not read the listing page: ${(e as Error).message.slice(0, 160)}` });
  }
  const listingSrc = (quote?: string) => sourceOf(listing.url, quote, pageAsOf);
  step(
    "Listing read",
    pageText ? `${pageText.length.toLocaleString("en")} characters${pageText === liveText && liveText ? " (fetched live)" : " (Exa's stored copy)"}` : "page text unavailable — continuing with the title and address",
  );

  const gone = liveText.match(/Kohde on poistunut palvelusta[^\n#]*|Ilmoitus on poistunut[^\n#]*|This listing (?:has been|was) removed[^\n#]*/i) ?? liveText.match(/^[\s-]*(Vuokrattu|Rented|Varattu|Myyty|Sold)\s*$/im);
  if (gone) {
    addFinding("risk", `The live listing page says "${gone[0].trim()}" — it is probably no longer available. Facts below come from Exa's stored copy.`, sourceOf(listing.url, gone[0].trim(), new Date().toISOString()), {
      severity: "high",
      via: "listing",
    });
  }

  // ---- 2. Extract facts from the listing: regex first (always), LLM fills gaps (verified) ----
  const rx = regexListing(pageText);
  let ex: Extracted | null = null;
  if (pageText.length > 200 && llmAvailable()) {
    step("Extracting building, terms and contact from the listing");
    try {
      llmCalls++;
      ex = await askJson({
        system:
          "Extract facts from a Finnish rental listing page. Copy values exactly as written; use null when the text does not state it. Quotes must be verbatim substrings of the text. Do not infer a renovation from the building's age.",
        user: `URL: ${listing.url}\nTitle: ${listing.title}\n\n${pageText.slice(0, 14000)}`,
        schema: Extract,
      });
    } catch (e) {
      emit({ type: "error", message: `Listing extraction (LLM) unavailable, using pattern extraction only: ${(e as Error).message.slice(0, 120)}` });
    }
  }
  const inText = (v: string | null | undefined) => !!v && loose(pageText).includes(loose(v));
  const address = (ex?.address && inText(ex.address) ? ex.address : undefined) ?? listing.address ?? listing.title;
  const { street, name: streetName } = streetOf(listing.address ?? address);
  const district = (ex?.district && inText(ex.district) ? ex.district : undefined) ?? listing.areaId?.replace(/^\d{5}\s*/, "");
  const city = cityOf(address, listing.title, listing.areaId, pageText.slice(0, 600)) ?? "Helsinki";
  const housingCompany = rx.housingCompany ?? (ex?.housingCompany && inText(ex.housingCompany) ? ex.housingCompany : undefined);
  const builtYear = rx.builtYear?.value ?? (ex?.builtYear && pageText.includes(String(ex.builtYear)) ? ex.builtYear : undefined);
  if (builtYear) {
    building.builtYear = builtYear;
    addFinding("building", `Built in ${builtYear}${housingCompany ? ` (${housingCompany})` : ""}.`, listingSrc(rx.builtYear?.quote ?? lineAround(pageText, String(builtYear))), { via: "listing" });
  }
  if (housingCompany) building.housingCompany = housingCompany;
  const energy = rx.energy ?? (ex?.energyClass && inText(ex.energyClass) ? { value: ex.energyClass, quote: lineAround(pageText, ex.energyClass) ?? ex.energyClass } : undefined);
  if (energy) facts.push({ label: "Energy class", value: energy.value, source: listingSrc(energy.quote) });
  const factLabels = new Set(facts.map((f) => f.label.toLowerCase()));
  for (const f of rx.facts) {
    factLabels.add(f.label.toLowerCase());
    facts.push({ label: f.label, value: f.value, source: listingSrc(f.quote) });
  }
  for (const f of ex?.facts ?? []) {
    if (factLabels.has(f.label.toLowerCase())) continue;
    if (quoteIn(f.quote, pageText)) {
      factLabels.add(f.label.toLowerCase());
      facts.push({ label: f.label, value: f.value, source: listingSrc(f.quote) });
    } else dropped++;
  }
  const renos = [...(ex?.renovations ?? [])];
  for (const r of rx.renovations) if (!renos.some((x) => loose(x.quote).includes(loose(r.quote).slice(0, 40)))) renos.push({ ...r, what: r.what, year: r.year ?? null });
  for (const r of renos) {
    if (!quoteIn(r.quote, pageText)) {
      dropped++;
      continue;
    }
    const src = listingSrc(r.quote);
    addFinding("building", `Listing: ${r.what}${r.year ? ` (${r.year})` : ""} — ${r.status === "planned" ? "planned" : r.status === "done" ? "done" : "status not stated"}.`, src, {
      via: "listing",
      renovation: { what: `${r.what}${r.status === "planned" ? " (planned)" : ""}`, year: r.year ?? undefined },
    });
    if (r.status === "planned") addFinding("risk", `${r.what} is planned${r.year ? ` for ${r.year}` : ""}: expect weeks of noise and possibly temporary loss of water/bathroom; ask how it affects the rent.`, src, { severity: "medium", via: "listing" });
  }

  // Landlord + contact
  // Maintenance / fault-report contacts (huolto, vikailmoitukset, kiinteistöpalvelu) are on many
  // listing pages but are not who you ask for a viewing: skip them.
  const MAINT = /vikailmoit|huolto|kiinteistöpalvelu|kiinteistöhuol|isännöi|ulkoalue|siivou|talomestari|maintenance|fault report|janitor/i;
  const isMaint = (needle: string) => {
    const i = pageText.toLowerCase().indexOf(needle.toLowerCase());
    return i >= 0 && MAINT.test(pageText.slice(Math.max(0, i - 160), i + needle.length));
  };
  const emails = [...new Set(pageText.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])].filter((e) => !/example|noreply|no-reply/i.test(e) && !isMaint(e));
  const email = ex?.email && pageText.toLowerCase().includes(ex.email.toLowerCase()) && !isMaint(ex.email) ? ex.email : emails[0];
  const phoneRaw = ex?.phone && digits(ex.phone).length >= 6 && digits(pageText).includes(digits(ex.phone)) ? ex.phone : rx.phone;
  const phone = phoneRaw && !isMaint(phoneRaw) ? phoneRaw : undefined;
  const urls = pageText.match(/https?:\/\/[^\s)<>\]"]+/g) ?? [];
  const formUrl = ex?.formUrl && urls.some((u) => u.startsWith(ex!.formUrl!)) ? ex.formUrl : urls.find((u) => /application|hakemus|form|lomake|yhteydenotto/i.test(u));
  const big = BIG_LANDLORDS.find((b) => b.re.test(`${ex?.landlordName ?? ""} ${host(listing.url)} ${email ?? ""}`)) ?? BIG_LANDLORDS.find((b) => b.re.test(pageText.slice(0, 6000)));
  const landlordName = (ex?.landlordName && inText(ex.landlordName) ? ex.landlordName : undefined) ?? rx.landlord ?? big?.name;
  const landlordKind = big ? "company" : ex?.landlordKind ?? "unknown";
  const ownDomain = (() => {
    if (email) {
      const d = email.split("@")[1].toLowerCase();
      if (!/gmail|hotmail|outlook|yahoo|icloud|live\.|kolumbus|luukku|elisanet|welho/.test(d)) return d;
    }
    const h = host(listing.url);
    if (!LISTING_HOSTS.some((d) => h.endsWith(d))) return h;
    return big?.domain;
  })();
  own.host = ownDomain;
  const contactQuote = (email && lineAround(pageText, email)) || (phone && lineAround(pageText, phone)) || (formUrl && lineAround(pageText, formUrl)) || (landlordName && lineAround(pageText, landlordName));
  const contact: Listing["contact"] | undefined =
    email || phone || formUrl || landlordName
      ? {
          ...(ex?.contactName && inText(ex.contactName) ? { name: ex.contactName } : rx.contactName ? { name: rx.contactName } : {}),
          ...(landlordName ? { company: landlordName } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(formUrl ? { formUrl } : {}),
          source: listingSrc(contactQuote),
        }
      : listing.contact;
  step(
    "Listing facts",
    [builtYear && `built ${builtYear}`, housingCompany, landlordName && `landlord ${landlordName}`, email ? "email found" : phone ? "phone found" : formUrl ? "form found" : "no direct contact"].filter(Boolean).join(" · "),
  );

  // ---- 4. Orchestrated lane: one scoped search per question ----
  const since = new Date(Date.now() - SIX_MONTHS_MS).toISOString();
  const placeQ = [street ?? address, district, city].filter(Boolean).join(" ");
  const worksDomains =
    city === "Espoo" ? ["espoo.fi", "lansimetro.fi", "raidejokeri.info"] : city === "Vantaa" ? ["vantaa.fi"] : city === "Kauniainen" ? ["kauniainen.fi"] : ["hel.fi", "infraohjelmahelsinki.fi", "kaupunkiliikenne.fi", "uutiset.hel.fi"];
  const decisionDomains = city === "Espoo" ? ["espoo.fi"] : city === "Vantaa" ? ["vantaa.fi"] : city === "Kauniainen" ? ["kauniainen.fi"] : ["paatokset.hel.fi", "hel.fi"];
  step("Looking up the building", [street, housingCompany].filter(Boolean).join(" · "));
  if (landlordName) step("Checking the landlord", landlordName);
  step("Scanning the street for works and noise", `${street ?? district ?? city}, last 6 months`);

  const bNeedles = [housingCompany ?? "", street ?? ""].filter((x) => x.length > 3);
  const lNeedles = landlordName ? [landlordName.replace(/\s*\(.*\)$/, "").replace(/\b(Oy|Oyj|Ab|LKV)\b/gi, "").trim(), ...(big ? [big.name.split(" ")[0]] : [])] : [];
  const sNeedles = [streetName ?? "", district ?? ""].filter((x) => x.length > 3);

  const useLlm = llmAvailable();
  if (!useLlm) step("Exa summaries mode", "LLM unavailable — Exa writes one structured finding per page; quotes still verified");
  const sq = (q: string) => (useLlm ? undefined : q);
  const sqBuilding = sq(`Facts about the building at ${street}, ${city}${housingCompany ? ` (${housingCompany})` : ""}: renovations done or planned (pipes, facade, roof, windows, lift), building permits, problems. relevant=false if the page is about another address.`);
  const sqSurround = sq(`Construction works, blasting, street works, noise, tram or metro works, openings or closures on ${streetName ?? street} or in ${district ?? city}, ${city}, with dates. relevant=false if none are mentioned for this place.`);
  const lanes: Promise<Ev[]>[] = [
    scoped("building", { query: `${housingCompany ?? `As Oy ${street}`} ${city} linjasaneeraus putkiremontti julkisivuremontti peruskorjaus`, numResults: 8 }, trace, `${street} remontti saneeraus`, sqBuilding),
    scoped("building", { query: `${street} ${city} rakennuslupa päätös`, includeDomains: decisionDomains, numResults: 6 }, trace, `${street} rakennuslupa`, sqBuilding),
    scoped("surroundings", { query: `${placeQ} työmaa katutyöt louhinta melu`, startPublishedDate: since, numResults: 8 }, trace, `${streetName ?? district} työmaa melu`, sqSurround),
    scoped("surroundings", { query: `${district ?? streetName} ${city} rakennustyöt raitiotie työmaa liikennejärjestelyt`, startPublishedDate: since, numResults: 8 }, trace, `${district ?? streetName} työt`, sqSurround),
    scoped("surroundings", { query: `${district ?? streetName} ${streetName ?? ""} katutyöt työmaa rakentaminen`, includeDomains: worksDomains, startPublishedDate: since, numResults: 8 }, trace, `${district ?? streetName} työmaa`, sqSurround),
    scoped("surroundings", { query: `${district ?? streetName} ${city} avautuu uusi kauppa ravintola sulkeutuu`, startPublishedDate: since, category: "news", numResults: 6 }, trace, `${district ?? streetName}`, sqSurround),
  ];
  if (landlordName) {
    const ln = lNeedles[0] || landlordName;
    // Reviews come from third parties; the landlord's own site is searched separately for official info.
    const notOwn = ownDomain ? { excludeDomains: [ownDomain] } : {};
    const sqLandlord = sq(`What tenants, reviews or news say about ${ln} as a landlord or letting agency: complaints, praise, rent increases, maintenance, deposits. relevant=false if the page is not about ${ln}.`);
    lanes.push(
      scoped("landlord", { query: `${ln} vuokranantaja kokemuksia vuokralaiset`, numResults: 8, ...notOwn }, trace, `${ln} kokemuksia`, sqLandlord),
      scoped("landlord", { query: `${ln} landlord Helsinki tenant experience review`, numResults: 6, ...notOwn }, trace, `${ln} landlord`, sqLandlord),
      scoped("landlord", { query: `${ln} vuokralaiset vuokrankorotus uutinen`, startPublishedDate: new Date(Date.now() - 2 * 365 * 86400_000).toISOString(), category: "news", numResults: 6, ...notOwn }, trace, `${ln} vuokralaiset`, sqLandlord),
    );
    if (ownDomain) lanes.push(scoped("landlord", { query: `${ln} tietoa vuokralaiselle asukkaille huolto vikailmoitus vuokrankorotus`, includeDomains: [ownDomain], numResults: 4 }, trace, "vuokralaiselle asukkaille", sqLandlord));
  }
  const all = (await Promise.all(lanes)).flat();
  const byUrl = new Map<string, Ev>();
  for (const e of all) {
    if (e.url === listing.url || !e.text) continue;
    const need = e.lane === "building" ? bNeedles : e.lane === "landlord" ? lNeedles : sNeedles;
    if (!mentions(e, need)) continue;
    const prev = byUrl.get(e.url);
    if (prev) prev.text = prev.text.includes(e.text) ? prev.text : `${prev.text}\n…\n${e.text}`;
    else byUrl.set(e.url, { ...e });
  }
  const evidence = [...byUrl.values()].slice(0, 24).map((e, i) => ({ ...e, id: `E${i + 1}` }));
  const count = (l: string) => evidence.filter((e) => e.lane === l).length;
  step("Sources found", `${all.length} results → ${evidence.length} mention this building, landlord or street (building ${count("building")}, landlord ${count("landlord")}, surroundings ${count("surroundings")})`);

  // ---- 5. Structure the evidence (one LLM call, quotes verified) ----
  const listingBrief = [
    `Address: ${address}`,
    district && `District: ${district}, ${city}`,
    builtYear && `Built: ${builtYear}`,
    housingCompany && `Housing company: ${housingCompany}`,
    landlordName && `Landlord: ${landlordName}`,
    building.renovations.length && `Renovations in listing: ${building.renovations.map((r) => r.what).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  let synthQuestions: string[] = [];
  let synthOk = false;
  if (evidence.length && useLlm) {
    step("Weighing the evidence", `${evidence.length} sources, quotes are checked against the page text`);
    try {
      llmCalls++;
      const out = await askJson({
        system: SYNTH_SYSTEM,
        user: `LISTING\n${listingBrief}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nEVIDENCE\n${evidence
          .map((e) => `[${e.id}] (${e.lane}) ${e.title} — ${e.url}${e.date ? ` — published ${e.date.slice(0, 10)}` : ""}\n${e.text.slice(0, 1800)}`)
          .join("\n\n")}`,
        schema: Synth,
      });
      const ev = new Map(evidence.map((e) => [e.id, e]));
      for (const f of out.findings) {
        const e = ev.get(f.evidence.trim());
        if (!e || !quoteIn(f.quote, `${e.title}\n${e.text}`)) {
          dropped++;
          continue;
        }
        addFinding(f.section, f.text, sourceOf(e.url, f.quote, e.date), {
          tone: f.tone,
          via: "search",
          renovation: f.section === "building" && f.renovation ? { what: f.renovation.what, year: f.renovation.year ?? undefined } : undefined,
        });
      }
      for (const r of out.risks) {
        const e = ev.get(r.evidence.trim());
        if (!e || !quoteIn(r.quote, `${e.title}\n${e.text}`)) {
          dropped++;
          continue;
        }
        addFinding("risk", r.text, sourceOf(e.url, r.quote, e.date), { severity: r.severity, via: "search" });
      }
      synthQuestions = out.questions;
      synthOk = true;
    } catch (e) {
      emit({ type: "error", message: `Structuring search results failed: ${(e as Error).message.slice(0, 160)}` });
    }
  }
  if (evidence.length && !synthOk) {
    // Exa-summary path (or LLM failure): one finding per relevant page, quote verified on the page text.
    const perLane: Record<string, number> = {};
    for (const e of evidence) {
      const sm = e.summary;
      if (!sm?.relevant || !sm.finding || (perLane[e.lane] ?? 0) >= 4) continue;
      const body = `${e.title}\n${e.full ?? ""}\n${e.text}`;
      if (!quoteIn(sm.quote, body)) {
        dropped++;
        continue;
      }
      perLane[e.lane] = (perLane[e.lane] ?? 0) + 1;
      const section = e.lane as Section;
      const reno = section === "building" && /(renovat|refurbish|replac|pipe|facade|façade|roof)/i.test(sm.finding);
      addFinding(section, clip(sm.finding, 280), sourceOf(e.url, sm.quote, e.date), { tone: sm.tone, via: "search", renovation: reno ? { what: clip(sm.finding, 120), year: yearsIn(sm.quote, builtYear) } : undefined });
      if (sm.risk && sm.risk.length > 10) addFinding("risk", clip(sm.risk, 240), sourceOf(e.url, sm.quote, e.date), { severity: "medium", via: "search" });
    }
  }

  // ---- 6. Merge the deep lane, verifying each quote against the cited page ----
  if (!AGENT_OFF) step("Waiting for the deep research agent", `up to ${Math.max(0, Math.round((t0 + AGENT_DEADLINE_MS - Date.now()) / 1000))} s more`);
  const agent = await agentP;
  let agentState: NonNullable<ListingResearch["meta"]>["agent"] = typeof agent === "string" ? agent : "merged";
  let costDollars: number | undefined;
  let agentQuestions: string[] = [];
  if (typeof agent === "object") {
    costDollars = agent.costDollars;
    const cited = [...new Set([...agent.findings.map((f) => f.sourceUrl), ...agent.risks.map((r) => r.sourceUrl)])].filter((u) => u !== listing.url).slice(0, 12);
    step("Verifying the agent's citations", `${agent.findings.length + agent.risks.length} items from ${cited.length} pages`);
    const texts = new Map<string, { text: string; date?: string }>();
    if (cited.length) {
      try {
        const r = await contents({ urls: cited, text: { maxCharacters: 80000 } }, trace);
        for (const x of r.results ?? []) texts.set(x.url, { text: `${x.title ?? ""}\n${x.text ?? ""}`, date: x.publishedDate ?? undefined });
      } catch {
        /* unverifiable -> dropped below */
      }
    }
    const pageOf = (u: string) => texts.get(u) ?? texts.get(u.replace(/\/$/, "")) ?? texts.get(`${u}/`);
    let kept = 0;
    // The cited page must also be about this place / landlord, not only contain the quote.
    const about = (section: Section | "risk", t: string) => {
      const need = section === "building" ? bNeedles : section === "landlord" ? lNeedles : section === "surroundings" ? sNeedles : [...bNeedles, ...sNeedles, ...lNeedles];
      if (!need.length) return true;
      const l = loose(t);
      return need.some((n) => l.includes(loose(n)));
    };
    for (const f of agent.findings) {
      const p = pageOf(f.sourceUrl);
      if (!p || !quoteIn(f.quote, p.text) || f.sourceUrl === listing.url || !about(f.section, p.text)) {
        dropped++;
        continue;
      }
      kept++;
      const reno = f.section === "building" && /(remont|saneera|renovat|peruskorja|replac|uusittiin|uusitaan)/i.test(`${f.text} ${f.quote}`);
      const year = reno ? yearsIn(`${f.quote} ${f.text}`, builtYear) : undefined;
      addFinding(f.section, f.text, sourceOf(f.sourceUrl, f.quote, p.date), { tone: f.tone, via: "agent", renovation: reno ? { what: clip(f.text, 120), year } : undefined });
    }
    for (const r of agent.risks) {
      const p = pageOf(r.sourceUrl);
      if (!p || !quoteIn(r.quote, p.text) || !about("risk", p.text)) {
        dropped++;
        continue;
      }
      kept++;
      addFinding("risk", r.text, sourceOf(r.sourceUrl, r.quote, p.date), { severity: r.severity, via: "agent" });
    }
    agentQuestions = agent.questions;
    step("Deep research merged", `${kept} verified, ${agent.findings.length + agent.risks.length - kept} dropped (quote not on the cited page, or page not about this place)`);
  } else if (agent === "timeout") {
    agentState = "timeout";
    step("Deep research agent still running", "not merged to stay within the time limit; search findings above are complete");
  } else if (agent === "failed") step("Deep research agent unavailable", "continuing with search findings");

  // ---- 7. Questions + unknowns ----
  const reviewsFound = reviews.length > 0;
  const pipeKnown = [...building.renovations.map((r) => r.what), ...building.notes.map((n) => n.text)].some((t) => /pipe|putki|linja|plumb|water pipes|sewer|vesijoh|viemär/i.test(t));
  if (builtYear && builtYear <= 1990 && !pipeKnown) {
    questions.push(`The building is from ${builtYear}. Has the pipe renovation (linjasaneeraus) been done, or is one planned? We found no source either way.`);
    unknowns.push("Pipe renovation (linjasaneeraus) status — no source found");
  }
  if (!builtYear) unknowns.push("Construction year — not stated on the listing");
  if (landlordName && !reviewsFound) unknowns.push(`Tenant experiences with ${landlordName} — no public reviews found`);
  if (!landlordName) unknowns.push("Who the landlord is — the listing does not say");
  if (!surroundings.length) unknowns.push(`Works or noise near ${street ?? district ?? "the address"} in the last 6 months — nothing found`);
  if (!contact?.email && !contact?.phone && !contact?.formUrl) unknowns.push("Direct contact (email/phone/form) — not on the listing page");
  const qSeen = new Set(questions.map(loose));
  for (const q of [...synthQuestions, ...agentQuestions]) {
    const k = loose(q);
    if (q.length > 12 && !qSeen.has(k)) {
      qSeen.add(k);
      questions.push(q);
    }
  }

  const research: ListingResearch = {
    listingUrl: listing.url,
    address,
    building: building.builtYear || building.housingCompany || building.renovations.length || building.notes.length ? building : undefined,
    landlord:
      landlordName || contact
        ? { name: landlordName ?? contact?.name ?? "Not stated on the listing", kind: landlordName ? landlordKind : "unknown", reviews, ...(contact ? { contact } : {}) }
        : undefined,
    surroundings,
    risks: risks.sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity)),
    questions: questions.slice(0, 6),
    steps,
    facts,
    unknowns,
    meta: { tookMs: Date.now() - t0, exaCalls: trace.length, llmCalls, agent: agentState, dropped, ...(costDollars != null ? { costDollars } : {}) },
  };
  step("Done", `${building.renovations.length + building.notes.length + reviews.length + surroundings.length + risks.length} cited findings in ${Math.round((Date.now() - t0) / 1000)} s · ${trace.length} Exa calls · ${dropped} unverifiable items dropped`);
  research.steps = steps;
  research.meta!.tookMs = Date.now() - t0;
  return research;
}
