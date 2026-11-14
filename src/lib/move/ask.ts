// "Add any criterion": the user types what matters ("climbing wall", "near the sea", "safe to walk
// at night") and every area is measured on it, each answer cited. One small LLM call classifies the
// criterion (as in Minerva: a typed criterion routed to the right tool):
//  - place:       a kind of venue -> Exa Places around each area centre, nearest one + distance
//  - yes_no:      a yes/no question about the area -> Exa search per area, judged only from passages
//  - descriptive: a short answer about the area -> same, with a 1-4 word value
// For the web kinds the judge must quote a passage verbatim; quotes that do not appear in the source
// are dropped and that area reads "unknown". Nothing is answered from model memory.
import { z } from "zod";
import { askJson } from "@/lib/llm";
import { search, type ExaResult, type ExaTrace } from "@/lib/exa";
import type { Criterion, LatLng, Place } from "./types";
import { customId, measureCustom } from "./custom";
import { hostOf, today } from "./util";

export type AskKind = "place" | "yes_no" | "descriptive";
export type AskArea = { id: string; name: string; municipality: string; center: LatLng };
export type AskResult = {
  criterion: { id: `custom:${string}`; label: string; kind: AskKind; what: string; question: string };
  results: Record<string, { criterion: Criterion; places: Place[] }>;
  tookMs: number;
};

const Plan = z.object({
  kind: z.enum(["place", "yes_no", "descriptive"]).describe("place = they want a kind of venue/facility nearby (gym, sauna, Lidl, dog park, international school). yes_no = a yes/no property of the neighbourhood. descriptive = a property best answered with a short phrase or level"),
  label: z.string().describe("Column label, 1-3 words, Title case, e.g. 'Climbing wall', 'Near the sea', 'Safe at night'"),
  placeQuery: z.string().describe("For place: English plural venue type to search, e.g. 'climbing gyms', 'public saunas'. Else empty"),
  searchQuery: z.string().describe("For yes_no/descriptive: a short web search phrase in Finnish AND English keywords about this property of a neighbourhood, without the area name, e.g. 'meri ranta merinäköala seaside beach'. Else empty"),
  positive: z.string().describe("What a good answer means for the user, one short sentence, e.g. 'the sea or a beach is within walking distance'"),
});

const Judge = z.object({
  areas: z.array(
    z.object({
      areaId: z.string(),
      value: z.string().describe("yes_no: 'Yes', 'No' or 'Partly'. descriptive: 1-4 words. 'Unknown' if the passages don't say"),
      status: z.enum(["good", "ok", "poor", "unknown"]).describe("good = clearly meets what the user wants, ok = partly, poor = clearly does not, unknown = the passages don't settle it"),
      detail: z.string().describe("One plain sentence grounded in the quote"),
      source: z.number().describe("Index [n] of the passage the quote comes from, -1 if unknown"),
      quote: z.string().describe("A verbatim excerpt (8-30 words) copied exactly from that passage; empty if unknown"),
    }),
  ),
});

const norm = (s: string) => s.toLowerCase().replace(/[“”"'’]/g, "").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/**
 * The passage text to show as the quote: the judge's quote if it is verbatim in the passage,
 * otherwise the passage sentence that shares at least 70% of its words. Never the model's wording.
 */
function verbatim(quote: string, passage: string): string | null {
  if (!quote.trim()) return null;
  if (norm(passage).includes(norm(quote))) return quote.trim();
  const q = new Set(words(quote));
  if (q.size < 4) return null;
  let best: { s: string; score: number } | null = null;
  for (const s of passage.split(/(?<=[.!?…])\s+|\s*\.\.\.\s*|\s+…\s+/)) {
    const ws = new Set(words(s));
    const hit = [...q].filter((w) => ws.has(w)).length / q.size;
    if (hit >= 0.7 && (!best || hit > best.score)) best = { s: s.trim(), score: hit };
  }
  return best ? best.s.slice(0, 300) : null;
}

async function webEvidence(q: string, a: AskArea, question: string, trace: ExaTrace[]): Promise<ExaResult[]> {
  const short = a.name.split(/\s+-\s+/).pop()!.trim();
  const res = await search(
    { query: `${short} ${a.municipality} ${q}`, type: "auto", numResults: 6, userLocation: "FI", contents: { highlights: { query: `${question} ${short}`, maxCharacters: 500 } } },
    trace,
  ).catch(() => ({ results: [] as ExaResult[] }));
  return (res.results ?? []).filter((r) => (r.highlights ?? []).some((h) => h.trim().length > 40)).slice(0, 5);
}

export async function askCriterion(question: string, areas: AskArea[], trace: ExaTrace[]): Promise<AskResult> {
  const t0 = Date.now();
  const plan = await askJson({
    system: "You turn a home-seeker's wish about a neighbourhood in the Helsinki region into a measurable criterion. Never answer it yourself.",
    user: question,
    schema: Plan,
  });
  const what = (plan.kind === "place" ? plan.placeQuery : plan.searchQuery).trim() || question;
  const id = customId(plan.kind === "place" ? what : plan.label || question);
  const criterion = { id, label: plan.label || question, kind: plan.kind, what, question };
  const results: AskResult["results"] = {};

  if (plan.kind === "place") {
    await Promise.all(
      areas.map(async (a) => {
        results[a.id] = await measureCustom({ id, what, label: criterion.label }, a, trace);
      }),
    );
    return { criterion, results, tookMs: Date.now() - t0 };
  }

  // Web kinds: evidence per area in parallel, then one judging call for all areas.
  const evidence = await Promise.all(areas.map((a) => webEvidence(what, a, question, trace)));
  const blocks: string[] = [];
  const index: { area: string; r: ExaResult; text: string }[] = [];
  // Short keys (A1, A2 …): real area ids contain spaces and models trim them.
  const key = (i: number) => `A${i + 1}`;
  areas.forEach((a, i) => {
    const lines = evidence[i].map((r) => {
      const n = index.length;
      const text = (r.highlights ?? []).join(" … ").replace(/\s+/g, " ").trim();
      index.push({ area: a.id, r, text });
      return `[${n}] ${hostOf(r.url)}${r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : ""}: ${text}`;
    });
    blocks.push(`## areaId=${key(i)} — ${a.name}, ${a.municipality}\n${lines.join("\n") || "(no passages found)"}`);
  });
  const judged = await askJson({
    system:
      `You judge neighbourhoods for a home-seeker ONLY from the numbered passages given for each area. The user wants: ${plan.positive}. ` +
      `Be strict: "good" only if a passage says it directly about that area; a passage about a nearby place, a walk of 15+ minutes or a general city statement is at most "ok". ` +
      `Criterion type: ${plan.kind}. Answer every areaId (A1, A2 …) exactly as written. Use only passages under the same areaId. The quote must be one sentence copied character for character from the passage. If the passages do not clearly settle it, status "unknown", value "Unknown", source -1. ` +
      `Passages about a different place with a similar name do not count.`,
    user: `Criterion: ${question}\n\n${blocks.join("\n\n")}`,
    schema: Judge,
    effort: "low",
  });
  const byArea = new Map(judged.areas.map((j) => [j.areaId.trim().toUpperCase(), j]));
  for (const [i, a] of areas.entries()) {
    const j = byArea.get(key(i));
    const src = j && j.source >= 0 ? index[j.source] : undefined;
    const quote = j && src && src.area === a.id ? verbatim(j.quote, src.text) : null;
    if (!j || j.status === "unknown" || !quote) {
      results[a.id] = {
        criterion: { id, label: criterion.label, status: "unknown", value: null, detail: evidence[i].length ? "The pages Exa found don't settle this for this area." : "Exa found no pages about this for this area.", sources: [] },
        places: [],
      };
      continue;
    }
    results[a.id] = {
      criterion: {
        id,
        label: criterion.label,
        status: j.status,
        value: j.value,
        detail: j.detail,
        sources: [{ url: src!.r.url, label: hostOf(src!.r.url), quote, asOf: src!.r.publishedDate?.slice(0, 10) ?? today() }],
      },
      places: [],
    };
  }
  return { criterion, results, tookMs: Date.now() - t0 };
}
