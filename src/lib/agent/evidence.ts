// Evidence store + grounding guard. Every fact the agent states must cite an
// evidence id ([e3]) that was really retrieved by an Exa call; quotes and URLs
// are checked against the retrieved text, anything else is dropped.
import type { Evidence, Source, Via } from "./types";

export const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const canonUrl = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return u.trim().replace(/\/+$/, "").toLowerCase();
  }
};

export class EvidenceStore {
  items: Evidence[];
  constructor(prior: Evidence[] = []) {
    this.items = prior.filter((e) => e && typeof e.id === "string" && typeof e.url === "string" && typeof e.text === "string");
  }
  private nextId() {
    const max = this.items.reduce((m, e) => Math.max(m, Number(e.id.slice(1)) || 0), 0);
    return `e${max + 1}`;
  }
  /** Adds (or refreshes) a document; same URL + via keeps its id and merges text. */
  add(d: Omit<Evidence, "id">): Evidence {
    const key = canonUrl(d.url);
    const old = this.items.find((e) => canonUrl(e.url) === key);
    if (old) {
      if (!norm(old.text).includes(norm(d.text).slice(0, 200))) old.text = `${old.text}\n…\n${d.text}`.slice(0, 12000);
      if (d.via === "exa.contents") old.via = d.via;
      old.title ??= d.title;
      old.date ??= d.date;
      return old;
    }
    const e: Evidence = { id: this.nextId(), ...d, text: d.text.slice(0, 12000) };
    this.items.push(e);
    return e;
  }
  get(id: string) {
    return this.items.find((e) => e.id === id.trim().toLowerCase());
  }
  /** True when the URL was retrieved, or appears verbatim inside retrieved text (e.g. a form link on an official page). */
  knowsUrl(url: string): Evidence | undefined {
    const c = canonUrl(url);
    const direct = this.items.find((e) => canonUrl(e.url) === c);
    if (direct) return direct;
    const bare = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
    if (bare.length < 8) return undefined;
    return this.items.find((e) => e.text.toLowerCase().includes(bare));
  }
  /** True when the string (email, phone, ...) appears in some retrieved text. */
  findText(s: string): Evidence | undefined {
    const n = norm(s);
    if (!n) return undefined;
    // Phones are written with varying spacing / +358 vs 0 prefix: compare digit runs.
    const digits = /^[\d\s+()./-]+$/.test(s) ? s.replace(/\D/g, "") : "";
    const local = digits.replace(/^358/, "0");
    return this.items.find((e) => {
      if (norm(e.text).includes(n)) return true;
      if (digits.length < 7) return false;
      const hay = e.text.replace(/\D/g, "");
      return hay.includes(digits) || hay.includes(local) || hay.includes(local.replace(/^0/, "358"));
    });
  }
  /** Trimmed copy for the client-side state (keeps the guard working on follow-up turns). */
  snapshot(max = 30): Evidence[] {
    return this.items.slice(-max).map((e) => ({ ...e, text: e.text.slice(0, 2500) }));
  }
}

/** A short verbatim excerpt for the evidence feed. */
export function excerpt(text: string, n = 280): string {
  const t = text.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > n * 0.6 ? sp : n)}…`;
}

export function quoteIsVerbatim(quote: string, ev: Evidence): boolean {
  const q = norm(quote.replace(/^["'“”]+|["'“”.…]+$/g, ""));
  if (q.length < 8) return false;
  // Exa joins highlight fragments with "..." — compare against each fragment and the whole.
  return norm(ev.text).includes(q) || ev.text.split(/\n*\.\.\.\n*|…/).some((frag) => norm(frag).includes(q));
}

const MARKER = /\[((?:\s*e?\d+\s*,?)+)\]/gi;

/**
 * Renumbers [e3][e7] markers to [1][2] in order of first use, drops markers that
 * don't point at retrieved evidence, strips links to URLs that were never retrieved,
 * and keeps only quotes that are really in the evidence text.
 */
export function groundText(
  text: string,
  store: EvidenceStore,
  quotes: { id: string; quote: string }[] = [],
): { text: string; sources: Source[]; dropped: { markers: string[]; links: string[]; quotes: string[] } } {
  const order: string[] = [];
  const droppedMarkers: string[] = [];
  let out = text.replace(MARKER, (_m, list: string) => {
    const ids = list
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .map((x) => (x.startsWith("e") ? x : `e${x}`));
    const nums: number[] = [];
    for (const id of ids) {
      if (!store.get(id)) {
        droppedMarkers.push(id);
        continue;
      }
      if (!order.includes(id)) order.push(id);
      const n = order.indexOf(id) + 1;
      if (!nums.includes(n)) nums.push(n);
    }
    return nums
      .sort((a, b) => a - b)
      .map((n) => `[${n}]`)
      .join("");
  });

  // Markdown links / bare URLs must point at something Exa retrieved.
  const droppedLinks: string[] = [];
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label: string, url: string) => {
    if (store.knowsUrl(url)) return m;
    droppedLinks.push(url);
    return label;
  });
  // Markdown links whose target isn't a URL ("[Open form](form_link)") -> plain label.
  out = out.replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)\s]*\)/g, "$1");
  out = out.replace(/(^|[\s(<])(https?:\/\/[^\s)>\]]+)/g, (m, pre: string, url: string) => {
    const clean = url.replace(/[.,;:!?]+$/, "");
    if (store.knowsUrl(clean)) return m;
    droppedLinks.push(clean);
    return `${pre}[link removed: not from a retrieved source]`;
  });
  out = out.replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();

  const droppedQuotes: string[] = [];
  const sources: Source[] = order.map((id, i) => {
    const ev = store.get(id)!;
    const cand = quotes.filter((q) => q.id.trim().toLowerCase() === id).map((q) => q.quote);
    const good = cand.find((q) => quoteIsVerbatim(q, ev));
    if (!good) droppedQuotes.push(...cand);
    return { n: i + 1, id, url: ev.url, title: ev.title, via: ev.via as Via, quote: good?.trim().replace(/^["“]|["”]$/g, "") };
  });
  return { text: out, sources, dropped: { markers: droppedMarkers, links: droppedLinks, quotes: droppedQuotes } };
}
