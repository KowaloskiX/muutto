import { z } from "zod";
import { askJson } from "@/lib/claude";
import { findCompaniesWeb, findPlaces, type ExaTrace, type Place } from "@/lib/exa";
import { domainOf } from "@/lib/prh";
import { buildRanking, polishWhy, type Ranked, type Why } from "@/lib/rationale";
import { verifyCompany, type CompanyReport } from "@/lib/verify";

/** One row of the final ranking: `fit` is 0-100, `why` has 2-4 evidence-backed reasons (most important first). */
export type RankedItem = Ranked;
export type { Why };

export const maxDuration = 300;

const CITIES: Record<string, { latitude: number; longitude: number }> = {
  espoo: { latitude: 60.21, longitude: 24.66 },
  helsinki: { latitude: 60.17, longitude: 24.94 },
  vantaa: { latitude: 60.29, longitude: 25.04 },
};

const Intent = z.object({
  service: z.string().describe("The specific job in plain English, e.g. 'pipe relining'"),
  trade: z.string().describe("Generic trade/business category for a local business directory, e.g. 'plumber', 'electrician', 'moving company'"),
  city: z.string().describe("Finnish city; default Espoo if none given"),
  summary: z.string().describe("One short sentence restating the job"),
});

// Keyword fallback so the demo still runs if the LLM call fails.
const TRADES: [RegExp, string][] = [
  [/plumb|pipe|relin|putki|lvi|sewer|viemär|drain/i, "plumber"],
  [/electric|sähkö|sauna heater|kiuas|socket|wiring/i, "electrician"],
  [/mov(e|ing)|muutto/i, "moving company"],
  [/paint|maalari/i, "painter"],
  [/clean|siivous/i, "cleaning company"],
  [/lock|lukko/i, "locksmith"],
  [/roof|katto/i, "roofer"],
  [/window|ikkuna/i, "window installer"],
  [/heat pump|lämpöpumppu|hvac|ilmalämpö/i, "HVAC contractor"],
  [/bathroom|kylpyhuone|renovat|remont/i, "renovation contractor"],
];
function guessIntent(q: string): z.infer<typeof Intent> {
  const city = /helsinki|helsingfors/i.test(q) ? "Helsinki" : /vantaa|vanda/i.test(q) ? "Vantaa" : "Espoo";
  const trade = TRADES.find(([re]) => re.test(q))?.[1] ?? "contractor";
  const service = q
    .replace(/\b(in|at|for my flat in)\s+(espoo|helsinki|vantaa)\b/gi, "")
    .replace(/[,.]?\s*english speaking/i, "")
    .replace(/\s+/g, " ")
    .trim()
    // "Electrician to install a sauna heater" -> "install a sauna heater"
    .replace(/^[\p{L}-]+\s+(?:to|for)\s+/iu, "");
  return { service, trade, city, summary: q };
}

export type FindEvent =
  | { type: "stage"; id: "understand" | "find" | "verify" | "rank"; status: "active" | "done"; detail?: string }
  | { type: "intent"; service: string; city: string; summary: string }
  | { type: "places"; places: Place[] }
  | { type: "company"; domain: string; status: "scanning" | "done" | "failed"; place: Place; report?: CompanyReport }
  | { type: "done"; ranked: RankedItem[]; trace: ExaTrace[] }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const { query, verifyTop = 4 } = (await req.json()) as { query?: string; verifyTop?: number };
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: FindEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const trace: ExaTrace[] = [];
      try {
        if (!query?.trim()) throw new Error("Describe the job you need done");
        send({ type: "stage", id: "understand", status: "active" });
        const intent = await askJson({
          system: "Extract the home-services job a person in Finland needs done. Answer in English.",
          user: query,
          schema: Intent,
        }).catch(() => guessIntent(query));
        send({ type: "intent", ...intent });
        send({ type: "stage", id: "understand", status: "done", detail: `${intent.service} · ${intent.city}` });

        send({ type: "stage", id: "find", status: "active", detail: "Exa Places + semantic search over company sites" });
        const coords = CITIES[intent.city.toLowerCase()] ?? CITIES.helsinki;
        const [{ places }, webCos] = await Promise.all([
          findPlaces(intent.trade, intent.city, coords, trace).catch(() => ({ places: [] as Place[] })),
          findCompaniesWeb(intent.service, intent.city, trace).catch(() => []),
        ]);
        send({ type: "places", places });
        // Merge: companies whose own site matches the specific job come first;
        // Places adds phone, address and rating when the domain matches.
        const placeByDomain = new Map(places.filter((p) => p.website).map((p) => [domainOf(p.website), p]));
        // Interleave: a company whose site matches the specific job, then a rated local listing, etc.
        const merged = new Map<string, Place>();
        const webList = webCos.map((w) => {
          const p = placeByDomain.get(domainOf(w.website));
          return { ...(p ?? { categories: [] }), name: p?.name ?? w.name, website: w.website } as Place;
        });
        const placeList = places.filter((p) => p.website);
        for (let i = 0; i < Math.max(webList.length, placeList.length); i++) {
          for (const p of [webList[i], placeList[i]]) {
            const d = p && domainOf(p.website);
            if (d && !merged.has(d)) merged.set(d, p);
          }
        }
        const candidates = [...merged.values()].slice(0, Math.min(6, verifyTop));
        send({ type: "stage", id: "find", status: "done", detail: `${webCos.length} company sites + ${places.length} local listings, checking ${candidates.length}` });

        send({ type: "stage", id: "verify", status: "active", detail: "Business ID, trade register, their own site, reviews" });
        const ranked: { place: Place; report: CompanyReport }[] = [];
        await Promise.all(
          candidates.map(async (place) => {
            const domain = domainOf(place.website) ?? place.name;
            send({ type: "company", domain, status: "scanning", place });
            try {
              const report = await verifyCompany({ name: place.name, website: place.website, service: intent.service, city: intent.city });
              trace.push(...report.trace);
              ranked.push({ place, report });
              send({ type: "company", domain, status: "done", place, report });
            } catch {
              send({ type: "company", domain, status: "failed", place });
            }
          }),
        );
        send({ type: "stage", id: "verify", status: "done" });

        send({ type: "stage", id: "rank", status: "active" });
        // Fit score (service proof weighted highest) + evidence-backed "why" reasons, sorted by fit.
        let scored = buildRanking(ranked, intent.service);
        // One company can run several brands/domains: keep the best-fitting per business ID.
        scored = scored.filter((r, i) => !r.report.businessId || scored.findIndex((x) => x.report.businessId === r.report.businessId) === i);
        scored = buildRanking(scored, intent.service); // recompute comparisons against the de-duplicated shortlist
        scored = await polishWhy(scored);
        send({ type: "stage", id: "rank", status: "done", detail: scored[0] ? `${scored[0].report.name} fits best (${scored[0].fit}/100)` : undefined });
        send({ type: "done", ranked: scored, trace });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
