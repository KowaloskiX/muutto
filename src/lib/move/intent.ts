// Stage "understand": parse the user's request into a MoveIntent (one small LLM call) and
// geocode the workplace. If the user only names a company, Exa finds its Helsinki-region
// office address first; Nominatim then turns the address into coordinates.
import { z } from "zod";
import { askJson } from "@/lib/llm";
import { geocode } from "@/lib/geo";
import { search, type ExaTrace } from "@/lib/exa";
import type { MoveIntent, Source } from "./types";
import { haversineM } from "./util";
import { customId } from "./custom";

const Parsed = z.object({
  workAddress: z.string().describe("The workplace street address exactly as given (e.g. 'Arkadiankatu 6, Helsinki'). Empty if only a company name is given"),
  company: z.string().describe("Employer/company name if given (e.g. 'Wolt', 'Nokia'), else empty"),
  workplaceLandmark: z.string().describe("A named place if the workplace is a landmark rather than an address, e.g. 'Helsinki-Vantaa airport', 'Aalto University Otaniemi'. Else empty"),
  city: z.string().describe("Municipality of the workplace if stated or obvious: Helsinki, Espoo, Vantaa or Kauniainen. Empty if unknown"),
  tenure: z.enum(["rent", "buy"]).describe("buy only if they want to purchase/buy; otherwise rent"),
  budget: z.number().describe("Monthly rent ceiling (rent) or purchase price ceiling (buy) in euros, e.g. '€1,300' -> 1300, '250k' -> 250000. 0 if not given"),
  size: z.string().describe("Rooms or size wanted as stated, e.g. '1-2 rooms', '2 rooms', '50 m²'. Empty if not given"),
  minRooms: z.number().describe("Minimum number of rooms implied (1 for studio). 0 if unknown. A family with kids implies at least 3 unless stated"),
  maxRooms: z.number().describe("Maximum number of rooms implied. 0 if unknown"),
  household: z.string().describe("e.g. 'single', 'couple', 'family with 2 kids'. Empty if not stated"),
  hasKids: z.boolean(),
  priorities: z
    .array(z.string())
    .describe(
      "Ordered list of what they care about, most important first, using these short phrases where they fit: 'short commute', 'quiet', 'pharmacy nearby', 'cafés nearby', 'grocery nearby', 'schools', 'daycare', 'parks', 'clean air', 'low rent', 'public transport', 'little construction', 'car-friendly'. Always include 'short commute'.",
    ),
  maxCommuteMin: z.number().describe("Max one-way commute in minutes if stated, else 0"),
  customPlaces: z
    .array(z.object({ what: z.string().describe("Search phrase, English plural, specific: 'gyms', 'climbing gyms', 'Lidl supermarkets', 'dog parks', 'international schools', 'public saunas', 'tennis courts'"), label: z.string().describe("Short singular column label, e.g. 'Gym', 'Climbing gym', 'Lidl', 'Dog park'") }))
    .describe(
      "Other kinds of places they want near home that are NOT already covered by: pharmacy, café, grocery/supermarket in general, school, daycare, park, public transport stop. Max 3, in the order mentioned. Empty if none.",
    ),
  summary: z.string().describe("One short English sentence restating the request"),
});

function dedupeCustom(list: { what: string; label: string }[]): MoveIntent["customPlaces"] {
  const seen = new Set<string>();
  const out = list
    .map((c) => ({ what: c.what.trim(), label: (c.label || c.what).trim() }))
    .filter((c) => c.what.length >= 3)
    .map((c) => ({ ...c, id: customId(c.what) }))
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .slice(0, 3);
  return out.length ? out : undefined;
}

export type IntentResult = { intent: MoveIntent; workSources: Source[]; minRooms?: number; maxRooms?: number; hasKids: boolean };

const REGION = { lat: 60.25, lng: 24.85 };

/** Company name only -> Exa finds the office street address in the Helsinki region. */
async function companyAddress(company: string, trace: ExaTrace[]): Promise<{ address: string; source: Source } | null> {
  const res = await search(
    {
      query: `${company} office address Helsinki Espoo Vantaa`,
      type: "auto",
      numResults: 6,
      contents: { highlights: { query: `${company} office street address postal code`, maxCharacters: 400 } },
    },
    trace,
  ).catch(() => ({ results: [] }));
  const re = /([A-ZÅÄÖ][a-zåäöé-]+(?:katu|tie|kuja|polku|väylä|kaari|ranta|puistikko|aukio|vägen|gatan|linja|rinne|tori)\s+\d+[A-Za-z]?)[,\s]+(0\d{4}|02\d{3}|01\d{3})?\s*(Helsinki|Espoo|Vantaa|Kauniainen)?/;
  for (const r of res.results ?? []) {
    for (const h of r.highlights ?? []) {
      const m = h.match(re);
      if (m) {
        const address = [m[1], m[2], m[3]].filter(Boolean).join(" ").replace(/\s+/g, " ");
        return { address, source: { url: r.url, label: new URL(r.url).hostname.replace(/^www\./, ""), quote: h.slice(0, 240), asOf: r.publishedDate?.slice(0, 10) } };
      }
    }
  }
  return null;
}

export async function understand(query: string, trace: ExaTrace[]): Promise<IntentResult> {
  const p = await askJson({
    system:
      "You parse a relocation request. Someone got a job in the Helsinki region (Helsinki, Espoo, Vantaa, Kauniainen) and wants to find where to live. Extract only what they say; never invent an address.",
    user: query,
    schema: Parsed,
  });

  const workSources: Source[] = [];
  let address = p.workAddress.trim();
  if (!address && p.company && !p.workplaceLandmark) {
    const hit = await companyAddress(p.company, trace);
    if (hit) {
      address = hit.address;
      workSources.push(hit.source);
    }
  }
  const tries = [
    address && p.city && !address.toLowerCase().includes(p.city.toLowerCase()) ? `${address}, ${p.city}` : address,
    address,
    p.workplaceLandmark,
    p.workplaceLandmark && p.city ? `${p.workplaceLandmark}, ${p.city}` : "",
  ].filter(Boolean);
  let work: MoveIntent["work"];
  for (const q of [...new Set(tries)]) {
    const g = await geocode(q);
    // Only accept points in the capital region (place names repeat across Finland).
    if (g && haversineM(g, REGION) < 45_000) {
      work = { lat: g.lat, lng: g.lng, label: address || p.workplaceLandmark || g.label };
      workSources.push({ url: `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}`, label: "OpenStreetMap Nominatim", quote: `${q} → ${g.label}` });
      break;
    }
  }

  const priorities = p.priorities.length ? p.priorities : ["short commute"];
  if (!priorities.some((x) => /commute/i.test(x))) priorities.unshift("short commute");
  const intent: MoveIntent = {
    workAddress: address || p.workplaceLandmark || p.company,
    work,
    tenure: p.tenure,
    budget: p.budget > 0 ? p.budget : undefined,
    size: p.size || undefined,
    household: p.household || undefined,
    priorities,
    maxCommuteMin: p.maxCommuteMin > 0 ? p.maxCommuteMin : 35,
    summary: p.summary,
    customPlaces: dedupeCustom(p.customPlaces),
  };
  return { intent, workSources, minRooms: p.minRooms || undefined, maxRooms: p.maxRooms || undefined, hasKids: p.hasKids };
}
