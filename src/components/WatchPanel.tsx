"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Bell, ClockCounterClockwise, SpinnerGap, Trash } from "@phosphor-icons/react";
import s from "./WatchPanel.module.css";

type Item = {
  date?: string;
  title: string;
  url: string;
  snippet?: string;
  signal: "insolvency" | "complaint" | "news";
  sent: boolean;
  why?: string;
};
type RunSummary = {
  runs: number;
  completed: number;
  latest: { id: string; status: string; at?: string; failReason?: string | null } | null;
  sent: number;
  dropped: number;
  items: Item[];
  webhooks?: number;
};
type Backtest = {
  query: string;
  window: { start: string; end: string; days: number };
  runs: number;
  runsWithAlerts: number;
  sent: number;
  dropped: number;
  items: Item[];
  agentBacktest?: { id?: string; status?: string; error?: string } | null;
};
type AgentResult = { id: string; status: string; data?: { name: string; contents: Record<string, unknown> }[] };

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" }) : "–");
const SIGNAL_LABEL = { insolvency: "Insolvency", complaint: "Complaint", news: "News" } as const;

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["value", "text", "content", "summary"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return JSON.stringify(v);
}
function cellCitations(v: unknown): { url: string; title?: string }[] {
  const c = (v as { citations?: unknown })?.citations;
  return Array.isArray(c) ? (c as { url: string; title?: string }[]).filter((x) => x?.url) : [];
}

function Counters({ runs, sent, dropped, runsLabel = "runs" }: { runs: number; sent: number; dropped: number; runsLabel?: string }) {
  return (
    <div className={s.counters}>
      <div><b>{runs}</b><span>{runsLabel}</span></div>
      <div className={s.sent}><b>{sent}</b><span>sent to agent</span></div>
      <div className={s.dropped}><b>{dropped}</b><span>dropped</span></div>
    </div>
  );
}

function ItemList({ items, showDropped }: { items: Item[]; showDropped: boolean }) {
  const shown = items.filter((i) => showDropped || i.sent);
  if (!shown.length) return <p className={s.empty}>Nothing about this company in the window.</p>;
  return (
    <ul className={s.items}>
      {shown.map((i) => (
        <li key={i.url} className={i.sent ? undefined : s.isDropped}>
          <time>{fmt(i.date)}</time>
          <div className={s.body}>
            <a href={i.url} target="_blank" rel="noreferrer">
              {i.title} <ArrowSquareOut size={12} />
            </a>
            {i.snippet && i.sent && <p>{i.snippet}</p>}
            {!i.sent && i.why && <p className={s.why}>dropped: {i.why}</p>}
          </div>
          <span className={`${s.tag} ${s[i.signal]}`}>{SIGNAL_LABEL[i.signal]}</span>
        </li>
      ))}
    </ul>
  );
}

export default function WatchPanel({ name, domain }: { name: string; domain?: string }) {
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "on" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary | null>(null);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [days, setDays] = useState(30);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [showDropped, setShowDropped] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ name, ...(domain ? { domain } : {}), ...extra }).toString();

  // ---- live monitor ----
  async function watch() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setMonitorId(j.id);
      setMode(j.webhook);
      setState("on");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  async function unwatch() {
    if (!monitorId) return;
    await fetch(`/api/watch?id=${encodeURIComponent(monitorId)}`, { method: "DELETE" }).catch(() => null);
    setMonitorId(null);
    setRuns(null);
    setState("idle");
  }

  const pollRuns = useCallback(async () => {
    if (!monitorId) return;
    const res = await fetch(`/api/watch?id=${encodeURIComponent(monitorId)}&${qs({})}`).catch(() => null);
    if (res?.ok && alive.current) setRuns(await res.json());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorId, name, domain]);

  useEffect(() => {
    if (!monitorId) return;
    pollRuns();
    const t = setInterval(pollRuns, runs?.latest?.status === "completed" ? 30000 : 4000);
    return () => clearInterval(t);
  }, [monitorId, pollRuns, runs?.latest?.status]);

  // ---- backtest ----
  async function backtest(d = days) {
    setBtBusy(true);
    setAgent(null);
    setError(null);
    try {
      const res = await fetch(`/api/watch?${qs({ backtest: "1", days: String(d), agent: "1" })}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setBt(j);
      if (j.agentBacktest?.id) pollAgent(j.agentBacktest.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBtBusy(false);
    }
  }

  async function pollAgent(id: string) {
    for (let i = 0; i < 40 && alive.current; i++) {
      const res = await fetch(`/api/watch?backtestId=${encodeURIComponent(id)}`).catch(() => null);
      const j: AgentResult | null = res?.ok ? await res.json() : null;
      if (j) setAgent(j);
      if (!j || j.status !== "running") return;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  const agentCells = (agent?.data ?? []).flatMap((e) => Object.entries(e.contents ?? {}));

  return (
    <section className={s.panel} aria-label={`Exa watcher for ${name}`}>
      <header className={s.head}>
        <div>
          <span className={s.kicker}>Exa Monitor</span>
          <h3>{name}</h3>
          <span className={s.sub}>Daily search: bankruptcy, restructuring, complaints, news</span>
        </div>
        {state === "on" ? (
          <button type="button" className={s.ghost} onClick={unwatch} title="Delete the Exa monitor">
            <Trash /> Stop
          </button>
        ) : (
          <button type="button" className={s.primary} onClick={watch} disabled={state === "busy"}>
            {state === "busy" ? <SpinnerGap className={s.spin} /> : <Bell weight="bold" />}
            {state === "error" ? "Retry watch" : "Watch"}
          </button>
        )}
      </header>

      {error && <p className={s.error}>{error}</p>}

      {state === "on" && (
        <div className={s.block}>
          <div className={s.status}>
            <span className={s.dot} data-live={runs?.latest?.status === "completed" ? "1" : "0"} />
            Watching daily · {mode === "live" ? "signed webhooks" : "polling (no public webhook URL)"}
            {runs?.latest && <> · last run {runs.latest.status}{runs.latest.at ? ` ${fmt(runs.latest.at)}` : ""}</>}
          </div>
          {runs && (
            <>
              <Counters runs={runs.runs} sent={runs.sent} dropped={runs.dropped} />
              <ItemList items={runs.items} showDropped={showDropped} />
            </>
          )}
        </div>
      )}

      <div className={s.block}>
        <div className={s.btHead}>
          <button type="button" className={s.ghost} onClick={() => backtest()} disabled={btBusy}>
            {btBusy ? <SpinnerGap className={s.spin} /> : <ClockCounterClockwise />}
            {bt ? "Re-run" : "Show last 30 days"}
          </button>
          <div className={s.seg} role="group" aria-label="Backtest window">
            {[30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => {
                  setDays(d);
                  if (bt) backtest(d);
                }}
              >
                {d === 365 ? "1 y" : `${d} d`}
              </button>
            ))}
          </div>
        </div>

        {bt && (
          <>
            <p className={s.caption}>
              What the watcher would have caught {fmt(bt.window.start)} – {fmt(bt.window.end)}: {bt.runs} simulated daily runs,{" "}
              {bt.runsWithAlerts} with an alert.
            </p>
            <Counters runs={bt.runs} sent={bt.sent} dropped={bt.dropped} />
            <ItemList items={bt.items} showDropped={showDropped} />
            {bt.dropped > 0 && (
              <button type="button" className={s.link} onClick={() => setShowDropped((v) => !v)}>
                {showDropped ? "Hide" : "Show"} {bt.dropped} dropped results
              </button>
            )}
            {bt.agentBacktest && (
              <div className={s.agent}>
                <span className={s.kicker}>Agent Monitors backtest · last 13 days</span>
                {bt.agentBacktest.error ? (
                  <p className={s.why}>unavailable: {bt.agentBacktest.error}</p>
                ) : !agent || agent.status === "running" ? (
                  <p className={s.why}><SpinnerGap className={s.spin} /> researching…</p>
                ) : agentCells.length ? (
                  <ul className={s.items}>
                    {agentCells.map(([field, v]) => (
                      <li key={field}>
                        <time>{field}</time>
                        <div className={s.body}>
                          <p>{cellText(v)}</p>
                          {cellCitations(v).map((c) => (
                            <a key={c.url} href={c.url} target="_blank" rel="noreferrer">
                              {c.title ?? c.url} <ArrowSquareOut size={12} />
                            </a>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.empty}>No changes found ({agent.status}).</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
