// Public contract track record: award notices in Hilma (hankintailmoitukset.fi, Finland's
// procurement notice service) that a company WON. Read from Exa's index of Hilma and parsed
// deterministically. A company only counts as the winner when its business ID (or exact
// legal name) sits in the winner block of the notice:
//   - contract results page: "1 NCC Suomi Oy (1765514-2)" / "Voittajatarjous 1 …" / "Vinnande anbud 1 …"
//   - winning-tender page: the FIRST organisation after "Information on the winning bid"
//     (later organisations on that page may be group members or subcontractors, so they don't count)
//   - pre-2023 award notice (TED F03 etc.): "Suppliers name and address / National registration number"
//   - procedure results table: "Contractors <exact legal name>" / "Sopimusosapuolet <…>"
// Bidders, buyers and names in free text never count. Nothing is inferred: every win carries
// the notice URL and the verbatim winner line.
import { search, type ExaResult, type ExaTrace } from "./exa";

export type PublicWin = {
  /** Procedure title. */
  title: string;
  /** Contract / lot title when the notice gives one (BT-721, or a worded BT-150 reference). */
  contract?: string;
  buyer?: string;
  /** As printed on the notice, e.g. "15 720 744,34 EUR". */
  value?: string;
  /** Published in Hilma, YYYY-MM-DD. */
  date?: string;
  /** Main CPV classification, e.g. "Rakennustyöt (45000000)". */
  cpv?: string;
  url: string;
  /** Verbatim winner line from the page (whitespace collapsed). */
  quote: string;
  /** Title/CPV shares the job's trade (set by tradeRelevance). */
  relevant?: boolean;
};

const HILMA = "hankintailmoitukset.fi";
const MAX_WINS = 5;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRe = (name: string) => esc(clean(name)).replace(/\\?\s+/g, "\\s+");

/** Procedure key: one procedure = one win, whichever language/sub-page Exa returned. */
function procedureOf(url: string): { key: string; base: string; lang: string } | null {
  const e = /^(https?:\/\/(?:www\.)?hankintailmoitukset\.fi)\/(fi|en|sv)\/public\/procedure\/(\d+)\/enotice\/(\d+)/.exec(url);
  if (e) return { key: `p${e[3]}`, base: `${e[1]}/${e[2]}/public/procedure/${e[3]}/enotice/${e[4]}/`, lang: e[2] };
  const o = /^(https?:\/\/(?:www\.)?hankintailmoitukset\.fi)\/(fi|en|sv)\/public\/procurement\/(\d+)\/notice\/(\d+)/.exec(url);
  if (o) return { key: `q${o[3]}`, base: `${o[1]}/${o[2]}/public/procurement/${o[3]}/notice/${o[4]}/`, lang: o[2] };
  return null;
}

const fiDate = (s: string) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
};

function titleOf(text: string, exaTitle?: string): string | undefined {
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1];
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^Hilma(\s*-\s*\w+)?$/i.test(l));
  const t = clean(h1 ?? first ?? (exaTitle && !/^Hilma\b/i.test(exaTitle) ? exaTitle : ""));
  const out = t.replace(/^(Jälki-ilmoitus|Contract award notice|Efterhandsannons)\s*:\s*/i, "");
  return out && out.length > 3 && out.length < 300 ? out : undefined;
}

function valueOf(text: string): string | undefined {
  const m =
    /(?:HILMA FI-70|BT-720:[^\n]*|Total value of the contract\/lot|Sopimuksen\/osan kokonaisarvo|Kontraktets\/delens totala värde)\s+((?:\d[\d  .]*)(?:,\d+)?\s*EUR)/i.exec(text);
  return m ? clean(m[1]) : undefined;
}

function buyerOf(text: string): string | undefined {
  // Pre-2023 notice header: "Contract award notice (TED F03) Oulun kaupunki Published in Hilma …"
  const old = /\((?:TED )?F\d\d\)\s+([^\n]{3,120}?)\s+(?:Published in Hilma|Julkaistu Hilmassa|Publicerad i Hilma)/.exec(text);
  if (old) return clean(old[1]);
  const lbl = /(?:Buyer organisation|Hankintayksikkö|Upphandlande enhet)\s*\n+\s*([^\n]{3,120})/.exec(text);
  return lbl ? clean(lbl[1]) : undefined;
}

/** eForms overview page: the first organisation named (BT-500) is the buyer. */
function contractOf(text: string): string | undefined {
  for (const bt of ["BT-721", "BT-150"]) {
    const m = new RegExp(`${bt}:[^\\n]*\\n+\\s*([^\\n]{3,200})`).exec(text);
    const v = m && clean(m[1]);
    if (v && /[a-zåäö]{4}/i.test(v) && !/BT-\d/.test(v)) return v;
  }
  return undefined;
}

const overviewBuyer = (text: string) => {
  const m = /BT-500:[^\n]*\n+\s*([^\n]{3,120})/.exec(text);
  return m && !/BT-\d/.test(m[1]) ? clean(m[1]) : undefined;
};
const cpvOf = (text: string) => {
  const m = /(?:BT-262:[^\n]*|Main CPV code|Pääasiallinen CPV-koodi|Huvudsaklig CPV-kod)\s*\n+\s*([^\n]{3,120}\(\d{8}\))/.exec(text);
  return m ? clean(m[1]) : undefined;
};

/** The verbatim winner line if this page names the company as a winner, else null. */
export function winnerLine(text: string, url: string, businessId: string, name: string): string | null {
  const id = esc(businessId);
  const nm = nameRe(name);
  const results = /\/results\b/.test(url);
  if (results) {
    // Contract page: "1 NCC Suomi Oy (1765514-2)", "Voittajatarjous 2 X Oy (…)".
    const line = new RegExp(`^[ \\t]*((?:Voittajatarjous|Winning tender|Vinnande anbud)?[ \\t]*\\d+[ \\t]+[^\\n()]{2,120}\\(${id}\\))[ \\t]*$`, "mi").exec(text);
    if (line) return clean(line[1]);
    // Winning-tender page: only the first organisation after the heading.
    const head = /##\s*(?:Information on the winning bid|Kilpailun voittaneen tarjouksen tiedot|Uppgifter om anbudet som vann tävlingen)/i.exec(text);
    if (head) {
      const after = text.slice(head.index);
      const org = /(BT-500:[^\n]*)\n+\s*([^\n]+?)\s*\n+\s*([^\n]*BT-501:[^\n]*)\n+\s*([^\n]*)/.exec(after);
      if (org) {
        const orgName = clean(org[2]);
        const orgId = clean(org[4]);
        // Quote the page verbatim from the name through the identifier.
        if (orgId === businessId) return clean(org[0].slice(org[0].indexOf(org[2], org[1].length)));
        if (!/^\d{7}-\d$/.test(orgId) && new RegExp(`^${nm}$`, "i").test(orgName)) return orgName;
      }
    }
    // Procedure results table: "Contractors NCC Suomi Oy" / "Sopimusosapuolet Sähkö Via Oy".
    const party = new RegExp(`(?:Contractors|Sopimusosapuolet|Avtalsparter|Kontraktsparter)\\s+(${nm})(?=\\s*(?:\\||,|$))`, "mi").exec(text);
    if (party) return clean(party[0]);
  }
  // Pre-2023 award notice: supplier section with the registration number.
  if (/\b(?:TED )?F(?:03|06|15|21|22|23|25)\)|award notice|jälki-ilmoitus|efterhandsannons/i.test(text)) {
    const flat = clean(text);
    const sup = new RegExp(
      `(?:Suppliers name and address|Toimittajan nimi ja osoite|Leverantörens namn och adress)\\s+(?:National registration number|Yritys- ja yhteisötunnus|Nationellt registreringsnummer)\\s+${id}\\s+(?:Official name|Virallinen nimi|Officiellt namn)\\s+(${nm})`,
      "i",
    ).exec(flat);
    if (sup) return sup[0];
  }
  return null;
}

function parseWin(r: ExaResult, businessId: string, name: string): PublicWin | null {
  const text = r.text ?? "";
  const quote = winnerLine(text, r.url, businessId, name);
  if (!quote) return null;
  const title = titleOf(text, r.title);
  if (!title) return null;
  const pub = /(?:Published in Hilma|Julkaistu Hilmassa|Publicerad i Hilma)\s+(\d{1,2}\.\d{1,2}\.\d{4})/.exec(text)?.[1];
  const contract = contractOf(text);
  return { title, contract: contract && contract.toLowerCase() !== title.toLowerCase() ? contract : undefined, buyer: buyerOf(text), value: valueOf(text), date: pub ? fiDate(pub) : r.publishedDate?.slice(0, 10), cpv: cpvOf(text), url: r.url, quote };
}

// Prefer the page that says most (value, then a contract/results page) for each procedure.
const richness = (w: PublicWin) => (w.value ? 2 : 0) + (w.contract ? 1 : 0) + (/\/contract\//.test(w.url) ? 1 : 0) + (/\/en\//.test(w.url) ? 0.5 : 0);

export type PublicWinsResult = { wins: PublicWin[]; searched: true; failed?: boolean };

/** Award notices in Hilma that name this company as the winner. One Exa search (Hilma only). */
export async function publicWins(co: { businessId: string; name: string }, trace: ExaTrace[]): Promise<PublicWinsResult> {
  const { businessId, name } = co;
  let results: ExaResult[];
  try {
    const data = await search(
      { query: `${name} ${businessId} contract award winner`, type: "auto", numResults: 10, includeDomains: [HILMA], contents: { text: { maxCharacters: 6000 } } },
      trace,
    );
    results = data.results ?? [];
  } catch {
    return { wins: [], searched: true, failed: true };
  }

  const byProc = new Map<string, PublicWin>();
  const addWin = (w: PublicWin) => {
    const p = procedureOf(w.url);
    if (!p) return;
    const prev = byProc.get(p.key);
    if (!prev) byProc.set(p.key, w);
    else {
      const [best, other] = richness(w) > richness(prev) ? [w, prev] : [prev, w];
      byProc.set(p.key, { ...best, contract: best.contract ?? other.contract, buyer: best.buyer ?? other.buyer, value: best.value ?? other.value, date: best.date ?? other.date, cpv: best.cpv ?? other.cpv });
    }
  };
  for (const r of results) {
    const w = parseWin(r, businessId, name);
    if (w) addWin(w);
  }

  // Buyer and CPV live on the notice overview, not on the results pages. Use an overview of
  // the same procedure when the search returned one. (Fetching overviews with /contents was
  // tried: Hilma is a client-rendered app and Exa's live crawl of it times out.)
  for (const r of results) {
    const p = procedureOf(r.url);
    const win = p && byProc.get(p.key);
    if (!win || /\/results\b/.test(r.url)) continue;
    const text = r.text ?? "";
    byProc.set(p.key, { ...win, buyer: win.buyer ?? (p.key.startsWith("p") ? overviewBuyer(text) : buyerOf(text)), cpv: win.cpv ?? cpvOf(text) });
  }
  const sorted = [...byProc.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, MAX_WINS);
  return { wins: sorted, searched: true };
}

// ---- trade relevance -------------------------------------------------------------
// Job wording -> notice wording (Finnish procurement titles) and CPV code prefixes.
const TRADES: { label: string; job: RegExp; notice: RegExp }[] = [
  { label: "HVAC", job: /ilmanvaih|ventilat|hvac|\biv\b|ilmastoin|air.?condition/i, notice: /ilmanvaih|ilmastoin|\biv[- ]|iv-|ventilat|\blvi|lvia|\(4533[01]\d{3}\)|\(42520000\)/i },
  { label: "electrical", job: /sähkö|sahko|electric/i, notice: /sähkö|electric|\(4531\d{4}\)/i },
  { label: "plumbing", job: /putki|plumb|pipe|viemär|kvv|vesijohto|\blvi\b/i, notice: /putki|viemär|vesijohto|\blvi|lvia|\(4533\d{4}\)/i },
  { label: "painting", job: /maala|paint/i, notice: /maala|\(45442\d{3}\)/i },
  { label: "roofing", job: /katto|roof|vesikat/i, notice: /katto|vesikat|\(45261\d{3}\)/i },
  { label: "demolition", job: /purku|demoli|asbest/i, notice: /purku|purkam|asbest|\(4511\d{4}\)/i },
  { label: "flooring", job: /lattia|floor|laatoit|tiling/i, notice: /lattia|laatoit|\(4543\d{4}\)/i },
  { label: "window and door", job: /ikkuna|window|ovi\b|door/i, notice: /ikkuna|ovien|\(45421\d{3}\)/i },
  { label: "facade", job: /julkisivu|facade|rappau/i, notice: /julkisivu|rappau|\(45443\d{3}\)/i },
];

/** Mark wins whose title or CPV matches the job's trade; returns the trade label used. */
export function tradeRelevance(wins: PublicWin[], jobText: string): { wins: PublicWin[]; label?: string } {
  const t = TRADES.find((x) => x.job.test(jobText));
  if (!t) return { wins };
  return { label: t.label, wins: wins.map((w) => ({ ...w, relevant: t.notice.test(`${w.title} ${w.contract ?? ""} ${w.cpv ?? ""}`) })) };
}

const fmtDate = (d?: string) => (d ? d.split("-").reverse().map((x) => x.replace(/^0/, "")).join(".") : undefined);
export const monthYear = (d?: string) => (d ? `${Number(d.slice(5, 7))}/${d.slice(0, 4)}` : undefined);

/** One line per win for the check detail: "Title (Buyer, 1 000 000 EUR, 15.10.2026)". */
export function winLine(w: PublicWin): string {
  const meta = [w.buyer, w.value, fmtDate(w.date)].filter(Boolean).join(", ");
  // The contract title adds something only when it is not the procedure title reworded or an
  // internal reference ("55332-3 / Laboratoriotarvikkeet Mekalasi Oy").
  const c = w.contract;
  const useful = c && c.length <= 90 && c.slice(0, 15).toLowerCase() !== w.title.slice(0, 15).toLowerCase() && !/\b(oy|oyj|ab)\b|\d{4,}/i.test(c);
  const name = useful ? `${w.title} – ${c}` : w.title;
  return `${name}${meta ? ` (${meta})` : ""}`;
}
