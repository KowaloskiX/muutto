"use client";

// The subcontractor search while it runs: a fixed four-stage pipeline, one "now" line, and a chip
// per company being checked. Once finished it folds to one quiet line ("Searched 45 · checked 4 · 38 s").
import { useState } from "react";
import { CaretDown, Check, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { t, type Key } from "./i18n";
import type { SearchStageId, SearchState } from "./types";
import s from "./Search.module.css";

const PIPELINE: { id: SearchStageId; label: Key; tag?: string }[] = [
  { id: "understand", label: "sUnderstand" },
  { id: "find", label: "sFind", tag: "Exa" },
  { id: "verify", label: "sVerify", tag: "YTJ · PRH" },
  { id: "rank", label: "sRank" },
];

export function SearchCard({ st, lang }: { st: SearchState; lang?: string }) {
  const [open, setOpen] = useState(false);
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);
  const checked = st.companies.filter((c) => c.status !== "scanning").length;
  const done = PIPELINE.filter((p) => st.stages[p.id] === "done").length;
  const active = PIPELINE.find((p) => st.stages[p.id] === "active");

  const substep = (id: SearchStageId): string | undefined => {
    if (id === "understand") return st.scope;
    if (id === "find") return st.found != null ? tr("sFound", { n: st.found }) : undefined;
    if (id === "verify") return st.companies.length ? tr("sChecked", { done: checked, n: st.companies.length }) : undefined;
    return st.ranked != null ? tr("sRanked", { n: st.ranked }) : undefined;
  };

  const notes = st.notes.length > 0 && (
    <ul className={s.notes}>
      {st.notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );

  if (st.finished && !open) {
    const secs = st.endedAt ? Math.max(1, Math.round((st.endedAt - st.startedAt) / 1000)) : undefined;
    // "Searched 45 · checked 4 · 38 s" when the search got that far; otherwise just how it ended.
    const line = !st.failed && st.found != null && secs != null ? tr("sSummary", { found: st.found, n: checked, secs }) : tr(st.failed ? "sStopped" : "sComplete");
    return (
      <div className={s.wrap}>
        <button type="button" className={s.summary} onClick={() => setOpen(true)} aria-expanded={false} title={tr("sShow")}>
          {st.failed ? <WarningCircle weight="fill" className={s.sumBad} aria-hidden /> : <Check weight="bold" className={s.sumOk} aria-hidden />}
          <span>{line}</span>
          <CaretDown weight="bold" className={s.caret} aria-hidden />
        </button>
        {notes}
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <section className={s.card} aria-label={tr("sTitle")}>
        <header className={s.head}>
          <small>{tr("sTitle")}</small>
          <span className={s.count}>
            {done}/{PIPELINE.length}
          </span>
          {st.finished && (
            <button type="button" className={s.fold} onClick={() => setOpen(false)} aria-expanded title={tr("sHide")} aria-label={tr("sHide")}>
              <CaretDown weight="bold" aria-hidden />
            </button>
          )}
        </header>
        {!st.finished && (
          <p className={s.now} aria-live="polite">
            <i aria-hidden />
            <span>{active ? tr(active.label) : tr("sPreparing")}</span>
          </p>
        )}
        <ol className={s.stages}>
          {PIPELINE.map((p) => {
            const status = st.stages[p.id];
            const sub = substep(p.id);
            return (
              <li key={p.id} className={s[status]}>
                <span className={s.icon} aria-hidden>
                  {status === "done" ? <Check weight="bold" /> : status === "active" ? <CircleNotch className={s.spin} /> : status === "failed" ? <WarningCircle weight="fill" /> : <i />}
                </span>
                <div className={s.body}>
                  <div className={s.label}>
                    <span>{tr(p.label)}</span>
                    {p.tag && status === "active" && <em>{p.tag}</em>}
                  </div>
                  {sub && status !== "pending" && <span className={s.sub}>{sub}</span>}
                  {p.id === "verify" && st.companies.length > 0 && status !== "pending" && (
                    <ul className={s.chips}>
                      {st.companies.map((c) => {
                        const state = c.status === "scanning" ? "scanning" : c.status === "failed" ? "failed" : c.verdict ?? "grey";
                        return (
                          <li key={c.key} className={`${s.chip} ${s[`c_${state}`]}`} title={c.name}>
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
