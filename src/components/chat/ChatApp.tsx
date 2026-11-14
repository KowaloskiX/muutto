"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, NotePencil, Paperclip, ShieldCheck, SquaresFour } from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { QuoteInput, QuoteRow, Recommendation } from "@/lib/compare";
import type { QuoteReport } from "@/lib/quote";
import { keywordIntent, type RouteArgs, type RouteOut } from "./intent";
import { CheckingCard, CitedText, CompanyCard, CompanyDetailCard, CompareCard, DraftCard, ExaBadge, NumberedSources, QuoteCheckCard, Sources, WatchCard, companyKey, host } from "./Bubbles";
import { loadTable, t, type Key, type Table } from "./i18n";
import { EMPTY_CTX, type Action, type Chip, type Ctx, type Draft, type Msg, type NewMsg, type Source } from "./types";
import s from "./Chat.module.css";

const STORE = "kilpi-chat-v2";
const uid = () => Math.random().toString(36).slice(2, 10);

const EXAMPLE = "Need someone to reline the pipes in my Espoo flat, English speaking";

const welcomeChips = (): Chip[] => [
  { label: "Reline the pipes in my Espoo flat", action: "example", payload: EXAMPLE, primary: true },
  { label: "What is YSE 1998?", action: "example", payload: "What is YSE 1998?" },
];

const WELCOME_TEXT = "Hi, I'm Kilpi. Tell me what needs doing at home, or ask me anything about hiring a contractor in Finland. I find and check companies, get quotes, compare them and keep an eye on whoever you hire. Every claim comes with its source, and nothing goes out without your OK.";

const welcome = (): Msg => ({
  id: uid(),
  role: "bot",
  kind: "text",
  text: WELCOME_TEXT,
  chips: welcomeChips(),
});

// A pasted contractor quote: long, multi-line, and several quote markers at once.
const QUOTE_MARKS = [/tarjous|offert|quote|urakka/i, /y-tunnus|\b\d{7}-\d\b/i, /\balv\b|\bvat\b|\bmoms\b/i, /€|\beur\b|euro/i, /maksu|payment|betalning/i, /takuu|warranty|garanti/i];
const looksLikeQuote = (x: string) => x.length > 250 && x.split(/\n/).length >= 4 && QUOTE_MARKS.filter((r) => r.test(x)).length >= 3;

function quoteMeta(text: string, n: number): QuoteInput {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\b(Oy|Ab|Ky|Tmi|Oyj)\b/.test(l) && !/^(asiakas|kohde|ystävällisin)/i.test(l));
  const company = line?.split(/,|·|\bY-tunnus/i)[0].replace(/^ystävällisin terveisin,?\s*/i, "").trim() || `Quote ${n}`;
  const w = text.match(/(?:https?:\/\/)?((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fi|com|net|eu|se))\b/i);
  return { company, website: w ? `https://${w[1]}` : undefined, text };
}

// Exa traces are large and only useful for the classic view's debug panel: keep storage small.
const slimRanked = (r: Ranked): Ranked => ({ ...r, report: { ...r.report, trace: [] } });
const slimReport = (r: QuoteReport): QuoteReport => ({ ...r, trace: [] });
const nameOf = (r: Ranked) => r.report.name || r.place.name;
const domainOfRanked = (r: Ranked) => host(r.place.website ?? r.report.website) || r.report.domain || undefined;
const flat = (x: string) => x.toLowerCase().replace(/\b(oy|oyj|ab|ky|tmi|ay|ltd)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
const sameName = (a: string, b: string) => {
  const x = flat(a);
  const y = flat(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

async function postJson<T>(url: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Compact, serialisable view of the conversation state for the router. */
function routerState(c: Ctx) {
  const item = (r: Ranked, n: number) => ({
    n,
    name: nameOf(r),
    domain: domainOfRanked(r),
    fit: r.fit,
    businessId: r.report.businessId,
    why: r.why.map((w) => ({ label: w.sentence, status: w.status, sources: w.evidence.map((e) => e.url) })),
    checks: r.report.checks.map((k) => ({ label: k.label, status: k.status, detail: k.detail.slice(0, 300), sources: k.evidence.map((e) => e.url) })),
  });
  return {
    job: c.job,
    city: c.city,
    lastQuery: c.lastQuery,
    lang: c.lang,
    shortlist: c.ranked.slice(0, 8).map((r, i) => item(r, i + 1)),
    picked: c.ranked.map((r, i) => (c.selected.includes(companyKey(r)) ? i + 1 : 0)).filter(Boolean),
    quotes: c.quotes.map((q) => ({ company: q.company })),
    comparison: c.comparison,
    watched: c.watched.map((w) => ({ name: w.name, domain: w.domain })),
    hired: c.hired,
    checked: c.checked ? item(c.checked, 0) : undefined,
  };
}

export default function ChatApp() {
  const [msgs, setMsgsState] = useState<Msg[]>([]);
  const msgsRef = useRef<Msg[]>([]);
  const [ctx, setCtxState] = useState<Ctx>(EMPTY_CTX);
  const ctxRef = useRef<Ctx>(EMPTY_CTX);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const setCtx = useCallback((fn: (c: Ctx) => Ctx) => {
    ctxRef.current = fn(ctxRef.current);
    setCtxState(ctxRef.current);
  }, []);
  const setMsgs = useCallback((fn: (m: Msg[]) => Msg[]) => {
    msgsRef.current = fn(msgsRef.current);
    setMsgsState(msgsRef.current);
  }, []);

  // ---- persistence -------------------------------------------------------
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as { msgs: Msg[]; ctx: Ctx };
        if (Array.isArray(saved.msgs) && saved.msgs.length) {
          // Anything that was mid-flight when the tab closed is not coming back.
          const restoredMsgs = saved.msgs.map((m) =>
            m.kind === "checking" ? { ...m, items: m.items.map((i) => (i.status === "scanning" ? { ...i, status: "failed" as const } : i)) } : m,
          );
          setMsgs(() => restoredMsgs);
          ctxRef.current = { ...EMPTY_CTX, ...saved.ctx };
          setCtxState(ctxRef.current);
          if (ctxRef.current.lang) void loadTable(ctxRef.current.lang);
          restored = true;
        }
      }
    } catch {
      /* storage blocked or corrupt: start fresh */
    }
    if (!restored) setMsgs(() => [welcome()]);
    setReady(true);
  }, [setMsgs]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ msgs, ctx }));
    } catch {
      /* quota or blocked storage: chat still works in memory */
    }
  }, [msgs, ctx, ready]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy]);

  // ---- message helpers ---------------------------------------------------
  const push = useCallback(
    (m: NewMsg) => {
      const id = m.id ?? uid();
      setMsgs((prev) => [...prev, { ...m, id } as Msg]);
      return id;
    },
    [setMsgs],
  );
  const patch = useCallback((id: string, fn: (m: Msg) => Msg) => setMsgs((prev) => prev.map((m) => (m.id === id ? fn(m) : m))), [setMsgs]);
  type SayExtra = { chips?: Chip[]; tone?: "progress" | "error" | "success"; exa?: boolean; sources?: Source[]; note?: string };
  const say = useCallback((text: string, extra: SayExtra = {}) => push({ role: "bot", kind: "text", text, ...extra }), [push]);
  /** Say one of Kilpi's own lines in the conversation's language. */
  const tr = (key: Key, vars?: Record<string, string | number>) => t(ctxRef.current.lang, key, vars);
  const sayT = (key: Key, vars?: Record<string, string | number>, extra?: SayExtra) => say(tr(key, vars), extra);
  const echo = useCallback((text: string, attachment?: string) => push({ role: "user", kind: "text", text, attachment }), [push]);
  const retireChips = () => setMsgs((prev) => prev.map((m) => (m.chips && !m.chipsUsed ? { ...m, chipsUsed: true } : m)));

  // ---- tools -------------------------------------------------------------
  /** Contractor search (job) or single-company verification (company), both via /api/find. */
  async function runFind(query: string, mode: "job" | "company", table: Promise<Table>, label?: string) {
    let checkingId: string | null = null;
    let kind: "job" | "company" = mode;
    let found: { job?: string; city?: string } = {};
    const checking: { name: string; domain: string; status: "scanning" | "done" | "failed" }[] = [];
    const retry: Chip[] = [{ label: tr("chipRetry"), action: "find_again", payload: query }];
    try {
      const resP = fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      await table;
      const res = await resP;
      if (!res.ok || !res.body) throw new Error(`search failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "intent") {
            kind = e.kind === "company" ? "company" : "job";
            if (kind === "company") sayT("checkingCompany", { name: label || query }, { tone: "progress", exa: true });
            else sayT("looking", { service: label || e.service, city: e.city }, { tone: "progress", exa: true });
            if (kind === "job") found = { job: e.service, city: e.city };
          } else if (e.type === "notice") {
            say(e.message, { tone: e.level === "warning" ? "error" : "progress" });
          } else if (e.type === "stage" && e.id === "find" && e.status === "done" && kind === "job") {
            const n = Number(/checking (\d+)/i.exec(e.detail ?? "")?.[1] ?? 0);
            const total = (e.detail ?? "").match(/\d+/g)?.slice(0, 2).reduce((a: number, b: string) => a + Number(b), 0) ?? 0;
            if (n) sayT("found", { found: total, n }, { tone: "progress", exa: true });
          } else if (e.type === "company") {
            const i = checking.findIndex((x) => x.domain === e.domain);
            const row = { name: e.report?.name ?? e.place.name, domain: e.domain, status: e.status };
            if (i < 0) checking.push(row);
            else checking[i] = row;
            const items = [...checking];
            if (!checkingId) checkingId = push({ role: "bot", kind: "checking", items });
            else patch(checkingId, (m) => ({ ...m, items }) as Msg);
          } else if (e.type === "done") {
            finished = true;
            const ranked = (e.ranked as Ranked[]).map(slimRanked);
            if (kind === "company") {
              const item = ranked[0];
              if (!item) {
                sayT("companyFailed", { msg: "no result" }, { tone: "error", chips: retry });
                break;
              }
              setCtx((c) => ({ ...c, checked: item }));
              push({ role: "bot", kind: "detail", item });
              sayT("companyResult", { name: nameOf(item) }, { chips: [{ label: tr("chipWatchIt", { name: nameOf(item) }), action: "watch_name", payload: nameOf(item) }] });
              break;
            }
            if (!ranked.length) {
              // Keep the previous shortlist: a failed refinement shouldn't wipe it.
              sayT("noneTrusted", undefined, { chips: retry });
              break;
            }
            setCtx((c) => ({ ...c, ranked, selected: [], lastQuery: query, job: found.job ?? c.job, city: found.city ?? c.city }));
            sayT("results", { name: nameOf(ranked[0]) });
            ranked.slice(0, 4).forEach((item, i) => push({ role: "bot", kind: "company", item, rank: i + 1 }));
            const n = Math.min(3, ranked.length);
            sayT("askTop", { n }, {
              chips: [
                { label: tr("chipAskTop", { n }), action: "ask_top3", primary: true },
                { label: tr("chipPick"), action: "pick_myself" },
                { label: tr("chipNotNow"), action: "not_now" },
              ],
            });
          } else if (e.type === "error") {
            throw new Error(e.message);
          }
        }
      }
    } catch (err) {
      sayT(kind === "company" ? "companyFailed" : "searchError", { msg: (err as Error).message }, { tone: "error", chips: retry });
    }
  }

  async function runDrafts(companies: Ranked[], table: Promise<Table>) {
    if (!companies.length) {
      await table;
      sayT("noShortlist");
      return;
    }
    const c = ctxRef.current;
    const job = [c.job, c.city && `in ${c.city}`].filter(Boolean).join(" ") || c.lastQuery || "home repair job";
    try {
      const [{ drafts }] = await Promise.all([
        postJson<{ drafts: Omit<Draft, "lang">[] }>("/api/draft", {
          job,
          companies: companies.map((r) => ({
            name: nameOf(r),
            email: r.report.contact.emails[0],
            concerns: r.why.filter((w) => w.status === "yellow" || w.status === "red").map((w) => w.sentence),
          })),
        }),
        table,
      ]);
      sayT("drafts", { n: drafts.length });
      const lang = ctxRef.current.lang === "fi" ? "fi" : "en";
      drafts.forEach((d) => push({ role: "bot", kind: "draft", draft: { ...d, lang } }));
      sayT("afterDrafts", undefined, {
        chips: [
          { label: tr("chipPasteQuote"), action: "paste_another", primary: true },
        ],
      });
    } catch (err) {
      sayT("draftError", { msg: (err as Error).message }, { tone: "error" });
    }
  }

  async function runQuotes(added: QuoteInput[]) {
    const known = new Set(ctxRef.current.quotes.map((q) => q.text));
    const fresh = added.filter((q) => !known.has(q.text));
    setCtx((c) => ({ ...c, quotes: [...c.quotes, ...fresh].slice(-4) }));
    const all = ctxRef.current.quotes;
    if (all.length === 1) {
      const q = all[0];
      sayT("checkingQuote", { company: q.company }, { tone: "progress", exa: true });
      try {
        const report = slimReport(await postJson<QuoteReport>("/api/check-quote", { text: q.text, website: q.website }));
        push({ role: "bot", kind: "quoteCheck", company: q.company, report });
        const reds = report.checks.filter((x) => x.status === "red").length;
        const yellows = report.checks.filter((x) => x.status === "yellow").length;
        sayT(reds ? "quoteRed" : "quoteOk", { reds, yellows }, { chips: [{ label: tr("chipPasteQuote"), action: "paste_another", primary: true }] });
      } catch (err) {
        sayT("quoteError", { msg: (err as Error).message }, { tone: "error" });
      }
      return;
    }
    await runCompare(all);
  }

  async function runCompare(all: QuoteInput[]) {
    sayT("comparing", { n: all.length }, { tone: "progress", exa: true });
    try {
      const out = await postJson<{ rows: QuoteRow[]; recommendation: Recommendation }>("/api/compare-quotes", { quotes: all });
      const rows = out.rows.map((r) => ({ ...r, report: slimReport(r.report) }));
      push({ role: "bot", kind: "compare", rows, recommendation: out.recommendation });
      const best = rows[out.recommendation.pick];
      setCtx((c) => ({
        ...c,
        comparison: {
          headline: out.recommendation.headline,
          pick: best?.company,
          rows: rows.map((r) => ({ company: r.company, total: r.totalWithVat ?? r.total, upfrontPct: r.upfrontPct, reds: r.reds, yellows: r.yellows })),
          reasons: out.recommendation.reasons.map((r) => r.text),
        },
      }));
      if (!best) {
        sayT("noneGood");
        return;
      }
      const ranked = ctxRef.current.ranked.find((r) => sameName(nameOf(r), best.company));
      const domain = host(best.website ?? best.report.company?.website ?? ranked?.place.website);
      setCtx((c) => ({ ...c, pick: { name: best.company, domain: domain || undefined } }));
      sayT("safer", { name: best.company }, {
        chips: [
          { label: tr("chipHire", { name: best.company }), action: "hire", primary: true },
          { label: tr("chipNotYet"), action: "not_yet" },
        ],
      });
    } catch (err) {
      sayT("compareError", { msg: (err as Error).message }, { tone: "error" });
    }
  }

  /** Who a name / shortlist number refers to, with a domain when we know one. */
  function resolveTarget(args: RouteArgs): { name: string; domain?: string } | undefined {
    const c = ctxRef.current;
    const byRef = args.refs?.map((n) => c.ranked[n - 1]).find(Boolean);
    if (byRef) return { name: nameOf(byRef), domain: domainOfRanked(byRef) };
    const name = args.target?.trim() || args.company?.trim();
    if (name) {
      const r = [...c.ranked, ...(c.checked ? [c.checked] : [])].find((x) => sameName(nameOf(x), name));
      if (r) return { name: nameOf(r), domain: domainOfRanked(r) };
      if (c.pick && sameName(c.pick.name, name)) return c.pick;
      return { name, domain: /\.[a-z]{2,}$/i.test(name) ? host(name) : undefined };
    }
    if (c.pick) return c.pick;
    if (c.checked) return { name: nameOf(c.checked), domain: domainOfRanked(c.checked) };
    return undefined;
  }

  async function runWatch(target: { name: string; domain?: string } | undefined) {
    if (!target) {
      sayT("watchWho");
      return;
    }
    if (ctxRef.current.watched.some((w) => sameName(w.name, target.name))) {
      sayT("alreadyWatching", { name: target.name });
      return;
    }
    try {
      const out = await postJson<{ id: string; webhook: string }>("/api/watch", { name: target.name, domain: target.domain });
      setCtx((x) => ({ ...x, hired: target.name, watched: [...x.watched, { name: target.name, domain: target.domain, monitorId: out.id }] }));
      push({ role: "bot", kind: "watch", name: target.name, domain: target.domain, monitorId: out.id, mode: out.webhook });
      sayT("watching", { name: target.name }, { tone: "success", exa: true });
    } catch (err) {
      sayT("watchError", { name: target.name, msg: (err as Error).message }, { tone: "error" });
    }
  }

  async function runUnwatch(name: string | undefined) {
    const w = ctxRef.current.watched;
    if (!w.length) {
      sayT("notWatching");
      return;
    }
    const hit = name ? w.find((x) => sameName(x.name, name) || (x.domain && name.includes(x.domain))) : w.length === 1 ? w[0] : undefined;
    if (!hit) {
      sayT("unwatchWhich", { names: w.map((x) => x.name).join(", ") });
      return;
    }
    try {
      const res = await fetch(`/api/watch?id=${encodeURIComponent(hit.monitorId)}`, { method: "DELETE" });
      // 404: the monitor is already gone on Exa's side; forget it here too.
      if (!res.ok && res.status !== 404) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      setCtx((x) => ({ ...x, watched: x.watched.filter((y) => y.monitorId !== hit.monitorId), hired: x.hired === hit.name ? undefined : x.hired }));
      sayT("unwatched", { name: hit.name }, { tone: "success" });
    } catch (err) {
      sayT("unwatchError", { name: hit.name, msg: (err as Error).message }, { tone: "error" });
    }
  }

  async function runAsk(question: string, args: RouteArgs, table: Promise<Table>) {
    const lang = ctxRef.current.lang ?? "en";
    try {
      const [out] = await Promise.all([
        postJson<{ answer: string; sources: { n: number; url: string; title?: string; quote?: string }[]; grounded: boolean }>("/api/ask", {
          question,
          query: args.searchQuery,
          lang,
          finland: args.finland !== false,
        }),
        table,
      ]);
      if (!out.answer || !out.sources.length) {
        sayT("askNoAnswer");
        return;
      }
      say(out.answer, { sources: out.sources, exa: true, note: out.grounded ? undefined : tr("askPartial") });
    } catch (err) {
      await table;
      sayT("askError", { msg: (err as Error).message }, { tone: "error" });
    }
  }

  // ---- input -------------------------------------------------------------
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  function history() {
    return msgsRef.current
      .filter((m): m is Extract<Msg, { kind: "text" }> => m.kind === "text" && !!m.text && !(m.role === "bot" && m.tone === "progress"))
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 400) }));
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    retireChips();
    if (looksLikeQuote(text)) {
      const q = quoteMeta(text, ctxRef.current.quotes.length + 1);
      echo(text, `Quote from ${q.company}`);
      await work(() => runQuotes([q]));
      return;
    }
    const hist = history();
    echo(text);
    await work(async () => {
      const c = ctxRef.current;
      let r: RouteOut;
      try {
        r = await postJson<RouteOut>("/api/chat-route", { text, history: hist, state: routerState(c) });
      } catch {
        r = { intent: keywordIntent(text), lang: c.lang ?? "en", args: { query: text, searchQuery: text }, by: "keywords" };
      }
      setCtx((x) => ({ ...x, lang: r.lang }));
      const table = loadTable(r.lang);
      const a = r.args ?? {};
      const refItems = (a.refs ?? []).map((n) => c.ranked[n - 1]).filter((x): x is Ranked => !!x);

      switch (r.intent) {
        case "find_contractor":
          return runFind(a.query || text, "job", table, r.lang !== "en" ? a.jobLabel : undefined);
        case "check_company": {
          const raw = a.company || text;
          // A URL is looked up by its bare domain ("vesiniitty.fi"); names and Y-tunnus as given.
          const company = /^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$)/i.test(raw) ? host(raw) : raw;
          return runFind(`Verify the company ${company}`, "company", table, company);
        }
        case "company_detail": {
          await table;
          const named = a.target || a.company;
          const byName = named ? [...c.ranked, ...(c.checked ? [c.checked] : [])].filter((x) => sameName(nameOf(x), named)).slice(0, 1) : [];
          // No reference at all: the company checked on its own, or the only one listed.
          const implicit = c.checked ? [c.checked] : c.ranked.length === 1 ? c.ranked : [];
          const items = refItems.length ? refItems : byName.length ? byName : named ? [] : implicit;
          if (!items.length) return void sayT(c.ranked.length || c.checked ? "whichCompany" : "noShortlist");
          items.forEach((item) => push({ role: "bot", kind: "detail", item, rank: c.ranked.indexOf(item) + 1 || undefined }));
          return;
        }
        case "about_shortlist":
          await table;
          if (!r.answer) return void (c.ranked.length || c.checked || c.comparison ? sayT("explainError", { msg: "no answer" }, { tone: "error" }) : sayT("noShortlist"));
          return void say(r.answer, { sources: r.sources ?? [] });
        case "request_quotes": {
          const picks = c.ranked.filter((x) => c.selected.includes(companyKey(x)));
          return runDrafts(refItems.length ? refItems : picks.length ? picks : c.ranked.slice(0, 3), table);
        }
        case "check_quote":
          if (text.length > 160) {
            const q = quoteMeta(text, c.quotes.length + 1);
            await table;
            return runQuotes([q]);
          }
          await table;
          return void sayT("pasteQuote");
        case "compare_quotes":
          await table;
          if (c.quotes.length >= 2) return runCompare(c.quotes);
          return void sayT(c.quotes.length ? "oneQuote" : "noQuotes");
        case "watch":
          await table;
          return runWatch(resolveTarget(a));
        case "unwatch":
          await table;
          return runUnwatch(a.target || a.company || (refItems[0] && nameOf(refItems[0])));
        case "ask":
          return runAsk(text, a, table);
        case "start_over":
          ctxRef.current = { ...EMPTY_CTX, lang: r.lang };
          setCtxState(ctxRef.current);
          setMsgs(() => []);
          push({ role: "bot", kind: "text", text: r.reply || WELCOME_TEXT, chips: welcomeChips() });
          return;
        default:
          // Generated replies are already in the user's language: no need to wait for the UI strings.
          if (r.reply) return void say(r.reply);
          await table;
          sayT("fallback");
      }
    });
  }

  async function onChip(msgId: string, chip: Chip) {
    if (busy) return;
    patch(msgId, (m) => ({ ...m, chipsUsed: true }));
    const act: Action = chip.action;
    const c = ctxRef.current;
    const table = loadTable(c.lang ?? "en");
    if (act === "example") return send(chip.payload ?? EXAMPLE);
    if (act === "paste_another") {
      inputRef.current?.focus();
      return;
    }
    retireChips();
    echo(chip.label);
    if (act === "find_again") {
      const q = chip.payload ?? c.lastQuery ?? EXAMPLE;
      return work(() => runFind(q, /^Verify the company /.test(q) ? "company" : "job", table));
    }
    if (act === "ask_top3") return work(() => runDrafts(c.ranked.slice(0, 3), table));
    if (act === "pick_myself") return void sayT("pickMyself", undefined, { chips: [{ label: tr("chipDraftPicks"), action: "draft_selected", primary: true }] });
    if (act === "draft_selected") {
      const picks = c.ranked.filter((r) => c.selected.includes(companyKey(r)));
      if (!picks.length) return void sayT("noPicks", undefined, { chips: [{ label: tr("chipDraftPicks"), action: "draft_selected", primary: true }] });
      return work(() => runDrafts(picks, table));
    }
    if (act === "not_now") return void sayT("notNow");
    if (act === "compare_now") return work(() => runCompare(c.quotes));
    if (act === "hire") return work(() => runWatch(c.pick));
    if (act === "watch_name") return work(() => runWatch(resolveTarget({ target: chip.payload })));
    if (act === "not_yet") sayT("notYet");
  }

  function newChat() {
    if (busy) return;
    ctxRef.current = EMPTY_CTX;
    setCtxState(EMPTY_CTX);
    setMsgs(() => [welcome()]);
    setInput("");
  }

  const togglePick = (key: string) =>
    setCtx((c) => ({ ...c, selected: c.selected.includes(key) ? c.selected.filter((k) => k !== key) : [...c.selected, key] }));

  // ---- render ------------------------------------------------------------
  const lastChipMsg = [...msgs].reverse().find((m) => m.chips?.length && !m.chipsUsed)?.id;

  function body(m: Msg) {
    switch (m.kind) {
      case "text":
        if (m.role === "user")
          return (
            <div className={`${s.bubble} ${s.user}`}>
              {m.attachment && (
                <span className={s.attach}>
                  <Paperclip weight="bold" /> {m.attachment}
                </span>
              )}
              <span className={s.text}>{m.text.length > 220 ? `${m.text.slice(0, 200).trim()}…` : m.text}</span>
            </div>
          );
        if (!m.text) return null; // chips-only message
        {
          const numbered = !!m.sources?.length && m.sources.every((x) => x.n != null);
          return (
            <div className={`${s.bubble} ${s.bot} ${m.tone ? s[m.tone] : ""}`}>
              {numbered ? <CitedText text={m.text} sources={m.sources!} /> : <span className={s.text}>{m.text}</span>}
              {m.note && <small className={s.note}>{m.note}</small>}
              {numbered ? (
                <span className={s.srcList}>
                  <NumberedSources list={m.sources!} />
                  {m.exa && <ExaBadge />}
                </span>
              ) : (
                (m.sources?.length || m.exa) && (
                  <span className={s.srcRow}>
                    <Sources list={m.sources} />
                    {m.exa && <ExaBadge />}
                  </span>
                )
              )}
            </div>
          );
        }
      case "checking":
        return <div className={`${s.bubble} ${s.bot}`}><CheckingCard items={m.items} /></div>;
      case "company":
        return <CompanyCard item={m.item} rank={m.rank} selected={ctx.selected.includes(companyKey(m.item))} onToggle={() => togglePick(companyKey(m.item))} />;
      case "detail":
        return <CompanyDetailCard item={m.item} rank={m.rank} />;
      case "draft":
        return <DraftCard draft={m.draft} onChange={(d) => patch(m.id, (x) => ({ ...x, draft: d }) as Msg)} />;
      case "quoteCheck":
        return <QuoteCheckCard company={m.company} report={m.report} />;
      case "compare":
        return <CompareCard rows={m.rows} recommendation={m.recommendation} />;
      case "watch":
        return <WatchCard name={m.name} domain={m.domain} monitorId={m.monitorId} mode={m.mode} />;
    }
  }

  return (
    <div className={s.stage}>
      <aside className={s.aside}>
        <span className={s.asideMark}><ShieldCheck weight="fill" /></span>
        <h1>Text Kilpi the job. It does the legwork.</h1>
        <p>Finds local contractors with Exa, checks each one against the Finnish trade register and their own site, drafts your quote requests and compares the replies. Ask it anything about hiring in Finland: every answer is sourced. You approve every step.</p>
        <Link href="/" className={s.asideLink}><SquaresFour weight="bold" /> Open the classic view</Link>
      </aside>

      <main className={s.phone} aria-label="Chat with Kilpi">
        <header className={s.header}>
          <span className={s.avatar} aria-hidden><ShieldCheck weight="fill" /></span>
          <div className={s.who}>
            <strong>Kilpi</strong>
            <small>{busy ? "working on it…" : "your contractor butler"}</small>
          </div>
          <Link href="/" className={s.headBtn} title="Classic view"><SquaresFour weight="bold" /><span>Classic</span></Link>
          <button type="button" className={s.headBtn} onClick={newChat} disabled={busy} title="New chat"><NotePencil weight="bold" /><span>New chat</span></button>
        </header>

        <div className={s.scroll} ref={scroller} role="log" aria-live="polite">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const showAvatar = m.role === "bot" && prev?.role !== "bot";
            const content = body(m);
            const chips = m.chips && !m.chipsUsed && m.id === lastChipMsg;
            if (!content && !chips) return null;
            return (
              <div key={m.id} className={`${s.row} ${m.role === "user" ? s.rowUser : s.rowBot} ${prev && prev.role !== m.role ? s.gap : ""}`}>
                {m.role === "bot" && <span className={`${s.mini} ${showAvatar ? "" : s.hidden}`} aria-hidden><ShieldCheck weight="fill" /></span>}
                <div className={s.col}>
                  {content}
                  {chips && (
                    <div className={s.chips}>
                      {m.chips!.map((c) => (
                        <button key={c.label} type="button" className={`${s.chip} ${c.primary ? s.chipPrimary : ""}`} onClick={() => onChip(m.id, c)} disabled={busy}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className={`${s.row} ${s.rowBot}`}>
              <span className={s.mini} aria-hidden><ShieldCheck weight="fill" /></span>
              <div className={`${s.bubble} ${s.bot} ${s.typing}`} aria-label="Kilpi is typing"><i /><i /><i /></div>
            </div>
          )}
        </div>

        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={ctx.ranked.length ? "Message Kilpi, or paste a quote…" : "What needs doing? Or ask a question…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            aria-label="Message"
          />
          <button type="submit" className={s.sendBtn} disabled={busy || !input.trim()} aria-label="Send"><ArrowUp weight="bold" /></button>
        </form>
      </main>
    </div>
  );
}
