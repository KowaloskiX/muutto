"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ClipboardText, NotePencil, Paperclip, ShieldCheck, SquaresFour, X } from "@phosphor-icons/react";
import CaseFile, { type OutboxItem } from "@/components/case/CaseFile";
import { ActionCard, PlanCard, str } from "./Agent";
import type { Ranked } from "@/lib/rationale";
import type { QuoteInput, QuoteRow, Recommendation } from "@/lib/compare";
import type { QuoteReport } from "@/lib/quote";
import { keywordIntent, type RouteArgs, type RouteOut } from "./intent";
import { CheckingCard, CitedText, CompanyCard, CompanyDetailCard, CompareCard, DraftCard, ExaBadge, NumberedSources, QuoteCheckCard, Sources, WatchCard, companyKey, host } from "./Bubbles";
import { loadTable, t, type Key, type Table } from "./i18n";
import { EMPTY_CTX, type Action, type AgentAction, type Chip, type Ctx, type Draft, type Evidence, type LiveCand, type Msg, type NewMsg, type PlanStep, type Project, type Source } from "./types";
import s from "./Chat.module.css";

const STORE = "kilpi-contractors-v1";
const uid = () => Math.random().toString(36).slice(2, 10);

const EXAMPLE = "Electrical subcontractor for a 40-apartment pipe renovation (linjasaneeraus) in Espoo, start March";

const welcomeChips = (): Chip[] => [
  { label: "Electrical subcontractor for a 40-apartment pipe renovation in Espoo, start March", action: "example", payload: EXAMPLE, primary: true },
  { label: "Check subcontractor: <paste company>", action: "prefill", payload: "Check subcontractor: " },
  { label: "Which documents must I collect from a subcontractor?", action: "example", payload: "Which documents must I collect from a subcontractor before signing under the tilaajavastuulaki, and which can I check myself from public registers?" },
];

const WELCOME_TEXT = "Find subcontractors for your project and vet them before you sign: tilaajavastuu, plus everything the registers can't show.";

const welcome = (text = WELCOME_TEXT): Msg => ({
  id: uid(),
  role: "bot",
  kind: "welcome",
  text,
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
    errand: c.errand,
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
  /** Mobile: the case file opens as a bottom sheet. */
  const [sheet, setSheet] = useState(false);
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
            m.kind === "checking"
              ? { ...m, items: m.items.map((i) => (i.status === "scanning" ? { ...i, status: "failed" as const } : i)) }
              : m.kind === "plan" && !m.finished
                ? { ...m, finished: true, failed: true, steps: m.steps.map((x) => (x.status === "active" ? { ...x, status: "failed" as const } : x)) }
                : m,
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
    // Say something the moment the search starts; the first stream event refines it in place.
    const progressId = sayT(mode === "company" ? "checkingCompany" : "starting", { name: label || query.replace(/^Verify the company /, "") }, { tone: "progress", exa: true });
    const progress = (text: string) => patch(progressId, (m) => (m.kind === "text" ? { ...m, text } : m));
    try {
      // Kilpi for contractors: every search and company check is a B2B subcontractor vetting.
      const resP = fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, audience: "b2b" }) });
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
            await table;
            kind = e.kind === "company" ? "company" : "job";
            if (kind === "company") progress(tr("checkingCompany", { name: label || query.replace(/^Verify the company /, "") }));
            else progress(tr("looking", { service: label || e.service, city: e.city }));
            if (kind === "job") {
              found = { job: e.service, city: e.city };
              const loc = e.location as { lat: number; lng: number; label: string; source?: string } | undefined;
              const pr = (e.project ?? {}) as Partial<Project>;
              const project: Project = {
                summary: e.summary,
                service: e.service,
                trade: pr.trade || undefined,
                scope: pr.scope || undefined,
                place: pr.place || e.city,
                startDate: pr.startDate || undefined,
                contractValueEur: pr.contractValueEur || undefined,
                audience: e.audience,
                site: loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng, label: loc.label, source: loc.source } : undefined,
                tilaajavastuu: e.tilaajavastuu,
              };
              setCtx((c) => ({ ...c, project, live: [], searching: true }));
            }
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
            if (kind === "job") {
              const lc: LiveCand = { domain: e.domain, name: row.name, status: e.status, place: e.place, report: e.report ? { ...e.report, trace: [] } : undefined };
              setCtx((c) => {
                const live = [...(c.live ?? [])];
                const j = live.findIndex((x) => x.domain === lc.domain);
                if (j < 0) live.push(lc);
                else live[j] = { ...live[j], ...lc, report: lc.report ?? live[j].report };
                return { ...c, live };
              });
            }
            if (!checkingId) checkingId = push({ role: "bot", kind: "checking", items });
            else patch(checkingId, (m) => ({ ...m, items }) as Msg);
          } else if (e.type === "stage" && e.id === "rank" && e.status === "active" && kind === "job") {
            sayT("ranking", undefined, { tone: "progress" });
          } else if (e.type === "done") {
            finished = true;
            await table;
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
            const flagged = ranked.slice(0, 4).filter((r) => r.why.some((w) => w.status === "red" || w.status === "yellow")).length;
            sayT(flagged ? "resultsFlags" : "results", { name: nameOf(ranked[0]), n: Math.min(4, ranked.length), flagged });
            ranked.slice(0, 4).forEach((item, i) => push({ role: "bot", kind: "company", item, rank: i + 1 }));
            const n = Math.min(3, ranked.length);
            const top = ranked.slice(0, n);
            const names = top.map(nameOf).join(", ");
            const asks = top.filter((r) => r.why.some((w) => w.status === "red" || w.status === "yellow")).length;
            sayT(asks ? "askTopFlags" : "askTop", { n, names, asks }, {
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
    } finally {
      if (ctxRef.current.searching || ctxRef.current.live?.length) setCtx((c) => ({ ...c, searching: false, live: [] }));
    }
  }

  async function runDrafts(companies: Ranked[], table: Promise<Table>) {
    if (!companies.length) {
      await table;
      sayT("noShortlist");
      return;
    }
    const c = ctxRef.current;
    const job = [c.project?.scope || c.job, c.city && `in ${c.city}`].filter(Boolean).join(" ") || c.lastQuery || "construction subcontract";
    const p = c.project;
    await table;
    sayT("drafting", { names: companies.map(nameOf).join(", ") }, { tone: "progress" });
    try {
      type DraftOut = Omit<Draft, "lang" | "kind"> & { documentRequestFi?: string; documentRequestEn?: string; documents?: { fi: string; en: string; law?: string }[] };
      const [{ drafts }] = await Promise.all([
        postJson<{ drafts: DraftOut[] }>("/api/draft", {
          job,
          audience: "b2b",
          project: p ? { trade: p.trade ?? "", scope: p.scope ?? p.service ?? "", place: p.place ?? "", startDate: p.startDate ?? "", contractValueEur: p.contractValueEur } : undefined,
          companies: companies.map((r) => {
            const b2bChecks = r.report.checks.some((k) => k.group);
            return {
              name: nameOf(r),
              email: r.report.contact.emails[0],
              concerns: r.why.filter((w) => w.status === "yellow" || w.status === "red").map((w) => w.sentence),
              businessId: r.report.businessId,
              // The documents this company still owes; without a B2B report the route asks for the full § 5 list.
              ...(r.report.documents?.length ? { documents: r.report.documents } : b2bChecks ? { checks: r.report.checks } : {}),
            };
          }),
        }),
        table,
      ]);
      const lang = ctxRef.current.lang === "fi" ? "fi" : "en";
      // B2B: one RFQ and one tilaajavastuu document request per company.
      const out: Draft[] = drafts.flatMap((d) => {
        const { documentRequestFi, documentRequestEn, documents, ...rfq } = d;
        const list: Draft[] = [{ ...rfq, lang, kind: documentRequestFi ? "rfq" : undefined }];
        if (documentRequestFi && documentRequestEn)
          list.push({ name: d.name, email: d.email, subject: `Tilaajavastuulain selvitykset / Contractor's Liability Act documents: ${d.name}`, bodyFi: documentRequestFi, bodyEn: documentRequestEn, lang, kind: "docs", documents });
        return list;
      });
      sayT("drafts", { n: out.length });
      out.forEach((draft) => push({ role: "bot", kind: "draft", draft }));
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
    sayT("startingWatch", { name: target.name }, { tone: "progress", exa: true });
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

  /** The visible conversation as agent turns (progress lines dropped, proposed actions summarised). */
  function agentMessages() {
    const turns: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of msgsRef.current) {
      let turn: { role: "user" | "assistant"; content: string } | undefined;
      if (m.kind === "text" && m.text && !(m.role === "bot" && m.tone === "progress")) turn = { role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 2000) };
      else if (m.kind === "action") turn = { role: "assistant", content: `[Proposed ${m.action.kind.replace("_", " ")}: ${m.action.title}${m.status === "done" ? " — the user approved it" : ""}]` };
      if (!turn) continue;
      const last = turns[turns.length - 1];
      if (last?.role === turn.role) last.content += `\n\n${turn.content}`;
      else turns.push(turn);
    }
    while (turns.length && turns[0].role !== "user") turns.shift();
    return turns.slice(-14);
  }

  const ACTION_KINDS = ["email", "letter", "calendar", "booking_link", "call_script", "watch", "form_link"];

  /** A general errand: stream /api/agent and render its plan, evidence, cited answer and proposed actions. */
  async function runErrand(text: string, args: RouteArgs, table: Promise<Table>) {
    const prev = ctxRef.current.errand;
    setCtx((c) => ({ ...c, errand: { topic: prev && text.length < 80 ? prev.topic : text.slice(0, 300), last: prev?.last } }));
    let planId: string | null = null;
    let plan: string[] = [];
    let steps: PlanStep[] = [];
    const evidence: Evidence[] = [];
    let handoff: string | undefined;
    let replied = false;
    let lastText: string | undefined;
    // Proposed actions are shown right after the answer that explains them.
    let queued: AgentAction[] = [];
    const flush = () => {
      queued.forEach((action) => push({ role: "bot", kind: "action", action, status: "pending" }));
      queued = [];
    };
    const syncPlan = (finished?: boolean, failed?: boolean) => {
      const next = { plan, steps: [...steps], evidence: evidence.map((x) => ({ ...x })), finished, failed };
      if (!planId) planId = push({ role: "bot", kind: "plan", ...next });
      else patch(planId, (m) => ({ ...m, ...next }) as Msg);
    };
    const closePlan = (failed: boolean) => {
      if (!planId && !steps.length && !plan.length) return;
      steps = steps.map((x) => (x.status === "active" ? { ...x, status: failed ? "failed" : "done" } : x.status === "pending" ? { ...x, status: "skipped" } : x));
      syncPlan(true, failed);
    };
    const retry: Chip[] = [{ label: tr("chipRetry"), action: "retry_errand", payload: text }];
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: agentMessages(), state: ctxRef.current.agentState }),
      });
      // Agent not deployed (yet): answer questions the old way, from Exa with sources.
      if (res.status === 404 || res.status === 405) return runAsk(text, args, table);
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `agent failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      const handle = (line: string) => {
        let e: Record<string, unknown> & { type?: string };
        try {
          e = JSON.parse(line);
        } catch {
          return; // a partial or non-JSON line: skip it
        }
        if (e.type === "plan" && Array.isArray(e.steps)) {
          // The plan is what the agent intends to do (strings); tool calls arrive as separate `step` events.
          plan = (e.steps as unknown[]).map((x) => (typeof x === "string" ? x : String((x as { label?: string })?.label ?? ""))).filter(Boolean);
          syncPlan();
        } else if (e.type === "step") {
          const id = String(e.id);
          const i = steps.findIndex((x) => x.id === id);
          const old = steps[i];
          const st = String(e.status);
          const status: PlanStep["status"] = st === "running" || st === "active" ? "active" : st === "error" || st === "failed" ? "failed" : st === "done" ? "done" : "pending";
          const row: PlanStep = { id, label: (e.label as string) || old?.label || "", status, tool: (e.tool as string) || old?.tool, detail: (e.detail as string) || old?.detail };
          if (i < 0) steps = [...steps, row];
          else steps = steps.map((x, k) => (k === i ? row : x));
          syncPlan();
        } else if (e.type === "evidence" && Array.isArray(e.items)) {
          // The same evidence id can arrive again (e.g. searched, then read): merge by id, else by url.
          for (const it of e.items as Evidence[]) {
            if (!it?.url || !/^https?:/i.test(it.url)) continue;
            const i = evidence.findIndex((x) => (it.id && x.id === it.id) || x.url === it.url);
            if (i < 0) evidence.push(it);
            else evidence[i] = { ...evidence[i], ...Object.fromEntries(Object.entries(it).filter(([, v]) => v != null && v !== "")) };
          }
          syncPlan();
        } else if (e.type === "message" && typeof e.text === "string" && e.text.trim()) {
          const sources: Source[] = ((e.sources as Source[] | undefined) ?? []).filter((x) => x?.url && /^https?:/i.test(x.url)).map((x, i) => ({ ...x, n: x.n ?? i + 1 }));
          say(e.text, { sources, exa: sources.length > 0 });
          flush();
          replied = true;
          lastText = e.text;
        } else if (e.type === "action" && e.action && typeof e.action === "object") {
          const a = e.action as Partial<AgentAction>;
          if (!a.kind || !ACTION_KINDS.includes(a.kind)) return;
          const action: AgentAction = { id: String(a.id ?? uid()), kind: a.kind, title: a.title || a.kind.replace("_", " "), payload: a.payload && typeof a.payload === "object" ? a.payload : {}, requiresApproval: true };
          queued.push(action);
          replied = true;
        } else if (e.type === "handoff" && e.to === "contractors") {
          handoff = (typeof e.query === "string" && e.query.trim()) || text;
        } else if (e.type === "done") {
          finished = true;
          setCtx((c) => ({ ...c, agentState: e.state ?? c.agentState }));
          const calls = Number((e.stats as { exaCalls?: number } | undefined)?.exaCalls);
          if (planId && calls > 0) patch(planId, (m) => ({ ...m, exaCalls: calls }) as Msg);
        } else if (e.type === "error") {
          throw new Error(typeof e.message === "string" ? e.message : "agent error");
        }
      };
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(line);
      }
      if (!finished && buf.trim()) handle(buf);
      closePlan(false);
      flush();
      if (lastText) setCtx((c) => ({ ...c, errand: c.errand && { ...c.errand, last: lastText!.slice(0, 400) } }));
      if (handoff) {
        await table;
        setCtx((c) => ({ ...c, errand: undefined }));
        if (!replied) sayT("handoff", undefined, { tone: "progress" });
        return runFind(handoff, "job", table);
      }
      if (!replied) {
        await table;
        sayT("agentNoAnswer", undefined, { chips: retry });
      }
    } catch (err) {
      closePlan(true);
      flush();
      await table;
      sayT("agentError", { msg: (err as Error).message }, { tone: "error", chips: retry });
    }
  }

  async function approveWatch(msgId: string, a: AgentAction) {
    const p = a.payload ?? {};
    const endpoint = str(p, "endpoint");
    const name = str(p, "name", "target", "query", "topic") ?? a.title;
    try {
      let out: { id?: string; monitorId?: string };
      if (endpoint) {
        // Only our own API: never let a suggested action call an arbitrary URL.
        if (!/^\/api\/[\w/-]+(\?[^#]*)?$/.test(endpoint)) throw new Error("this watch has no valid endpoint");
        const body = p.body && typeof p.body === "object" ? p.body : Object.fromEntries(Object.entries(p).filter(([k]) => !["endpoint", "method"].includes(k)));
        out = await postJson(endpoint, body);
      } else {
        // The errand agent creates the Exa Monitor only on this explicit approval.
        out = await postJson("/api/agent", { approve: { kind: "watch", payload: { query: str(p, "query") ?? name, why: str(p, "why"), includeDomains: Array.isArray(p.includeDomains) ? p.includeDomains : [] } } });
      }
      const id = out.id ?? out.monitorId;
      if (id) setCtx((x) => ({ ...x, watched: [...x.watched.filter((w) => w.monitorId !== id), { name, monitorId: id }] }));
      patch(msgId, (m) => ({ ...m, status: "done", result: undefined }) as Msg);
    } catch (err) {
      patch(msgId, (m) => ({ ...m, status: "failed", result: tr("actionFailed", { msg: (err as Error).message }) }) as Msg);
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
          const raw = (a.company || text).replace(/^\s*(check|verify|vet|tarkista)(\s+(the\s+)?(subcontractor|company|aliurakoitsija|yritys))?\s*:?\s*/i, "").trim() || text;
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
        case "errand":
          return runErrand(text, a, table);
        case "start_over":
          ctxRef.current = { ...EMPTY_CTX, lang: r.lang };
          setCtxState(ctxRef.current);
          setMsgs(() => []);
          push(welcome(WELCOME_TEXT));
          return;
        default:
          // Generated replies are already in the user's language: no need to wait for the UI strings.
          {
            // Two in-scope suggestions, in the conversation's language.
            await table;
            const chips: Chip[] = (["exScope1", "exScope2"] as const).map((k) => ({ label: tr(k), action: "example", payload: tr(k) }));
            if (r.reply) return void say(r.reply, { chips });
            sayT("fallback", undefined, { chips });
          }
      }
    });
  }

  async function onChip(msgId: string, chip: Chip) {
    if (busy) return;
    const act: Action = chip.action;
    if (act === "prefill") {
      // Fill the composer and let the user finish the sentence (e.g. paste a company name).
      setInput(chip.payload ?? "");
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
      return;
    }
    patch(msgId, (m) => ({ ...m, chipsUsed: true }));
    const c = ctxRef.current;
    const table = loadTable(c.lang ?? "en");
    if (act === "example") return send(chip.payload ?? EXAMPLE);
    if (act === "paste_another") {
      inputRef.current?.focus();
      return;
    }
    if (act === "retry_errand") {
      retireChips();
      return work(() => runErrand(chip.payload ?? "", {}, table));
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
  /** The sources an action rests on (payload.basedOn), with the quote we read there for deep links. */
  const basisOf = (a: AgentAction): Source[] => {
    const based = Array.isArray(a.payload?.basedOn) ? (a.payload.basedOn as { id?: string; url?: string; title?: string }[]) : [];
    const read = msgs.flatMap((m) => (m.kind === "plan" ? m.evidence : []));
    return based
      .filter((b) => b?.url && /^https?:/i.test(b.url))
      .map((b) => {
        const ev = read.find((e) => (b.id && e.id === b.id) || e.url === b.url);
        return { url: b.url!, title: b.title ?? ev?.title, quote: ev?.quote };
      });
  };
  const lastChipMsg = [...msgs].reverse().find((m) => m.chips?.length && !m.chipsUsed)?.id;

  // ---- case file: derived from the conversation ------------------------------
  const outbox: OutboxItem[] = msgs.flatMap((m) => (m.kind === "draft" ? [{ id: m.id, draft: m.draft }] : []));
  const lastCompare = [...msgs].reverse().find((m): m is Extract<Msg, { kind: "compare" }> => m.kind === "compare");
  const caseCount = (ctx.searching ? ctx.live?.length ?? 0 : ctx.ranked.length) + outbox.filter((o) => !o.draft.sent).length;
  const caseFromPanel = (fn: () => Promise<void>) => {
    if (busy) return;
    retireChips();
    setSheet(false);
    void work(fn);
  };

  function body(m: Msg) {
    switch (m.kind) {
      case "text":
        if (m.role === "user")
          return (
            <div className={s.user}>
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
            <div className={`${s.bot} ${m.tone ? s[m.tone] : ""}`}>
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
        return <div className={s.bot}><CheckingCard items={m.items} /></div>;
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
      case "welcome":
        return (
          <div className={s.welcome}>
            <p className={s.welcomeLead}>{m.text}</p>
            <ol className={s.howList}>
              <li><b>Find</b> subcontractors near the site.</li>
              <li><b>Check</b> each against the tilaajavastuu registers, references, licences and news, with a source for every finding.</li>
              <li><b>Request</b> quotes and missing documents. Nothing is sent without your OK.</li>
              <li><b>Watch</b> the ones you sign with.</li>
            </ol>
          </div>
        );
      case "plan":
        return <PlanCard plan={m.plan} steps={m.steps} evidence={m.evidence} finished={m.finished} failed={m.failed} exaCalls={m.exaCalls} lang={ctx.lang} />;
      case "action":
        return (
          <ActionCard
            action={m.action}
            status={m.status}
            edit={m.edit}
            editing={m.editing}
            result={m.result}
            basis={basisOf(m.action)}
            lang={ctx.lang}
            onChange={(x) => patch(m.id, (y) => ({ ...y, ...x }) as Msg)}
            onWatch={() => approveWatch(m.id, m.action)}
          />
        );
    }
  }

  return (
    <div className={s.stage}>
      <main className={s.phone} aria-label="Chat with Kilpi">
        <header className={s.header}>
          <span className={s.avatar} aria-hidden><ShieldCheck weight="fill" /></span>
          <div className={s.who}>
            <strong>Kilpi</strong>
            <small>{busy ? "Working on it…" : "Subcontractor vetting"}</small>
          </div>
          <button type="button" className={`${s.headBtn} ${s.caseBtn}`} onClick={() => setSheet(true)} title="Case file" aria-label="Open case file">
            <ClipboardText weight="bold" />
            <span>Case file</span>
            {caseCount > 0 && <b className={s.caseCount}>{caseCount}</b>}
          </button>
          <Link href="/" className={`${s.headBtn} ${s.iconOnly}`} title="Classic view" aria-label="Classic view"><SquaresFour weight="bold" /></Link>
          <button type="button" className={`${s.headBtn} ${s.iconOnly}`} onClick={newChat} disabled={busy} title="New project" aria-label="New project"><NotePencil weight="bold" /></button>
        </header>
        {(ctx.project || ctx.ranked.length > 0 || outbox.length > 0) && (
          <button type="button" className={s.caseStrip} onClick={() => setSheet(true)}>
            <span>
              {[
                ctx.searching ? `${ctx.live?.length ?? 0} checking` : ctx.ranked.length ? `${Math.min(8, ctx.ranked.length)} candidates` : "",
                outbox.length ? `${outbox.filter((o) => !o.draft.sent).length} to approve` : "",
                ctx.watched.length ? `${ctx.watched.length} watched` : "",
              ]
                .filter(Boolean)
                .join(" · ") || ctx.project?.scope || "Project"}
            </span>
            <em>Open case file</em>
          </button>
        )}

        <div className={s.scroll} ref={scroller} role="log" aria-live="polite">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const content = body(m);
            const chips = m.chips && !m.chipsUsed && m.id === lastChipMsg;
            if (!content && !chips) return null;
            return (
              <div key={m.id} className={`${s.row} ${m.role === "user" ? s.rowUser : s.rowBot} ${prev && prev.role !== m.role ? s.gap : ""}`}>
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
          {busy && !(msgs[msgs.length - 1]?.kind === "plan" && !(msgs[msgs.length - 1] as { finished?: boolean }).finished) && (
            <div className={`${s.row} ${s.rowBot}`}>
              <div className={s.typing} aria-label="Kilpi is working"><i /><i /><i /></div>
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
            placeholder={ctx.ranked.length ? "Message Kilpi, or paste a subcontractor quote…" : "Trade, project and site, e.g. waterproofing for a school in Vantaa"}
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

      <section className={`${s.casePane} ${sheet ? s.sheetOpen : ""}`} aria-label="Case file">
        <div className={s.sheetBar}>
          <span className={s.grip} aria-hidden />
          <strong>Case file</strong>
          <button type="button" className={s.headBtn} onClick={() => setSheet(false)} aria-label="Close case file"><X weight="bold" /></button>
        </div>
        <CaseFile
          ctx={ctx}
          outbox={outbox}
          compare={lastCompare ? { rows: lastCompare.rows, recommendation: lastCompare.recommendation } : undefined}
          busy={busy}
          onDraft={(r) => caseFromPanel(() => runDrafts([r], loadTable(ctxRef.current.lang ?? "en")))}
          onWatch={(target) => caseFromPanel(() => runWatch(target))}
          onDraftChange={(id, d) => patch(id, (x) => ({ ...x, draft: d }) as Msg)}
          onPrefill={(text) => {
            setSheet(false);
            setInput(text);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      </section>
      {sheet && <button type="button" className={s.sheetScrim} onClick={() => setSheet(false)} aria-label="Close case file" />}
    </div>
  );
}
