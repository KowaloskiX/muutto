"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bell, CaretDown, ChatCircleText, Check, FileText, Minus, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import type { Check as CheckT, Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import { cellOf, findingOf, firstSentence, fmtKm, hostOf, isDoc, isTv, notListedLine, publicRegisters, regName, verdict, VERDICT_LABEL, type Cand } from "./model";
import s from "./Case.module.css";
import d from "./Drawer.module.css";

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

/** The verdict as a coloured dot and a word. */
const SHORT_VERDICT: Record<Status, string> = { green: "Clear", yellow: "Clarify", red: "Red flag", grey: "Checking" };
export function VerdictWord({ v, short }: { v: Status; short?: boolean }) {
  return (
    <span className={`${s.verdict} ${s[`t_${v}`]}`} title={short ? VERDICT_LABEL[v] : undefined}>
      <i className={`${s.vDot} ${s[`d_${v}`]}`} aria-hidden />
      {short ? SHORT_VERDICT[v] : VERDICT_LABEL[v]}
    </span>
  );
}

/** The verdict as a statement of what to do next. */
const STATEMENT: Record<Status, string> = { green: "Clear to ask for a quote", yellow: "Clarify before signing", red: "Red flag: resolve before signing", grey: "Still checking" };

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
/** "(Stored copy.)" is already said by the source card; drop it from sentences. */
const tidyDetail = (t: string) => t.replace(/\s*\(Stored copy\.\)\s*/g, " ").trim();

/** Each public register's name as it appears on a Finnish register page (for the "Since" column). */
const FI_REG: Record<string, RegExp> = {
  "tv-prepayment": /ennakkoperint/i,
  "tv-employer": /työnantaj/i,
  "tv-vat": /arvonlisävero/i,
  "tv-trade-register": /kaupparekist/i,
  "tv-tax": /verovelka/i,
};
const DATED = /^(.*?)\s+(\d{1,2}\.\d{1,2}\.\d{4})$/;
/** The date a register entry starts, read from the cited "Active registers: A 03.08.2021 · B …" passage. */
function sinceOf(c: CheckT): string | undefined {
  const re = FI_REG[c.id];
  if (!re || c.status !== "green") return undefined;
  for (const e of c.evidence) {
    if (!e.quote) continue;
    for (const part of e.quote.replace(/^[^·:]{3,40}:\s+/, "").split(" · ")) {
      const m = part.trim().match(DATED);
      if (m && re.test(m[1])) return m[2];
    }
  }
  return undefined;
}

type Ev = { url: string; quote?: string; via?: string; asOf?: string };
function SourceLinks({ ev }: { ev: Ev[] }) {
  if (!ev.length) return null;
  const seen = new Set<string>();
  const uniq = ev.filter((e) => !seen.has(hostOf(e.url)) && !!seen.add(hostOf(e.url)));
  return (
    <>
      {uniq.slice(0, 3).map((e, i) => (
        <a key={`${e.url}-${i}`} className={d.link} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.via ?? e.url}>
          {hostOf(e.url)}
          {e.asOf && `, ${fiDate(e.asOf)}`}
          <ArrowUpRight weight="bold" aria-hidden />
        </a>
      ))}
    </>
  );
}

/** "Asiakastieto (register data from YTJ, …)" → "Asiakastieto"; the publisher in a few words. */
const publisher = (via?: string) => via?.split(/[;(]/)[0].trim().replace(/^exa\..*$/i, "") || undefined;

/**
 * The cited passage as a source card (as in Legora's review grid): who published it and when, the
 * passage itself (a register list becomes name | date rows), what the page does not list, and a
 * link that opens the page at the passage.
 */
function SourceCard({ e, checks = [] }: { e: Ev; checks?: CheckT[] }) {
  const passage = clean(e.quote ?? "", 600);
  if (!passage) return null;
  // "Active registers: A · B · C" reads as a heading and a list; any passage splits on " · ".
  const head = passage.match(/^([^·:]{3,40}):\s+(.*)$/);
  const lines = (head ? head[2] : passage).split(" · ").map((x) => x.trim()).filter(Boolean);
  const rows = lines.length > 1 || DATED.test(lines[0] ?? "");
  const missing = checks.map(notListedLine).filter((x): x is string => !!x);
  const who = publisher(e.via);
  const host = hostOf(e.url);
  return (
    <figure className={d.source}>
      <figcaption className={d.sHead}>
        <span className={d.favicon} aria-hidden>
          <FileText weight="bold" />
        </span>
        <span className={d.sWho}>
          <strong>{who && who.toLowerCase() !== host ? `${who} · ${host}` : host}</strong>
          <span>{[e.asOf ? `Copy of ${fiDate(e.asOf)}` : /stored copy/i.test(e.via ?? "") ? "Stored copy of the page" : "Web page", "cited passage highlighted"].join(" · ")}</span>
        </span>
      </figcaption>
      <blockquote className={d.passage}>
        {head && <p className={d.pHead}>{head[1]}</p>}
        {rows ? (
          <span className={d.pRows}>
            {lines.map((l, i) => {
              const m = l.match(DATED);
              return (
                <span key={i} className={`${d.pRow} ${d.pFound}`}>
                  <span>{m ? m[1] : l}</span>
                  {m && <span className={d.pDate}>{m[2]}</span>}
                </span>
              );
            })}
            {missing.map((x) => {
              const m = x.replace(/^Not listed:\s*/, "").match(/^(.*?)(?:\s*\((.*)\))?$/);
              return (
                <span key={x} className={`${d.pRow} ${d.pMissing}`}>
                  <span>
                    {m?.[1]} {m?.[2] && <span className={d.pEn}>({m[2]})</span>}
                  </span>
                  <span className={d.pDate}>Not listed</span>
                </span>
              );
            })}
          </span>
        ) : (
          <p className={d.pText}>{lines.join(" · ")}</p>
        )}
      </blockquote>
      <div className={d.sFoot}>
        <a className={d.pill} href={withTextFragment(e.url, e.quote)} target="_blank" rel="noopener noreferrer" title={e.via ?? e.url}>
          Open at this passage
          <ArrowUpRight weight="bold" aria-hidden />
        </a>
      </div>
    </figure>
  );
}

/** Everything behind one check: the full sentence, the cited passage (unless it is the one shown above), law, sources, re-check. */
function CheckDetail({ c, shown }: { c: CheckT; shown?: Ev }) {
  const ev = webEv(c);
  const lead = ev.find((e) => e.quote && e.quote.trim().length > 12);
  const same = !!lead && !!shown && lead.url === shown.url && lead.quote === shown.quote;
  const rest = ev.filter((e) => e !== lead || same);
  return (
    <div className={d.detail}>
      <p>{tidyDetail(c.detail)}</p>
      {lead && !same && <SourceCard e={lead} checks={[c]} />}
      {(rest.length > 0 || c.law || !ev.length) && (
        <dl className={d.kv}>
          {c.law && (
            <>
              <dt>Law</dt>
              <dd>{c.law}</dd>
            </>
          )}
          <dt>{rest.length > 1 ? "Sources" : "Source"}</dt>
          <dd>{rest.length ? <SourceLinks ev={rest} /> : c.status === "grey" ? "Not confirmed from public data" : "Kilpi's own check"}</dd>
        </dl>
      )}
      {c.action && (
        <a className={`${d.pill} ${d.recheck}`} href={c.action.url} target="_blank" rel="noopener noreferrer">
          {c.action.label}
          <ArrowUpRight weight="bold" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** Opened from a matrix cell: expand this row and bring it into view. */
function useFocus(focus?: number) {
  const [open, setOpen] = useState(!!focus);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" }));
  }, [focus]);
  return { open, setOpen, ref };
}

/** One register as a table row: name | status | since; expands to the full sentence, law and re-check link. */
function RegRow({ c, focus, shown }: { c: CheckT; focus?: number; shown?: Ev }) {
  const { open, setOpen, ref } = useFocus(focus);
  const cell = cellOf(c);
  const loud = cell.kind === "missing" || cell.kind === "clarify" ? d.rowLoud : cell.kind === "flag" ? d.rowFlag : "";
  return (
    <li ref={ref} className={`${d.row} ${loud} ${focus ? d.focus : ""}`}>
      <button type="button" className={d.rowBtn} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <span className={d.rowName}>
          <Glyph status={c.status} />
          <span>{regName(c)}</span>
        </span>
        <span className={`${d.status} ${d[`s_${cell.kind}`]}`}>{cell.word}</span>
        <span className={d.since}>{sinceOf(c) ?? ""}</span>
        <CaretDown weight="bold" className={`${d.chev} ${open ? d.chevOpen : ""}`} aria-hidden />
      </button>
      {open && <CheckDetail c={c} shown={shown} />}
    </li>
  );
}

/** One check line (capability, other): glyph, title, status word; the first sentence under it when it matters. */
function CheckLine({ c, focus }: { c: CheckT; focus?: number }) {
  const { open, setOpen, ref } = useFocus(focus);
  const note = c.status !== "green" ? firstSentence(tidyDetail(c.detail)) : "";
  return (
    <li ref={ref} className={`${d.line} ${focus ? d.focus : ""}`}>
      <button type="button" className={d.lineBtn} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <Glyph status={c.status} />
        <span className={d.lineTitle}>{shortLabel(c.label)}</span>
        <span className={`${d.word} ${d[`w_${c.status}`]}`}>{statusWord(c)}</span>
        <CaretDown weight="bold" className={`${d.chev} ${open ? d.chevOpen : ""}`} aria-hidden />
      </button>
      {note && !open && <p className={d.note}>{note}</p>}
      {open && <CheckDetail c={c} />}
    </li>
  );
}

function DocLine({ name, fi, law, action }: { name: string; fi?: string; law?: string; action?: { label: string; url: string } }) {
  return (
    <li className={d.doc}>
      <span className={d.box} aria-hidden />
      <span className={d.docText}>
        <span className={d.docName}>{name}</span>
        {fi && <span className={d.docFi}>{fi}</span>}
        {action && (
          <a className={d.link} href={action.url} target="_blank" rel="noopener noreferrer">
            {action.label}
            <ArrowUpRight weight="bold" aria-hidden />
          </a>
        )}
      </span>
      {law && <span className={d.docLaw}>{law.replace(/^1233\/2006\s*/, "")}</span>}
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
  const clear = regs.filter((c) => c.status === "green");
  const docs = r.checks.filter((c) => isTv(c) && isDoc(c));
  // A document named in `documents` without a matching check still has to be requested.
  const extraDocs = (r.documents ?? []).filter((x) => !docs.some((c) => c.document?.en === x.en || c.id === x.id));
  const capability = r.checks.filter((c) => c.group === "capability").sort(byStatus);
  const other = r.checks.filter((c) => !c.group).sort(byStatus);
  const fAt = (id: string) => (focus?.id === id ? focus.n : undefined);
  // The key finding's passage, with the date and publisher from the evidence it came from.
  const allEv: Ev[] = [...r.checks.flatMap((c) => c.evidence), ...cand.why.flatMap((w) => w.evidence)].filter((e) => e.url && /^https?:/i.test(e.url));
  const leadSrc = key?.sources.find((x) => x.quote && x.quote.trim().length > 12);
  const lead: Ev | undefined = leadSrc ? (allEv.find((e) => e.url === leadSrc.url && e.quote === leadSrc.quote) ?? leadSrc) : undefined;
  // The register checks this passage is evidence for (so the card can say what the page does not list).
  const leadChecks = key?.check
    ? [key.check]
    : lead
      ? regs.filter((c) => c.status !== "green" && c.evidence.some((e) => e.url === lead.url && e.quote === lead.quote))
      : [];
  const otherSrc = key ? key.sources.filter((x) => !lead || hostOf(x.url) !== hostOf(lead.url)) : [];
  const line = r.registry?.mainBusinessLine;
  const regDate = r.registry?.registrationDate;
  const address = r.registry?.addresses?.[0];
  const facts: [string, React.ReactNode][] = [
    ["Business ID", r.businessId],
    [
      "Website",
      cand.site ? (
        <a href={cand.site} target="_blank" rel="noopener noreferrer">
          {hostOf(cand.site)}
        </a>
      ) : undefined,
    ],
    ["Line of business", line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}` : undefined],
    ["Registered", regDate ? fiDate(regDate) : undefined],
    ["Address", address ? address.replace(/\b([A-ZÅÄÖ]{2,})\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()) : undefined],
    // Honest freshness: cached reports are real earlier checks, say how old they are.
    ["Checked", r.cachedAt ? checkedAgo(r.cachedAt) : "just now"],
  ];

  return (
    <aside className={d.wrap} role="dialog" aria-label={`${cand.name}: all checks`}>
      <button type="button" className={d.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div className={d.drawer}>
        <header className={d.head}>
          <button type="button" className={d.back} onClick={onClose} aria-label="Back to the list">
            <ArrowLeft weight="bold" aria-hidden /> List
          </button>
          <div className={d.title}>
            <h2>{cand.name}</h2>
            <p className={d.meta}>
              {cand.fit != null && (
                <span>
                  Fit <b>{cand.fit}</b>/100
                </span>
              )}
              {distance != null && (
                <span>
                  <b>{fmtKm(distance)}</b> from site
                </span>
              )}
              {r.businessId && <span>{r.businessId}</span>}
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </header>

        <div className={d.body}>
          <section className={`${d.section} ${d[`c_${v}`]}`} aria-labelledby="dr-verdict">
            <h3 id="dr-verdict" className={d.sh}>
              Verdict
            </h3>
            <p className={d.statement}>
              <i className={d.dot} aria-hidden />
              {STATEMENT[v]}
            </p>
            {key && <p className={d.finding}>{key.text.replace(/\s*\(Stored copy\.\)/g, "")}</p>}
            {lead ? <SourceCard e={lead} checks={leadChecks} /> : null}
            {otherSrc.length > 0 && (
              <p className={d.also}>
                Also cited <SourceLinks ev={otherSrc} />
              </p>
            )}
          </section>

          {regs.length > 0 && (
            <section className={d.section} aria-labelledby="dr-regs">
              <h3 id="dr-regs" className={d.sh}>
                Registers
                <small>
                  {clear.length} of {regs.length} clear
                </small>
              </h3>
              <ul className={d.table}>
                <li className={d.cols} aria-hidden>
                  <span>Register</span>
                  <span>Status</span>
                  <span>Since</span>
                  <span />
                </li>
                {regs.map((c) => (
                  <RegRow key={c.id} c={c} focus={fAt(c.id)} shown={lead} />
                ))}
              </ul>
              {r.registrySource && (
                <p className={d.footnote}>
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
            <section className={d.section} aria-labelledby="dr-docs">
              <h3 id="dr-docs" className={d.sh}>
                Documents to request<small>{docs.length + extraDocs.length}</small>
              </h3>
              <ul className={d.lines}>
                {docs.map((c) => (
                  <DocLine key={c.id} name={c.document?.en ?? shortLabel(c.label)} fi={c.document?.fi} law={c.law} action={c.action} />
                ))}
                {extraDocs.map((x) => (
                  <DocLine key={x.id} name={x.en} fi={x.fi} law={x.law} />
                ))}
              </ul>
            </section>
          )}

          {capability.length > 0 && (
            <section className={d.section} aria-labelledby="dr-cap">
              <h3 id="dr-cap" className={d.sh}>
                Capability
              </h3>
              <ul className={d.lines}>
                {capability.map((c) => (
                  <CheckLine key={c.id} c={c} focus={fAt(c.id)} />
                ))}
              </ul>
            </section>
          )}

          {other.length > 0 && (
            <section className={d.section} aria-labelledby="dr-other">
              <h3 id="dr-other" className={d.sh}>
                {regs.length || capability.length ? "Other checks" : "Checks"}
              </h3>
              <ul className={d.lines}>
                {other.map((c) => (
                  <CheckLine key={c.id} c={c} focus={fAt(c.id)} />
                ))}
              </ul>
            </section>
          )}

          <section className={d.section} aria-labelledby="dr-co">
            <h3 id="dr-co" className={d.sh}>
              Company
            </h3>
            <dl className={d.facts}>
              {facts
                .filter(([, val]) => val != null && val !== "")
                .map(([k, val]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{k}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
            </dl>
          </section>
        </div>

        <footer className={d.foot}>
          <button type="button" className={s.primary} onClick={onDraft} disabled={busy}>
            Draft RFQ and documents
          </button>
          <span className={d.footQuiet}>
            <button type="button" className={s.quiet} onClick={onWatch} disabled={busy || watching}>
              <Bell weight="bold" aria-hidden /> {watching ? "Watching" : "Watch"}
            </button>
            <button type="button" className={s.quiet} onClick={onAsk} disabled={busy} aria-label="Ask about this company">
              <ChatCircleText weight="bold" aria-hidden /> Ask
            </button>
          </span>
        </footer>
      </div>
    </aside>
  );
}
