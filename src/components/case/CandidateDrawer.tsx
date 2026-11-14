"use client";

import { useEffect } from "react";
import { ArrowSquareOut, Bell, ChatCircleText, CheckCircle, Question, Warning, X, XCircle } from "@phosphor-icons/react";
import type { Check, Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import { compliance, findingOf, fmtKm, hostOf, isDoc, isTv, verdict, VERDICT_LABEL, type Cand } from "./model";
import s from "./Case.module.css";

export function Dot({ status }: { status: Status }) {
  const Icon = status === "green" ? CheckCircle : status === "red" ? XCircle : status === "yellow" ? Warning : Question;
  return <Icon weight="fill" className={`${s.dot} ${s[`c_${status}`]}`} aria-hidden />;
}

/** Verdict as a small soft badge: icon + label, so color never carries it alone. */
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
const STATUS_WORD: Record<Status, string> = { green: "Verified", yellow: "Clarify", red: "Failed", grey: "No data" };
const shortLabel = (l: string) => l.replace(/^Tilaajavastuu:\s*(\S)/i, (_, ch: string) => ch.toUpperCase());

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

function CheckRow({ c }: { c: Check }) {
  const ev = c.evidence.filter((e) => e.url && /^https?:/i.test(e.url));
  const quote = ev.find((e) => e.quote && e.quote.trim().length > 12);
  return (
    <li className={s.check}>
      <Dot status={c.status} />
      <div>
        <p className={s.checkHead}>
          <b>{shortLabel(c.label)}</b>
          <small className={s[`c_${c.status}`]}>{c.action && c.status === "grey" ? "Check yourself" : STATUS_WORD[c.status]}</small>
        </p>
        <p>
          {c.detail}
          {c.law && <span className={s.law}> · {c.law}</span>}
        </p>
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
    </li>
  );
}

function DocRow({ c }: { c: Check }) {
  const why = c.evidence.find((e) => e.url && /^https?:/i.test(e.url));
  return (
    <li className={s.doc}>
      <p>
        <b>{c.document?.en ?? c.label}</b>
        {c.document?.fi && <span className={s.fi}> · {c.document.fi}</span>}
      </p>
      {(c.law || c.action || why) && (
        <p className={s.docMeta}>
          {c.law && <span>{c.law}</span>}
          {c.action && (
            <a className={s.textLink} href={c.action.url} target="_blank" rel="noopener noreferrer">
              {c.action.label} <ArrowSquareOut weight="bold" aria-hidden />
            </a>
          )}
          {why && (
            <a className={s.src} href={withTextFragment(why.url, why.quote)} target="_blank" rel="noopener noreferrer" title={why.quote}>
              {hostOf(why.url)} <ArrowSquareOut weight="bold" aria-hidden />
            </a>
          )}
        </p>
      )}
    </li>
  );
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
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const r = cand.report;
  if (!r) return null;
  const v = verdict(cand);
  const comp = compliance(r);
  const key = findingOf(cand);
  const tv = r.checks.filter(isTv);
  const verified = tv.filter((c) => !isDoc(c)).sort(byStatus);
  const docs = tv.filter(isDoc);
  // A document named in `documents` without a matching check still has to be requested.
  const extraDocs = (r.documents ?? []).filter((d) => !docs.some((c) => c.document?.en === d.en || c.id === d.id));
  const capability = r.checks.filter((c) => c.group === "capability").sort(byStatus);
  const other = r.checks.filter((c) => !c.group).sort(byStatus);
  const prof = r.profile;
  const meta = [
    r.businessId && `Y-tunnus ${r.businessId}`,
    cand.fit != null && `fit ${cand.fit}/100`,
    distance != null && `${fmtKm(distance)} from site`,
    prof?.employees && `${prof.employees} staff`,
    prof?.foundedYear && `founded ${prof.foundedYear}`,
  ].filter(Boolean);
  const keyEv = key?.sources ?? [];

  return (
    <aside className={s.drawerWrap} role="dialog" aria-label={`${cand.name}: all checks`}>
      <button type="button" className={s.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div className={s.drawer}>
        <header className={s.dHead}>
          <div className={s.dTitle}>
            <VerdictBadge v={v} />
            <h2>{cand.name}</h2>
            <p>
              {meta.join(" · ")}
              {cand.site && (
                <>
                  {" · "}
                  <a href={cand.site} target="_blank" rel="noopener noreferrer">
                    {hostOf(cand.site)}
                  </a>
                </>
              )}
            </p>
            {r.registry?.mainBusinessLine && <p>{r.registry.mainBusinessLine}</p>}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </header>

        <div className={s.dBody}>
          {key && (
            <section className={s.dSection}>
              <h3>Key finding</h3>
              <p className={s.keyText}>
                <Dot status={key.status} /> <span>{key.text}</span>
              </p>
              {key.quote && <q className={s.keyQuote}>{key.quote}</q>}
              <SourceLinks ev={keyEv} />
            </section>
          )}

          {tv.length > 0 && (
            <section className={s.dSection}>
              <h3>
                Registers verified
                {comp && (
                  <small>
                    {comp.verified} of {comp.total}
                  </small>
                )}
              </h3>
              <ul className={s.checks}>{verified.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            </section>
          )}

          {(docs.length > 0 || extraDocs.length > 0) && (
            <section className={s.dSection}>
              <h3>
                Documents to request<small>{docs.length + extraDocs.length}</small>
              </h3>
              <p className={s.note}>Registers can&apos;t show these. Collect them before signing, none older than 3 months.</p>
              <ul className={s.docs}>
                {docs.map((c) => <DocRow key={c.id} c={c} />)}
                {extraDocs.map((d) => <DocRow key={d.id} c={{ id: d.id, label: d.en, status: "grey", detail: "", evidence: [], needsDocument: true, document: { fi: d.fi, en: d.en }, law: d.law }} />)}
              </ul>
            </section>
          )}

          {capability.length > 0 && (
            <section className={s.dSection}>
              <h3>Capability</h3>
              <p className={s.note}>What registers can&apos;t show: references, licences, capacity.</p>
              <ul className={s.checks}>{capability.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            </section>
          )}

          {other.length > 0 && (
            <section className={s.dSection}>
              <h3>{tv.length || capability.length ? "Other checks" : "All checks"}</h3>
              <ul className={s.checks}>{other.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
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
