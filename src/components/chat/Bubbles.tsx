"use client";

import { ArrowSquareOut, Bell, CheckCircle, CircleNotch, Envelope, PencilSimple, Phone, Question, Star, Warning, XCircle } from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { QuoteRow, Recommendation } from "@/lib/compare";
import type { QuoteReport, QuoteCheck } from "@/lib/quote";
import type { Status } from "@/lib/verify";
import { withTextFragment } from "@/lib/textFragment";
import type { Draft, Source } from "./types";
import s from "./Chat.module.css";

export const host = (u?: string) => {
  if (!u) return "";
  try {
    return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function ExaBadge() {
  return <span className={s.exa} title="Found and checked with Exa search">via Exa</span>;
}

export function SourceChip({ src }: { src: Source }) {
  const h = host(src.url);
  if (!h) return null;
  return (
    <a className={s.src} href={withTextFragment(src.url, src.quote)} target="_blank" rel="noopener noreferrer" title={src.quote ? `“${src.quote.slice(0, 160)}”` : src.url}>
      {h}
      <ArrowSquareOut weight="bold" />
    </a>
  );
}

export function Sources({ list }: { list?: Source[] }) {
  const seen = new Set<string>();
  const uniq = (list ?? []).filter((x) => x.url && /^https?:/i.test(x.url) && !seen.has(host(x.url)) && seen.add(host(x.url)));
  if (!uniq.length) return null;
  return (
    <span className={s.srcRow}>
      {uniq.slice(0, 3).map((x) => <SourceChip key={x.url} src={x} />)}
    </span>
  );
}

function Dot({ status }: { status: Status }) {
  const Icon = status === "green" ? CheckCircle : status === "red" ? XCircle : status === "yellow" ? Warning : Question;
  return <Icon weight="fill" className={`${s.dot} ${s[status]}`} />;
}

export function CheckingCard({ items }: { items: { name: string; domain: string; status: "scanning" | "done" | "failed" }[] }) {
  return (
    <ul className={s.checking}>
      {items.map((it) => (
        <li key={it.domain}>
          {it.status === "scanning" ? <CircleNotch className={s.spin} /> : it.status === "done" ? <CheckCircle weight="fill" className={`${s.dot} ${s.green}`} /> : <XCircle weight="fill" className={`${s.dot} ${s.grey}`} />}
          <span>{it.name}</span>
          <small>{it.domain}</small>
        </li>
      ))}
    </ul>
  );
}

export const companyKey = (r: Ranked) => r.report.domain ?? host(r.place.website) ?? r.report.name;

type Finding = { status: Status; label: string; text: string; quote?: string; sources: Source[] };
const toSources = (ev: { url: string; quote?: string }[]) => ev.filter((e) => e.url && /^https?:/i.test(e.url)).map((e) => ({ url: e.url, quote: e.quote }));
/** A readable excerpt of a verbatim quote: markdown noise removed, centred on `needle` when given. */
const clip = (q: string, needle?: string, n = needle ? 90 : 130) => {
  const t = q.replace(/[#*|`>]+/g, " ").replace(/\s+/g, " ").trim();
  let a = 0;
  let b = t.length;
  const i = needle ? t.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i >= 0 && t.length > n) {
    a = Math.max(0, i - Math.floor((n - needle!.length) / 2));
    b = Math.min(t.length, a + n);
    a = Math.max(0, b - n);
  } else b = Math.min(t.length, n);
  // Page excerpts often start or end mid-word: drop the broken word at either end.
  if (a > 0 || /^[a-zäö]/.test(t)) a = t.indexOf(" ", a) + 1 || a;
  if (b < t.length || /[(\[:,@-]$/.test(t)) b = t.lastIndexOf(" ", b) > a ? t.lastIndexOf(" ", b) : b;
  return `${a > 0 ? "…" : ""}${t.slice(a, b).trim()}${b < t.length ? "…" : ""}`;
};
const FINDING_LABEL: Record<Status, string> = { red: "Red flag", yellow: "Ask first", green: "Verified", grey: "Note" };

/** The one finding a customer should see first: a sourced red/yellow flag, else proof of identity, else the strongest sourced reason. */
export function keyFinding(item: Ranked): Finding | null {
  const sourced = item.why.filter((w) => toSources(w.evidence).length);
  const fromWhy = (w: Ranked["why"][number]): Finding => {
    const src = toSources(w.evidence);
    const q = w.evidence.find((e) => e.quote && e.quote.trim().length > 12)?.quote;
    return { status: w.status, label: FINDING_LABEL[w.status], text: w.sentence, quote: q ? clip(q) : undefined, sources: src };
  };
  const red = sourced.find((w) => w.status === "red");
  if (red) return fromWhy(red);
  const redCheck = item.report.checks.find((c) => c.status === "red" && toSources(c.evidence).length);
  if (redCheck) {
    const q = redCheck.evidence.find((e) => e.quote && e.quote.trim().length > 12)?.quote;
    return { status: "red", label: FINDING_LABEL.red, text: redCheck.detail, quote: q ? clip(q) : undefined, sources: toSources(redCheck.evidence) };
  }
  const yellow = sourced.find((w) => w.status === "yellow");
  if (yellow) return fromWhy(yellow);
  const id = item.report.checks.find((c) => c.id === "identity" && c.status === "green" && toSources(c.evidence).length);
  if (id && item.report.businessId) {
    const q = id.evidence.find((e) => e.source === "site" && e.quote)?.quote ?? id.evidence.find((e) => e.quote)?.quote;
    return { status: "green", label: FINDING_LABEL.green, text: `Business ID ${item.report.businessId} on their site matches the trade register`, quote: q ? clip(q, item.report.businessId) : undefined, sources: toSources(id.evidence) };
  }
  const green = sourced.find((w) => w.status === "green");
  return green ? fromWhy(green) : null;
}

export function CompanyCard({ item, rank, selected, onToggle }: { item: Ranked; rank: number; selected?: boolean; onToggle?: () => void }) {
  const name = item.report.name || item.place.name;
  const phone = item.place.phone ?? item.report.contact.phones[0];
  const site = item.place.website ?? item.report.website;
  const fitCls = item.fit >= 70 ? s.fitHigh : item.fit >= 45 ? s.fitMid : s.fitLow;
  const key = keyFinding(item);
  const keyUrls = new Set(key?.sources.map((x) => x.url));
  // Only lines with evidence are shown; the key finding isn't repeated.
  const rest = item.why.filter((w) => w.sentence !== key?.text && toSources(w.evidence).length && !toSources(w.evidence).every((x) => keyUrls.has(x.url))).slice(0, 2);
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.rank}>{rank}</span>
        <div className={s.cardTitle}>
          <strong>{name}</strong>
          {site && <a href={site} target="_blank" rel="noopener noreferrer">{host(site)}</a>}
        </div>
        <span className={`${s.fit} ${fitCls}`} title="Fit score: service proof, register, reputation, rating">{item.fit}<small>/100</small></span>
      </div>
      {key && (
        <div className={`${s.finding} ${s[`f_${key.status}`]}`}>
          <div className={s.findingHead}>
            <Dot status={key.status} />
            <small>{key.label}</small>
          </div>
          <p className={s.findingText}>{key.text}</p>
          {key.quote && <q className={s.findingQuote}>{key.quote}</q>}
          <Sources list={key.sources} />
        </div>
      )}
      {rest.length > 0 && (
        <ul className={`${s.why} ${s.whyCompact}`}>
          {rest.map((w, i) => (
            <li key={i}>
              <Dot status={w.status} />
              <span>
                {w.sentence} <Sources list={toSources(w.evidence)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={s.cardFoot}>
        {phone && (
          <a href={`tel:${phone.replace(/\s/g, "")}`} className={s.meta}>
            <Phone weight="fill" /> {phone}
          </a>
        )}
        {item.place.rating && (
          <span className={s.meta}>
            <Star weight="fill" /> {item.place.rating.score.toFixed(1)} <small>({item.place.rating.count})</small>
          </span>
        )}
        <ExaBadge />
        {onToggle && (
          <button type="button" className={`${s.pickBtn} ${selected ? s.picked : ""}`} onClick={onToggle} aria-pressed={selected}>
            {selected ? <CheckCircle weight="fill" /> : null}
            {selected ? "Picked" : "Pick"}
          </button>
        )}
      </div>
    </div>
  );
}

const mailto = (d: Draft, body: string) =>
  `mailto:${d.email ?? ""}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`;

export function draftBody(d: Draft) {
  return d.edited ?? (d.lang === "fi" ? d.bodyFi : d.bodyEn);
}

export function DraftCard({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const body = draftBody(draft);
  return (
    <div className={s.card}>
      <div className={s.draftHead}>
        <Envelope weight="fill" />
        <div>
          {draft.kind && <small className={s.draftKind}>{draft.kind === "docs" ? "Tilaajavastuu document request" : "Subcontract quote request (RFQ)"}</small>}
          <strong>To {draft.name}</strong>
          <small>{draft.email ?? "No email found on their site: add one in your mail app"}</small>
        </div>
        <div className={s.langToggle} role="group" aria-label="Language">
          {(["en", "fi"] as const).map((l) => (
            <button key={l} type="button" className={draft.lang === l ? s.on : ""} onClick={() => onChange({ ...draft, lang: l, edited: undefined })}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className={s.subject}>{draft.subject}</div>
      {draft.editing ? (
        <textarea className={s.draftEdit} value={body} rows={9} onChange={(e) => onChange({ ...draft, edited: e.target.value })} aria-label={`Edit message to ${draft.name}`} />
      ) : (
        <p className={s.draftBody}>{body}</p>
      )}
      <div className={s.draftActions}>
        {draft.sent ? (
          <span className={s.sentNote}><CheckCircle weight="fill" /> Approved, opened in your mail app</span>
        ) : (
          <a className={s.approve} href={mailto(draft, body)} onClick={() => onChange({ ...draft, sent: true, editing: false })}>
            Approve and send
          </a>
        )}
        <button type="button" className={s.ghost} onClick={() => onChange({ ...draft, editing: !draft.editing })}>
          <PencilSimple /> {draft.editing ? "Done" : "Edit"}
        </button>
      </div>
    </div>
  );
}

const ORDER: Status[] = ["red", "yellow", "green", "grey"];
const checkSources = (c: QuoteCheck): Source[] => c.evidence.filter((e) => e.url && e.source !== "quote").map((e) => ({ url: e.url!, quote: e.quote }));

export function QuoteCheckCard({ company, report }: { company: string; report: QuoteReport }) {
  const sorted = [...report.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const f = report.facts;
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div className={s.cardTitle}>
          <strong>{report.company?.name ?? company}</strong>
          <span>{f.total != null ? `${f.total.toLocaleString("fi-FI")} € ${f.vat === "excluded" ? "+ VAT" : f.vat === "included" ? "incl. VAT" : ""}` : "Total not found"}</span>
        </div>
        <ExaBadge />
      </div>
      <ul className={s.why}>
        {sorted.slice(0, 5).map((c) => (
          <li key={c.id}>
            <Dot status={c.status} />
            <span>
              <b>{c.label}.</b> {c.detail} {checkSources(c).length ? <Sources list={checkSources(c)} /> : <span className={s.inQuote} title="Read from the quote text you pasted">in the quote</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const eur = (n?: number) => (n == null ? "?" : `${n.toLocaleString("fi-FI")} €`);

export function CompareCard({ rows, recommendation }: { rows: QuoteRow[]; recommendation: Recommendation }) {
  const pick = rows[recommendation.pick];
  // Check ids repeat per quote, so attribute a reason to the company it names (all rows if it names none).
  const firstWord = (name: string) => name.toLowerCase().replace(/^(lvi|oy)[- ]/, "").split(/[\s&-]+/)[0];
  const srcFor = (ids: string[], text: string) => {
    const named = rows.filter((r) => text.toLowerCase().includes(firstWord(r.company)));
    return (named.length ? named : rows).flatMap((r) => r.report.checks.filter((c) => ids.includes(c.id)).flatMap(checkSources));
  };
  return (
    <div className={s.card}>
      <div className={s.recoHead}>
        <small>My pick</small>
        <strong>{recommendation.headline}</strong>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Company</th>
              <th>Total</th>
              <th>Upfront</th>
              <th>Labour</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === recommendation.pick ? s.pickRow : ""}>
                <td>
                  <div className={s.coCell}>
                  <span className={s.coName}>{r.company}</span>
                  {r.reds > 0 && <span className={`${s.flag} ${s.flagRed}`} title="Serious issues">{r.reds}</span>}
                  {r.yellows > 0 && <span className={`${s.flag} ${s.flagYellow}`} title="Things to clarify">{r.yellows}</span>}
                  </div>
                </td>
                <td>{eur(r.totalWithVat ?? r.total)}</td>
                <td className={(r.upfrontPct ?? 0) > 30 ? s.bad : ""}>{r.upfrontPct != null ? `${r.upfrontPct}%` : "?"}</td>
                <td className={r.labourItemised ? s.good : s.bad} title={r.labourItemised ? "Labour itemised" : "Labour not itemised"}>
                  {r.labourItemised ? <CheckCircle weight="fill" className={s.dot} /> : <XCircle weight="fill" className={s.dot} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recommendation.reasons.length > 0 && (
        <ul className={s.why}>
          {recommendation.reasons.map((r, i) => (
            <li key={i}>
              <CheckCircle weight="fill" className={`${s.dot} ${s.green}`} />
              <span>
                {r.text} {srcFor(r.checkIds, r.text).length ? <Sources list={srcFor(r.checkIds, r.text)} /> : <span className={s.inQuote} title="Read from the quote text you pasted">in the quote</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recommendation.askBeforeSigning.length > 0 && (
        <div className={s.askFirst}>
          <small>Ask {pick ? pick.company : "them"} before signing</small>
          <ul>
            {recommendation.askBeforeSigning.map((q, i) => <li key={i}>{q.replace(/^#\d+\s*/, "")}</li>)}
          </ul>
        </div>
      )}
      <div className={s.cardFoot}>
        <ExaBadge />
        <small className={s.muted}>Checked against the trade register and their own sites</small>
      </div>
    </div>
  );
}

export function WatchCard({ name, domain, monitorId, mode }: { name: string; domain?: string; monitorId?: string; mode?: string }) {
  return (
    <div className={`${s.card} ${s.watch}`}>
      <Bell weight="fill" />
      <div>
        <strong>Watching {name}</strong>
        <small>
          Daily Exa Monitor for news, complaints and register changes{domain ? ` about ${domain}` : ""}
          {mode === "polling" ? " (checked on demand while running locally)" : ""}.
        </small>
        {monitorId && <code>{monitorId}</code>}
      </div>
    </div>
  );
}

const CHECK_ORDER: Status[] = ["red", "yellow", "green", "grey"];

/** Everything verified about one company: every check with its sources, plus register facts. */
export function CompanyDetailCard({ item, rank }: { item: Ranked; rank?: number }) {
  const r = item.report;
  const name = r.name || item.place.name;
  const site = item.place.website ?? r.website;
  const checks = [...r.checks].sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status));
  const phone = item.place.phone ?? r.contact.phones[0];
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        {rank != null && <span className={s.rank}>{rank}</span>}
        <div className={s.cardTitle}>
          <strong>{name}</strong>
          {site && <a href={site} target="_blank" rel="noopener noreferrer">{host(site)}</a>}
        </div>
        <span className={`${s.fit} ${item.fit >= 70 ? s.fitHigh : item.fit >= 45 ? s.fitMid : s.fitLow}`} title="Fit score">{item.fit}<small>/100</small></span>
      </div>
      {(r.businessId || r.registry?.registrationDate || r.registry?.mainBusinessLine) && (
        <p className={s.muted}>
          {[r.businessId && `Y-tunnus ${r.businessId}`, r.registry?.registrationDate && `reg. ${r.registry.registrationDate}`, r.registry?.mainBusinessLine]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <ul className={s.why}>
        {checks.map((c) => (
          <li key={c.id}>
            <Dot status={c.status} />
            <span>
              <b>{c.label}.</b> {c.detail}{" "}
              {toSources(c.evidence).length ? (
                <Sources list={toSources(c.evidence)} />
              ) : (
                <span className={s.inQuote} title={c.status === "grey" ? "Searched, nothing found" : "Kilpi's own check"}>{c.status === "grey" ? "nothing found" : "Kilpi's check"}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className={s.cardFoot}>
        {phone && (
          <a href={`tel:${phone.replace(/\s/g, "")}`} className={s.meta}>
            <Phone weight="fill" /> {phone}
          </a>
        )}
        {r.contact.emails[0] && (
          <a href={`mailto:${r.contact.emails[0]}`} className={s.meta}>
            <Envelope weight="fill" /> {r.contact.emails[0]}
          </a>
        )}
        <ExaBadge />
      </div>
    </div>
  );
}

/** Answer text with inline [n] markers turned into links to the numbered sources. */
export function CitedText({ text, sources }: { text: string; sources: Source[] }) {
  const byN = new Map(sources.filter((x) => x.n != null).map((x) => [x.n!, x]));
  // Light markdown from the agent: "## Heading" and **bold** become bold, "- item" a bullet.
  const md = text
    .replace(/^\s*#{1,6}\s+(.+)$/gm, "**$1**")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n");
  const parts = md.split(/(\[\d+\]|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g);
  return (
    <span className={s.text}>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(p);
        if (link)
          return (
            <a key={i} className={s.inlineLink} href={link[2]} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        const m = /^\[(\d+)\]$/.exec(p);
        const src = m ? byN.get(Number(m[1])) : undefined;
        if (!m) return p;
        if (!src) return null;
        return (
          <a key={i} className={s.cite} href={withTextFragment(src.url, src.quote)} target="_blank" rel="noopener noreferrer" title={src.quote ? `“${src.quote}”` : src.title ?? src.url}>
            {m[1]}
          </a>
        );
      })}
    </span>
  );
}

export function NumberedSources({ list }: { list: Source[] }) {
  return (
    <span className={s.srcList}>
      {list.map((x) => (
        <a key={`${x.n}-${x.url}`} className={s.src} href={withTextFragment(x.url, x.quote)} target="_blank" rel="noopener noreferrer" title={x.quote ? `“${x.quote}”` : x.title ?? x.url}>
          <b>{x.n}</b> {host(x.url)}
          <ArrowSquareOut weight="bold" />
        </a>
      ))}
    </span>
  );
}
