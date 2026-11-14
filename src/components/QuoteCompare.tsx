"use client";

import { useState } from "react";
import { ArrowSquareOut, Bell, CheckCircle, Scales, SpinnerGap, Trophy, Warning, XCircle } from "@phosphor-icons/react";
import type { QuoteRow, Recommendation } from "@/lib/compare";
import { SAMPLE_QUOTE } from "./QuoteChecker";
import { withTextFragment } from "@/lib/textFragment";

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

type Company = { name: string; website?: string };
type Result = { rows: QuoteRow[]; recommendation: Recommendation };

const eur = (n?: number) => (n == null ? "–" : `${n.toLocaleString("fi-FI")} €`);

function Cell({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) {
  const cls = ok ? "kp-cmp-ok" : warn ? "kp-cmp-warn" : "kp-cmp-bad";
  const Icon = ok ? CheckCircle : warn ? Warning : XCircle;
  return <td className={cls}><Icon weight="fill" />{children}</td>;
}

export default function QuoteCompare({ companies }: { companies: Company[] }) {
  const base = companies.length ? companies : [{ name: "Company A" }, { name: "Company B" }];
  const [items, setItems] = useState(base.slice(0, 4).map((c) => ({ company: c.name, website: c.website, text: "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [hired, setHired] = useState<"idle" | "busy" | "on" | "error">("idle");

  const set = (i: number, text: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, text } : x)));

  function loadDemo() {
    setItems([
      { company: "Espoon Putki & Saneeraus Oy", website: "https://espoonputki.fi", text: SAMPLE_QUOTE },
      { company: "LVI-Vesiniitty Oy", website: "https://www.vesiniitty.fi", text: SAMPLE_QUOTE_GOOD },
    ]);
    setResult(null);
  }

  async function compare() {
    setBusy(true);
    setError(null);
    setResult(null);
    setHired("idle");
    try {
      const quotes = items.filter((q) => q.text.trim().length >= 20);
      const res = await fetch("/api/compare-quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotes }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hire(row: QuoteRow) {
    setHired("busy");
    let domain: string | undefined;
    try {
      domain = row.website ? new URL(row.website).hostname.replace(/^www\./, "") : undefined;
    } catch {
      domain = undefined;
    }
    const res = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: row.company, domain }) });
    setHired(res.ok ? "on" : "error");
  }

  const rec = result?.recommendation;
  const picked = rec && rec.pick >= 0 ? result!.rows[rec.pick] : null;
  const checkById = (row: QuoteRow, id: string) => row.report.checks.find((c) => c.id === id);

  return (
    <div className="kp-cmp">
      <div className="kp-cmp-head">
        <h3><Scales weight="bold" /> Compare the quotes you got back</h3>
        <button type="button" className="kp-cmp-ghost" onClick={loadDemo}>Load 2 demo quotes</button>
      </div>
      <div className="kp-cmp-inputs">
        {items.map((q, i) => (
          <label key={i}>
            <span>{q.company}</span>
            <textarea rows={6} value={q.text} onChange={(e) => set(i, e.target.value)} placeholder="Paste their quote (tarjous) here" />
          </label>
        ))}
      </div>
      <button type="button" className="offer-link-button" onClick={() => void compare()} disabled={busy || items.every((q) => q.text.trim().length < 20)}>
        {busy ? <SpinnerGap className="spin" /> : <Scales weight="bold" />}{busy ? "Checking every claim in every quote…" : "Compare and recommend"}
      </button>
      {error && <p className="kp-error">{error}</p>}

      {result && (
        <>
          <div className="kp-cmp-table-wrap">
            <table className="kp-cmp-table">
              <thead>
                <tr><th />{result.rows.map((r, i) => <th key={i} className={rec?.pick === i ? "kp-cmp-pick" : ""}>{rec?.pick === i && <Trophy weight="fill" />}{r.company}</th>)}</tr>
              </thead>
              <tbody>
                <tr><th>Total incl. VAT</th>{result.rows.map((r, i) => <td key={i}>{eur(r.totalWithVat)}{r.vat === "excluded" && <small> (+VAT added)</small>}</td>)}</tr>
                <tr><th>Paid upfront</th>{result.rows.map((r, i) => <Cell key={i} ok={(r.upfrontPct ?? 0) <= 15} warn={(r.upfrontPct ?? 0) <= 30}>{r.upfrontPct ?? 0}%</Cell>)}</tr>
                <tr><th>Labour itemised (tax credit)</th>{result.rows.map((r, i) => <Cell key={i} ok={r.labourItemised}>{r.labourItemised ? "Yes" : "No"}</Cell>)}</tr>
                <tr><th>VAT clear</th>{result.rows.map((r, i) => <Cell key={i} ok={r.vat === "included"} warn={r.vat === "excluded"}>{r.vat}</Cell>)}</tr>
                <tr><th>Warranty / terms</th>{result.rows.map((r, i) => <Cell key={i} ok={r.warranty} warn>{r.warranty ? "Stated" : "Missing"}</Cell>)}</tr>
                <tr><th>Red / yellow flags</th>{result.rows.map((r, i) => <Cell key={i} ok={r.reds === 0 && r.yellows <= 1} warn={r.reds === 0}>{r.reds} / {r.yellows}</Cell>)}</tr>
              </tbody>
            </table>
          </div>

          {rec && (
            <div className={`kp-cmp-rec ${picked ? "" : "none"}`}>
              <strong>{picked ? <Trophy weight="fill" /> : <Warning weight="fill" />}{rec.headline}</strong>
              <ul>
                {rec.reasons.map((r, i) => {
                  const ev = picked ? r.checkIds.map((id) => checkById(picked, id)).flatMap((c) => c?.evidence ?? []).find((e) => e.url) : undefined;
                  return (
                    <li key={i}>
                      {r.text}
                      {ev?.url && <a href={withTextFragment(ev.url, ev.quote)} target="_blank" rel="noopener noreferrer"> source <ArrowSquareOut /></a>}
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
                <button type="button" className="offer-link-button" onClick={() => void hire(picked)} disabled={hired === "busy" || hired === "on"} title="Starts an Exa Monitor on this company until the job is done">
                  {hired === "busy" ? <SpinnerGap className="spin" /> : <Bell weight={hired === "on" ? "fill" : "bold"} />}
                  {hired === "on" ? `Hired. Exa is watching ${picked.company} until the job is done` : hired === "error" ? "Could not start the watcher, retry" : `Hire ${picked.company} and keep watching them`}
                </button>
              )}
              <span className="kp-cmp-foot">Recommendation from verified checks only ({rec.decidedBy === "claude" ? "Claude, citing check ids" : "rule-based"})</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
