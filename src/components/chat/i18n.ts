// Kilpi's own chat lines. English is the source; any other language is translated
// once by /api/chat-route (mode "translate") and cached in localStorage.
export const EN = {
  starting: "Reading the project, searching with Exa…",
  looking: "Looking for {service} subcontractors around {city}…",
  checkingCompany: "Checking {name}: registers, site, references, news…",
  found: "Found {found} candidates, checking {n} against the registers…",
  foundNone: "Exa found no subcontractor websites for that yet.",
  noneTrusted: "I couldn't find a subcontractor I'd trust for that. Could you describe the trade a bit differently, or widen the area around the site?",
  ranking: "Ranking by trust…",
  results: "{n} candidates are in the case file. {name} looks strongest, and none has a warning.",
  resultsFlags: "{n} candidates are in the case file. {name} ranks first; {flagged} need clarifying before you sign.",
  askTop: "Draft quote requests and document requests for the top {n}? Nothing is sent until you approve.",
  askTopFlags: "Draft quote requests and document requests for the top {n}, with questions about the warnings? Nothing is sent until you approve.",
  chipAskTop: "Yes, draft RFQs for the top {n}",
  chipPick: "Pick myself",
  chipNotNow: "Not now",
  chipRetry: "Try again",
  searchError: "Something went wrong while searching: {msg}",
  companyResult: "That's everything I checked for {name}, with the tilaajavastuu items still to request. Want me to watch them during the project?",
  companyFailed: "I couldn't verify that subcontractor: {msg}",
  chipWatchIt: "Watch {name}",
  drafting: "Drafting RFQs and document requests to {names}…",
  drafts: "{n} drafts ready, also in the case file's Outbox. Nothing is sent until you tap Approve and send.",
  afterDrafts: "When quotes come back, paste them here and I'll check and compare them. Collect the documents before signing; none may be older than 3 months.",
  chipPasteQuote: "I'll paste one",
  draftError: "I couldn't draft the requests: {msg}",
  noShortlist: "I don't have a shortlist yet. Tell me the trade, the project and the site, and I'll find subcontractors first.",
  checkingQuote: "Checking {company}'s quote: business ID, payment terms, VAT (reverse charge) and their claims against the register and their site…",
  quoteRed: "I'd hold off signing this one: {reds} serious issue(s), {yellows} thing(s) to clarify. Paste the next quote when it arrives and I'll compare them.",
  quoteOk: "Looks reasonable, {yellows} thing(s) to clarify. Paste the next quote when it arrives and I'll compare them.",
  quoteError: "I couldn't check that quote: {msg}",
  pasteQuote: "Paste the subcontractor's quote (tarjous) here and I'll check it line by line.",
  oneQuote: "I have one quote so far. Paste another and I'll compare them.",
  noQuotes: "Paste at least two quotes and I'll compare them.",
  comparing: "Comparing {n} quotes: price incl. VAT, payment schedule, itemised labour, and whether each company checks out…",
  noneGood: "Honestly, I wouldn't sign any of these as written. Ask each subcontractor for a staged payment schedule tied to completed work and an itemised price first.",
  safer: "{name} is the safer choice. Want me to go with them and watch them for the length of the project?",
  chipHire: "Choose {name} and watch them",
  chipNotYet: "Not yet",
  compareError: "I couldn't compare the quotes: {msg}",
  startingWatch: "Setting up a daily Exa Monitor on {name}…",
  watchWho: "Who should I watch? Name the subcontractor, or find candidates first.",
  watching: "Done. I'll watch {name} for the length of the project (daily Exa Monitor): news, register changes, bankruptcy and payment-default notices. New findings show up in the Watching section of this project.",
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
  pickMyself: "Sure. Tick the companies in the case file, then let me know.",
  chipDraftPicks: "Draft for my picks",
  noPicks: "You haven't picked anyone yet. Tick a company in the case file first.",
  notNow: "No problem, the shortlist stays in the case file. When quotes arrive, paste them in and I'll compare them.",
  notYet: "Okay, I'll hold off. Ask me any time, or paste another quote to add it to the comparison.",
  fallback: "I help Finnish main contractors find and vet subcontractors: tilaajavastuu documents, registers, references, licences, quotes and subcontract terms (YSE 1998). Try one of these:",
  exScope1: "Electrical subcontractor for a 40-apartment pipe renovation in Espoo, start March",
  exScope2: "Which documents must I collect from a subcontractor?",
  explainError: "I couldn't answer that from what I have: {msg}",
  agentError: "I got stuck on that one: {msg}",
  agentNoAnswer: "I couldn't finish that. Could you tell me a bit more about what you need?",
  handoff: "This is a job for my subcontractor check. Let me find and vet companies for it.",
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
  watchStarted: "Watching. New findings will show up here.",
  actionFailed: "That didn't work: {msg}",
  basedOn: "Based on",
  copyForForm: "Approve and copy for the form",
  sTitle: "Subcontractor search",
  sUnderstand: "Understanding the job",
  sFind: "Finding subcontractors",
  sVerify: "Checking registers",
  sRank: "Ranking",
  sPreparing: "Starting the search",
  sComplete: "Search complete",
  sStopped: "Search stopped",
  sFound: "{n} found",
  sChecked: "{done} of {n} checked",
  sRanked: "{n} ranked",
  sSummary: "Searched {found} · checked {n} · {secs} s",
  sShow: "Show search steps",
  sHide: "Hide search steps",
} as const;

export type Key = keyof typeof EN;
export type Table = Partial<Record<Key, string>>;

export function format(tpl: string, vars: Record<string, string | number> = {}) {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const STORE = "kilpi-chat-i18n-b2b-v6";
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
