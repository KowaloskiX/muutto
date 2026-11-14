// Live housing listings for an area via Exa (published in the last ~30 days), one search per
// portal: rent -> oikotie.fi + vuokraovi.com, buy -> oikotie.fi + etuovi.com. Price, size,
// rooms, address and contact are parsed deterministically from the page text Exa returns;
// nothing is filled in when the page does not state it.
import { contents, search, type ExaResult, type ExaTrace } from "@/lib/exa";
import type { Criterion, Listing, Source } from "./types";
import { fmtEur, hostOf, median } from "./util";
import { areaStems } from "./news";

const LISTING_URL = /asunnot\.oikotie\.fi\/(vuokra-asunnot|myytavat-asunnot)\/[^/]+\/\d+|vuokraovi\.com\/kohde\/|etuovi\.com\/kohde\//;

const eur = (s: string) => Number(s.replace(/\s| /g, "").replace(/,\d{1,2}$/, "").replace(/[.,]/g, ""));
const m2 = (s: string) => Number(s.replace(",", "."));

function first(text: string, res: RegExp[]): RegExpMatchArray | null {
  for (const r of res) {
    const m = text.match(r);
    if (m) return m;
  }
  return null;
}

// Listing photos are the portal's own CDN images. Agency logos, agent portraits and site assets are
// dropped; http is upgraded to https (the CDNs serve both) so the page has no mixed content.
const PHOTO_OK = /cdn\.asunnot\.oikotie\.fi\/|cloudfront\.net\/[^ ]*etuovimedia\/images\/(rental|property)\//;
const PHOTO_NOT = /logo|\/agent\/|\/ogroup\/|_next\/static|\/static\/media\//i;
function photosOf(r: ExaResult): string[] | undefined {
  const all = [r.image, ...(r.extras?.imageLinks ?? [])].filter((u): u is string => !!u && PHOTO_OK.test(u) && !PHOTO_NOT.test(u)).map((u) => u.replace(/^http:\/\//, "https://"));
  const out = [...new Set(all)].slice(0, 5);
  return out.length ? out : undefined;
}

export type ParsedListing = Listing & { kind: "rent" | "sale" | "unknown"; postalCode?: string; roomsN?: number; eurPerM2?: number; priceQuote?: string };

export function parseListing(r: ExaResult): ParsedListing | null {
  if (!LISTING_URL.test(r.url)) return null;
  const text = (r.text ?? "").replace(/ /g, " ");
  const title = (r.title ?? text.split("\n")[0] ?? "").trim();
  const isRent = /vuokra-asunnot|vuokraovi\.com/.test(r.url) || /Vuokra\/kk|€\s*\/\s*kk|Vuokrataan/.test(text);
  const isSale = /myytavat-asunnot/.test(r.url) || /Velaton hinta|Myydään|Myyntihinta/.test(text);
  const kind = isRent && !/myytavat-asunnot/.test(r.url) && !/Velaton hinta/.test(text) ? "rent" : isSale ? "sale" : "unknown";

  let price: number | undefined;
  let priceQuote: string | undefined;
  if (kind === "rent") {
    const m = first(text, [/Vuokra\/kk\s*:?\s*([\d\s]{3,9})\s*€/, /Vuokra\s+([\d\s]{3,9})\s*€\s*\/\s*kk/, /###\s*([\d\s]{3,9})\s*€\s*\/\s*kk/, /([\d\s]{3,7})\s*€\s*\/\s*kk/]);
    if (m) (price = eur(m[1])), (priceQuote = m[0].replace(/\s+/g, " ").trim());
  } else if (kind === "sale") {
    const m = first(text, [/Velaton hinta\s*:?\s*([\d\s]{5,11}(?:,\d{2})?)\s*€/, /##\s*Hinta\s*###\s*([\d\s]{5,11})\s*€/, /Hinta\s*:?\s*([\d\s]{5,11})\s*€/]);
    if (m) (price = eur(m[1])), (priceQuote = m[0].replace(/\s+/g, " ").trim());
  }
  if (price != null && (!Number.isFinite(price) || price < 100)) price = undefined;

  const sz = first(text, [/Asuinpinta-ala\s*:?\s*(\d{1,3}(?:,\d)?)\s*m²/, /Asuintilojen pinta-ala\s*(\d{1,3}(?:,\d)?)\s*m²/, /###\s*(\d{1,3}(?:,\d)?)\s*m²/]) ?? title.match(/(\d{1,3}(?:,\d)?)\s*m²/);
  const sizeM2 = sz ? m2(sz[1]) : undefined;

  const roomsM = first(text, [/Huoneiston kokoonpano\s*:?\s*\n*\s*([^\n]{2,40})/, /Huoneistoselitelmä\s*:?\s*([^\n]{2,40})/]) ?? title.match(/(\d\s*h\s*\+[^\n,-]{0,25})/);
  const rooms = roomsM?.[1]?.trim();
  const nM = text.match(/Huoneita\s*:?\s*\n*\s*(\d|Yksiö|Kaksio|Kolmio)/i) ?? rooms?.match(/^(\d)\s*h/) ?? title.match(/\b(Yksiö|Kaksio|Kolmio)\b/i);
  const word: Record<string, number> = { yksiö: 1, kaksio: 2, kolmio: 3 };
  const roomsN = nM ? (word[nM[1].toLowerCase()] ?? Number(nM[1])) : undefined;

  const addrM = first(text, [/Sijainti\s*\n+\s*([^\n]{4,80}\b\d{5}\s+[A-ZÅÄÖ][^\n]{2,20})/, /-\s+([^\n]{4,60},\s*\d{5}\s+(?:Helsinki|Espoo|Vantaa|Kauniainen))/, /\n- ([^\n]{4,60}, \d{5})\b/]);
  const heading = text.match(/^#\s+([^\n●]+)/m)?.[1]?.trim();
  const fromBlock = addrM?.[1]?.replace(/\s+/g, " ").trim();
  const pcAny = (fromBlock?.match(/\b(\d{5})\b/) ?? text.match(/\b(0\d{4})\s+[A-ZÅÄÖ][a-zåäö]+/))?.[1];
  // Prefer a "street + number" line; the page heading is "Street 4 B, District, City".
  const street = [fromBlock, heading, title.split(" - ")[0]].find((x) => x && /^[A-ZÅÄÖ][^,]*\d/.test(x) && !/^(Myydään|Vuokrataan)/.test(x));
  let address = (street ?? fromBlock ?? heading ?? title.split(" - ")[0]).replace(/\s+/g, " ").trim();
  if (pcAny && !address.includes(pcAny)) address = `${address.split(",")[0]}, ${pcAny} ${address.split(",").pop()?.trim() ?? ""}`.trim();
  const postalCode = (address.match(/\b(\d{5})\b/) ?? [])[1] ?? pcAny;

  // Contact: the agent/landlord as the page names them. Property-manager (isännöitsijä) and
  // bookkeeper lines are skipped: they are not the people to contact about a viewing.
  let contact: Listing["contact"];
  const agent = text.match(/####\s+([^\n]{3,60})\n+\s*(Kiinteistönvälittäjä[^\n]*|LKV[^\n]*|Myyntineuvottelija[^\n]*|Vuokrausneuvoja[^\n]*)/);
  const shower = text.match(/Esittelijänä\s+([^\n]{3,50}?)\s+p\.\s*([+\d][\d\s]{6,16}\d)/);
  const company = (() => {
    const hs = [...text.matchAll(/^####\s+([^\n]{3,60})$/gm)].map((m) => m[1].trim()).filter((h) => !/Kartta|Alueen|Esittely|Seuraava|kohteet|palvelut|Isännöit/i.test(h));
    const c = hs.find((h) => /\.(fi|com)$|Oy\b|LKV|Kodit|SATO|Lumo|Avara|Kiinteistö|Vuokra/i.test(h));
    return c && c !== agent?.[1]?.trim() ? c : undefined;
  })();
  const form = text.match(/(Ota yhteyttä[^\n]{0,80}|Vuokraa tästä[^\n]{0,60}|yhteydenottolomakkeeseen[^\n]{0,60}|Jätä yhteystietosi[^\n]{0,80}|Kysy lisätietoja[^\n]{0,60})/i);
  if (agent || shower || company || form) {
    const quote = [agent?.[0], shower?.[0], company && `#### ${company}`, form?.[0]].filter(Boolean).join(" … ").replace(/\s+/g, " ").slice(0, 280);
    contact = {
      name: shower?.[1]?.trim() ?? agent?.[1]?.trim(),
      company,
      phone: shower?.[2]?.replace(/\s+/g, " ").trim(),
      formUrl: form ? r.url : undefined,
      source: { url: r.url, label: hostOf(r.url), quote, asOf: r.publishedDate?.slice(0, 10) },
    };
  }

  const eurPerM2 = price && sizeM2 ? price / sizeM2 : undefined;
  return {
    url: r.url,
    title: title.slice(0, 140),
    address,
    price,
    sizeM2,
    rooms,
    roomsN,
    publishedAt: r.publishedDate?.slice(0, 10),
    source: hostOf(r.url).replace(/^asunnot\./, ""),
    contact,
    photos: photosOf(r),
    kind,
    postalCode,
    eurPerM2,
    priceQuote,
  };
}

export type ListingQuery = { tenure: "rent" | "buy"; budget?: number; minRooms?: number; maxRooms?: number };

const roomWord = (n?: number) => (n == null ? "" : n <= 1 ? "yksiö" : n === 2 ? "kaksio" : n === 3 ? "kolmio" : `${n}h`);

export async function areaListings(
  area: { id: string; name: string; municipality: string; postalCode?: string },
  q: ListingQuery,
  trace: ExaTrace[],
): Promise<{ all: ParsedListing[]; ok: boolean }> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const place = `${area.name.split(/\s+-\s+/).pop()} ${area.municipality}`;
  const rw = roomWord(q.maxRooms ?? q.minRooms);
  const verb = q.tenure === "rent" ? "Vuokrataan" : "Myydään";
  const domains = q.tenure === "rent" ? ["oikotie.fi", "vuokraovi.com"] : ["oikotie.fi", "etuovi.com"];
  const runs = await Promise.allSettled(
    domains.map((d) =>
      search(
        {
          query: `${verb} ${rw} ${place} ${area.postalCode ?? ""}`.replace(/\s+/g, " ").trim(),
          type: "auto",
          numResults: 10,
          includeDomains: [d],
          startPublishedDate: since,
          // No contents here: asking for text in the same call makes Exa favour portal articles
          // over listing pages (measured). Text is fetched in a second /contents call.
        },
        trace,
      ),
    ),
  );
  const ok = runs.some((r) => r.status === "fulfilled");
  const stems = areaStems(area.name);
  const seen = new Set<string>();
  const lists: ExaResult[][] = runs.map((run) => {
    if (run.status !== "fulfilled") return [];
    const out: ExaResult[] = [];
    for (const r of run.value.results ?? []) {
      const key = r.url.replace(/\?.*$/, "");
      if (seen.has(key) || !LISTING_URL.test(r.url)) continue;
      seen.add(key);
      out.push({ ...r, url: key });
    }
    return out;
  });
  const hits: ExaResult[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) hits.push(l[i]);
  // Portals interleaved so both are represented; up to 10 pages read in one /contents call.
  const pick = hits.slice(0, 10);
  const all: ParsedListing[] = [];
  if (!pick.length) return { all, ok };
  const page = await contents({ urls: pick.map((h) => h.url), text: { maxCharacters: 4000 }, extras: { imageLinks: 6 } }, trace).catch(() => ({ results: [] as ExaResult[] }));
  const byUrl = new Map(page.results.map((r) => [r.url.replace(/\?.*$/, ""), r]));
  for (const h of pick) {
    const full = byUrl.get(h.url);
    if (!full?.text) continue;
    const p = parseListing({ ...full, url: h.url, title: h.title ?? full.title, publishedDate: h.publishedDate ?? full.publishedDate });
    if (!p) continue;
    if (q.tenure === "rent" ? p.kind === "sale" : p.kind === "rent") continue;
    // Must be in this area: same postal code, or the area name in the address/title.
    const inArea = (p.postalCode && area.postalCode ? p.postalCode === area.postalCode : false) || (!p.postalCode && stems.some((s) => `${p.address} ${p.title}`.toLowerCase().includes(s)));
    if (!inArea) continue;
    all.push({ ...p, areaId: area.id });
  }
  return { all, ok };
}

/** Listings to show: within budget and room range, priced first, newest first, max 5. */
export function pickListings(all: ParsedListing[], q: ListingQuery): ParsedListing[] {
  const fits = (l: ParsedListing) =>
    (q.budget == null || l.price == null || l.price <= q.budget) && (q.minRooms == null || l.roomsN == null || l.roomsN >= q.minRooms) && (q.maxRooms == null || l.roomsN == null || l.roomsN <= q.maxRooms);
  // The same flat is often on two portals: keep one per street address + size (the one with photos).
  const seen = new Set<string>();
  return all
    .filter(fits)
    .sort((a, b) => Number(b.price != null) - Number(a.price != null) || Number(!!b.photos) - Number(!!a.photos) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .filter((l) => {
      const street = l.address?.split(",")[0].toLowerCase().replace(/\s+[a-z]\s*\d*$/i, "").replace(/\s+/g, " ").trim();
      if (!street || !/\d/.test(street)) return true;
      const k = `${street}|${l.sizeM2 ? Math.round(l.sizeM2) : ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);
}

export function rentCriterion(all: ParsedListing[], q: ListingQuery, ok: boolean): Criterion {
  const label = q.tenure === "rent" ? "Asking rent" : "Asking price";
  if (!ok) return { id: "rent", label, status: "unknown", value: null, detail: "Listing search unavailable right now.", sources: [] };
  const priced = all.filter((l) => l.price != null && l.eurPerM2 != null);
  if (!priced.length) return { id: "rent", label, status: "unknown", value: null, detail: `No priced ${q.tenure === "rent" ? "rental" : "sale"} listings for this area found on the portals in the last 30 days.`, sources: [] };
  const perM2 = median(priced.map((l) => l.eurPerM2!));
  const sized = priced.filter((l) => l.roomsN != null && (q.minRooms == null || l.roomsN >= q.minRooms) && (q.maxRooms == null || l.roomsN <= q.maxRooms));
  const typical = sized.length ? median(sized.map((l) => l.price!)) : undefined;
  const unit = q.tenure === "rent" ? "/mo" : "";
  const perUnit = q.tenure === "rent" ? `€${perM2.toFixed(1)}/m²` : `€${Math.round(perM2).toLocaleString("en-US")}/m²`;
  let status: Criterion["status"] = "ok";
  if (q.budget && typical != null) status = typical <= q.budget ? "good" : typical <= q.budget * 1.1 ? "ok" : "poor";
  else if (q.budget && typical == null) status = "unknown";
  const sources: Source[] = (sized.length ? sized : priced).slice(0, 4).map((l) => ({
    url: l.url,
    label: l.source,
    quote: `${l.address ?? l.title}: ${l.priceQuote ?? fmtEur(l.price!)}${l.sizeM2 ? `, ${l.sizeM2} m²` : ""}${l.rooms ? `, ${l.rooms}` : ""}`,
    asOf: l.publishedAt,
  }));
  return {
    id: "rent",
    label,
    status,
    value: typical != null ? `${fmtEur(typical)}${unit} typical` : `${perUnit} median`,
    detail:
      `Median ${perUnit} across ${priced.length} priced listing${priced.length > 1 ? "s" : ""} published in the last 30 days` +
      (typical != null ? `; median ${fmtEur(typical)}${unit} for ${sized.length} listing${sized.length > 1 ? "s" : ""} with the room count you asked for` : "; none with your room count") +
      (q.budget ? ` (budget ${fmtEur(q.budget)}${unit}).` : ".") +
      " Asking prices, not signed contracts.",
    sources,
  };
}
