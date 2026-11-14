"use client";

import { useEffect } from "react";
import { ArrowSquareOut, Bell, ChatCircleText, CheckCircle, FileArrowDown, Globe, MapPin, PaperPlaneTilt, Question, Warning, X, XCircle } from "@phosphor-icons/react";
import type { Check, Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import { keyFinding } from "@/components/chat/Bubbles";
import { compliance, fmtKm, hostOf, isDoc, isTv, verdict, VERDICT_LABEL, type Cand } from "./model";
import s from "./Case.module.css";

export function Dot({ status }: { status: Status }) {
  const Icon = status === "green" ? CheckCircle : status === "red" ? XCircle : status === "yellow" ? Warning : Question;
  return <Icon weight="fill" className={`${s.dot} ${s[`c_${status}`]}`} />;
}

const ORDER: Status[] = ["red", "yellow", "green", "grey"];
const byStatus = (a: Check, b: Check) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
const clean = (q: string, n = 180) => {
  const t = q.replace(/[#*|`>]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t;
};
const SRC_LABEL: Record<string, string> = { registry: "Register", site: "Their site", web: "Web" };

function Evidence({ check }: { check: Check }) {
  const ev = check.evidence.filter((e) => e.url && /^https?:/i.test(e.url));
  if (!ev.length) return check.action ? null : <span className={s.noSrc}>{check.status === "grey" ? "not confirmed from public data" : "Kilpi's own check"}</span>;
  const first = ev.find((e) => e.quote && e.quote.trim().length > 12);
  return (
    <>
      {first?.quote && (
        <a className={s.quote} href={withTextFragment(first.url, first.quote)} target="_blank" rel="noopener noreferrer" title="Opens the page at this sentence">
          “{clean(first.quote)}”
        </a>
      )}
      <span className={s.srcs}>
        {ev.slice(0, 4).map((e, i) => (
          <a key={`${e.url}-${i}`} className={s.src} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.via ?? e.url}>
            <small>{SRC_LABEL[e.source] ?? "Source"}</small> {hostOf(e.url)}
            {e.asOf && <small> · as of {e.asOf}</small>}
            <ArrowSquareOut weight="bold" />
          </a>
        ))}
      </span>
    </>
  );
}

function CheckRow({ c }: { c: Check }) {
  return (
    <li className={s.check}>
      <Dot status={c.status} />
      <div>
        <p>
          <b>{c.label.replace(/^Tilaajavastuu:\s*(\S)/i, (_, ch: string) => ch.toUpperCase())}.</b> {c.detail}
          {c.law && <small className={s.law}> · {c.law}</small>}
        </p>
        <Evidence check={c} />
        {c.action && (
          <span className={s.srcs}>
            <a className={`${s.src} ${s.actionLink}`} href={c.action.url} target="_blank" rel="noopener noreferrer">
              Check yourself: {c.action.label} <ArrowSquareOut weight="bold" />
            </a>
          </span>
        )}
      </div>
    </li>
  );
}

function DocRow({ c }: { c: Check }) {
  return (
    <li className={s.check}>
      <FileArrowDown weight="fill" className={`${s.dot} ${s.c_req}`} />
      <div>
        <p>
          <b>{c.document?.en ?? c.label}</b>
          {c.document?.fi && <small className={s.fi}> · {c.document.fi}</small>}
        </p>
        {c.detail && <p className={s.why}>{c.detail}</p>}
        <span className={s.srcs}>
          {c.law && <span className={s.lawTag}>{c.law}</span>}
          {c.action && (
            <a className={s.src} href={c.action.url} target="_blank" rel="noopener noreferrer">
              {c.action.label} <ArrowSquareOut weight="bold" />
            </a>
          )}
          {c.evidence
            .filter((e) => e.url && /^https?:/i.test(e.url))
            .slice(0, 1)
            .map((e) => (
              <a key={e.url} className={s.src} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.quote}>
                <small>Why</small> {hostOf(e.url)} <ArrowSquareOut weight="bold" />
              </a>
            ))}
        </span>
      </div>
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
  const key = keyFinding({ place: cand.place, report: r, why: cand.why, fit: cand.fit ?? 0 });
  const tv = r.checks.filter(isTv);
  const verified = tv.filter((c) => !isDoc(c)).sort(byStatus);
  const docs = tv.filter(isDoc);
  // A document named in `documents` without a matching check still has to be requested.
  const extraDocs = (r.documents ?? []).filter((d) => !docs.some((c) => c.document?.en === d.en || c.id === d.id));
  const capability = r.checks.filter((c) => c.group === "capability").sort(byStatus);
  const other = r.checks.filter((c) => !c.group).sort(byStatus);
  const prof = r.profile;
  const addr = r.registry?.addresses?.[0] ?? cand.place.address;

  return (
    <div className={s.drawerWrap} role="dialog" aria-modal="true" aria-label={`${cand.name}: all checks`}>
      <button type="button" className={s.scrim} onClick={onClose} aria-label="Close" />
      <aside className={s.drawer}>
        <header className={s.dHead}>
          <span className={`${s.badge} ${s[`b_${v}`]}`}>{cand.rank ?? "✓"}</span>
          <div className={s.dTitle}>
            <h3>{cand.name}</h3>
            <small>
              {[r.businessId && `Y-tunnus ${r.businessId}`, r.registry?.mainBusinessLine, r.registry?.registrationDate && `registered ${r.registry.registrationDate}`].filter(Boolean).join(" · ")}
            </small>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close"><X weight="bold" /></button>
        </header>

        <div className={s.dBody}>
          <div className={s.dMeta}>
            <span className={`${s.verdict} ${s[`v_${v}`]}`}><Dot status={v} /> {VERDICT_LABEL[v]}</span>
            {cand.fit != null && <span className={s.pill}>fit {cand.fit}/100</span>}
            {distance != null && <span className={s.pill}><MapPin weight="fill" /> {fmtKm(distance)} from site</span>}
            {cand.site && (
              <a className={s.pill} href={cand.site} target="_blank" rel="noopener noreferrer"><Globe weight="bold" /> {hostOf(cand.site)}</a>
            )}
          </div>
          {addr && <p className={s.addr}>{addr}</p>}

          {prof && (prof.employees || prof.revenue || prof.foundedYear) ? (
            <div className={s.profile}>
              {prof.employees ? <div><b>{prof.employees}</b><small>employees</small></div> : null}
              {prof.revenue ? <div><b>{prof.revenue >= 1e6 ? `${(prof.revenue / 1e6).toFixed(1)} M` : prof.revenue.toLocaleString("fi-FI")}</b><small>revenue</small></div> : null}
              {prof.foundedYear ? <div><b>{prof.foundedYear}</b><small>founded</small></div> : null}
              {prof.source && (
                <a href={prof.source} target="_blank" rel="noopener noreferrer" className={s.profSrc}>Exa company index <ArrowSquareOut weight="bold" /></a>
              )}
            </div>
          ) : null}

          {key && (
            <div className={`${s.keyBox} ${s[`kf_${key.status}`]}`}>
              <small>{key.label}</small>
              <p>{key.text}</p>
              {key.quote && <q>{key.quote}</q>}
            </div>
          )}

          {comp && (
            <div className={s.compBig}>
              <span className={s.bar} aria-hidden>
                <i style={{ width: `${comp.total ? (100 * comp.verified) / comp.total : 0}%` }} />
              </span>
              <span>
                <b>{comp.verified}</b> of {comp.total} {comp.b2b ? "tilaajavastuu items verified" : "checks clear"}
                {comp.docs > 0 && <> · <b>{comp.docs}</b> to request</>}
              </span>
            </div>
          )}

          {tv.length > 0 && (
            <>
              <h4 className={s.group}><CheckCircle weight="fill" /> Verified: public registers and Exa</h4>
              <ul className={s.checks}>{verified.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
              {(docs.length > 0 || extraDocs.length > 0) && (
                <>
                  <h4 className={`${s.group} ${s.groupReq}`}><FileArrowDown weight="fill" /> Request from the company</h4>
                  <p className={s.groupNote}>Registers can&apos;t show these. Before signing, collect them (none older than 3 months).</p>
                  <ul className={s.checks}>
                    {docs.map((c) => <DocRow key={c.id} c={c} />)}
                    {extraDocs.map((d) => <DocRow key={d.id} c={{ id: d.id, label: d.en, status: "grey", detail: "", evidence: [], needsDocument: true, document: { fi: d.fi, en: d.en }, law: d.law }} />)}
                  </ul>
                </>
              )}
            </>
          )}

          {capability.length > 0 && (
            <>
              <h4 className={s.group}><Globe weight="fill" /> What registers can&apos;t show: references, licences, capacity</h4>
              <ul className={s.checks}>{capability.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            </>
          )}

          {other.length > 0 && (
            <>
              <h4 className={s.group}><Question weight="fill" /> {tv.length || capability.length ? "Other checks" : "All checks"}</h4>
              <ul className={s.checks}>{other.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            </>
          )}
        </div>

        <footer className={s.dFoot}>
          <button type="button" className={s.primary} onClick={onDraft} disabled={busy}><PaperPlaneTilt weight="fill" /> Draft RFQ + document request</button>
          <button type="button" className={s.ghostBtn} onClick={onWatch} disabled={busy || watching}><Bell weight="fill" /> {watching ? "Watching" : "Watch"}</button>
          <button type="button" className={s.ghostBtn} onClick={onAsk} disabled={busy}><ChatCircleText weight="fill" /> Ask</button>
        </footer>
      </aside>
    </div>
  );
}
