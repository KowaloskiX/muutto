"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowUp,
  Bell,
  Check,
  EnvelopeSimple,
  Highlighter,
  Copy,
  CaretDown,
  Lightning,
  X,
  CheckCircle,
  MagnifyingGlass,
  Phone,
  Question,
  ShieldCheck,
  Sparkle,
  SpinnerGap,
  Star,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import type { FindEvent } from "./api/find/route";
import type { ExaTrace, Place } from "@/lib/exa";
import type { Check as VerifyCheck, CompanyReport, Evidence, Status } from "@/lib/verify";
import { JUMP_HINT, withTextFragment } from "@/lib/textFragment";
import type { DraftOut } from "./api/draft/route";
import CriteriaMatrix from "@/components/CriteriaMatrix";
import WatchPanel from "@/components/WatchPanel";
import QuoteChecker from "@/components/QuoteChecker";
import QuoteCompare from "@/components/QuoteCompare";

type View = "home" | "searching" | "results";
type StageId = "understand" | "find" | "verify" | "rank";
type StageLive = { status: "pending" | "active" | "done"; detail?: string };
type Why = { sentence: string; status: Status; evidence: Evidence[] };
/** `why` and `fit` come from the ranking step; both optional so older payloads still render. */
type Ranked = { place: Place; report: CompanyReport; why?: Why[]; fit?: number };

const PIPELINE: { id: StageId; label: string; agent: string }[] = [
  { id: "understand", label: "Understanding the job", agent: "Claude" },
  { id: "find", label: "Finding local businesses", agent: "Exa Places" },
  { id: "verify", label: "Checking each company", agent: "Exa + trade register" },
  { id: "rank", label: "Ranking by trust", agent: "Agent" },
];

const EXAMPLES = [
  "Pipe relining for my flat in Espoo, English speaking",
  "Electrician in Helsinki to install a sauna heater",
  "Moving company in Vantaa for a 2-room apartment",
];

function Brand() {
  return (
    <span className="brand">
      <span className="brand-glyph kp-glyph"><ShieldCheck weight="fill" /></span>
      Kilpailutus
    </span>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "green") return <CheckCircle weight="fill" />;
  if (status === "yellow") return <Warning weight="fill" />;
  if (status === "red") return <XCircle weight="fill" />;
  return <Question weight="fill" />;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Small marker on links that open the source scrolled to the quoted sentence. */
function JumpHint() {
  return <span className="kp-jump" title={JUMP_HINT} aria-label={JUMP_HINT}><Highlighter weight="bold" />jump to quote</span>;
}

function SourceChips({ evidence, max = 3 }: { evidence: Evidence[]; max?: number }) {
  const uniq = evidence.filter((e, i, a) => e.url && a.findIndex((x) => x.url === e.url) === i).slice(0, max);
  if (!uniq.length) return null;
  return (
    <span className="kp-chips">
      {uniq.map((e, i) => (
        <a
          key={i}
          className="kp-chip"
          href={withTextFragment(e.url, e.quote)}
          target="_blank"
          rel="noopener noreferrer"
          title={e.quote ? `“${clip(e.quote.replace(/\s+/g, " ").trim(), 220)}” · ${JUMP_HINT}` : e.url}
        >
          {e.quote ? <Highlighter weight="bold" /> : <ArrowSquareOut weight="bold" />}
          {hostOf(e.url)}
        </a>
      ))}
    </span>
  );
}

function WhyList({ why, max }: { why: Why[]; max: number }) {
  return (
    <ul className="kp-why-list">
      {why.slice(0, max).map((w, i) => (
        <li key={i} className={`kp-why-item ${w.status}`}>
          <span className="kp-dot" aria-label={w.status} />
          <span className="kp-why-text">{w.sentence}</span>
          <SourceChips evidence={w.evidence ?? []} />
        </li>
      ))}
    </ul>
  );
}

function fitTone(fit: number): Status {
  return fit >= 70 ? "green" : fit >= 45 ? "yellow" : "red";
}

function WhyBlock({ why, fit, rank }: { why?: Why[]; fit?: number; rank: number }) {
  const items = (why ?? []).filter((w) => w?.sentence);
  const hasFit = typeof fit === "number" && Number.isFinite(fit);
  if (!items.length && !hasFit) return null;
  const score = hasFit ? Math.max(0, Math.min(100, Math.round(fit))) : 0;
  return (
    <section className="kp-why" aria-label={`Why ranked #${rank}`}>
      <div className="kp-why-head">
        <span className="kp-why-title">Why #{rank}</span>
        {hasFit && <span className={`kp-fit ${fitTone(score)}`} title="How well this company fits your job, 0–100">{score}<small>/100 fit</small></span>}
      </div>
      {items.length > 0 && <WhyList why={items} max={4} />}
    </section>
  );
}

function CheckRow({ check }: { check: VerifyCheck }) {
  const [open, setOpen] = useState(check.status === "red" || check.status === "yellow");
  return (
    <li className={`kp-check ${check.status}`}>
      <button type="button" className="kp-check-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="kp-check-icon"><StatusIcon status={check.status} /></span>
        <span className="kp-check-label">{check.label}</span>
        {check.evidence.length > 0 && <span className="kp-check-count">{check.evidence.length} source{check.evidence.length > 1 ? "s" : ""}</span>}
      </button>
      {open && (
        <div className="kp-check-body">
          <p>{check.detail}</p>
          {check.evidence.map((ev, i) => (
            <a key={i} className="kp-evidence" href={withTextFragment(ev.url, ev.quote)} target="_blank" rel="noopener noreferrer" title={ev.quote ? JUMP_HINT : undefined}>
              {ev.quote && <q>{ev.quote}</q>}
              <span className="kp-evidence-src">
                {ev.source === "registry" ? "Trade register" : ev.source === "site" ? "Their website" : "Web"} · {hostOf(ev.url)} <ArrowSquareOut />
                {ev.quote && <JumpHint />}
              </span>
            </a>
          ))}
        </div>
      )}
    </li>
  );
}

function verdictOf(report: CompanyReport): { label: string; tone: Status } {
  const reds = report.checks.filter((c) => c.status === "red").length;
  const yellows = report.checks.filter((c) => c.status === "yellow").length;
  if (reds) return { label: `${reds} red flag${reds > 1 ? "s" : ""}`, tone: "red" };
  if (yellows) return { label: `${yellows} thing${yellows > 1 ? "s" : ""} to ask about`, tone: "yellow" };
  return { label: "All checks passed", tone: "green" };
}

const REGISTRY_IDS = new Set(["identity", "prepayment", "situation", "age", "id-checksum"]);
const RANK: Record<Status, number> = { red: 0, yellow: 1, grey: 2, green: 3 };
const worst = (cs: VerifyCheck[]): Status => cs.reduce<Status>((w, c) => (RANK[c.status] < RANK[w] ? c.status : w), "green");

function RegistryRow({ checks }: { checks: VerifyCheck[] }) {
  const status = checks.length ? worst(checks) : "grey";
  const merged: VerifyCheck = {
    id: "registry",
    label: "Registered company & tax credit",
    status,
    detail: checks.map((c) => c.detail).join(" "),
    evidence: checks.flatMap((c) => c.evidence).filter((e, i, a) => a.findIndex((x) => x.url === e.url && x.quote === e.quote) === i),
  };
  return <CheckRow check={merged} />;
}

type EndpointKind = "places" | "search" | "contents" | "monitors";
function endpointKind(t: ExaTrace): EndpointKind {
  if (/monitor/i.test(t.endpoint)) return "monitors";
  if (t.endpoint.includes("/contents")) return "contents";
  if (/^search\(lite\)/.test(t.summary)) return "places";
  return "search";
}
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

function ExaTracePanel({ trace }: { trace: ExaTrace[] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  const total = trace.reduce((a, t) => a + t.ms, 0);
  return (
    <div className={`kp-trace ${open ? "open" : ""}`}>
      <button type="button" className="kp-trace-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Lightning weight="fill" />
        <span>What Exa did</span>
        <span className="kp-trace-meta">{trace.length} call{trace.length > 1 ? "s" : ""} · {fmtMs(total)}</span>
        <CaretDown weight="bold" className="kp-caret" />
      </button>
      {open && (
        <ol className="kp-trace-list">
          {trace.map((t, i) => {
            const kind = endpointKind(t);
            return (
              <li key={i} className={t.ok ? "" : "fail"}>
                <span className={`kp-ep ${kind}`}>{kind}</span>
                <span className="kp-trace-sum" title={t.summary}>{t.summary.replace(/^(search\([^)]*\)|contents):\s*/, "") || t.endpoint}</span>
                <span className="kp-trace-ms">{fmtMs(t.ms)}</span>
                <span className="kp-trace-ok">{t.ok ? <CheckCircle weight="fill" /> : <XCircle weight="fill" />}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ExaSummary({ trace }: { trace: ExaTrace[] }) {
  if (!trace.length) return null;
  const total = trace.reduce((a, t) => a + t.ms, 0);
  const counts = trace.reduce<Partial<Record<EndpointKind, number>>>((m, t) => {
    const k = endpointKind(t);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  const failed = trace.filter((t) => !t.ok).length;
  return (
    <div className="kp-exa-summary" aria-label="Exa usage">
      <span className="kp-exa-title"><Lightning weight="fill" />Powered by Exa</span>
      <span><strong>{trace.length}</strong> API calls</span>
      <span><strong>{fmtMs(total)}</strong> total Exa time</span>
      <span className="kp-exa-eps">
        {(Object.entries(counts) as [EndpointKind, number][]).map(([k, n]) => <span key={k} className={`kp-ep ${k}`}>{k} ×{n}</span>)}
      </span>
      {failed > 0 && <span className="kp-exa-fail">{failed} failed</span>}
    </div>
  );
}

function siteQuotes(report: CompanyReport): { url: string; quote: string; href: string }[] {
  const service = report.checks.find((c) => c.id === "service");
  const claims = report.checks.filter((c) => c.id.startsWith("claim-"));
  return [service, ...claims]
    .flatMap((c) => c?.evidence ?? [])
    .filter((e): e is { url: string; quote: string; source: "site" } => e.source === "site" && !!e.quote)
    .slice(0, 2)
    .map((e) => ({ url: e.url, href: withTextFragment(e.url, e.quote), quote: clip(e.quote.replace(/\s+/g, " ").trim(), 170) }));
}

function SiteQuotes({ report }: { report: CompanyReport }) {
  const quotes = siteQuotes(report);
  if (!quotes.length) return null;
  return (
    <div className="kp-quotes">
      {quotes.map((q, i) => (
        <a key={i} className="kp-quote" href={q.href} target="_blank" rel="noopener noreferrer" title={JUMP_HINT}>
          <q>{q.quote}</q>
          <span className="kp-quote-src">From their site · {hostOf(q.url)} · via Exa <ArrowSquareOut /><JumpHint /></span>
        </a>
      ))}
    </div>
  );
}

function genericAnswer(service: string, city: string) {
  const job = service || "this job";
  return `To find someone for ${job}${city ? ` in ${city}` : ""}, search Google or a marketplace like Fixmera, read their reviews, and ask a few companies for quotes. Make sure the company is registered and has a valid business ID before you pay anything.`;
}

function WithWithout({ top, service, city }: { top: Ranked; service: string; city: string }) {
  const { place, report } = top;
  const why = (top.why ?? []).filter((w) => w?.sentence);
  const phone = place.phone ?? report.contact?.phones?.[0];
  const quote = siteQuotes(report)[0];
  const site = place.website ?? report.website ?? (report.domain ? `https://${report.domain}` : undefined);
  return (
    <section className="kp-compare" aria-label="Without Exa vs with Exa">
      <div className="kp-compare-box without">
        <span className="kp-compare-label">A model without web search would say:</span>
        <p>{genericAnswer(service, city)}</p>
        <span className="kp-compare-foot">No names · no phone numbers · no sources</span>
      </div>
      <div className="kp-compare-arrow" aria-hidden><ArrowRight weight="bold" /></div>
      <div className="kp-compare-box with">
        <span className="kp-compare-label"><Lightning weight="fill" />With Exa:</span>
        <h3>{report.name}</h3>
        <div className="kp-compare-facts">
          {phone && <a href={`tel:${phone.replace(/\s/g, "")}`}><Phone weight="bold" />{phone}</a>}
          {place.rating && <span><Star weight="fill" />{place.rating.score.toFixed(1)} ({place.rating.count} reviews)</span>}
          {report.businessId && <a href={`https://tietopalvelu.ytj.fi/yritys/${report.businessId}`} target="_blank" rel="noopener noreferrer"><ShieldCheck weight="bold" />Y-tunnus {report.businessId}</a>}
          {site && <a href={site} target="_blank" rel="noopener noreferrer"><ArrowSquareOut weight="bold" />{hostOf(site)}</a>}
        </div>
        {why.length > 0 && <WhyList why={why} max={2} />}
        {quote && <a className="kp-quote" href={quote.href} target="_blank" rel="noopener noreferrer" title={JUMP_HINT}><q>{quote.quote}</q><span className="kp-quote-src">From their site · {hostOf(quote.url)} · via Exa <ArrowSquareOut /><JumpHint /></span></a>}
        <span className="kp-compare-foot">{report.trace.length} Exa calls for this company · every claim linked</span>
      </div>
    </section>
  );
}

function ConnectRecord({ report }: { report: CompanyReport }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [check, setCheck] = useState<VerifyCheck | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  async function run() {
    setState("busy");
    try {
      const res = await fetch("/api/verify-connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: report.name, businessId: report.businessId, website: report.website }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCheck({ id: "exa-connect", label: data.label ?? "Company record (Exa Connect)", status: data.status, detail: data.detail, evidence: data.evidence ?? [] });
      setCost(typeof data.costDollars === "number" ? data.costDollars : null);
      setState("done");
    } catch {
      setState("error");
    }
  }
  if (check) return <><CheckRow check={check} />{cost != null && <li className="kp-connect-cost">Exa Connect · Fiber.ai · ${cost.toFixed(2)}</li>}</>;
  return (
    <li>
      <button type="button" className="kp-connect-btn" onClick={() => void run()} disabled={state === "busy"} title="Exa Agent run with partner data (Fiber.ai): LinkedIn, size, key people. ~30–60 s, ~$0.15">
        {state === "busy" ? <SpinnerGap className="spin" /> : <Lightning weight="bold" />}
        {state === "busy" ? "Looking up company record…" : state === "error" ? "Exa Connect lookup failed, retry" : "Company record via Exa Connect"}
      </button>
    </li>
  );
}

function CompanyCard({ item, rank, active, selected, onToggle, watching, onWatch, setRef, advanced = false }: {
  item: Ranked; rank: number; active: boolean; selected: boolean; onToggle: () => void; advanced?: boolean;
  watching: "idle" | "busy" | "on" | "error"; onWatch: () => void; setRef: (n: HTMLElement | null) => void;
}) {
  const { place, report } = item;
  const verdict = verdictOf(report);
  const registry = report.checks.filter((c) => REGISTRY_IDS.has(c.id));
  const exaChecks = report.checks.filter((c) => !REGISTRY_IDS.has(c.id));
  const tax = report.checks.find((c) => c.id === "prepayment");
  const phone = place.phone ?? report.contact?.phones?.[0];
  return (
    <article className={`result-card kp-card ${active ? "active" : ""}`} ref={setRef}>
      <div className={`kp-card-side ${verdict.tone}`}>
        <span className="kp-rank">#{rank}</span>
        <span className="kp-verdict-icon"><StatusIcon status={verdict.tone} /></span>
        <strong>{verdict.label}</strong>
        <div className="kp-side-meta">
          {place.rating && <span><Star weight="fill" /> {place.rating.score.toFixed(1)} ({place.rating.count})</span>}
          {report.businessId && <span>Y-tunnus {report.businessId}</span>}
          {report.registry?.registrationDate && <span>Since {report.registry.registrationDate.slice(0, 4)}</span>}
          {tax && <span>{tax.status === "green" ? "Tax credit OK" : "No tax credit"}</span>}
        </div>
      </div>
      <div className="product-copy">
        <div className="product-source">
          <span>{report.domain ?? "no website"}</span>
          <span>{report.checks.filter((c) => c.status === "green").length}/{report.checks.length} verified</span>
        </div>
        <h2>{report.name}</h2>
        {place.address && <p className="match-reason">{place.address}</p>}
        <WhyBlock why={item.why} fit={item.fit} rank={rank} />
        <SiteQuotes report={report} />
        <ul className="kp-checks">
          {exaChecks.map((c) => <CheckRow key={c.id} check={c} />)}
          <RegistryRow checks={registry} />
          {advanced && <ConnectRecord report={report} />}
        </ul>
        <div className="kp-actions">
          <button type="button" className={`offer-link-button ${selected ? "" : "kp-secondary"}`} onClick={onToggle}>
            {selected ? <Check weight="bold" /> : <EnvelopeSimple weight="bold" />}{selected ? "In quote request" : "Ask for a quote"}
          </button>
          {phone && <a className="offer-link-button kp-secondary" href={`tel:${phone.replace(/\s/g, "")}`}><Phone weight="bold" />Call</a>}
          {place.website && <a className="offer-link-button kp-secondary" href={place.website} target="_blank" rel="noopener noreferrer">Site <ArrowSquareOut weight="bold" /></a>}
          <button type="button" className="offer-link-button kp-secondary" onClick={onWatch} disabled={watching === "busy" || watching === "on"} title="Exa Monitor: daily check for bankruptcy, complaints and news">
            {watching === "busy" ? <SpinnerGap className="spin" /> : <Bell weight={watching === "on" ? "fill" : "bold"} />}
            {watching === "on" ? "Watching" : watching === "error" ? "Retry watch" : "Watch"}
          </button>
        </div>
        <ExaTracePanel trace={report.trace ?? []} />
      </div>
    </article>
  );
}

function concernsOf(report: CompanyReport): string[] {
  return report.checks.filter((c) => c.status === "yellow" || c.status === "red").map((c) => `${c.label}: ${c.detail}`).slice(0, 3);
}

function DraftSheet({ drafts, loading, onClose }: { drafts: DraftOut[]; loading: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<"fi" | "en">("fi");
  const [sent, setSent] = useState<Record<string, boolean>>({});
  return (
    <div className="kp-sheet-backdrop" role="dialog" aria-label="Quote requests">
      <div className="kp-sheet">
        <div className="kp-sheet-head">
          <h2>Quote requests</h2>
          <div className="kp-lang">
            <button className={lang === "fi" ? "on" : ""} onClick={() => setLang("fi")}>Suomi</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button>
          </div>
          <button className="kp-icon" onClick={onClose} aria-label="Close"><X weight="bold" /></button>
        </div>
        {loading && <p className="kp-muted"><SpinnerGap className="spin" /> Drafting one message per company…</p>}
        {drafts.map((d) => {
          const body = lang === "fi" ? d.bodyFi : d.bodyEn;
          const mailto = `mailto:${d.email ?? ""}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`;
          return (
            <div className="kp-draft" key={d.name}>
              <div className="kp-draft-to"><strong>{d.name}</strong><span>{d.email ?? "no email found on their site"}</span></div>
              <div className="kp-draft-subject">{d.subject}</div>
              <pre className="kp-draft-body">{body}</pre>
              <div className="kp-actions">
                <a className="offer-link-button" href={mailto} onClick={() => setSent((s) => ({ ...s, [d.name]: true }))}>
                  {sent[d.name] ? <Check weight="bold" /> : <EnvelopeSimple weight="bold" />}{sent[d.name] ? "Opened in mail" : "Approve and send"}
                </a>
                <button className="offer-link-button kp-secondary" onClick={() => void navigator.clipboard.writeText(`${d.subject}\n\n${body}`)}><Copy weight="bold" />Copy</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState("");
  const [stages, setStages] = useState<Record<string, StageLive>>({});
  const [companies, setCompanies] = useState<Record<string, "scanning" | "done" | "failed">>({});
  const [ranked, setRanked] = useState<Ranked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [watch, setWatch] = useState<Record<number, "idle" | "busy" | "on" | "error">>({});
  const [drafts, setDrafts] = useState<DraftOut[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [trace, setTrace] = useState<ExaTrace[]>([]);
  const [intent, setIntent] = useState<{ service: string; city: string }>({ service: "", city: "" });
  const [showCompare, setShowCompare] = useState(true);
  const [advanced, setAdvanced] = useState(false);

  async function startWatch(i: number) {
    const r = ranked[i]?.report;
    if (!r) return;
    setWatch((w) => ({ ...w, [i]: "busy" }));
    const res = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: r.name, domain: r.domain }) });
    setWatch((w) => ({ ...w, [i]: res.ok ? "on" : "error" }));
  }

  async function draftQuotes() {
    const chosen = ranked.filter((_, i) => selected[i]);
    if (!chosen.length) return;
    setDrafts([]);
    setDrafting(true);
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: summary, companies: chosen.map(({ report }) => ({ name: report.name, email: report.contact?.emails?.[0], concerns: concernsOf(report) })) }),
    });
    const data = await res.json();
    setDrafts(data.drafts ?? []);
    setDrafting(false);
  }

  async function run(q: string) {
    if (!q.trim()) return;
    setView("searching");
    setStages({});
    setCompanies({});
    setRanked([]);
    setSelected({});
    setWatch({});
    setDrafts(null);
    setError(null);
    setTrace([]);
    setIntent({ service: "", city: "" });
    setSummary(q);
    const res = await fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as FindEvent;
        if (e.type === "stage") setStages((s) => ({ ...s, [e.id]: { status: e.status, detail: e.detail ?? s[e.id]?.detail } }));
        else if (e.type === "intent") {
          setSummary(e.summary);
          setIntent({ service: e.service, city: e.city });
        }
        else if (e.type === "company") setCompanies((c) => ({ ...c, [e.domain]: e.status }));
        else if (e.type === "done") {
          setRanked(e.ranked);
          setTrace(e.trace ?? e.ranked.flatMap((r) => r.report.trace ?? []));
          setActive(0);
          setView("results");
        } else if (e.type === "error") setError(e.message);
      }
    }
  }

  // Track which card is centred in the carousel.
  useEffect(() => {
    if (view !== "results") return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && setActive(Number((en.target as HTMLElement).dataset.idx))),
      { threshold: 0.6 },
    );
    cardRefs.current.forEach((n, i) => { if (n) { n.dataset.idx = String(i); obs.observe(n); } });
    return () => obs.disconnect();
  }, [view, ranked.length]);

  const go = (i: number) => cardRefs.current[Math.max(0, Math.min(ranked.length - 1, i))]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

  if (view === "home") {
    return (
      <main className="home-shell">
        <header className="app-header"><Brand /></header>
        <section className="search-hero">
          <h1>Who should do the job?</h1>
          <p className="kp-sub">Tell me what you need. I find local contractors, check every claim against the trade register and their own site, and show you the sources.</p>
          <div className="search-composer">
            <div className="composer-entry">
              <textarea
                aria-label="Describe the job"
                rows={2}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(query); } }}
                placeholder="Pipe relining for my flat in Espoo, English speaking"
              />
            </div>
            <div className="composer-controls">
              <div className="composer-controls-left" />
              <div className="composer-controls-right">
                <button className="submit-action" type="button" onClick={() => void run(query)} disabled={!query.trim()} aria-label="Find contractors"><ArrowUp weight="bold" /></button>
              </div>
            </div>
          </div>
          <div className="kp-examples">
            {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => { setQuery(ex); void run(ex); }}>{ex}</button>)}
          </div>
          <details className="kp-quote-home">
            <summary>Already have a quote? Check it claim by claim</summary>
            <QuoteChecker />
          </details>
        </section>
      </main>
    );
  }

  if (view === "searching") {
    const done = PIPELINE.filter((p) => stages[p.id]?.status === "done").length;
    const now = PIPELINE.find((p) => stages[p.id]?.status === "active");
    return (
      <main className="searching-shell">
        <header className="app-header"><Brand /><span className="secure-label"><ShieldCheck />Sources for every claim</span></header>
        <section className="searching-content">
          <div className="search-orbit"><MagnifyingGlass weight="bold" /><span /></div>
          <h1>Checking contractors for you</h1>
          <p className="searching-query">{summary}</p>
          {error && <p className="kp-error">{error} <button className="text-link" onClick={() => setView("home")}>Back</button></p>}
          <div className="pipeline-card">
            <div className="pipeline-head">
              <span className="pipeline-badge"><Sparkle weight="fill" />Progress</span>
              <span className="pipeline-progress">{done}/{PIPELINE.length}</span>
            </div>
            <div className="pipeline-now" aria-live="polite"><span className="pipeline-now-dot" /><span>{now?.label ?? "Starting"}</span></div>
            <div className="stage-list">
              {PIPELINE.map((item) => {
                const live = stages[item.id]?.status ?? "pending";
                return (
                  <div className={`stage-item ${live === "done" ? "done" : live === "active" ? "active" : ""}`} key={item.id}>
                    <span className="stage-status">{live === "done" ? <Check weight="bold" /> : live === "active" ? <SpinnerGap className="spin" /> : <span className="stage-pending-dot" />}</span>
                    <div className="stage-body">
                      <div className="stage-head"><span className="stage-label">{item.label}</span><span className="stage-agent">{item.agent}</span></div>
                      {stages[item.id]?.detail && <span className="stage-substep">{stages[item.id]?.detail}</span>}
                      {item.id === "verify" && Object.keys(companies).length > 0 && (
                        <div className="site-grid">
                          {Object.entries(companies).map(([d, st]) => (
                            <span key={d} className={`site-chip ${st === "scanning" ? "scanning" : st === "done" ? "hit" : "empty"}`}>
                              <span className="site-chip-dot" /><span className="site-chip-domain">{d}</span>
                              {st === "scanning" && <SpinnerGap className="spin" />}
                              {st === "done" && <Check weight="bold" />}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="results-shell">
      <header className="results-header">
        <button className="new-search-button" onClick={() => setView("home")}><MagnifyingGlass />New search</button>
        <Brand />
        <span />
      </header>
      <section className="results-intro">
        <div><h1>{ranked.length} contractors checked</h1><p>{summary}</p></div>
        {ranked.length > 0 && (
          <button type="button" className={`kp-compare-toggle ${showCompare ? "on" : ""}`} onClick={() => setShowCompare((v) => !v)} aria-pressed={showCompare}>
            <Lightning weight="fill" />{showCompare ? "Hide" : "Show"} without vs with Exa
          </button>
        )}
        {ranked.length > 0 && (
          <button type="button" className={`kp-compare-toggle ${advanced ? "on" : ""}`} onClick={() => setAdvanced((v) => !v)} aria-pressed={advanced}>
            {advanced ? "Hide" : "Show"} advanced Exa tools
          </button>
        )}
      </section>
      <div className="kp-results-meta"><ExaSummary trace={trace} /></div>
      {showCompare && ranked[0] && <WithWithout top={ranked[0]} service={intent.service || summary} city={intent.city} />}
      {ranked.length ? (
        <>
          <section className="results-track" aria-label="Contractors">
            {ranked.map((item, i) => (
              <CompanyCard
                key={item.report.name + i}
                item={item}
                rank={i + 1}
                active={i === active}
                selected={!!selected[i]}
                onToggle={() => setSelected((s) => ({ ...s, [i]: !s[i] }))}
                watching={watch[i] ?? "idle"}
                advanced={advanced}
                onWatch={() => {
                  if (!advanced) return void startWatch(i);
                  go(i);
                  setActive(i);
                  document.getElementById("kp-watch")?.scrollIntoView({ behavior: "smooth" });
                }}
                setRef={(n) => { cardRefs.current[i] = n; }}
              />
            ))}
          </section>
          <div className="carousel-controls">
            <button onClick={() => go(active - 1)} aria-label="Previous"><ArrowLeft weight="bold" /></button>
            <span>{active + 1} / {ranked.length}</span>
            <button onClick={() => go(active + 1)} aria-label="Next"><ArrowRight weight="bold" /></button>
          </div>
          <section className="kp-more" id="kp-compare">
            <QuoteCompare
              key={Object.keys(selected).filter((k) => selected[Number(k)]).join(",") || "top"}
              companies={(Object.values(selected).some(Boolean) ? ranked.filter((_, i) => selected[i]) : ranked.slice(0, 2)).map((r) => ({ name: r.report.name, website: r.place.website }))}
            />
          </section>
          {advanced && ranked[active] && (
            <section className="kp-more" id="kp-watch">
              <WatchPanel key={ranked[active].report.name} name={ranked[active].report.name} domain={ranked[active].report.domain} />
            </section>
          )}
          {advanced && ranked[active] && (
            <section className="kp-more">
              <details className="kp-quote-home kp-quote-results">
                <summary>Check a single quote from {ranked[active].report.name}</summary>
                <QuoteChecker key={ranked[active].report.name} defaultWebsite={ranked[active].place.website} />
              </details>
            </section>
          )}
          {advanced && (
            <section className="kp-more">
              <CriteriaMatrix
                job={intent.service || summary}
                city={intent.city || "Espoo"}
                exclude={ranked.map((r) => ({ name: r.report.name, website: r.place.website }))}
              />
            </section>
          )}
          {Object.values(selected).some(Boolean) && (
            <div className="kp-floating">
              <span>{Object.values(selected).filter(Boolean).length} selected</span>
              <button className="offer-link-button" onClick={() => void draftQuotes()}><EnvelopeSimple weight="bold" />Draft quote requests</button>
            </div>
          )}
          {drafts && <DraftSheet drafts={drafts} loading={drafting} onClose={() => setDrafts(null)} />}
        </>
      ) : (
        <section className="empty-results"><h2>No contractors with a website found</h2><p>Try a broader description or another city.</p><button className="primary-button" onClick={() => setView("home")}>Try again</button></section>
      )}
    </main>
  );
}
