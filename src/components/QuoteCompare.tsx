"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, Bell, CheckCircle, Plus, Scales, SpinnerGap, Trophy, Warning, X, XCircle } from "@phosphor-icons/react";
import type { QuoteRow, Reason, ReasonRef, Recommendation } from "@/lib/compare";
import type { QuoteEvidence } from "@/lib/quote";
import { SAMPLE_QUOTE } from "./QuoteChecker";
import { withTextFragment } from "@/lib/textFragment";
import styles from "./QuoteCompare.module.css";

// A second, well-formed demo quote so the comparison has a real choice to make.
const SAMPLE_QUOTE_GOOD = `TARJOUS 14.11.2026
LVI-Vesiniitty Oy, Y-tunnus 2941791-8, www.vesiniitty.fi

Kohde: kylpyhuoneen putkiremontti ja vedeneristys, kerrostaloasunto 6 m², Espoo

Hinta-erittely (sis. ALV 25,5 %):
- Työn osuus 7 900 € (kotitalousvähennyskelpoinen)
- Tarvikkeet ja materiaalit 5 600 €
Yhteensä 13 500 € sis. ALV 25,5 %

Maksuerät: 20 % töiden alkaessa, 50 % kun putkityöt valmiit, 30 % vastaanoton jälkeen.
Sopimusehdot: KSE 2013. Takuu 2 vuotta työlle, vedeneristykselle sertifioitu asennus.

Ystävällisin terveisin, LVI-Vesiniitty Oy`;

// A third demo: cheaper on paper, but priced without VAT and with a deposit.
const SAMPLE_QUOTE_TMI = `Tmi Putkityö Salo
Y-tunnus 3301122-4

TARJOUS
Kohde: kylpyhuoneen putkiremontti, kerrostalo 6 m², Espoo

Hinnat alv 0 %:
Työn osuus 6 200 €
Tarvikkeet 4 100 €
Yhteensä 10 300 € alv 0 %

Varausmaksu 1 500 € tilauksen yhteydessä, loput kun työ on valmis.
Takuu 1 vuosi.`;

const MAX_QUOTES = 4;
const HIRED_KEY = "kp-hired-v1";

type Item = { company: string; website?: string; text: string };
type Company = { name: string; website?: string };
type Result = { rows: QuoteRow[]; recommendation: Recommendation };
type Hire = { state: "busy" | "on" | "error"; monitorId?: string };

const eur = (n?: number) => (n == null ? "–" : `${n.toLocaleString("fi-FI")} €`);

function Cell({ ok, warn, src, note, children }: { ok?: boolean; warn?: boolean; src?: string; note?: string; children: React.ReactNode }) {
  const cls = ok ? "kp-cmp-ok" : warn ? "kp-cmp-warn" : "kp-cmp-bad";
  const Icon = ok ? CheckCircle : warn ? Warning : XCircle;
  return (
    <td className={cls}>
      <Icon weight="fill" />
      <Src line={src} note={note}>{children}</Src>
    </td>
  );
}

// Wraps a parsed value; hovering (or focusing) it shows the quote line it came from.
function Src({ line, note, children }: { line?: string; note?: string; children: React.ReactNode }) {
  if (!line && !note) return <>{children}</>;
  return (
    <span className={styles.src} title={[line && `From the quote: “${line}”`, note].filter(Boolean).join("\n")} tabIndex={0}>
      {children}
    </span>
  );
}

function loadHired(): Record<string, Hire> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIRED_KEY) ?? "{}") as Record<string, Hire>;
    // A "busy" that survived a reload never finished; drop it.
    return Object.fromEntries(Object.entries(raw).filter(([, h]) => h.state === "on"));
  } catch {
    return {};
  }
}

function saveHired(h: Record<string, Hire>) {
  try {
    localStorage.setItem(HIRED_KEY, JSON.stringify(Object.fromEntries(Object.entries(h).filter(([, x]) => x.state === "on"))));
  } catch {
    /* storage blocked: state just won't survive a reload */
  }
}

function refsOf(r: Reason, pick: number): ReasonRef[] {
  if (r.refs?.length) return r.refs;
  const qi = r.quoteIndex ?? pick; // older payloads: reasons are about the picked quote
  return r.checkIds.map((checkId) => ({ quoteIndex: qi, checkId }));
}

function evidenceFor(rows: QuoteRow[], refs: ReasonRef[]): QuoteEvidence[] {
  return refs.flatMap((ref) => rows[ref.quoteIndex]?.report.checks.find((c) => c.id === ref.checkId)?.evidence ?? []);
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function QuoteCompare({ companies }: { companies: Company[] }) {
  const base = companies.length ? companies : [{ name: "Company A" }, { name: "Company B" }];
  const [items, setItems] = useState<Item[]>(base.slice(0, MAX_QUOTES).map((c) => ({ company: c.name, website: c.website, text: "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [hired, setHired] = useState<Record<string, Hire>>({});

  // Hire state outlives a re-compare and a page reload (keyed by company name).
  useEffect(() => setHired(loadHired()), []);
  const updateHire = (company: string, h: Hire | null) =>
    setHired((prev) => {
      const next = { ...prev };
      if (h) next[company] = h;
      else delete next[company];
      saveHired(next);
      return next;
    });

  const patch = (i: number, p: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const addQuote = () => setItems((xs) => (xs.length >= MAX_QUOTES ? xs : [...xs, { company: `Company ${String.fromCharCode(65 + xs.length)}`, text: "" }]));
  const removeQuote = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));

  function loadDemo() {
    setItems([
      { company: "Espoon Putki & Saneeraus Oy", website: "https://espoonputki.fi", text: SAMPLE_QUOTE },
      { company: "LVI-Vesiniitty Oy", website: "https://www.vesiniitty.fi", text: SAMPLE_QUOTE_GOOD },
      { company: "Tmi Putkityö Salo", text: SAMPLE_QUOTE_TMI },
    ]);
    setResult(null);
    setError(null);
  }

  async function compare() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const quotes = items.filter((q) => q.text.trim()).map((q, i) => ({ ...q, company: q.company.trim() || `Company ${i + 1}` }));
      const res = await fetch("/api/compare-quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotes }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hire(row: QuoteRow) {
    updateHire(row.company, { state: "busy" });
    let domain: string | undefined;
    try {
      domain = row.website ? new URL(row.website).hostname.replace(/^www\./, "") : undefined;
    } catch {
      domain = undefined;
    }
    try {
      const res = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: row.company, domain }) });
      const data = await res.json().catch(() => ({}));
      updateHire(row.company, res.ok ? { state: "on", monitorId: data.id } : { state: "error" });
    } catch {
      updateHire(row.company, { state: "error" });
    }
  }

  async function stopWatching(company: string) {
    const id = hired[company]?.monitorId;
    updateHire(company, null);
    if (id) await fetch(`/api/watch?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  }

  const rec = result?.recommendation;
  const picked = rec && rec.pick >= 0 ? result!.rows[rec.pick] : null;
  const hire0 = picked ? hired[picked.company] : undefined;
  const filled = items.filter((q) => q.text.trim()).length;

  return (
    <div className="kp-cmp">
      <div className="kp-cmp-head">
        <h3><Scales weight="bold" /> Compare the quotes you got back</h3>
        <button type="button" className="kp-cmp-ghost" onClick={loadDemo}>Load 3 demo quotes</button>
      </div>
      <div className="kp-cmp-inputs">
        {items.map((q, i) => (
          <label key={i}>
            <span className={styles.quoteHead}>
              <input className={styles.nameInput} value={q.company} onChange={(e) => patch(i, { company: e.target.value })} aria-label={`Company name for quote ${i + 1}`} />
              {items.length > 1 && (
                <button type="button" className={styles.remove} onClick={(e) => { e.preventDefault(); removeQuote(i); }} aria-label={`Remove ${q.company || `quote ${i + 1}`}`} title="Remove this quote">
                  <X weight="bold" />
                </button>
              )}
            </span>
            <textarea rows={6} value={q.text} onChange={(e) => patch(i, { text: e.target.value })} placeholder="Paste their quote (tarjous) here" />
          </label>
        ))}
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.add} onClick={addQuote} disabled={items.length >= MAX_QUOTES}>
          <Plus weight="bold" /> {items.length >= MAX_QUOTES ? `Up to ${MAX_QUOTES} quotes` : "Add another quote"}
        </button>
      </div>
      <button type="button" className="offer-link-button" onClick={() => void compare()} disabled={busy || filled === 0}>
        {busy ? <SpinnerGap className="spin" /> : <Scales weight="bold" />}
        {busy ? `Checking every claim in ${filled} quote${filled === 1 ? "" : "s"}…` : filled === 1 ? "Check this quote" : "Compare and recommend"}
      </button>
      {error && <p className="kp-error" role="alert">{error}</p>}

      {result && (
        <>
          <div className="kp-cmp-table-wrap">
            <table className="kp-cmp-table">
              <thead>
                <tr><th />{result.rows.map((r, i) => <th key={i} className={rec?.pick === i ? "kp-cmp-pick" : ""}>{rec?.pick === i && <Trophy weight="fill" />}{r.company}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <th>Total incl. VAT</th>
                  {result.rows.map((r, i) => (
                    <td key={i}>
                      <Src line={r.report.facts.totalLine}>{r.totalEstimated && r.totalWithVat != null ? "≈ " : ""}{eur(r.totalWithVat)}</Src>
                      {r.vat === "excluded" && r.totalWithVat != null && <small> (+VAT added)</small>}
                      {r.hourlyRate != null && <small> ({r.hourlyRate} €/h{r.totalEstimated ? ", estimate" : ", no estimate"})</small>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Due before work starts</th>
                  {result.rows.map((r, i) => {
                    const f = r.report.facts;
                    const pct = r.upfrontPct;
                    const line = f.upfrontLine ?? f.paymentLine;
                    if (pct == null) return <Cell key={i} warn src={line}>{f.upfrontLine ? `${r.upfrontAmount ? eur(r.upfrontAmount) : "Amount"} unclear` : "Not stated"}</Cell>;
                    return (
                      <Cell key={i} ok={pct <= 15} warn={pct <= 30} src={line}>
                        {pct > 0 && pct < 1 ? "<1" : Math.round(pct)}%{r.upfrontAmount ? ` (${eur(r.upfrontAmount)})` : ""}
                      </Cell>
                    );
                  })}
                </tr>
                <tr>
                  <th>Labour itemised (tax credit)</th>
                  {result.rows.map((r, i) => <Cell key={i} ok={r.labourItemised} src={r.report.facts.labourLine}>{r.labourItemised ? (r.hourlyRate != null && r.report.facts.labourLine === r.report.facts.hourlyLine ? "Yes (hourly)" : "Yes") : "No"}</Cell>)}
                </tr>
                <tr>
                  <th>VAT clear</th>
                  {result.rows.map((r, i) => <Cell key={i} ok={r.vat === "included"} warn={r.vat === "excluded"} src={r.report.facts.vatLine}>{r.vat === "included" ? "Included" : r.vat === "excluded" ? "Excluded" : "Unclear"}</Cell>)}
                </tr>
                <tr>
                  <th>Business ID</th>
                  {result.rows.map((r, i) => {
                    const c = r.report.checks.find((x) => x.id === "ytunnus");
                    const label = r.report.facts.businessIds[0] ?? (r.report.facts.invalidIds[0] ? `${r.report.facts.invalidIds[0]} (invalid)` : "Missing");
                    const quoted = c?.evidence.find((e) => e.source === "quote")?.quote;
                    return <Cell key={i} ok={c?.status === "green"} warn={c?.status === "yellow"} src={quoted} note={c?.detail}>{label}</Cell>;
                  })}
                </tr>
                <tr>
                  <th>Warranty / terms</th>
                  {result.rows.map((r, i) => {
                    const f = r.report.facts;
                    const src = [f.warrantyLine, f.termsLine].filter((x, j, a) => x && a.indexOf(x) === j).join(" / ") || undefined;
                    return <Cell key={i} ok={r.warranty && !!f.termsLine} warn src={src}>{r.warranty ? (f.termsLine ? "Warranty + terms" : "Warranty only") : f.termsLine ? "Terms only" : "Missing"}</Cell>;
                  })}
                </tr>
                <tr><th>Red / yellow flags</th>{result.rows.map((r, i) => <Cell key={i} ok={r.reds === 0 && r.yellows <= 1} warn={r.reds === 0}>{r.reds} / {r.yellows}</Cell>)}</tr>
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>Underlined values were read from the quote: hover one to see the exact line.</p>

          {rec && (
            <div className={`kp-cmp-rec ${picked ? "" : "none"}`}>
              <strong>{picked ? <Trophy weight="fill" /> : <Warning weight="fill" />}{rec.headline}</strong>
              <ul>
                {rec.reasons.map((r, i) => {
                  const refs = refsOf(r, rec.pick);
                  const about = r.quoteIndex ?? refs[0]?.quoteIndex ?? rec.pick;
                  const evs = evidenceFor(result.rows, refs);
                  const linked = evs.find((e) => e.url && !e.record) ?? evs.find((e) => e.url);
                  const verbatim = evs.find((e) => !e.record && e.source !== "registry" && e.quote);
                  return (
                    <li key={i}>
                      {about !== rec.pick && result.rows[about] && <span className={styles.about}>{result.rows[about].company}</span>}
                      {r.text}
                      {linked?.url && (
                        <a href={linked.record ? linked.url : withTextFragment(linked.url, linked.quote)} target="_blank" rel="noopener noreferrer" title={linked.quote}> source <ArrowSquareOut /></a>
                      )}
                      {verbatim && <span className={styles.reasonQuote}>{verbatim.source === "quote" ? "Quote says" : "Source says"}: “{short(verbatim.quote)}”</span>}
                    </li>
                  );
                })}
              </ul>
              {rec.askBeforeSigning.length > 0 && (
                <>
                  <span className="kp-cmp-sub">Ask before signing</span>
                  <ul>{rec.askBeforeSigning.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </>
              )}
              {picked && (
                <div className={styles.hireRow}>
                  <button
                    type="button"
                    className="offer-link-button"
                    onClick={() => void hire(picked)}
                    disabled={hire0?.state === "busy" || hire0?.state === "on"}
                    title="Starts an Exa Monitor on this company until the job is done"
                  >
                    {hire0?.state === "busy" ? <SpinnerGap className="spin" /> : <Bell weight={hire0?.state === "on" ? "fill" : "bold"} />}
                    {hire0?.state === "on"
                      ? `Hired. Exa is watching ${picked.company} until the job is done`
                      : hire0?.state === "error"
                        ? "Could not start the watcher, retry"
                        : hire0?.state === "busy"
                          ? "Starting the watcher…"
                          : `Hire ${picked.company} and keep watching them`}
                  </button>
                  {hire0?.state === "on" && (
                    <button type="button" className={styles.stop} onClick={() => void stopWatching(picked.company)}>Stop watching</button>
                  )}
                </div>
              )}
              <span className="kp-cmp-foot">Recommendation from verified checks only ({rec.decidedBy === "claude" ? "LLM, citing check ids" : "rule-based"})</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
