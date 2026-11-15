// Who is renting this flat out, and what do they ask of tenants? One Exa search for the landlord or
// agency named in the listing (or its portal contact), then one judging call that may only use the
// returned passages: tenant requirements (credit check, deposit, income, pets), how to apply, and
// reviews. Each item keeps a verbatim quote that must appear in the passages.
import { z } from "zod";
import { search, type ExaTrace } from "@/lib/exa";
import { askJson } from "@/lib/llm";
import type { LandlordIntel, Listing } from "./types";
import { hostOf } from "./util";

const Out = z.object({
  name: z.string(),
  kind: z.enum(["agency", "company", "private", "unknown"]),
  website: z.string().describe("Official website URL if a passage shows it, else empty"),
  requirements: z.array(z.object({ what: z.string().describe("Short English, e.g. 'Credit check (luottotiedot)'"), quote: z.string(), url: z.string() })),
  apply: z.object({ how: z.string().describe("How to apply, short English; empty if unknown"), url: z.string(), quote: z.string() }),
  reviews: z.array(z.object({ quote: z.string(), url: z.string(), date: z.string(), tone: z.enum(["positive", "negative", "neutral"]) })),
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const cache = new Map<string, { at: number; v: LandlordIntel }>();

export async function landlordIntel(l: Listing, trace: ExaTrace[]): Promise<LandlordIntel | undefined> {
  const who = l.contact?.company || l.contact?.name;
  if (!who) return undefined;
  const hit = cache.get(who.toLowerCase());
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.v;
  const res = await search(
    {
      query: `${who} vuokra-asunnot vuokrahakemus luottotiedot vakuus lemmikit vaatimukset vuokralainen`,
      type: "auto",
      numResults: 8,
      contents: { highlights: { query: `${who} tenant requirements: credit information, deposit, income, pets, smoking, how to apply`, maxCharacters: 420 } },
    },
    trace,
  );
  const passages = (res.results ?? []).flatMap((r) => (r.highlights ?? []).map((h) => ({ url: r.url, date: r.publishedDate?.slice(0, 10), text: h.replace(/\s+/g, " ").trim() }))).slice(0, 18);
  if (!passages.length) return { name: who, kind: "unknown", requirements: [], reviews: [], checkedAt: new Date().toISOString() };
  const r = await askJson({
    system:
      "You read passages about a Finnish landlord or letting agency. Extract only what the passages say: tenant requirements, how to apply, reviews by tenants. " +
      "Requirements = what an ordinary adult applicant must meet or provide (credit check, deposit, income, employment, pets, smoking, documents, references); skip special cases (minors, guardians, students only if not stated as a rule). " +
      "Copy every quote character for character from one passage and give that passage's URL. If nothing is said, return empty lists. Never infer.",
    user: `Landlord / agency: ${who}\n\nPassages:\n${passages.map((p, i) => `[${i + 1}] ${p.url}${p.date ? ` (${p.date})` : ""}\n${p.text}`).join("\n\n")}`,
    schema: Out,
  });
  const inPassages = (q: string, url: string) => !!q && passages.some((p) => p.url === url && norm(p.text).includes(norm(q)));
  const v: LandlordIntel = {
    name: r.name || who,
    kind: r.kind,
    website: r.website && /^https?:\/\//.test(r.website) ? r.website : undefined,
    requirements: r.requirements.filter((x) => inPassages(x.quote, x.url)).slice(0, 6),
    apply: r.apply.how ? { how: r.apply.how, url: /^https?:\/\//.test(r.apply.url) ? r.apply.url : undefined, quote: inPassages(r.apply.quote, r.apply.url) ? r.apply.quote : undefined } : undefined,
    reviews: r.reviews.filter((x) => inPassages(x.quote, x.url)).slice(0, 3).map((x) => ({ ...x, date: x.date || undefined })),
    checkedAt: new Date().toISOString(),
  };
  if (v.website) v.website = v.website.split("#")[0];
  void hostOf;
  cache.set(who.toLowerCase(), { at: Date.now(), v });
  return v;
}
