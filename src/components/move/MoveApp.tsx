"use client";

// /move: a relocation agent for the Helsinki region. Left, the chat (prompt, the five-stage search
// card, a one-line summary with actions). Middle, the move file (map, matrix, listings, watch).
// Right, the drawer (an area or a listing with deep research and the viewing request).
// Streams NDJSON from /api/move and /api/move/research. Shows only what the API returned.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, CaretLeft, CaretRight, ChatCircleText, CircleNotch, NotePencil, WarningCircle, X } from "@phosphor-icons/react";
import type { Area, Listing, MoveEvent, ResearchEvent, ViewingDraft, WatchResult, WatchRuns } from "@/lib/move/types";
import MoveFile, { PROMPTS } from "./MoveFile";
import { MoveProgress } from "./MoveProgress";
import { mins } from "./model";
import { fitScore, rankAreas, weights, whyLines } from "@/lib/move/rank";
import type { AskResult } from "@/lib/move/ask";
import type { CriterionId } from "@/lib/move/types";
import type { Chip, DraftState, Msg, ResearchState, RunState, StageId, View, WatchState } from "./types";
import s from "./Move.module.css";

const STORE = "muutto:v1";
const STAGES: StageId[] = ["understand", "areas", "measure", "listings", "rank"];
const uid = () => Math.random().toString(36).slice(2, 10);
const WELCOME: Msg = { id: "welcome", role: "bot", kind: "welcome" };

async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as T;
      } catch {
        /* a partial or malformed line: skip it */
      }
    }
  }
  if (buf.trim()) {
    try {
      yield JSON.parse(buf) as T;
    } catch {
      /* ignore */
    }
  }
}

const errText = async (res: Response) => {
  try {
    const j = await res.json();
    return (j && (j.error || j.message)) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
};

const bestListing = (areas: Area[]) => {
  for (const a of areas) if (a.listings[0]) return { listing: a.listings[0], area: a };
  return undefined;
};

export default function MoveApp() {
  const [msgs, setMsgsState] = useState<Msg[]>([WELCOME]);
  const msgsRef = useRef<Msg[]>([WELCOME]);
  const [runs, setRunsState] = useState<Record<string, RunState>>({});
  const runsRef = useRef<Record<string, RunState>>({});
  const [currentRun, setCurrentRun] = useState<string | undefined>();
  const [view, setView] = useState<View | undefined>();
  const [research, setResearch] = useState<Record<string, ResearchState>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [watch, setWatch] = useState<WatchState | undefined>();
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [chatPeek, setChatPeek] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const researchRef = useRef<Record<string, ResearchState>>({});
  researchRef.current = research;

  const setMsgs = useCallback((fn: (m: Msg[]) => Msg[]) => {
    msgsRef.current = fn(msgsRef.current);
    setMsgsState(msgsRef.current);
  }, []);
  const patchRun = useCallback((id: string, fn: (r: RunState) => RunState) => {
    const cur = runsRef.current[id];
    if (!cur) return;
    runsRef.current = { ...runsRef.current, [id]: fn(cur) };
    setRunsState(runsRef.current);
  }, []);

  const run = currentRun ? runs[currentRun] : undefined;
  const areas = run?.ranked ?? run?.areas ?? [];
  const drawerOpen = !!view && areas.length > 0;
  const folded = drawerOpen && !chatPeek;

  // ---- persistence (finished state only; a run cut off by a reload is shown as stopped)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const st = JSON.parse(raw) as { msgs: Msg[]; runs: Record<string, RunState>; currentRun?: string; research?: Record<string, ResearchState>; drafts?: Record<string, DraftState>; watch?: WatchState };
        const fixedRuns: Record<string, RunState> = {};
        for (const [k, r] of Object.entries(st.runs ?? {})) fixedRuns[k] = r.finished ? r : { ...r, finished: true, failed: true, error: r.error ?? "Interrupted by a page reload." };
        runsRef.current = fixedRuns;
        setRunsState(fixedRuns);
        msgsRef.current = st.msgs?.length ? st.msgs : [WELCOME];
        setMsgsState(msgsRef.current);
        setCurrentRun(st.currentRun);
        const rs: Record<string, ResearchState> = {};
        for (const [k, r] of Object.entries(st.research ?? {})) rs[k] = r.running ? { ...r, running: false, error: r.error ?? "Interrupted by a page reload." } : r;
        setResearch(rs);
        const ds: Record<string, DraftState> = {};
        for (const [k, d] of Object.entries(st.drafts ?? {})) if (!d.loading) ds[k] = d;
        setDrafts(ds);
        if (st.watch && !st.watch.loading) setWatch(st.watch);
      }
    } catch {
      /* storage blocked or corrupt: start fresh */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ msgs, runs, currentRun, research, drafts, watch }));
    } catch {
      /* quota or blocked */
    }
  }, [ready, msgs, runs, currentRun, research, drafts, watch]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, runs]);

  useEffect(() => {
    if (!drawerOpen) setChatPeek(false);
  }, [drawerOpen]);

  const push = (m: Msg) => setMsgs((prev) => [...prev, m]);
  const isMobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

  // ---- the area search
  const search = async (query: string) => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    setView(undefined);
    setWatch(undefined);
    const id = uid();
    const r: RunState = {
      id,
      query: q,
      stages: { understand: "active", areas: "pending", measure: "pending", listings: "pending", rank: "pending" },
      details: {},
      candidates: [],
      areas: [],
      notices: [],
      finished: false,
      failed: false,
      startedAt: Date.now(),
    };
    runsRef.current = { ...runsRef.current, [id]: r };
    setRunsState(runsRef.current);
    setCurrentRun(id);
    setMsgs((prev) => [...prev.map((m) => (m.role === "bot" && m.kind === "text" && m.chips ? { ...m, chipsUsed: true } : m)), { id: uid(), role: "user", text: q }, { id: uid(), role: "bot", kind: "run", runId: id }]);
    let gotDone = false;
    try {
      const res = await fetch("/api/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      if (!res.ok || !res.body) throw new Error(await errText(res));
      for await (const e of ndjson<MoveEvent>(res)) {
        switch (e.type) {
          case "stage":
            patchRun(id, (st) => {
              const stages = { ...st.stages, [e.id]: e.status };
              // An active stage implies the earlier ones are done.
              if (e.status === "active") for (const k of STAGES.slice(0, STAGES.indexOf(e.id))) if (stages[k] !== "failed") stages[k] = "done";
              return { ...st, stages, details: e.detail ? { ...st.details, [e.id]: e.detail } : st.details };
            });
            break;
          case "intent":
            patchRun(id, (st) => ({ ...st, intent: e.intent }));
            break;
          case "areas":
            patchRun(id, (st) => ({ ...st, candidates: e.areas }));
            break;
          case "area":
            patchRun(id, (st) => ({ ...st, areas: [...st.areas.filter((a) => a.id !== e.area.id), e.area] }));
            break;
          case "notice":
            patchRun(id, (st) => ({ ...st, notices: st.notices.includes(e.message) ? st.notices : [...st.notices, e.message] }));
            break;
          case "error":
            patchRun(id, (st) => ({ ...st, error: e.message }));
            break;
          case "done":
            gotDone = true;
            patchRun(id, (st) => ({ ...st, ranked: e.ranked, tookMs: e.tookMs, finished: true, endedAt: Date.now(), stages: { understand: "done", areas: "done", measure: "done", listings: "done", rank: "done" } }));
            break;
        }
      }
      if (!gotDone) throw new Error(runsRef.current[id]?.error ?? "The search ended before a ranking came back.");
      const fin = runsRef.current[id];
      const ranked = fin.ranked ?? [];
      if (!ranked.length) {
        push({ id: uid(), role: "bot", kind: "text", text: fin.error ?? "No areas came back for this search. Try naming the workplace address and a budget.", tone: "note" });
      } else {
        const top = ranked[0];
        const nList = ranked.reduce((n, a) => n + a.listings.length, 0);
        const work = fin.intent?.work?.label || fin.intent?.workAddress;
        const t = top.commute?.transitMin;
        const text = [
          `Ranked ${ranked.length} area${ranked.length === 1 ? "" : "s"}${work ? ` for ${work}` : ""}.`,
          `Best fit: ${top.name} (fit ${top.fit}${t != null ? `, ${top.commute?.estimate ? "≈" : ""}${mins(t)} by transit` : ""}).`,
          nList ? `${nList} live listing${nList === 1 ? "" : "s"}.` : "No live listings found yet.",
        ].join(" ");
        const chips: Chip[] = [];
        if (bestListing(ranked)) chips.push({ label: "Research best listing", action: "research_best", primary: true });
        chips.push({ label: "Watch these areas", action: "watch", primary: !chips.length });
        chips.push({ label: "Open move file", action: "open_file" });
        push({ id: uid(), role: "bot", kind: "text", text, chips });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchRun(id, (st) => {
        const stages = { ...st.stages };
        const act = STAGES.find((k) => stages[k] === "active");
        if (act) stages[act] = "failed";
        return { ...st, stages, finished: true, failed: true, error: message, endedAt: Date.now() };
      });
      push({ id: uid(), role: "bot", kind: "text", text: `The search stopped: ${message}`, tone: "error", chips: [{ label: "Try again", action: "retry", payload: q, primary: true }] });
    } finally {
      setBusy(false);
    }
  };

  // ---- deep research on one listing
  // ---- user-added criteria (any question; Exa Places or Exa search, cited), merged into the run
  const [asking, setAsking] = useState<{ question: string; error?: string } | undefined>();
  const rescore = (r: RunState, list: Area[]): Area[] => {
    if (!r.intent) return list;
    const w = weights(r.intent);
    return rankAreas(list.map((a) => ({ ...a, fit: fitScore(a.criteria, w), why: whyLines(a.criteria, w) })));
  };
  const addCriterion = async (question: string, weight: number) => {
    const id = currentRun;
    const r = id ? runsRef.current[id] : undefined;
    const list = r ? (r.ranked ?? r.areas) : [];
    if (!r || !id || !list.length) return;
    setAsking({ question });
    try {
      const res = await fetch("/api/move/criterion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, areas: list.map((a) => ({ id: a.id, name: a.name, municipality: a.municipality, center: a.center })) }),
      });
      const j = (await res.json()) as AskResult & { error?: string };
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
      const c = j.criterion;
      patchRun(id, (cur) => {
        const intent = cur.intent ? { ...cur.intent, customPlaces: [...(cur.intent.customPlaces ?? []).filter((x) => x.id !== c.id), { id: c.id, what: c.what, label: c.label, weight, kind: c.kind }] } : cur.intent;
        const merge = (a: Area): Area => {
          const got = j.results[a.id];
          if (!got) return a;
          return { ...a, criteria: [...a.criteria.filter((x) => x.id !== c.id), got.criterion], places: [...a.places.filter((p) => p.criterion !== c.id), ...got.places] };
        };
        const next = { ...cur, intent };
        const areas = cur.areas.map(merge);
        const ranked = cur.ranked ? rescore(next, cur.ranked.map(merge)) : undefined;
        return { ...next, areas, ranked };
      });
      setAsking(undefined);
    } catch (e) {
      setAsking({ question, error: (e as Error).message });
    }
  };
  const removeCriterion = (cid: CriterionId) => {
    const id = currentRun;
    if (!id) return;
    patchRun(id, (cur) => {
      const intent = cur.intent ? { ...cur.intent, customPlaces: (cur.intent.customPlaces ?? []).filter((x) => x.id !== cid) } : cur.intent;
      const strip = (a: Area): Area => ({ ...a, criteria: a.criteria.filter((x) => x.id !== cid), places: a.places.filter((p) => p.criterion !== cid) });
      const next = { ...cur, intent };
      return { ...next, areas: cur.areas.map(strip), ranked: cur.ranked ? rescore(next, cur.ranked.map(strip)) : undefined };
    });
  };

  const runResearch = async (l: Listing) => {
    const cur = researchRef.current[l.url];
    if (cur?.running || cur?.research) return;
    const intent = run?.intent;
    if (!intent) return;
    setResearch((p) => ({ ...p, [l.url]: { running: true, steps: [], findings: [] } }));
    const upd = (fn: (st: ResearchState) => ResearchState) => setResearch((p) => (p[l.url] ? { ...p, [l.url]: fn(p[l.url]) } : p));
    try {
      const res = await fetch("/api/move/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listing: l, intent }) });
      if (!res.ok || !res.body) throw new Error(await errText(res));
      let done = false;
      for await (const e of ndjson<ResearchEvent>(res)) {
        if (e.type === "step") upd((st) => ({ ...st, steps: [...st.steps, { label: e.label, detail: e.detail }] }));
        else if (e.type === "finding") upd((st) => ({ ...st, findings: [...st.findings, e] }));
        else if (e.type === "error") upd((st) => ({ ...st, error: e.message }));
        else if (e.type === "done") {
          done = true;
          upd((st) => ({ ...st, research: e.research, running: false }));
        }
      }
      if (!done) upd((st) => ({ ...st, running: false, error: st.error ?? "The research ended before it finished." }));
    } catch (err) {
      upd((st) => ({ ...st, running: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ---- viewing request draft
  const runDraft = async (l: Listing) => {
    const intent = run?.intent;
    if (!intent || drafts[l.url]?.loading) return;
    setDrafts((p) => ({ ...p, [l.url]: { loading: true, lang: p[l.url]?.lang ?? "fi" } }));
    try {
      const res = await fetch("/api/move/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listing: l, intent, research: researchRef.current[l.url]?.research }) });
      if (!res.ok) throw new Error(await errText(res));
      const draft = (await res.json()) as ViewingDraft;
      if (!draft || typeof draft.subject !== "string") throw new Error("The draft came back empty.");
      setDrafts((p) => ({ ...p, [l.url]: { loading: false, draft, lang: p[l.url]?.lang ?? "fi" } }));
    } catch (err) {
      setDrafts((p) => ({ ...p, [l.url]: { loading: false, error: err instanceof Error ? err.message : String(err), lang: p[l.url]?.lang ?? "fi" } }));
    }
  };

  // ---- watch: an Exa Monitor over the top areas, polled for new listings
  const startWatch = async () => {
    const intent = run?.intent;
    const ranked = run?.ranked ?? [];
    if (!intent || !ranked.length || watch?.loading) return;
    const ids = ranked.slice(0, 5).map((a) => a.id);
    setWatch({ loading: true });
    try {
      const res = await fetch("/api/move/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, areas: ids }) });
      if (!res.ok) throw new Error(await errText(res));
      const result = (await res.json()) as WatchResult;
      if (!result?.id) throw new Error("No monitor id came back.");
      setWatch({ loading: false, result });
      push({ id: uid(), role: "bot", kind: "text", text: `Watching ${result.areas.length} area${result.areas.length === 1 ? "" : "s"} for new listings${result.mode === "live" ? " (live monitor)" : " (checked periodically)"}. They will appear in the move file.` });
    } catch (err) {
      setWatch({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
  const watchId = watch?.result?.id;
  useEffect(() => {
    if (!watchId) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/move/watch?id=${encodeURIComponent(watchId)}`);
        if (!res.ok) throw new Error(await errText(res));
        const j = (await res.json()) as WatchRuns;
        const runs: WatchRuns = { id: j?.id ?? watchId, runs: j?.runs ?? 0, latest: j?.latest ?? null, items: Array.isArray(j?.items) ? j.items : [], skipped: j?.skipped ?? 0 };
        if (!stop) setWatch((w) => (w && w.result?.id === watchId ? { ...w, runs, checkedAt: Date.now(), pollError: undefined } : w));
      } catch (err) {
        if (!stop) setWatch((w) => (w && w.result?.id === watchId ? { ...w, checkedAt: Date.now(), pollError: err instanceof Error ? err.message : String(err) } : w));
      }
    };
    void poll();
    const t = setInterval(poll, 45_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [watchId]);

  const openView = (v?: View) => {
    setView(v);
    if (v && isMobile()) setSheet(true);
  };

  const onChip = (msgId: string, c: Chip) => {
    if (c.action === "retry") {
      void search(c.payload ?? "");
      return;
    }
    if (c.action === "open_file") {
      setSheet(true);
      return;
    }
    setMsgs((prev) => prev.map((m) => (m.id === msgId && m.role === "bot" && m.kind === "text" ? { ...m, chips: m.chips?.filter((x) => x.action !== c.action) } : m)));
    if (c.action === "research_best") {
      const best = bestListing(run?.ranked ?? []);
      if (!best) return;
      openView({ kind: "listing", url: best.listing.url, from: best.area.id, focus: "research", n: Date.now() });
      void runResearch(best.listing);
    } else if (c.action === "watch") {
      void startWatch();
      if (isMobile()) setSheet(true);
    }
  };

  const newSearch = () => {
    if (busy) return;
    msgsRef.current = [WELCOME];
    setMsgsState(msgsRef.current);
    runsRef.current = {};
    setRunsState({});
    setCurrentRun(undefined);
    setView(undefined);
    setResearch({});
    setDrafts({});
    setWatch(undefined);
    setSheet(false);
  };

  const lastChips = [...msgs].reverse().find((m) => m.role === "bot" && m.kind === "text" && m.chips?.length && !m.chipsUsed)?.id;
  const nListings = areas.reduce((n, a) => n + a.listings.length, 0);

  function body(m: Msg) {
    if (m.role === "user")
      return (
        <div className={s.user}>
          <span className={s.text}>{m.text}</span>
        </div>
      );
    if (m.kind === "welcome")
      return (
        <div className={s.welcome}>
          <h1 className={s.welcomeLead}>Where should you live for your new job?</h1>
          <p className={s.welcomeSub}>Say where you will work and what matters. You get areas ranked by commute and daily life, live listings, and every fact cited.</p>
          <div className={s.suggest}>
            {PROMPTS.map((p, i) => (
              <button key={p} type="button" className={`${s.suggestRow} ${i === 0 ? s.suggestPrimary : ""}`} onClick={() => search(p)} disabled={busy}>
                <span className={s.suggestLabel}>{p}</span>
                <CaretRight weight="bold" className={s.suggestCaret} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      );
    if (m.kind === "run") {
      const r = runs[m.runId];
      return r ? <MoveProgress run={r} /> : null;
    }
    return (
      <div className={`${s.bot} ${m.tone === "error" ? s.error : m.tone === "note" ? s.note : ""}`}>
        {m.tone === "error" && <WarningCircle weight="fill" className={s.toneIcon} aria-hidden />}
        <span className={s.text}>{m.text}</span>
      </div>
    );
  }

  return (
    <div className={`${s.stage} ${folded ? s.stageFolded : ""}`}>
      <main className={s.phone} aria-label="Chat">
        <button
          type="button"
          className={s.rail}
          onClick={() => {
            setChatPeek(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="Show the chat"
          title="Show the chat"
          tabIndex={folded ? 0 : -1}
          aria-hidden={!folded}
        >
          <strong>Muutto</strong>
          <span className={s.railChat}>
            <ChatCircleText weight="bold" aria-hidden />
            <span>Chat</span>
          </span>
        </button>
        <header className={s.header}>
          <div className={s.who}>
            <strong>Muutto</strong>
            <small>{busy ? "Working on it…" : "Where to live, Helsinki region"}</small>
          </div>
          <button type="button" className={`${s.headBtn} ${s.caseBtn}`} onClick={() => setSheet(true)} aria-label="Open move file">
            <span>Move file</span>
            {areas.length > 0 && <b className={s.caseCount}>{areas.length}</b>}
          </button>
          {drawerOpen && chatPeek && (
            <button type="button" className={`${s.headBtn} ${s.iconOnly} ${s.foldBtn}`} onClick={() => setChatPeek(false)} title="Fold the chat" aria-label="Fold the chat">
              <CaretLeft weight="bold" />
            </button>
          )}
          <button type="button" className={`${s.headBtn} ${s.iconOnly}`} onClick={newSearch} disabled={busy} title="New search" aria-label="New search">
            <NotePencil weight="bold" />
          </button>
        </header>
        {run && (
          <button type="button" className={s.caseStrip} onClick={() => setSheet(true)}>
            <span>
              {!run.finished ? `Measuring ${run.areas.length}${run.candidates.length ? ` of ${run.candidates.length}` : ""} areas` : [`${areas.length} areas`, `${nListings} listings`, watch?.result ? `watching ${watch.result.areas.length}` : ""].filter(Boolean).join(" · ")}
            </span>
            <em>Open move file</em>
          </button>
        )}

        <div className={s.scroll} ref={scroller} role="log" aria-live="polite">
          {msgs.map((m, i) => {
            if (m.role === "bot" && m.kind === "welcome" && msgs.some((x) => x.role === "user")) return null;
            const prev = msgs[i - 1];
            const chips = m.role === "bot" && m.kind === "text" && m.chips?.length && !m.chipsUsed && m.id === lastChips ? m.chips : undefined;
            return (
              <div key={m.id} className={`${s.row} ${m.role === "user" ? s.rowUser : s.rowBot} ${prev && prev.role !== m.role ? s.gap : ""}`}>
                <div className={s.col}>
                  {body(m)}
                  {chips && (
                    <div className={s.chips}>
                      {chips.map((c) => (
                        <button key={c.label} type="button" className={`${s.chip} ${c.primary ? s.chipPrimary : ""} ${c.action === "open_file" ? s.mobileOnly : ""}`} onClick={() => onChip(m.id, c)} disabled={busy && c.action !== "open_file"}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void search(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="Workplace, budget, what matters…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void search(input);
              }
            }}
            aria-label="Message"
          />
          <button type="submit" className={s.sendBtn} disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <CircleNotch className={s.spin} /> : <ArrowUp weight="bold" />}
          </button>
        </form>
      </main>

      <section className={`${s.casePane} ${sheet ? s.sheetOpen : ""}`} aria-label="Move file">
        <div className={s.sheetBar}>
          <span className={s.grip} aria-hidden />
          <strong>Move file</strong>
          <button type="button" className={s.headBtn} onClick={() => setSheet(false)} aria-label="Close move file">
            <X weight="bold" />
          </button>
        </div>
        <MoveFile
          run={run}
          view={view}
          research={research}
          drafts={drafts}
          watch={watch}
          onView={openView}
          onResearch={(l) => void runResearch(l)}
          onDraft={(l) => void runDraft(l)}
          onDraftLang={(url, lang) => setDrafts((p) => (p[url] ? { ...p, [url]: { ...p[url], lang } } : p))}
          onDraftOpened={(url) => setDrafts((p) => (p[url] ? { ...p, [url]: { ...p[url], opened: true } } : p))}
          onWatch={() => void startWatch()}
          onPrompt={(t) => void search(t)}
          asking={asking}
          onAddCriterion={(q, w) => void addCriterion(q, w)}
          onRemoveCriterion={removeCriterion}
        />
      </section>
      {sheet && <button type="button" className={s.sheetScrim} onClick={() => setSheet(false)} aria-label="Close move file" />}
    </div>
  );
}
