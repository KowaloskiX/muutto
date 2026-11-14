"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bell, ChatCircleText, Check, Minus, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import type { Check as CheckT, Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import { findingOf, firstSentence, fmtKm, hostOf, isDoc, isTv, publicRegisters, regName, verdict, VERDICT_LABEL, type Cand } from "./model";
import s from "./Case.module.css";

const GLYPH = { green: Check, yellow: WarningCircle, red: XCircle, grey: Minus } as const;
const GLYPH_WORD: Record<Status, string> = { green: "clear", yellow: "clarify", red: "failed", grey: "no data" };

/** Register status as a bare glyph: check, exclamation, cross, dash. Colour only here and on verdict words. */
export function Glyph({ status }: { status: Status }) {
  const Icon = GLYPH[status];
  return (
    <span className={`${s.glyph} ${s[`g_${status}`]}`} role="img" aria-label={GLYPH_WORD[status]}>
      <Icon weight={status === "yellow" || status === "red" ? "fill" : "bold"} aria-hidden />
    </span>
  );
}

/** The verdict as a coloured word. */
export function VerdictWord({ v }: { v: Status }) {
  return <span className={`${s.verdict} ${s[`t_${v}`]}`}>{VERDICT_LABEL[v]}</span>;
}

const ORDER: Status[] = ["red", "yellow", "green", "grey"];
const byStatus = (a: CheckT, b: CheckT) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
const clean = (q: string, n = 180) => {
  const t = q.replace(/[#*|`>]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t;
};
const STATUS_WORD: Record<Status, string> = { green: "Clear", yellow: "Clarify", red: "Failed", grey: "No data" };
const statusWord = (c: CheckT) => (c.status === "grey" && c.action ? "Check manually" : STATUS_WORD[c.status]);
const shortLabel = (l: string) => l.replace(/^Tilaajavastuu:\s*(\S)/i, (_, ch: string) => ch.toUpperCase());
const webEv = (c: CheckT) => c.evidence.filter((e) => e.url && /^https?:/i.test(e.url));
const fiDate = (iso: string) => iso.split("-").reverse().join(".");

type Ev = { url: string; quote?: string; via?: string; asOf?: string };
function SourceLinks({ ev }: { ev: Ev[] }) {
  if (!ev.length) return null;
  const seen = new Set<string>();
  const uniq = ev.filter((e) => !seen.has(hostOf(e.url)) && !!seen.add(hostOf(e.url)));
  return (
    <span className={s.srcs}>
      {uniq.slice(0, 3).map((e, i) => (
        <a key={`${e.url}-${i}`} className={s.src} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.via ?? e.url}>
          {hostOf(e.url)}
          {e.asOf && `, ${fiDate(e.asOf)}`}
          <ArrowUpRight weight="bold" aria-hidden />
        </a>
      ))}
    </span>
  );
}

/** Everything behind one check: the full detail, the law, the quote, the sources, the manual re-check. */
function CheckDetail({ c }: { c: CheckT }) {
  const ev = webEv(c);
  const quote = ev.find((e) => e.quote && e.quote.trim().length > 12);
  return (
    <div className={s.detail}>
      <p>{c.detail}</p>
      {quote?.quote && (
        <a className={s.quote} href={withTextFragment(quote.url, quote.quote)} target="_blank" rel="noopener noreferrer" title="Opens the page at this sentence">
          “{clean(quote.quote)}”
        </a>
      )}
      {c.law && <p className={s.law}>{c.law}</p>}
      <span className={s.detailLinks}>
        <SourceLinks ev={ev} />
        {!ev.length && !c.action && <span className={s.noSrc}>{c.status === "grey" ? "Not confirmed from public data" : "Kilpi's own check"}</span>}
        {c.action && (
          <a className={s.src} href={c.action.url} target="_blank" rel="noopener noreferrer">
            {c.action.label}
            <ArrowUpRight weight="bold" aria-hidden />
          </a>
        )}
      </span>
    </div>
  );
}

/** One list line: glyph, title, short status or summary, source right-aligned; expands in place. */
function CheckLine({ c, title, summary, showSource, focus }: { c: CheckT; title: string; summary: string; showSource?: boolean; focus?: number }) {
  const [open, setOpen] = useState(!!focus);
  const ref = useRef<HTMLLIElement>(null);
  const ev = webEv(c);
  const first = ev[0];
  // Opened from a matrix cell: expand this check and bring it into view.
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" }));
  }, [focus]);
  return (
    <li ref={ref} className={`${s.line} ${open ? s.lineOpen : ""} ${focus ? s.lineFocus : ""}`}>
      <div className={s.lineHead}>
        <button type="button" className={s.lineBtn} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <Glyph status={c.status} />
          <span className={s.lineTitle}>{title}</span>
          <span className={s.lineSum}>{summary}</span>
        </button>
        {showSource && first && (
          <a className={s.lineSrc} href={withTextFragment(first.url, first.quote)} target="_blank" rel="noopener noreferrer" title={first.via ?? first.url}>
            {hostOf(first.url)}
          </a>
        )}
      </div>
      {open && <CheckDetail c={c} />}
    </li>
  );
}

function DocLine({ name, fi, law, action }: { name: string; fi?: string; law?: string; action?: { label: string; url: string } }) {
  return (
    <li className={s.doc}>
      <span className={s.box} aria-hidden />
      <span className={s.docText}>
        <span className={s.docName}>{name}</span>
        {fi && (
          <span className={s.docFi} title={fi}>
            {fi}
          </span>
        )}
      </span>
      {law && <span className={s.docLaw}>{law.replace(/^1233\/2006\s*/, "")}</span>}
      {action && (
        <a className={s.lineSrc} href={action.url} target="_blank" rel="noopener noreferrer" title={action.label}>
          {hostOf(action.url)}
        </a>
      )}
    </li>
  );
}

function checkedAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

export function CandidateDrawer({
  cand,
  focus,
  distance,
  busy,
  watching,
  onClose,
  onDraft,
  onWatch,
  onAsk,
}: {
  cand: Cand;
  /** The check to open and scroll to (from a clicked matrix cell). */
  focus?: { id: string; n: number };
  distance?: number;
  busy: boolean;
  watching: boolean;
  onClose: () => void;
  onDraft: () => void;
  onWatch: () => void;
  onAsk: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const r = cand.report;
  if (!r) return null;
  const v = verdict(cand);
  const key = findingOf(cand);
  const regs = publicRegisters(r);
  const clear = regs.filter((c) => c.status === "green").length;
  const docs = r.checks.filter((c) => isTv(c) && isDoc(c));
  // A document named in `documents` without a matching check still has to be requested.
  const extraDocs = (r.documents ?? []).filter((d) => !docs.some((c) => c.document?.en === d.en || c.id === d.id));
  const capability = r.checks.filter((c) => c.group === "capability").sort(byStatus);
  const other = r.checks.filter((c) => !c.group).sort(byStatus);
  const regSummary = (c: CheckT) => {
    const asOf = webEv(c).find((e) => e.asOf)?.asOf;
    return asOf ? `${statusWord(c)}, ${fiDate(asOf)}` : statusWord(c);
  };

  return (
    <aside className={s.drawerWrap} role="dialog" aria-label={`${cand.name}: all checks`}>
      <button type="button" className={s.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div className={s.drawer}>
        <header className={s.dHead}>
          <button type="button" className={s.back} onClick={onClose} aria-label="Back to the list">
            <ArrowLeft weight="bold" aria-hidden /> List
          </button>
          <div className={s.dTitle}>
            <VerdictWord v={v} />
            <h2>{cand.name}</h2>
            <p className={s.dMeta}>
              {[r.businessId, distance != null ? fmtKm(distance) : "", cand.fit != null ? `fit ${cand.fit}` : ""].filter(Boolean).join(" · ")}
              {cand.site && (
                <>
                  {" · "}
                  <a href={cand.site} target="_blank" rel="noopener noreferrer">
                    {hostOf(cand.site)}
                  </a>
                </>
              )}
              {/* Honest freshness: cached reports are real earlier checks, say how old they are. */}
              {" · "}
              <span className={s.nowrap}>checked {r.cachedAt ? checkedAgo(r.cachedAt) : "just now"}</span>
            </p>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </header>

        <div className={s.dBody}>
          {key && (
            <section className={s.finding} aria-label="Key finding">
              <p className={s.findingText}>{key.text}</p>
              {key.quote && <q className={s.findingQuote}>{key.quote}</q>}
              <SourceLinks ev={key.sources} />
            </section>
          )}

          {regs.length > 0 && (
            <section className={s.dSection}>
              <h3>
                Registers
                <span>
                  {clear} of {regs.length} clear
                </span>
              </h3>
              <ul className={s.lines}>
                {regs.map((c) => (
                  <CheckLine key={c.id} c={c} title={regName(c)} summary={regSummary(c)} showSource focus={focus?.id === c.id ? focus.n : undefined} />
                ))}
              </ul>
              {r.registrySource && (
                <p className={s.footnote}>
                  Live PRH register unreachable; facts from {r.registrySource.site.replace(/\s*\(.*\)\s*$/, "")}
                  {r.registrySource.asOf ? ` copy of ${fiDate(r.registrySource.asOf)}` : ""}.{" "}
                  <a href={r.registrySource.url} target="_blank" rel="noopener noreferrer">
                    Open copy
                  </a>
                  {r.businessId && (
                    <>
                      {", "}
                      <a href={`https://tietopalvelu.ytj.fi/yritys/${r.businessId}`} target="_blank" rel="noopener noreferrer">
                        re-check in YTJ
                      </a>
                    </>
                  )}
                </p>
              )}
            </section>
          )}

          {(docs.length > 0 || extraDocs.length > 0) && (
            <section className={s.dSection}>
              <h3>
                Documents to request<span>{docs.length + extraDocs.length}</span>
              </h3>
              <ul className={s.lines}>
                {docs.map((c) => (
                  <DocLine key={c.id} name={c.document?.en ?? shortLabel(c.label)} fi={c.document?.fi} law={c.law} action={c.action} />
                ))}
                {extraDocs.map((d) => (
                  <DocLine key={d.id} name={d.en} fi={d.fi} law={d.law} />
                ))}
              </ul>
            </section>
          )}

          {capability.length > 0 && (
            <section className={s.dSection}>
              <h3>Capability</h3>
              <ul className={s.lines}>
                {capability.map((c) => (
                  <CheckLine key={c.id} c={c} title={shortLabel(c.label)} summary={firstSentence(c.detail)} />
                ))}
              </ul>
            </section>
          )}

          {other.length > 0 && (
            <section className={s.dSection}>
              <h3>{regs.length || capability.length ? "Other checks" : "Checks"}</h3>
              <ul className={s.lines}>
                {other.map((c) => (
                  <CheckLine key={c.id} c={c} title={shortLabel(c.label)} summary={firstSentence(c.detail)} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className={s.dFoot}>
          <button type="button" className={s.primary} onClick={onDraft} disabled={busy}>
            Draft RFQ and documents
          </button>
          <button type="button" className={s.quiet} onClick={onWatch} disabled={busy || watching}>
            <Bell weight="bold" aria-hidden /> {watching ? "Watching" : "Watch"}
          </button>
          <button type="button" className={s.quiet} onClick={onAsk} disabled={busy} aria-label="Ask about this company">
            <ChatCircleText weight="bold" aria-hidden /> Ask
          </button>
        </footer>
      </div>
    </aside>
  );
}
