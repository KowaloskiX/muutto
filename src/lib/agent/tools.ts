// Function tools for the errand agent: OpenAI strict JSON schemas + executors.
// Research tools (exa_*) add documents to the evidence store; action tools only
// ever create *proposals* (requiresApproval) and are checked against evidence.
import { call, contents, findPlaces, search, type ExaResult, type ExaTrace } from "@/lib/exa";
import { geocode } from "@/lib/geo";
import { EvidenceStore, excerpt, norm } from "./evidence";
import { buildIcs, parseLocal } from "./ics";
import type { AgentAction, AgentEvent, Evidence, Via } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ToolCtx = {
  store: EvidenceStore;
  trace: ExaTrace[];
  emit: (e: AgentEvent) => void;
  userText: string;
  deadline: number;
  actions: AgentAction[];
  handoff?: string;
  searches?: number;
};

export type ToolResult = { output: string; ok: boolean; label?: string; detail?: string };

const S = (description: string) => ({ type: "string", description });
const NS = (description: string) => ({ type: ["string", "null"], description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description });

// "company"/"people" categories return homepages/profiles only, which starved early runs of real answers.
const CATEGORIES = ["news", "pdf", "research paper"] as const;
const MAX_SEARCHES = 8;

export const TOOL_DEFS = [
  {
    name: "plan",
    description: "Announce your plan for this errand: 2-6 short steps (imperative, user-facing). Call once, at the start, together with your first research calls.",
    parameters: obj({ steps: { type: "array", items: { type: "string" }, description: "Short user-facing steps, e.g. 'Find Elixia's cancellation terms'" } }),
  },
  {
    name: "exa_search",
    description:
      "Exa web search (live index). Use for any fact: rules, prices, deadlines, official forms, contact details, opening dates, news. Write the query as a plain natural-language description of the ideal page (no 'site:' or boolean operators; use includeDomains to restrict to a site). Run 2-3 complementary searches in parallel (e.g. official source + practical guide; English + Finnish for Finnish topics). Budget: about 6 searches per task.",
    parameters: obj({
      query: S("Natural-language description of the page you want, e.g. 'Elixia membership cancellation terms notice period'"),
      category: { type: ["string", "null"], enum: [...CATEGORIES, null], description: "Usually null (general web, best for official pages). 'news' only for recent news" },
      includeDomains: ids("Restrict to these domains (e.g. ['kela.fi']); empty for no restriction"),
      startPublishedDate: NS("ISO date; only pages published after it (for recent news/changes); null otherwise"),
      finland: { type: "boolean", description: "Bias results to Finland (user location FI)" },
    }),
  },
  {
    name: "exa_read",
    description: "Read specific pages with Exa contents (fresh crawl): use on the 1-3 most promising URLs from search to get exact terms, form links, email addresses, phone numbers, deadlines.",
    parameters: obj({
      urls: { type: "array", items: { type: "string" }, description: "1-3 URLs, normally taken from search results" },
      query: S("What you are looking for on these pages (steers the highlighted passages)"),
    }),
  },
  {
    name: "exa_places",
    description: "Find local venues/businesses (restaurants, gyms, shops, offices) with address, phone, rating and website via Exa's places index.",
    parameters: obj({
      query: S("Plural business type + qualifier in English, e.g. 'vegan restaurants', 'gyms'"),
      place: S("City or district, e.g. 'Helsinki' or 'Kallio, Helsinki'"),
    }),
  },
  {
    name: "exa_find_list",
    description:
      "Slow (30-60 s) deep research run with the Exa Agent API: ONLY for 'find all X that match criteria' when one search is not enough. Prefer exa_search/exa_places.",
    parameters: obj({
      query: S("What to find, e.g. 'demolition subcontractors in Oulu with asbestos removal certification'"),
      criteria: { type: "array", items: { type: "string" }, description: "2-4 criteria each item must meet" },
    }),
  },
  {
    name: "contractors_handoff",
    description:
      "Hand over to the app's subcontractor finder when the errand is to find, compare or vet subcontractors for a construction or renovation project (electrical, HVAC, plumbing, waterproofing, demolition, roofing...) or to check a named company. It finds, verifies (trade register, tilaajavastuu items, references, reviews) and ranks companies. Do not research subcontractors yourself.",
    parameters: obj({
      query: S("The job and place in one line, e.g. 'pipe relining in Espoo'"),
      note: S("One short sentence to the user saying what happens next (no facts)"),
    }),
  },
  {
    name: "draft_message",
    description:
      "Propose a message the user can send: an email, a formal letter, a call script, or an online-form text. Only use recipients (email, phone, address) that appear in retrieved evidence or that the user gave. Use [placeholders] for anything unknown (name, booking ref).",
    parameters: obj({
      kind: { type: "string", enum: ["email", "letter", "call_script", "form_text"], description: "Type of message" },
      to: S("Recipient: email address / phone / postal address / 'online form' exactly as found in evidence, or '' if unknown"),
      subject: S("Subject line or title"),
      body: S("Full ready-to-send text in the requested language, with [placeholders] for unknown personal details"),
      language: S("ISO 639-1 language of the body (e.g. 'en', 'fi')"),
      basedOn: ids("Evidence ids (e.g. ['e2','e5']) the content and recipient come from"),
    }),
  },
  {
    name: "calendar_event",
    description: "Propose a calendar entry (deadline, reminder, reservation, appointment). Times are local Europe/Helsinki.",
    parameters: obj({
      title: S("Event title"),
      start: S("'YYYY-MM-DDTHH:mm' local time, or 'YYYY-MM-DD' for an all-day item"),
      end: NS("Same format, or null (defaults to 1 h / 1 day)"),
      location: NS("Address or place, or null"),
      notes: S("What to do / bring, with source URLs"),
      basedOn: ids("Evidence ids the date or time comes from ([] if the user gave it)"),
    }),
  },
  {
    name: "booking_link",
    description: "Propose opening an official booking page / online form / claim form / cancellation page. The URL MUST come from retrieved evidence.",
    parameters: obj({
      url: S("Exact URL from evidence"),
      label: S("Button label, e.g. 'Open Finnair compensation claim form'"),
      kind: { type: "string", enum: ["booking_link", "form_link"], description: "booking_link for reservations/appointments, form_link for claims, applications, cancellations" },
      instructions: S("1-3 short sentences: what to fill in / have ready"),
      basedOn: ids("Evidence ids the link comes from"),
    }),
  },
  {
    name: "watch_changes",
    description:
      "Propose an Exa Monitor that re-runs a search daily and alerts the user to new pages (e.g. a subcontractor's bankruptcy or tax-debt news, a change in tilaajavastuu or reporting-duty guidance, a new public tender in the project area). Use when the user wants to be told when something happens or the answer may change soon.",
    parameters: obj({
      query: S("Search query the monitor re-runs, describing the page that would signal the change"),
      why: S("One sentence: what the user will be alerted about"),
      includeDomains: ids("Domains to watch (e.g. ['kela.fi']); empty for the whole web"),
      basedOn: ids("Evidence ids that motivated the watch"),
    }),
  },
  {
    name: "answer",
    description:
      "Send the final message to the user. kind='answer': findings with [eN] citations after every factual sentence, then what you prepared and the next steps they can approve. kind='clarify': ask ONE question when essential info is missing (still cite anything factual). Never claim you sent/booked/cancelled anything.",
    parameters: obj({
      kind: { type: "string", enum: ["answer", "clarify", "chat"], description: "answer (researched findings), clarify (one question), or chat (greetings / off-topic requests like poems: no facts, no research, 1-2 sentences steering to errands)" },
      text: S("Markdown in the user's language. Cite like [e3] or [e3, e7] right after the claim."),
      citations: {
        type: "array",
        description: "For each cited evidence id, one short verbatim phrase (5-25 words) copied exactly from it that supports the claim",
        items: obj({ id: S("Evidence id, e.g. 'e3'"), quote: S("Exact words copied from that evidence") }),
      },
    }),
  },
].map((t) => ({ type: "function" as const, strict: true, ...t }));

// ---- helpers ---------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

function fmtDocs(docs: Evidence[], per = 1200): string {
  if (!docs.length) return "No results.";
  return docs.map((d) => `[${d.id}] ${d.title ?? "(untitled)"} — ${d.url}${d.date ? ` (published ${d.date.slice(0, 10)})` : ""}\n${d.text.slice(0, per)}`).join("\n\n");
}

function addResults(ctx: ToolCtx, results: ExaResult[], via: Via, useText = false): Evidence[] {
  const out: Evidence[] = [];
  for (const r of results) {
    const hl = (r.highlights ?? []).join("\n...\n").trim();
    const text = (useText ? [hl, r.text ?? ""].filter(Boolean).join("\n\n---\n\n") : hl || (r.text ?? "")).trim();
    if (!r.url || text.length < 30) continue;
    out.push(ctx.store.add({ url: r.url, title: r.title ?? undefined, date: r.publishedDate?.slice(0, 10), text, via }));
  }
  if (out.length) ctx.emit({ type: "evidence", items: out.map((e) => ({ id: e.id, url: e.url, title: e.title, quote: excerpt(e.text), via: e.via, date: e.date })) });
  return out;
}

const remaining = (ctx: ToolCtx) => ctx.deadline - Date.now();
const actionId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function basedOn(ctx: ToolCtx, list: string[]) {
  return [...new Set(list.map((x) => x.trim().toLowerCase()))]
    .map((id) => ctx.store.get(id))
    .filter((e): e is Evidence => !!e)
    .map((e) => ({ id: e.id, url: e.url, title: e.title }));
}

function propose(ctx: ToolCtx, a: Omit<AgentAction, "id" | "requiresApproval">): AgentAction {
  const action: AgentAction = { id: actionId(), requiresApproval: true, ...a };
  ctx.actions.push(action);
  ctx.emit({ type: "action", action });
  return action;
}

/** Was this string given by the user (e.g. their own email or a flight number)? */
const userGave = (ctx: ToolCtx, s: string) => !!s && norm(ctx.userText).includes(norm(s));

// ---- executors ---------------------------------------------------------------

async function exaSearch(ctx: ToolCtx, a: any): Promise<ToolResult> {
  ctx.searches = (ctx.searches ?? 0) + 1;
  if (ctx.searches > MAX_SEARCHES) return { ok: false, output: "Search budget used up. Work with the evidence you have (or exa_read a promising URL), then propose actions and answer.", label: "Search budget reached", detail: "using the sources found so far" };
  // Exa is neural search: "site:x.com" operators hurt; turn them into includeDomains.
  const siteOps = [...String(a.query).matchAll(/\bsite:([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase());
  const q = String(a.query).replace(/\bsite:\S+/gi, "").replace(/\s+(OR|AND)\s+/g, " ").replace(/\s+/g, " ").trim();
  a.includeDomains = [...new Set([...(a.includeDomains ?? []), ...siteOps])];
  const body: Record<string, unknown> = {
    query: q.slice(0, 400),
    type: "auto",
    numResults: 6,
    contents: { highlights: { query: String(a.query).slice(0, 300), maxCharacters: 1200 } },
  };
  if (a.category) body.category = a.category;
  if (Array.isArray(a.includeDomains) && a.includeDomains.length) body.includeDomains = a.includeDomains.slice(0, 10);
  if (a.startPublishedDate && /^\d{4}-\d{2}-\d{2}/.test(a.startPublishedDate) && !["company", "people"].includes(a.category))
    body.startPublishedDate = new Date(a.startPublishedDate).toISOString();
  if (a.finland) body.userLocation = "FI";
  const data = await search(body, ctx.trace);
  const docs = addResults(ctx, data.results ?? [], "exa.search");
  return { ok: true, output: fmtDocs(docs), label: `Searched “${excerpt(String(a.query), 70)}”`, detail: `${docs.length} results` };
}

async function exaRead(ctx: ToolCtx, a: any): Promise<ToolResult> {
  const urls = (a.urls as string[]).filter((u) => /^https?:\/\//.test(u)).slice(0, 3);
  if (!urls.length) return { ok: false, output: "Error: give 1-3 absolute http(s) URLs." };
  const data = await contents(
    {
      urls,
      text: { maxCharacters: 6000 },
      highlights: { query: String(a.query).slice(0, 300), maxCharacters: 2000 },
      maxAgeHours: 72,
      livecrawlTimeout: 8000,
    },
    ctx.trace,
  );
  const docs = addResults(ctx, data.results ?? [], "exa.contents", true);
  const failed = (data.statuses ?? []).filter((s: any) => s?.status && s.status !== "success").map((s: any) => `${s.id}: ${s.error?.tag ?? s.status}`);
  return {
    ok: true,
    output: fmtDocs(docs, 4500) + (failed.length ? `\n\nCould not read: ${failed.join("; ")}` : ""),
    label: `Read ${urls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }).join(", ")}`,
    detail: `${docs.length}/${urls.length} pages`,
  };
}

async function exaPlaces(ctx: ToolCtx, a: any): Promise<ToolResult> {
  const placeName = String(a.place).trim();
  const geo = await geocode(/finland|suomi/i.test(placeName) ? placeName : `${placeName}, Finland`).catch(() => null);
  if (!geo) return { ok: false, output: `Error: could not locate "${placeName}". Try a Finnish city name.` };
  const query = String(a.query).trim();
  const { places, web } = await findPlaces(query.replace(/s$/i, ""), geo.municipality ?? placeName, { latitude: geo.lat, longitude: geo.lng }, ctx.trace, {
    plurals: [query],
  });
  const results: ExaResult[] = places.slice(0, 8).map((p) => ({
    url: p.website ?? (typeof p.placeUrl === "string" && /^https?:/.test(p.placeUrl) ? p.placeUrl : `https://www.google.com/maps/search/${encodeURIComponent(`${p.name} ${p.address ?? placeName}`)}`),
    title: p.name,
    text: [
      p.name,
      p.address && `Address: ${p.address}`,
      p.phone && `Phone: ${p.phone}`,
      p.website && `Website: ${p.website}`,
      p.rating && `Rating: ${p.rating.score} (${p.rating.count} reviews)`,
      p.categories.length && `Categories: ${p.categories.slice(0, 5).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }));
  const docs = addResults(ctx, results.length ? results : web.slice(0, 6), results.length ? "exa.places" : "exa.search", !!results.length);
  return { ok: true, output: fmtDocs(docs, 700), label: `Looked up ${query} in ${geo.label}`, detail: `${docs.length} places` };
}

async function exaFindList(ctx: ToolCtx, a: any): Promise<ToolResult> {
  const criteria = (a.criteria as string[]).slice(0, 4);
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string", format: "uri" },
            summary: { type: "string", description: "1-2 sentences with the key facts (price, date, location)" },
            evidence: { type: "string", description: "Short verbatim quote from the source supporting the criteria" },
          },
          required: ["name", "url", "summary"],
        },
      },
    },
    required: ["items"],
  };
  const run = await call(
    "POST",
    "/agent/runs",
    { query: `${a.query}\n\nToday is ${today()}. Criteria:\n${criteria.map((c) => `- ${c}`).join("\n")}\nOnly include items with a source URL.`, effort: "low", outputSchema: schema },
    ctx.trace,
    `agent(low): ${String(a.query).slice(0, 60)}`,
  );
  const budget = Math.min(55_000, remaining(ctx) - 12_000);
  const t0 = Date.now();
  let r = run;
  while (!["completed", "failed", "cancelled"].includes(r.status) && Date.now() - t0 < budget) {
    await new Promise((res) => setTimeout(res, 3000));
    r = await call("GET", `/agent/runs/${encodeURIComponent(run.id)}`, undefined, ctx.trace, `agent poll`).catch(() => r);
  }
  if (r.status !== "completed") return { ok: false, output: `Agent run ${r.status === "failed" ? "failed" : "did not finish in time"}. Use exa_search instead.`, label: "Deep search", detail: r.status };
  const items: any[] = r.output?.structured?.items ?? [];
  const grounding: any[] = r.output?.grounding ?? [];
  const results: ExaResult[] = items
    .filter((it) => /^https?:\/\//.test(it?.url ?? ""))
    .map((it, i) => {
      const cites = grounding.filter((g) => String(g.field ?? "").includes(`items[${i}]`)).flatMap((g) => g.citations ?? []);
      return { url: it.url, title: it.name, text: [it.summary, it.evidence && `"${it.evidence}"`, cites.length && `Sources: ${cites.map((c: any) => c.url).join(", ")}`].filter(Boolean).join("\n") };
    });
  const docs = addResults(ctx, results, "exa.agent", true);
  return { ok: true, output: fmtDocs(docs, 800), label: `Deep search: ${excerpt(String(a.query), 60)}`, detail: `${docs.length} items` };
}

function contractorsHandoff(ctx: ToolCtx, a: any): ToolResult {
  const q = String(a.query).trim().slice(0, 200);
  ctx.handoff = q;
  ctx.emit({ type: "handoff", to: "contractors", query: q });
  if (a.note) ctx.emit({ type: "message", kind: "answer", text: String(a.note).slice(0, 400), sources: [] });
  return { ok: true, output: "Handed off to the contractor finder. Stop now.", label: "Handing over to contractor finder", detail: q };
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s()-]{6,}\d/g;

function draftMessage(ctx: ToolCtx, a: any): ToolResult {
  const based = basedOn(ctx, a.basedOn ?? []);
  let to = String(a.to ?? "").trim();
  const notes: string[] = [];
  // Recipient addresses/phones must come from evidence or from the user — never invented.
  for (const m of to.match(EMAIL) ?? []) {
    if (!ctx.store.findText(m) && !userGave(ctx, m)) {
      to = to.replace(m, "").trim();
      notes.push(`recipient ${m} not found in sources — removed`);
    }
  }
  for (const m of to.match(PHONE) ?? []) {
    if (!ctx.store.findText(m) && !userGave(ctx, m)) {
      to = to.replace(m, "").trim();
      notes.push(`phone ${m} not found in sources — removed`);
    }
  }
  let body = String(a.body ?? "");
  for (const m of body.match(EMAIL) ?? []) if (!ctx.store.findText(m) && !userGave(ctx, m)) body = body.replaceAll(m, "[email address]");
  for (const m of body.match(/https?:\/\/[^\s)\]>]+/g) ?? []) if (!ctx.store.knowsUrl(m.replace(/[.,;:]+$/, ""))) body = body.replaceAll(m, "[link]");
  if (!based.length && !userGave(ctx, to)) notes.push("not linked to any source");
  const kindMap = { email: "email", letter: "letter", call_script: "call_script", form_text: "letter" } as const;
  const kind = kindMap[a.kind as keyof typeof kindMap] ?? "email";
  const email = (to.match(EMAIL) ?? [])[0];
  const phone = (to.match(PHONE) ?? [])[0];
  const payload: Record<string, unknown> = {
    format: a.kind,
    to,
    subject: String(a.subject ?? ""),
    body,
    language: a.language,
    basedOn: based,
    ...(notes.length ? { warnings: notes } : {}),
    ...(kind === "email" && email ? { mailto: `mailto:${email}?subject=${encodeURIComponent(String(a.subject ?? ""))}&body=${encodeURIComponent(body)}` } : {}),
    ...(kind === "call_script" && phone ? { tel: `tel:${phone.replace(/[^\d+]/g, "")}` } : {}),
  };
  const act = propose(ctx, { kind, title: String(a.subject || "Draft message").slice(0, 120), payload });
  return {
    ok: true,
    output: `Proposed ${kind} ${act.id} (awaiting user approval; NOT sent).${notes.length ? ` Warnings: ${notes.join("; ")}.` : ""}`,
    label: `Drafted ${kind.replace("_", " ")}`,
    detail: to || "recipient to fill in",
  };
}

function calendarEvent(ctx: ToolCtx, a: any): ToolResult {
  const s = parseLocal(String(a.start));
  if (!s) return { ok: false, output: "Error: start must be 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD'." };
  const based = basedOn(ctx, a.basedOn ?? []);
  const ev = { title: String(a.title).slice(0, 150), start: String(a.start), end: a.end ?? undefined, location: a.location ?? undefined, notes: String(a.notes ?? "").slice(0, 1500) };
  if (!buildIcs(ev)) return { ok: false, output: "Error: invalid date." };
  const qs = new URLSearchParams(Object.entries(ev).filter(([, v]) => v) as [string, string][]);
  const act = propose(ctx, { kind: "calendar", title: ev.title, payload: { ...ev, timezone: "Europe/Helsinki", allDay: s.allDay, icsUrl: `/api/agent/ics?${qs}`, basedOn: based } });
  return { ok: true, output: `Proposed calendar event ${act.id} (not added until the user approves).`, label: "Prepared calendar entry", detail: `${ev.title} · ${ev.start}` };
}

function bookingLink(ctx: ToolCtx, a: any): ToolResult {
  const url = String(a.url).trim();
  const src = /^https?:\/\//.test(url) ? ctx.store.knowsUrl(url) : undefined;
  if (!src)
    return {
      ok: false,
      output: `Rejected: ${url} is not in the retrieved evidence. Only propose URLs that Exa returned (search/read the official page first).`,
      label: "Rejected unverified link",
      detail: url,
    };
  const based = basedOn(ctx, [...(a.basedOn ?? []), src.id]);
  const kind = a.kind === "form_link" ? "form_link" : "booking_link";
  const act = propose(ctx, { kind, title: String(a.label).slice(0, 120), payload: { url, label: a.label, instructions: a.instructions, basedOn: based } });
  return { ok: true, output: `Proposed ${kind} ${act.id} (user must open it; nothing submitted).`, label: kind === "form_link" ? "Found the form" : "Found booking page", detail: url };
}

function watchChanges(ctx: ToolCtx, a: any): ToolResult {
  const based = basedOn(ctx, a.basedOn ?? []);
  const domains = (a.includeDomains ?? []).filter((d: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).slice(0, 5);
  const act = propose(ctx, {
    kind: "watch",
    title: String(a.why).slice(0, 140),
    payload: { query: String(a.query).replace(/\s+(OR|AND)\s+/g, " ").slice(0, 300), why: a.why, includeDomains: domains, cadence: "daily", engine: "exa.monitors", basedOn: based },
  });
  return { ok: true, output: `Proposed Exa Monitor ${act.id} (created only after approval).`, label: "Prepared a watch", detail: String(a.query).slice(0, 80) };
}

export async function runTool(ctx: ToolCtx, name: string, args: any): Promise<ToolResult> {
  switch (name) {
    case "exa_search":
      return exaSearch(ctx, args);
    case "exa_read":
      return exaRead(ctx, args);
    case "exa_places":
      return exaPlaces(ctx, args);
    case "exa_find_list":
      return exaFindList(ctx, args);
    case "contractors_handoff":
      return contractorsHandoff(ctx, args);
    case "draft_message":
      return draftMessage(ctx, args);
    case "calendar_event":
      return calendarEvent(ctx, args);
    case "booking_link":
      return bookingLink(ctx, args);
    case "watch_changes":
      return watchChanges(ctx, args);
    default:
      return { ok: false, output: `Unknown tool ${name}` };
  }
}

export const TOOL_LABEL: Record<string, string> = {
  exa_search: "Searching the web with Exa",
  exa_read: "Reading pages with Exa",
  exa_places: "Looking up places with Exa",
  exa_find_list: "Deep research with Exa Agent",
  contractors_handoff: "Handing over to contractor finder",
  draft_message: "Drafting a message",
  calendar_event: "Preparing a calendar entry",
  booking_link: "Checking the booking/form link",
  watch_changes: "Preparing a watch (Exa Monitor)",
};

export const TOOL_VIA: Record<string, string> = {
  exa_search: "exa.search",
  exa_read: "exa.contents",
  exa_places: "exa.places",
  exa_find_list: "exa.agent",
  watch_changes: "exa.monitors",
};
/* eslint-enable @typescript-eslint/no-explicit-any */
