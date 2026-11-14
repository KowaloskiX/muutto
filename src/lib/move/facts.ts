// Facts a listing page states about the flat and its building, read deterministically from the
// page text Exa returns (Oikotie, Vuokraovi, Etuovi). Each fact keeps the exact line it came from.
// Nothing is inferred: a fact the page does not state is simply absent.
import type { ListingFact } from "./types";

type Rule = { key: ListingFact["key"]; label: string; re: RegExp; value: (m: RegExpMatchArray) => string | null; tone?: (v: string, m: RegExpMatchArray) => ListingFact["tone"] };

const yes = (s: string) => /^(kyllä|on|yes)/i.test(s.trim());
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// "Label\n: value" (Oikotie), "Label value" on one line (Vuokraovi/Etuovi), or "Label\n\nvalue".
const field = (label: string, value = "([^\\n]{1,60})") => new RegExp(`(?:^|\\n)\\s*${label}\\s*(?:\\n\\s*:?\\s*|:\\s*|\\s+|\\n\\s*\\n\\s*)${value}`, "i");

const RULES: Rule[] = [
  { key: "built", label: "Built", re: field("Rakennusvuosi", "((?:1[89]|20)\\d{2})\\b"), value: (m) => m[1] },
  { key: "floor", label: "Floor", re: field("Kerros(?:et)?", "(\\d{1,2}\\s*\\/\\s*\\d{1,2})"), value: (m) => clean(m[1]).replace(/\s*\/\s*/, " of ") },
  { key: "lift", label: "Lift", re: field("Hissi", "(Kyllä|Ei|On|Ei ole)"), value: (m) => (yes(m[1]) ? "Yes" : "No"), tone: (v) => (v === "No" ? "poor" : undefined) },
  {
    key: "sauna",
    label: "Sauna",
    re: /(Asunnossa sauna|Asunnossa on sauna|Taloyhtiössä on sauna(?:\s*\n\s*Kyllä)?)/i,
    value: (m) => (/asunnossa/i.test(m[1]) ? "In the flat" : "In the building"),
    tone: () => "good",
  },
  { key: "energy", label: "Energy class", re: field("Energialuokka", "([A-G])(?:\\s*\\d{4}|\\b)"), value: (m) => m[1].toUpperCase(), tone: (v) => (/[AB]/.test(v) ? "good" : /[FG]/.test(v) ? "poor" : undefined) },
  { key: "condition", label: "Condition", re: field("(?:Kunto|Asunnon kunto)", "(Hyvä|Erinomainen|Tyydyttävä|Välttävä|Uusi|Huono)"), value: (m) => ({ hyvä: "Good", erinomainen: "Excellent", tyydyttävä: "Fair", välttävä: "Poor", uusi: "New", huono: "Bad" })[m[1].toLowerCase()] ?? m[1], tone: (v) => (/Good|Excellent|New/.test(v) ? "good" : /Poor|Bad/.test(v) ? "poor" : undefined) },
  { key: "pets", label: "Pets", re: field("Lemmikit sallittu", "(Kyllä|Ei)"), value: (m) => (yes(m[1]) ? "Allowed" : "Not allowed") },
  { key: "furnished", label: "Furnished", re: /(Vuokrataan kalustettuna|Kalustettu\s+(?:Kyllä|Ei))/i, value: (m) => (/ei$/i.test(m[1]) ? "No" : "Yes") },
  { key: "deposit", label: "Deposit", re: /(?:Vakuus|Lisätietoa vakuudesta)\s*:?\s*\n?\s*([\d\s.,]{3,9}\s*€|\d(?:[.,]\d)?\s*kk:n vuokra[^\n]{0,20})/i, value: (m) => clean(m[1]).replace(/,00/, "") },
  { key: "fee", label: "Maintenance fee", re: /Hoitovastike\s*:?\s*\n?\s*([\d\s.,]{2,9}\s*€\s*\/\s*kk)/i, value: (m) => clean(m[1]).replace(/,00/, "") },
  {
    key: "renovation",
    label: "Pipe renovation",
    re: /([^.\n]{0,80}(?:linjasaneeraus|putkiremontti|putkisaneeraus|LVIS-saneeraus|linjasaneerauks|putkiremontin)[^.\n]{0,100})/i,
    value: (m) => (/(tulossa|suunnitte|alkaa|käynnisty|edessä|planned|202[7-9]|203\d)/i.test(m[1]) ? "Planned" : /(tehty|toteutettu|valmistunut|valmis|uusittu|suoritettu|done|\b(19|20)\d{2}\b)/i.test(m[1]) ? "Done" : "Mentioned"),
    tone: (v) => (v === "Done" ? "good" : v === "Planned" ? "poor" : undefined),
  },
  { key: "balcony", label: "Balcony", re: /(Parveke\s*\n?\s*(?:Kyllä|Ei)\b|Asunnossa on parveke|lasitettu parveke)/i, value: (m) => (/ei\b/i.test(m[1]) && !/on parveke|lasitettu/i.test(m[1]) ? "No" : "Yes") },
  { key: "viewing", label: "Next viewing", re: /(?:Seuraava esittely|Esittelyaika)\s*\n+\s*((?:ma|ti|ke|to|pe|la|su)\s+\d{1,2}\.\d{1,2}\.\d{4}[^\n]{0,30})/i, value: (m) => clean(m[1]) },
  {
    key: "rentIncrease",
    label: "Rent increase",
    re: /(Vuokraa (?:korotetaan|tarkistetaan)[^.\n]{0,160})/i,
    value: (m) => {
      const pct = m[1].match(/vähintään\s+(\d+(?:[.,]\d+)?)\s*%/i);
      return pct ? `Yearly, at least ${pct[1].replace(",", ".")} %` : /indeksi/i.test(m[1]) ? "Yearly, by index" : "Yearly";
    },
  },
];

export function listingFacts(text: string): ListingFact[] | undefined {
  const t = text.replace(/\u00a0/g, " ");
  const out: ListingFact[] = [];
  for (const r of RULES) {
    const m = t.match(r.re);
    if (!m) continue;
    const value = r.value(m);
    if (!value) continue;
    out.push({ key: r.key, label: r.label, value, tone: r.tone?.(value, m), quote: clean(m[0]).slice(0, 220) });
  }
  return out.length ? out : undefined;
}
