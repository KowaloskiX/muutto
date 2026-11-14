"use client";

import { useEffect, useRef, useState } from "react";
import { JUMP_HINT, withTextFragment } from "@/lib/textFragment";
import type { AgentCompany, Criterion, CriterionResult, MoreRun } from "@/lib/exa-agent";

type Props = { job: string; city: string; exclude: { name: string; website?: string }[] };

const CHIP: Record<CriterionResult["status"], { bg: string; fg: string; label: string }> = {
  met: { bg: "#dcfce7", fg: "#166534", label: "Met" },
  not_met: { bg: "#fee2e2", fg: "#991b1b", label: "Not met" },
  unknown: { bg: "#f1f5f9", fg: "#475569", label: "Unknown" },
};

const s = {
  wrap: { marginTop: 24, fontFamily: "inherit", color: "inherit" } as React.CSSProperties,
  btn: { padding: "10px 16px", borderRadius: 8, border: "1px solid #0f172a", background: "#0f172a", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 } as React.CSSProperties,
  muted: { color: "#64748b", fontSize: 13 } as React.CSSProperties,
  tableWrap: { overflowX: "auto", marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 10 } as React.CSSProperties,
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 640 } as React.CSSProperties,
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontWeight: 600, verticalAlign: "bottom" } as React.CSSProperties,
  td: { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" } as React.CSSProperties,
  chip: { display: "inline-block", padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" } as React.CSSProperties,
  pop: { marginTop: 6, padding: 8, borderRadius: 6, background: "#fff", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.08)", maxWidth: 260, fontSize: 12, lineHeight: 1.4, color: "#0f172a" } as React.CSSProperties,
};

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
  const c = CHIP[st];
  const hasEvidence = !!(r?.evidence || r?.sourceUrl);
  return (
    <div onMouseEnter={() => hasEvidence && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" style={{ ...s.chip, background: c.bg, color: c.fg, cursor: hasEvidence ? "pointer" : "default" }} onClick={() => hasEvidence && setOpen((o) => !o)} title={r?.evidence ?? undefined}>
        {c.label}
        {hasEvidence ? " ⓘ" : ""}
      </button>
      {open && hasEvidence && (
        <div style={s.pop}>
          {r?.evidence && <div style={{ fontStyle: "italic" }}>{r.evidence}</div>}
          {r?.sourceUrl && (
            <a href={withTextFragment(r.sourceUrl, r.evidence)} target="_blank" rel="noreferrer" title={r.evidence ? JUMP_HINT : undefined} style={{ color: "#2563eb", wordBreak: "break-all" }}>
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
    <section style={s.wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={{ ...s.btn, opacity: busy ? 0.6 : 1 }} disabled={busy || !job.trim()} onClick={start}>
          {busy ? "Exa Agent researching…" : run?.terminal ? "Run Exa Agent again" : "Find more contractors (Exa Agent)"}
        </button>
        {runId && (
          <span style={s.muted}>
            {run?.status ?? "queued"} · {elapsed}s
            {run?.costDollars != null ? ` · $${run.costDollars.toFixed(3)}` : ""}
            {run?.stopReason ? ` · ${run.stopReason}` : ""}
          </span>
        )}
      </div>
      {!runId && !error && <div style={{ ...s.muted, marginTop: 6 }}>Asynchronous research run (~1 min): finds companies not listed above and checks each against {city ? `job + ${city}` : "the job"} criteria, with evidence.</div>}
      {error && <div style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>Exa Agent error: {error}</div>}
      {run?.terminal && run.status !== "completed" && <div style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>Run {run.status}{run.error ? `: ${run.error}` : ""}</div>}
      {run?.status === "completed" && companies.length === 0 && <div style={{ ...s.muted, marginTop: 8 }}>No additional companies found.</div>}

      {companies.length > 0 && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Company</th>
                {criteria.map((c) => (
                  <th key={c.key} style={s.th} title={c.description}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => (
                <tr key={`${co.website ?? co.name}-${i}`}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600 }}>{co.name}</div>
                    {co.website && (
                      <a href={co.website} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontSize: 12 }}>
                        {hostOf(co.website)}
                      </a>
                    )}
                    <div style={{ ...s.muted, fontSize: 12 }}>
                      {co.phone && <a href={`tel:${co.phone.replace(/\s/g, "")}`} style={{ color: "inherit", marginRight: 8 }}>{co.phone}</a>}
                      {co.email && <a href={`mailto:${co.email}`} style={{ color: "inherit" }}>{co.email}</a>}
                    </div>
                    {co.city && <div style={{ ...s.muted, fontSize: 12 }}>{co.city}</div>}
                  </td>
                  {criteria.map((c) => (
                    <td key={c.key} style={s.td}>
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
