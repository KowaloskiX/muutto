"use client";

import { useEffect, useRef, useState } from "react";
import { JUMP_HINT, withTextFragment } from "@/lib/textFragment";
import type { AgentCompany, Criterion, CriterionResult, MoreRun } from "@/lib/exa-agent";

type Props = { job: string; city: string; exclude: { name: string; website?: string }[] };

const CHIP_LABEL: Record<CriterionResult["status"], string> = { met: "Met", not_met: "Not met", unknown: "Unknown" };

function hostOf(url?: string) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return url ?? "";
  }
}

function Cell({ r }: { r?: CriterionResult }) {
  const [open, setOpen] = useState(false);
  const st = r?.status ?? "unknown";
  const hasEvidence = !!(r?.evidence || r?.sourceUrl);
  return (
    <div onMouseEnter={() => hasEvidence && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`kp-chip-st ${st}`} style={{ cursor: hasEvidence ? "pointer" : "default" }} onClick={() => hasEvidence && setOpen((o) => !o)} title={r?.evidence ?? undefined} aria-expanded={hasEvidence ? open : undefined}>
        {CHIP_LABEL[st]}
        {hasEvidence ? " ⓘ" : ""}
      </button>
      {open && hasEvidence && (
        <div className="kp-matrix-pop">
          {r?.evidence && <div style={{ fontStyle: "italic" }}>{r.evidence}</div>}
          {r?.sourceUrl && (
            <a href={withTextFragment(r.sourceUrl, r.evidence)} target="_blank" rel="noreferrer" title={r.evidence ? JUMP_HINT : undefined}>
              {hostOf(r.sourceUrl)}{r.evidence ? " · jump to quote ↗" : ""}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function score(c: AgentCompany) {
  return c.criteria.reduce((n, r) => n + (r.status === "met" ? 2 : r.status === "unknown" ? 0 : -1), 0);
}

export default function CriteriaMatrix({ job, city, exclude }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [run, setRun] = useState<MoreRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const busy = !!runId && !run?.terminal && !error;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/more?id=${encodeURIComponent(runId!)}`, { cache: "no-store" });
        const data = await res.json();
        if (!alive.current) return;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setRun(data as MoreRun);
        if (!(data as MoreRun).terminal) timer = setTimeout(poll, 4000);
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
    };
    timer = setTimeout(poll, 3000);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [busy, runId]);

  async function start() {
    setError(null);
    setRun(null);
    setCriteria([]);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const res = await fetch("/api/more", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, city, exclude }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCriteria(data.criteria);
      setRunId(data.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const elapsed = startedAt ? Math.round(((run?.terminal && run.completedAt ? Date.parse(run.completedAt) : now) - startedAt) / 1000) : 0;
  const companies = [...(run?.companies ?? [])].sort((a, b) => score(b) - score(a));

  return (
    <section className="kp-matrix" aria-label="Find more contractors with Exa Agent">
      <div className="kp-matrix-head">
        <div>
          <span className="kp-matrix-kicker">Exa Agent</span>
          <h3>More contractors, checked against your criteria</h3>
        </div>
        <button type="button" className="kp-matrix-btn" disabled={busy || !job.trim()} onClick={start}>
          {busy ? "Exa Agent researching…" : run?.terminal ? "Run Exa Agent again" : "Find more contractors"}
        </button>
      </div>
      {runId && (
          <div className="kp-matrix-muted" aria-live="polite">
            {run?.status ?? "queued"} · {elapsed}s
            {run?.costDollars != null ? ` · $${run.costDollars.toFixed(3)}` : ""}
            {run?.stopReason ? ` · ${run.stopReason}` : ""}
          </div>
      )}
      {!runId && !error && <div className="kp-matrix-muted">Asynchronous research run (~1 min): finds companies not listed above and checks each against {city ? `job + ${city}` : "the job"} criteria, with evidence.</div>}
      {error && <div className="kp-matrix-error" role="alert">Exa Agent error: {error}</div>}
      {run?.terminal && run.status !== "completed" && <div className="kp-matrix-error" role="alert">Run {run.status}{run.error ? `: ${run.error}` : ""}</div>}
      {run?.status === "completed" && companies.length === 0 && <div className="kp-matrix-muted">No additional companies found.</div>}

      {companies.length > 0 && (
        <div className="kp-matrix-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                {criteria.map((c) => (
                  <th key={c.key} title={c.description}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => (
                <tr key={`${co.website ?? co.name}-${i}`}>
                  <td>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{co.name}</div>
                    {co.website && (
                      <a href={co.website} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        {hostOf(co.website)}
                      </a>
                    )}
                    <div className="kp-matrix-sub">
                      {co.phone && <a href={`tel:${co.phone.replace(/\s/g, "")}`}>{co.phone}</a>}
                      {co.email && <a href={`mailto:${co.email}`}>{co.email}</a>}
                    </div>
                    {co.city && <div className="kp-matrix-sub">{co.city}</div>}
                  </td>
                  {criteria.map((c) => (
                    <td key={c.key}>
                      <Cell r={co.criteria.find((r) => r.criterionKey === c.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
