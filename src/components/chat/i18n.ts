// Kilpi's own chat lines. English is the source; any other language is translated
// once by /api/chat-route (mode "translate") and cached in localStorage.
export const EN = {
  starting: "On it. Working out the job and searching for local companies with Exa…",
  looking: "Looking for {service} companies in {city}…",
  checkingCompany: "Checking {name}: business ID, trade register, their own site and reviews…",
  found: "Found {found} candidates. Checking {n} companies against the trade register and their own sites…",
  foundNone: "Exa found no company websites for that yet.",
  noneTrusted: "I couldn't find anyone I'd trust for that. Could you describe the job a bit differently, or try a nearby city?",
  ranking: "Ranking them by trust…",
  results: "Here are the top {n}, best fit first. {name} looks strongest. The first line on each card is the finding that matters most, with its source.",
  resultsFlags: "Here are the top {n}, best fit first. {name} looks strongest. I found something to watch out for at {flagged} of them: it's the first line on each card, with its source.",
  askTop: "Next step: I'll draft quote requests to {names}, asking for an itemised price and a staged payment schedule. Nothing is sent until you approve. Draft them?",
  askTopFlags: "Next step: I'll draft quote requests to {names}, asking for an itemised price and a staged payment schedule, plus a question about each warning I found ({asks} of them). Nothing is sent until you approve. Draft them?",
  chipAskTop: "Yes, draft for the top {n}",
  chipPick: "Pick myself",
  chipNotNow: "Not now",
  chipRetry: "Try again",
  searchError: "Something went wrong while searching: {msg}",
  companyResult: "That's everything I checked for {name}. Want me to keep an eye on them while you decide?",
  companyFailed: "I couldn't verify that company: {msg}",
  chipWatchIt: "Watch {name}",
  drafting: "Drafting quote requests to {names}…",
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
  startingWatch: "Setting up a daily Exa Monitor on {name}…",
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
  fallback: "I specialise in hiring contractors for your home in Finland: finding and checking firms, quotes, deposits and complaints. Try one of these:",
  exScope1: "Find an English-speaking plumber in Espoo",
  exScope2: "My contractor wants 100% upfront. Is that OK?",
  explainError: "I couldn't answer that from what I have: {msg}",
  agentError: "I got stuck on that one: {msg}",
  agentNoAnswer: "I couldn't finish that. Could you tell me a bit more about what you need?",
  handoff: "This is a job for my contractor check. Let me find and vet companies for it.",
  planTitle: "My plan",
  planDone: "Done",
  planStopped: "Stopped",
  planRead: "What I read",
  needsOk: "Needs your OK",
  approveSend: "Approve and send",
  sentMail: "Approved, opened in your mail app",
  copy: "Copy",
  copied: "Copied",
  edit: "Edit",
  editDone: "Done",
  addCal: "Add to calendar",
  addedCal: "Added: calendar file downloaded",
  openBooking: "Open booking page",
  openForm: "Open the form",
  opened: "Opened in a new tab",
  callNow: "Call {phone}",
  called: "Calling from your phone",
  startWatch: "Start watching",
  watchStarted: "Watching. You'll hear from me if anything changes.",
  actionFailed: "That didn't work: {msg}",
  basedOn: "Based on",
  copyForForm: "Approve and copy for the form",
} as const;

export type Key = keyof typeof EN;
export type Table = Partial<Record<Key, string>>;

export function format(tpl: string, vars: Record<string, string | number> = {}) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const STORE = "kilpi-chat-i18n-v2";
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
