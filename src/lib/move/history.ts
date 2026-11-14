// Has this flat been on the market before? One Exa search per listing for its street address on the
// Finnish portals finds earlier pages for the same flat (same address and size): a rental removed
// two months ago, the same flat on another portal, an earlier asking price. Portals delist those
// pages, so general search engines rarely surface them; Exa still has them, with the portal's own
// "Kohde on poistunut palvelusta <date>" line. Also finds the portal's page for the whole building.
import { search, type ExaResult, type ExaTrace } from "@/lib/exa";
import type { Listing, ListingHistory } from "./types";
import { hostOf } from "./util";

const LISTING = /asunnot\.oikotie\.fi\/(vuokra-asunnot|myytavat-asunnot)\/[^/]+\/\d+|vuokraovi\.com\/kohde\/|etuovi\.com\/kohde\//;
const BUILDING = /asunnot\.oikotie\.fi\/talo\//;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const id = (u: string) => (u.match(/(?:\/kohde\/|\/)([a-z]{0,2}\d{4,})(?:[/?#]|$)/i) ?? [])[1]?.toLowerCase();

function street(address?: string): string | null {
  const s = address?.split(",")[0]?.trim();
  return s && /\d/.test(s) ? s : null;
}

function priceOf(text: string): number | undefined {
  const m = text.match(/(?:Vuokra(?:\/kk)?\s*:?\s*|###\s*)([\d\s]{3,9})\s*€\s*\/\s*kk/i) ?? text.match(/Velaton hinta\s*:?\s*([\d\s]{5,11})(?:,\d{2})?\s*€/i);
  const n = m ? Number(m[1].replace(/\s/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function listingHistory(l: Pick<Listing, "url" | "address" | "sizeM2">, trace: ExaTrace[]): Promise<ListingHistory | null> {
  const st = street(l.address);
  if (!st) return null;
  const pc = l.address?.match(/\b\d{5}\b/)?.[0] ?? "";
  const res = await search(
    {
      query: `${st} ${pc} Helsinki asunto`.trim(),
      type: "auto",
      numResults: 10,
      includeDomains: ["oikotie.fi", "vuokraovi.com", "etuovi.com"],
      contents: { text: { maxCharacters: 1500 } },
    },
    trace,
  );
  const self = id(l.url);
  const streetRe = new RegExp(st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i");
  const seen: ListingHistory["seen"] = [];
  let buildingPage: ListingHistory["buildingPage"];
  for (const r of (res.results ?? []) as ExaResult[]) {
    const text = (r.text ?? "").replace(/\u00a0/g, " ");
    const hay = `${r.title ?? ""} ${text}`;
    if (BUILDING.test(r.url) && !buildingPage && streetRe.test(hay.replace(/\s+[A-Z]\s*\d*\b/, ""))) {
      const line = text.match(/[^\n]*(?:hintamuutoksista|ilmoituksista)[^\n]*/i)?.[0];
      buildingPage = { url: r.url, label: hostOf(r.url), quote: line ? clean(line).slice(0, 200) : undefined };
      continue;
    }
    if (!LISTING.test(r.url) || id(r.url) === self || r.url.split("?")[0] === l.url.split("?")[0]) continue;
    if (!streetRe.test(hay)) continue;
    // Same flat: same street address and the same floor area (±1 m²) when both state it.
    const m2 = text.match(/(\d{2,3}(?:[.,]\d)?)\s*m²/);
    const size = m2 ? Number(m2[1].replace(",", ".")) : undefined;
    if (l.sizeM2 && size && Math.abs(size - l.sizeM2) > 1) continue;
    if (l.sizeM2 && !size) continue;
    const removed = text.match(/poistunut palvelusta\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
    const quote = clean(removed ? text.slice(Math.max(0, (removed.index ?? 0) - 60), (removed.index ?? 0) + 60) : (text.match(/[^\n]*\d{2,3}(?:[.,]\d)?\s*m²[^\n]*/)?.[0] ?? r.title ?? "")).slice(0, 200);
    seen.push({ url: r.url.split("?")[0], source: hostOf(r.url).replace(/^asunnot\./, ""), price: priceOf(text), removedOn: removed?.[1], publishedAt: r.publishedDate?.slice(0, 10), quote });
  }
  if (!seen.length && !buildingPage) return { seen: [], checkedAt: new Date().toISOString() };
  return { seen: seen.slice(0, 4), buildingPage, checkedAt: new Date().toISOString() };
}
