// Kilpi's own chat lines. English is the source; any other language is translated
// once by /api/chat-route (mode "translate") and cached in localStorage.
export const EN = {
  looking: "Looking for {service} companies in {city}…",
  checkingCompany: "Checking {name}: business ID, trade register, their own site and reviews…",
  found: "Found {found} candidates. Checking {n} companies against the trade register and their own sites…",
  foundNone: "Exa found no company websites for that yet.",
  noneTrusted: "I couldn't find anyone I'd trust for that. Could you describe the job a bit differently, or try a nearby city?",
  results: "Here's who I'd trust, best fit first. {name} looks strongest.",
  askTop: "Want me to ask the top {n} for quotes?",
  chipAskTop: "Yes, ask top {n}",
  chipPick: "Pick myself",
  chipNotNow: "Not now",
  chipRetry: "Try again",
  searchError: "Something went wrong while searching: {msg}",
  companyResult: "Here's everything I checked for {name}.",
  companyFailed: "I couldn't verify that company: {msg}",
  chipWatchIt: "Watch {name}",
  drafts: "Here are the drafts ({n}). I added questions about anything that looked off. Nothing is sent until you tap Approve and send.",
  afterDrafts: "When quotes come back, paste them here and I'll check and compare them.",
  chipPasteQuote: "I'll paste one",
  draftError: "I couldn't draft the requests: {msg}",
  noShortlist: "I don't have a shortlist yet. Tell me what needs doing and I'll find companies first.",
  checkingQuote: "Checking {company}'s quote: business ID, payment terms, VAT and their claims against the register, their site and consumer guidance…",
  quoteRed: "I'd hold off signing this one: {reds} serious issue(s), {yellows} thing(s) to clarify. Paste the next quote when it arrives and I'll compare them.",
  quoteOk: "Looks reasonable, {yellows} thing(s) to clarify. Paste the next quote when it arrives and I'll compare them.",
  quoteError: "I couldn't check that quote: {msg}",
  pasteQuote: "Paste the quote text (tarjous) here and I'll check it line by line.",
  oneQuote: "I have one quote so far. Paste another and I'll compare them.",
  noQuotes: "Paste at least two quotes and I'll compare them.",
  comparing: "Comparing {n} quotes: price incl. VAT, payment schedule, itemised labour, and whether each company checks out…",
  noneGood: "Honestly, I wouldn't sign any of these as written. Ask each company for a staged payment schedule and itemised labour first.",
  safer: "{name} is the safer hire. Want me to go with them?",
  chipHire: "Hire {name} and keep watching them",
  chipNotYet: "Not yet",
  compareError: "I couldn't compare the quotes: {msg}",
  watchWho: "Who should I keep an eye on? Name the company, or find a contractor first.",
  watching: "Done. I'll keep an eye on {name} until the job's done (Exa Monitor). If anything worrying shows up, you'll hear from me first.",
  alreadyWatching: "I'm already watching {name}.",
  watchError: "I couldn't start watching {name}: {msg}",
  notWatching: "I'm not watching anyone right now.",
  unwatchWhich: "Which one should I stop watching: {names}?",
  unwatched: "Okay, I've stopped watching {name}.",
  unwatchError: "I couldn't stop watching {name}: {msg}",
  whichCompany: "Which company do you mean? Use its number (#1) or name from the list.",
  lookingUp: "Looking that up…",
  askNoAnswer: "I couldn't find a reliable source for that. Could you rephrase it, or ask something more specific?",
  askPartial: "The sources I found only partly cover this.",
  askError: "I couldn't look that up right now: {msg}",
  pickMyself: "Sure. Tap Pick on the companies above, then let me know.",
  chipDraftPicks: "Draft for my picks",
  noPicks: "You haven't picked anyone yet. Tap Pick on a card first.",
  notNow: "No problem, your shortlist stays right here. When you have quotes, paste them in and I'll compare them.",
  notYet: "Okay, I'll hold off. Ask me any time, or paste another quote to add it to the comparison.",
  fallback: "I'm here. Tell me what needs doing at home, or ask me anything about hiring a contractor in Finland.",
  explainError: "I couldn't answer that from what I have: {msg}",
} as const;

export type Key = keyof typeof EN;
export type Table = Partial<Record<Key, string>>;

export function format(tpl: string, vars: Record<string, string | number> = {}) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const STORE = "kilpi-chat-i18n-v1";
const cache: Record<string, Table> = {};
const pending: Record<string, Promise<Table>> = {};

function readStore(): Record<string, Table> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, Table>;
  } catch {
    return {};
  }
}

/** Translated table for a language (English is identity). Never throws: falls back to English. */
export function loadTable(lang: string): Promise<Table> {
  if (!lang || lang === "en") return Promise.resolve({});
  if (cache[lang]) return Promise.resolve(cache[lang]);
  const stored = readStore()[lang];
  if (stored && Object.keys(stored).length >= Object.keys(EN).length * 0.8) return Promise.resolve((cache[lang] = stored));
  pending[lang] ??= fetch("/api/chat-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "translate", lang, strings: EN }),
  })
    .then((r) => (r.ok ? r.json() : { strings: {} }))
    .then((d: { strings?: Table }) => {
      const table = d.strings ?? {};
      if (Object.keys(table).length) {
        cache[lang] = table;
        try {
          localStorage.setItem(STORE, JSON.stringify({ ...readStore(), [lang]: table }));
        } catch {
          /* storage blocked: keep in memory */
        }
      }
      delete pending[lang];
      return table;
    })
    .catch(() => {
      delete pending[lang];
      return {};
    });
  return pending[lang];
}

/** Synchronous lookup against whatever is cached for the language. */
export function t(lang: string | undefined, key: Key, vars?: Record<string, string | number>) {
  const tpl = (lang && cache[lang]?.[key]) || EN[key];
  return format(tpl, vars);
}
