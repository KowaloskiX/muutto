"use client";

// The move search while it runs: five fixed stages, a chip per area being measured. Once finished
// it folds to one quiet line ("Ranked 6 areas · 23 listings · 41 s"). Same look as the subcontractor
// search card (shares its stylesheet).
import { useState } from "react";
import { CaretDown, Check, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import s from "@/components/chat/Search.module.css";
import { fitTone } from "./model";
import type { RunState, StageId } from "./types";

const PIPELINE: { id: StageId; label: string; tag?: string }[] = [
  { id: "understand", label: "Understanding the move" },
  { id: "areas", label: "Finding areas" },
  { id: "measure", label: "Measuring", tag: "OSM · FMI · Exa" },
  { id: "listings", label: "Live listings", tag: "Exa" },
  { id: "rank", label: "Ranking" },
];

export function MoveProgress({ run }: { run: RunState }) {
  const [open, setOpen] = useState(false);
  const done = PIPELINE.filter((p) => run.stages[p.id] === "done").length;
  const active = PIPELINE.find((p) => run.stages[p.id] === "active");
  const areas = run.ranked ?? run.areas;
  const listingN = areas.reduce((n, a) => n + a.listings.length, 0);

  const substep = (id: StageId): string | undefined => {
    const d = run.details[id];
    if (id === "understand") return d ?? run.intent?.summary;
    if (id === "areas") return d ?? (run.candidates.length ? `${run.candidates.length} candidate areas` : undefined);
    if (id === "measure") return d ?? (run.candidates.length ? `${run.areas.length} of ${run.candidates.length} measured` : run.areas.length ? `${run.areas.length} measured` : undefined);
    if (id === "listings") return d ?? (listingN ? `${listingN} live listings` : undefined);
    return d ?? (run.ranked ? `${run.ranked.length} ranked` : undefined);
  };

  const notes = run.notices.length > 0 && (
    <ul className={s.notes}>
      {run.notices.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );

  if (run.finished && !open) {
    const secs = run.tookMs != null ? Math.max(1, Math.round(run.tookMs / 1000)) : run.endedAt ? Math.max(1, Math.round((run.endedAt - run.startedAt) / 1000)) : undefined;
    const line = run.failed
      ? "Search stopped"
      : [run.ranked ? `Ranked ${run.ranked.length} areas` : "Search complete", `${listingN} listing${listingN === 1 ? "" : "s"}`, secs != null ? `${secs} s` : ""].filter(Boolean).join(" · ");
    return (
      <div className={s.wrap}>
        <button type="button" className={s.summary} onClick={() => setOpen(true)} aria-expanded={false} title="Show the search steps">
          {run.failed ? <WarningCircle weight="fill" className={s.sumBad} aria-hidden /> : <Check weight="bold" className={s.sumOk} aria-hidden />}
          <span>{line}</span>
          <CaretDown weight="bold" className={s.caret} aria-hidden />
        </button>
        {notes}
      </div>
    );
  }

  const chipAreas = run.candidates.length ? run.candidates : run.areas;
  return (
    <div className={s.wrap}>
      <section className={s.card} aria-label="Area search">
        <header className={s.head}>
          <small>Area search</small>
          <span className={s.count}>
            {done}/{PIPELINE.length}
          </span>
          {run.finished && (
            <button type="button" className={s.fold} onClick={() => setOpen(false)} aria-expanded title="Hide the steps" aria-label="Hide the steps">
              <CaretDown weight="bold" aria-hidden />
            </button>
          )}
        </header>
        {!run.finished && (
          <p aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {active ? active.label : "Preparing"}
          </p>
        )}
        <ol className={s.stages}>
          {PIPELINE.map((p) => {
            const status = run.stages[p.id];
            const sub = substep(p.id);
            return (
              <li key={p.id} className={s[status]}>
                <span className={s.icon} aria-hidden>
                  {status === "done" ? <Check weight="bold" /> : status === "active" ? <CircleNotch className={s.spin} /> : status === "failed" ? <WarningCircle weight="fill" /> : <i />}
                </span>
                <div className={s.body}>
                  <div className={s.label}>
                    <span>{p.label}</span>
                    {p.tag && status === "active" && <em>{p.tag}</em>}
                  </div>
                  {sub && status !== "pending" && <span className={s.sub}>{sub}</span>}
                  {p.id === "measure" && chipAreas.length > 0 && status !== "pending" && (
                    <ul className={s.chips}>
                      {chipAreas.map((c) => {
                        const measured = run.areas.find((a) => a.id === c.id);
                        const state = measured ? fitTone(measured.fit) : run.finished ? "failed" : "scanning";
                        return (
                          <li key={c.id} className={`${s.chip} ${s[`c_${state}`]}`} title={c.name}>
                            {state === "scanning" ? <CircleNotch className={s.spin} aria-hidden /> : <i aria-hidden />}
                            <span>{c.name}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {notes}
    </div>
  );
}
