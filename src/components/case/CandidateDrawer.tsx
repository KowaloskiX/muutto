"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  Bell,
  CaretRight,
  ChatCircleText,
  CheckCircle,
  Circle,
  Info,
  MinusCircle,
  Question,
  Warning,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import type { Check, Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import { findingOf, firstSentence, fmtKm, hostOf, isDoc, isTv, publicRegisters, regName, verdict, VERDICT_LABEL, type Cand } from "./model";
import s from "./Case.module.css";

export function Dot({ status }: { status: Status }) {
  const Icon = status === "green" ? CheckCircle : status === "red" ? XCircle : status === "yellow" ? Warning : Question;
  return <Icon weight="fill" className={`${s.dot} ${s[`c_${status}`]}`} aria-hidden />;
}

/** Register status as an SF-Symbols-like circle: check, exclamation, cross, dash. */
export function StatusIcon({ status, className = "" }: { status: Status; className?: string }) {
  const Icon = status === "green" ? CheckCircle : status === "red" ? XCircle : status === "yellow" ? WarningCircle : MinusCircle;
  return <Icon weight="fill" className={`${s.sIcon} ${s[`c_${status}`]} ${className}`} aria-hidden />;
}

/** Verdict as a small soft pill: icon + label, so color never carries it alone. */
export function VerdictBadge({ v }: { v: Status }) {
  return (
    <span className={`${s.badge} ${s[`b_${v}`]}`}>
      <Dot status={v} /> {VERDICT_LABEL[v]}
    </span>
  );
}

const ORDER: Status[] = ["red", "yellow", "green", "grey"];
const byStatus = (a: Check, b: Check) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
const clean = (q: string, n = 180) => {
  const t = q.replace(/[#*|`>]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t;
};
const SRC_LABEL: Record<string, string> = { registry: "Register", site: "Their site", web: "Web" };
const STATUS_WORD: Record<Status, string> = { green: "Clear", yellow: "Clarify", red: "Failed", grey: "No data" };
const statusWord = (c: Check) => (c.status === "grey" && c.action ? "Check" : STATUS_WORD[c.status]);
const shortLabel = (l: string) => l.replace(/^Tilaajavastuu:\s*(\S)/i, (_, ch: string) => ch.toUpperCase());
const webEv = (c: Check) => c.evidence.filter((e) => e.url && /^https?:/i.test(e.url));

function SourceLinks({ ev }: { ev: { url: string; quote?: string; source?: string; via?: string; asOf?: string }[] }) {
  if (!ev.length) return null;
  return (
    <span className={s.srcs}>
      {ev.slice(0, 3).map((e, i) => (
        <a key={`${e.url}-${i}`} className={s.src} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.via ?? e.url}>
          {e.source && SRC_LABEL[e.source] ? `${SRC_LABEL[e.source]} · ` : ""}
          {hostOf(e.url)}
          {e.asOf && ` · ${e.asOf}`}
          <ArrowSquareOut weight="bold" aria-hidden />
        </a>
      ))}
    </span>
  );
}

/** Everything behind one check: the full detail, the law, the quote, the sources, the manual re-check. */
function CheckDetail({ c }: { c: Check }) {
  const ev = webEv(c);
  const quote = ev.find((e) => e.quote && e.quote.trim().length > 12);
  return (
    <div className={s.detail}>
      <p>{c.detail}</p>
      {c.law && <p className={s.law}>{c.law}</p>}
      {quote?.quote && (
        <a className={s.quote} href={withTextFragment(quote.url, quote.quote)} target="_blank" rel="noopener noreferrer" title="Opens the page at this sentence">
          “{clean(quote.quote)}”
        </a>
      )}
      <SourceLinks ev={ev} />
      {!ev.length && !c.action && <span className={s.noSrc}>{c.status === "grey" ? "Not confirmed from public data" : "Kilpi's own check"}</span>}
      {c.action && (
        <a className={s.textLink} href={c.action.url} target="_blank" rel="noopener noreferrer">
          {c.action.label} <ArrowSquareOut weight="bold" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** Inset grouped list row: icon, title, one-line summary, chevron; expands in place. */
function CheckRow({ c }: { c: Check }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={s.gRow}>
      <button type="button" className={s.gHead} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <StatusIcon status={c.status} />
        <span className={s.gText}>
          <b>{shortLabel(c.label)}</b>
          {!open && <small>{firstSentence(c.detail)}</small>}
        </span>
        <span className={`${s.gWord} ${s[`t_${c.status}`]}`}>{statusWord(c)}</span>
        <CaretRight weight="bold" className={`${s.chev} ${open ? s.chevOpen : ""}`} aria-hidden />
      </button>
      {open && <CheckDetail c={c} />}
    </li>
  );
}

function DocRow({ c }: { c: Check }) {
  return (
    <li className={s.docRow}>
      <Circle weight="regular" className={s.docIcon} aria-hidden />
      <span className={s.docName}>
        <b>{c.document?.en ?? shortLabel(c.label)}</b>
        {c.document?.fi && <small>{c.document.fi}</small>}
      </span>
      {c.law && <span className={s.docLaw}>{c.law.replace(/^1233\/2006\s*/, "")}</span>}
      {c.action && (
        <a className={s.docAction} href={c.action.url} target="_blank" rel="noopener noreferrer" title={c.action.label} aria-label={c.action.label}>
          <ArrowSquareOut weight="bold" />
        </a>
      )}
    </li>
  );
}

function checkedAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

export function CandidateDrawer({
  cand,
  distance,
  busy,
  watching,
  onClose,
  onDraft,
  onWatch,
  onAsk,
}: {
  cand: Cand;
  distance?: number;
  busy: boolean;
  watching: boolean;
  onClose: () => void;
  onDraft: () => void;
  onWatch: () => void;
  onAsk: () => void;
}) {
  const [tile, setTile] = useState<string | undefined>();
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
  const openTile = regs.find((c) => c.id === tile);
  const docs = r.checks.filter((c) => isTv(c) && isDoc(c));
  // A document named in `documents` without a matching check still has to be requested.
  const extraDocs = (r.documents ?? []).filter((d) => !docs.some((c) => c.document?.en === d.en || c.id === d.id));
  const capability = r.checks.filter((c) => c.group === "capability").sort(byStatus);
  const other = r.checks.filter((c) => !c.group).sort(byStatus);
  const prof = r.profile;
  const chips = [
    r.businessId && { k: "Y-tunnus", v: r.businessId },
    distance != null && { k: "From site", v: fmtKm(distance) },
    prof?.employees && { k: "Staff", v: String(prof.employees) },
    prof?.foundedYear && { k: "Founded", v: String(prof.foundedYear) },
    cand.fit != null && { k: "Fit", v: `${cand.fit}/100` },
  ].filter((x): x is { k: string; v: string } => !!x);
  const keyEv = key?.sources ?? [];

  return (
    <aside className={s.drawerWrap} role="dialog" aria-label={`${cand.name}: all checks`}>
      <button type="button" className={s.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div className={s.drawer}>
        <header className={s.dHead}>
          <div className={s.dTitle}>
            <VerdictBadge v={v} />
            <h2>{cand.name}</h2>
            {r.registry?.mainBusinessLine && <p className={s.dSub}>{r.registry.mainBusinessLine}</p>}
            <div className={s.factChips}>
              {chips.map((c) => (
                <span key={c.k} className={s.factChip}>
                  <small>{c.k}</small>
                  {c.v}
                </span>
              ))}
              {cand.site && (
                <a className={`${s.factChip} ${s.factLink}`} href={cand.site} target="_blank" rel="noopener noreferrer">
                  {hostOf(cand.site)} <ArrowSquareOut weight="bold" aria-hidden />
                </a>
              )}
            </div>
            {/* Honest freshness: cached reports are real earlier checks, say how old they are. */}
            <p className={s.checkedAt}>Checked {r.cachedAt ? checkedAgo(r.cachedAt) : "just now"}</p>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Back to the list">
            <X weight="bold" className={s.closeX} />
            <span className={s.closeBack}>
              <ArrowLeft weight="bold" /> List
            </span>
          </button>
        </header>

        <div className={s.dBody}>
          {key && (
            <section className={`${s.callout} ${s[`k_${key.status}`]}`} aria-label="Key finding">
              <p className={s.calloutHead}>
                <StatusIcon status={key.status} />
                <span>Key finding</span>
              </p>
              <p className={s.calloutText}>{key.text}</p>
              {key.quote && <q className={s.keyQuote}>{key.quote}</q>}
              <SourceLinks ev={keyEv} />
            </section>
          )}

          {regs.length > 0 && (
            <section className={s.dSection}>
              <h3>
                Compliance at a glance
                <small>
                  {clear} of {regs.length} clear
                </small>
              </h3>
              <div className={s.tiles} role="list">
                {regs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    className={`${s.tile} ${tile === c.id ? s.tileOn : ""}`}
                    onClick={() => setTile((t) => (t === c.id ? undefined : c.id))}
                    aria-expanded={tile === c.id}
                    title={shortLabel(c.label)}
                  >
                    <StatusIcon status={c.status} className={s.tileIcon} />
                    <b>{regName(c)}</b>
                    <small className={s[`t_${c.status}`]}>{statusWord(c)}</small>
                  </button>
                ))}
              </div>
              {openTile ? (
                <div className={s.tileDetail}>
                  <p className={s.tileDetailHead}>
                    <StatusIcon status={openTile.status} />
                    <b>{shortLabel(openTile.label)}</b>
                  </p>
                  <CheckDetail c={openTile} />
                </div>
              ) : (
                <p className={s.hintLine}>Tap a register to see what it says and where.</p>
              )}
              {r.registrySource && (
                <p className={s.footnote}>
                  <Info weight="bold" aria-hidden />
                  <span>
                    Live trade register (PRH) unreachable: register facts from {r.registrySource.site}
                    {r.registrySource.asOf ? ` (copy ${r.registrySource.asOf.split("-").reverse().join(".")})` : ""}.{" "}
                    <a href={r.registrySource.url} target="_blank" rel="noopener noreferrer">Open copy</a>
                    {r.businessId && (
                      <>
                        {" · "}
                        <a href={`https://tietopalvelu.ytj.fi/yritys/${r.businessId}`} target="_blank" rel="noopener noreferrer">Re-check in YTJ</a>
                      </>
                    )}
                  </span>
                </p>
              )}
            </section>
          )}

          {(docs.length > 0 || extraDocs.length > 0) && (
            <section className={s.dSection}>
              <h3>
                Documents to request<small>{docs.length + extraDocs.length}</small>
              </h3>
              <ul className={s.group}>
                {docs.map((c) => <DocRow key={c.id} c={c} />)}
                {extraDocs.map((d) => <DocRow key={d.id} c={{ id: d.id, label: d.en, status: "grey", detail: "", evidence: [], needsDocument: true, document: { fi: d.fi, en: d.en }, law: d.law }} />)}
              </ul>
              <p className={s.hintLine}>Registers can&apos;t show these. Collect them before signing, none older than 3 months.</p>
            </section>
          )}

          {capability.length > 0 && (
            <section className={s.dSection}>
              <h3>Capability</h3>
              <ul className={s.group}>{capability.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
              <p className={s.hintLine}>What registers can&apos;t show: references, licences, capacity.</p>
            </section>
          )}

          {other.length > 0 && (
            <section className={s.dSection}>
              <h3>{regs.length || capability.length ? "Other checks" : "All checks"}</h3>
              <ul className={s.group}>{other.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            </section>
          )}
        </div>

        <footer className={s.dFoot}>
          <button type="button" className={s.primary} onClick={onDraft} disabled={busy}>
            Draft RFQ + documents
          </button>
          <button type="button" className={s.ghostBtn} onClick={onWatch} disabled={busy || watching}>
            <Bell weight="bold" /> {watching ? "Watching" : "Watch"}
          </button>
          <button type="button" className={s.ghostBtn} onClick={onAsk} disabled={busy} aria-label="Ask about this company">
            <ChatCircleText weight="bold" /> <span className={s.btnText}>Ask</span>
          </button>
        </footer>
      </div>
    </aside>
  );
}
