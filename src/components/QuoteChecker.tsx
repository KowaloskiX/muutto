"use client";

import { useState } from "react";
import { ArrowSquareOut, CheckCircle, FileText, Question, SpinnerGap, Warning, XCircle } from "@phosphor-icons/react";
import type { QuoteCheck, QuoteEvidence, QuoteReport, Status } from "@/lib/quote";
import styles from "./QuoteChecker.module.css";

export const SAMPLE_QUOTE = `TARJOUS nro 2026-114
Espoon Putki & Saneeraus Oy
Y-tunnus 3502206-6 · www.espoonputki.fi

Asiakas: Matti Virtanen, Espoo
Kohde: kylpyhuoneen putkiremontti ja vedeneristys, kerrostaloasunto 6 m²

Meillä on yli 20 vuoden kokemus putkitöistä pääkaupunkiseudulla. Olemme Tukes-rekisteröity yritys ja sertifioitu vedeneristäjä.

Tarjoamme työn kiinteään urakkahintaan:
Urakkahinta yhteensä 12 900 € (sisältää työt ja materiaalit)

Maksuehdot: 100 % ennakkomaksu ennen töiden aloitusta, maksu 7 päivän kuluessa tilauksesta.
Työt aloitetaan kahden viikon kuluessa maksun saapumisesta.

Tarjous on voimassa 14 päivää.
Ystävällisin terveisin,
Jari Lehtonen, toimitusjohtaja`;

const SOURCE_LABEL: Record<QuoteEvidence["source"], string> = {
  quote: "In the quote",
  site: "Company website",
  registry: "Official register",
  authority: "Consumer / tax authority",
  web: "Web",
};

function StatusIcon({ status }: { status: Status }) {
  if (status === "green") return <CheckCircle weight="fill" aria-label="OK" />;
  if (status === "yellow") return <Warning weight="fill" aria-label="Check this" />;
  if (status === "red") return <XCircle weight="fill" aria-label="Problem" />;
  return <Question weight="fill" aria-label="Info" />;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function CheckRow({ check }: { check: QuoteCheck }) {
  return (
    <li className={`${styles.check} ${styles[check.status]}`}>
      <span className={styles.icon}><StatusIcon status={check.status} /></span>
      <div className={styles.body}>
        <div className={styles.label}>{check.label}</div>
        <p className={styles.detail}>{check.detail}</p>
        {check.contradicts && <p className={styles.contradicts}><strong>Evidence says:</strong> {check.contradicts}</p>}
        {check.evidence.length > 0 && (
          <ul className={styles.evidence}>
            {check.evidence.map((e, i) => (
              <li key={i} className={styles.ev}>
                <span className={styles.evSrc}>{SOURCE_LABEL[e.source]}{e.url ? ` · ${host(e.url)}` : ""}</span>
                <blockquote className={styles.evQuote}>“{e.quote}”</blockquote>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className={styles.evLink}>
                    Open source <ArrowSquareOut />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const ORDER: Status[] = ["red", "yellow", "green", "grey"];

export default function QuoteChecker({ defaultWebsite }: { defaultWebsite?: string }) {
  const [text, setText] = useState("");
  const [website, setWebsite] = useState(defaultWebsite ?? "");
  const [businessId, setBusinessId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<QuoteReport | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/check-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, website: website || undefined, businessId: businessId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setReport(data as QuoteReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = report ? ORDER.map((s) => [s, report.checks.filter((c) => c.status === s).length] as const) : [];

  return (
    <section className={styles.wrap} aria-labelledby="qc-title">
      <div className={styles.head}>
        <h2 id="qc-title" className={styles.title}><FileText weight="duotone" /> Check a quote</h2>
        <button type="button" className={styles.ghost} onClick={() => { setText(SAMPLE_QUOTE); setWebsite(""); setBusinessId(""); setReport(null); }}>
          Load sample quote
        </button>
      </div>
      <p className={styles.lead}>Paste the contractor&apos;s offer (tarjous). We check the business ID, payment terms, tax-credit eligibility, VAT, warranty and every marketing claim against registers and official guidance, with sources.</p>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the quote text here…"
        rows={10}
      />
      <div className={styles.row}>
        <input className={styles.input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Company website (optional)" />
        <input className={styles.input} value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="Y-tunnus (optional)" />
        <button type="button" className={styles.primary} onClick={run} disabled={busy || text.trim().length < 20}>
          {busy ? <><SpinnerGap className={styles.spin} /> Checking…</> : "Check this quote"}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {report && (
        <div className={styles.results}>
          <div className={styles.summary}>
            {report.company && <span className={styles.company}>{report.company.name} · {report.company.businessId}</span>}
            {counts.filter(([, n]) => n > 0).map(([s, n]) => (
              <span key={s} className={`${styles.pill} ${styles[s]}`}><StatusIcon status={s} /> {n}</span>
            ))}
            <span className={styles.meta}>{report.trace.length} Exa lookups · claims read by {report.extractor === "claude" ? "Claude" : "rules"}</span>
          </div>
          <ul className={styles.list}>
            {[...report.checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((c) => <CheckRow key={c.id} check={c} />)}
          </ul>
        </div>
      )}
    </section>
  );
}
