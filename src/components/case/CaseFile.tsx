"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Bell,
  Buildings,
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  Copy,
  Envelope,
  FileText,
  Gavel,
  MapPin,
  MapTrifold,
  PaperPlaneTilt,
  Scales,
  UsersThree,
  XCircle,
} from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { QuoteRow, Recommendation } from "@/lib/compare";
import { Sources, draftBody, keyFinding } from "@/components/chat/Bubbles";
import type { Ctx, Draft } from "@/components/chat/types";
import { CandidateDrawer, Dot } from "./CandidateDrawer";
import {
  addressOf,
  compliance,
  fmtKm,
  fromRanked,
  geocodeClient,
  keyOf,
  km,
  verdict,
  VERDICT_LABEL,
  type Cand,
  type Geo,
} from "./model";
import type { Pin } from "./CaseMap";
import s from "./Case.module.css";

const CaseMap = dynamic(() => import("./CaseMap"), {
  ssr: false,
  loading: () => (
    <div className={s.mapLoading}>
      <CircleNotch className={s.spin} /> Loading map…
    </div>
  ),
});

export type OutboxItem = { id: string; draft: Draft };

type Props = {
  ctx: Ctx;
  outbox: OutboxItem[];
  compare?: { rows: QuoteRow[]; recommendation: Recommendation };
  busy: boolean;
  onDraft: (r: Ranked) => void;
  onWatch: (target: { name: string; domain?: string }) => void;
  onDraftChange: (id: string, d: Draft) => void;
  onPrefill: (text: string) => void;
};

const eur = (n?: number) =>
  n == null ? "?" : `${Math.round(n).toLocaleString("fi-FI")} €`;
const asRanked = (c: Cand): Ranked | null =>
  c.report
    ? { place: c.place, report: c.report, why: c.why, fit: c.fit ?? 0 }
    : null;
const mailto = (d: Draft, body: string) =>
  `mailto:${d.email ?? ""}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`;

export default function CaseFile({
  ctx,
  outbox,
  compare,
  busy,
  onDraft,
  onWatch,
  onDraftChange,
  onPrefill,
}: Props) {
  const [selected, setSelected] = useState<string | undefined>();
  const [open, setOpen] = useState<string | undefined>();
  const [geo, setGeo] = useState<Record<string, Geo | null>>({});
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const p = ctx.project;

  // ---- candidates: the live search while it runs, then the ranking (+ any company checked on its own)
  const cands = useMemo<Cand[]>(() => {
    if (ctx.searching && ctx.live?.length) {
      return ctx.live.map((l) => ({
        key: keyOf(l.report, l.place, l.domain),
        name: l.report?.name || l.name,
        domain: l.domain,
        site: l.place.website ?? l.report?.website,
        place: l.place,
        report: l.report,
        why: [],
        status: l.status,
        origin: "live" as const,
      }));
    }
    const list = ctx.ranked.slice(0, 8).map((r, i) => fromRanked(r, i + 1));
    if (ctx.checked) {
      const c = fromRanked(ctx.checked, undefined, "checked");
      if (!list.some((x) => x.key === c.key)) list.push(c);
    }
    return list;
  }, [ctx.searching, ctx.live, ctx.ranked, ctx.checked]);

  // ---- coordinates: listing lat/lng, else geocode the registered address
  useEffect(() => {
    for (const c of cands) {
      if (c.place.lat != null && c.place.lng != null) continue;
      const a = addressOf(c);
      if (!a || a in geo) continue;
      setGeo((g) => (a in g ? g : { ...g, [a]: null }));
      void geocodeClient(a).then((pt) => setGeo((g) => ({ ...g, [a]: pt })));
    }
  }, [cands, geo]);

  const site = p?.site;
  const coord = (c: Cand) =>
    c.place.lat != null && c.place.lng != null
      ? { lat: c.place.lat, lng: c.place.lng }
      : (() => {
          const a = addressOf(c);
          const g = a ? geo[a] : null;
          return g ? { lat: g.lat, lng: g.lng } : null;
        })();
  const dist = (c: Cand) => {
    const pt = coord(c);
    return site && pt ? km(site, pt) : undefined;
  };

  const pins: Pin[] = cands.flatMap((c) => {
    const pt = coord(c);
    if (!pt) return [];
    const d = dist(c);
    return [
      {
        key: c.key,
        ...pt,
        label: c.name,
        rank: c.rank,
        verdict: verdict(c),
        sub: [
          VERDICT_LABEL[verdict(c)],
          c.fit != null ? `fit ${c.fit}/100` : "",
          d != null ? `${fmtKm(d)} from site` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ];
  });

  const select = (key: string, scroll = false) => {
    setSelected(key);
    if (scroll)
      rows.current[key]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  };

  const openCand = cands.find((c) => c.key === open);
  const docsToRequest = cands.reduce(
    (n, c) => n + (compliance(c.report)?.docs ?? 0),
    0,
  );
  const unsent = outbox.filter((o) => !o.draft.sent).length;
  const empty =
    !p && !cands.length && !outbox.length && !compare && !ctx.watched.length;

  const nav: { id: string; label: string; n?: number }[] = [
    { id: "case-map", label: "Map", n: pins.length || undefined },
    { id: "case-cands", label: "Candidates", n: cands.length || undefined },
    { id: "case-outbox", label: "Outbox", n: outbox.length || undefined },
    { id: "case-quotes", label: "Quotes", n: compare?.rows.length },
    { id: "case-watch", label: "Watching", n: ctx.watched.length || undefined },
  ];

  return (
    <div className={s.case}>
      <div className={s.scroller}>
        {/* (a) project header */}
        <section className={s.project}>
          <div className={s.eyebrow}>
            <ClipboardText weight="fill" /> Case file
            {ctx.searching && (
              <span className={s.live}>
                <i /> live
              </span>
            )}
          </div>
          {p ? (
            <>
              <h2>
                {p.scope || p.service || p.summary || "Subcontractor search"}
              </h2>
              <div className={s.facts}>
                {p.trade && (
                  <span>
                    <Buildings weight="bold" /> {p.trade}
                  </span>
                )}
                {(p.site?.label || p.place) && (
                  <span>
                    <MapPin weight="bold" /> {p.site?.label || p.place}
                  </span>
                )}
                {p.startDate && (
                  <span>
                    <CalendarBlank weight="bold" /> Start {p.startDate}
                  </span>
                )}
                {p.contractValueEur ? (
                  <span>
                    <Scales weight="bold" /> ~{eur(p.contractValueEur)} excl.
                    VAT
                  </span>
                ) : null}
              </div>
              {p.tilaajavastuu && (
                <div
                  className={`${s.tv} ${p.tilaajavastuu.applies === "below_threshold" ? s.tvSoft : ""}`}
                >
                  <Gavel weight="fill" />
                  <div>
                    <strong>
                      {p.tilaajavastuu.applies === "below_threshold"
                        ? "Below the tilaajavastuu threshold"
                        : p.tilaajavastuu.applies === "yes"
                          ? "Tilaajavastuulaki applies"
                          : "Tilaajavastuulaki applies from €9,000"}
                    </strong>
                    <p>{p.tilaajavastuu.note}</p>
                    <Sources list={p.tilaajavastuu.evidence} />
                  </div>
                </div>
              )}
              {cands.length > 0 && (
                <div className={s.stats}>
                  <div>
                    <b>{cands.length}</b>
                    <small>candidates</small>
                  </div>
                  <div>
                    <b className={s.okText}>
                      {cands.filter((c) => verdict(c) === "green").length}
                    </b>
                    <small>look clear</small>
                  </div>
                  <div>
                    <b className={s.redText}>
                      {cands.filter((c) => verdict(c) === "red").length}
                    </b>
                    <small>red flags</small>
                  </div>
                  <div>
                    <b>{docsToRequest}</b>
                    <small>docs to request</small>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <h2>{cands.length ? "Subcontractor check" : "New project"}</h2>
              {empty && (
                <p className={s.lead}>
                  Describe the trade, the project and the site in the chat. This
                  file fills in as Kilpi works: the site and every candidate on
                  a map, the tilaajavastuu checklist per company, drafted quote
                  and document requests, quotes side by side, and the companies
                  you keep watching.
                </p>
              )}
            </>
          )}
        </section>

        <nav className={s.nav} aria-label="Case file sections">
          {nav.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(n.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {n.label}
              {n.n != null && <b>{n.n}</b>}
            </a>
          ))}
        </nav>

        {/* (b) map */}
        <section id="case-map" className={s.section}>
          <header className={s.secHead}>
            <MapTrifold weight="fill" />
            <h3>Site and candidates</h3>
            <span className={s.legend}>
              <i className={s.lg_site} />
              Site
              <i className={s.lg_green} />
              Clear
              <i className={s.lg_yellow} />
              Clarify
              <i className={s.lg_red} />
              Flag
              <i className={s.lg_grey} />
              Checking
            </span>
          </header>
          <div className={s.mapBox}>
            {site || pins.length ? (
              <CaseMap
                site={site}
                pins={pins}
                selected={selected}
                onSelect={(k) => select(k, true)}
              />
            ) : (
              <div className={s.mapEmpty}>
                <MapPin weight="duotone" />
                <span>
                  The project site and each subcontractor appear here once you
                  describe the job.
                </span>
              </div>
            )}
          </div>
          {site?.source === "default" && (
            <small className={s.hint}>
              No site given, so the search is centred on Espoo. Name the
              site&apos;s city or district for distances that matter.
            </small>
          )}
        </section>

        {/* (c) candidates */}
        <section id="case-cands" className={s.section}>
          <header className={s.secHead}>
            <UsersThree weight="fill" />
            <h3>Candidates</h3>
            {cands.length > 0 && (
              <small>
                {ctx.searching
                  ? "checking…"
                  : "best fit first · tap for the full checklist"}
              </small>
            )}
          </header>
          {cands.length ? (
            <ul className={s.cands}>
              {cands.map((c) => {
                const v = verdict(c);
                const comp = compliance(c.report);
                const d = dist(c);
                const k =
                  c.report && c.status === "done"
                    ? keyFinding({
                        place: c.place,
                        report: c.report,
                        why: c.why,
                        fit: c.fit ?? 0,
                      })
                    : null;
                return (
                  <li
                    key={c.key}
                    ref={(el) => {
                      rows.current[c.key] = el;
                    }}
                    className={`${s.cand} ${selected === c.key ? s.candOn : ""}`}
                    onMouseEnter={() => setSelected(c.key)}
                  >
                    <button
                      type="button"
                      className={s.candBtn}
                      onClick={() => {
                        select(c.key);
                        if (c.report) setOpen(c.key);
                      }}
                      disabled={!c.report}
                    >
                      <span className={`${s.badge} ${s[`b_${v}`]}`}>
                        {c.status === "scanning" ? (
                          <CircleNotch className={s.spin} />
                        ) : (
                          (c.rank ?? (c.origin === "checked" ? "✓" : "•"))
                        )}
                      </span>
                      <span className={s.candMain}>
                        <span className={s.candTop}>
                          <strong>{c.name}</strong>
                          {c.fit != null && (
                            <span
                              className={`${s.fit} ${c.fit >= 70 ? s.fitHi : c.fit >= 45 ? s.fitMid : s.fitLo}`}
                            >
                              {c.fit}
                            </span>
                          )}
                        </span>
                        <span className={s.candMeta}>
                          {c.origin === "checked" && (
                            <em>checked on its own</em>
                          )}
                          {c.domain && <span>{c.domain}</span>}
                          {d != null && (
                            <span className={s.km}>
                              <MapPin weight="fill" />
                              {fmtKm(d)} from site
                            </span>
                          )}
                          {c.status === "scanning" && (
                            <span>checking registers and site…</span>
                          )}
                          {c.status === "failed" && (
                            <span>could not be checked</span>
                          )}
                        </span>
                        {k && (
                          <span className={`${s.kf} ${s[`kf_${k.status}`]}`}>
                            <Dot status={k.status} />
                            <span>{k.text}</span>
                          </span>
                        )}
                        {comp && (
                          <span className={s.comp}>
                            <span className={s.bar} aria-hidden>
                              <i
                                style={{
                                  width: `${comp.total ? (100 * comp.verified) / comp.total : 0}%`,
                                }}
                              />
                              {comp.red > 0 && (
                                <i
                                  className={s.barRed}
                                  style={{
                                    width: `${(100 * comp.red) / comp.total}%`,
                                  }}
                                />
                              )}
                            </span>
                            <span>
                              <b>
                                {comp.verified}/{comp.total}
                              </b>{" "}
                              {comp.b2b ? "tilaajavastuu checks" : "checks"}
                              {comp.docs > 0 && (
                                <>
                                  {" "}
                                  · <b>{comp.docs}</b> doc
                                  {comp.docs === 1 ? "" : "s"} to request
                                </>
                              )}
                            </span>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={s.empty}>
              No candidates yet. Ask for a trade and a site, or paste a company
              to check.
            </p>
          )}
        </section>

        {/* (d) outbox */}
        <section id="case-outbox" className={s.section}>
          <header className={s.secHead}>
            <PaperPlaneTilt weight="fill" />
            <h3>Outbox</h3>
            {outbox.length > 0 && (
              <small>
                {unsent ? `${unsent} waiting for your OK` : "all approved"}
              </small>
            )}
          </header>
          {outbox.length ? (
            <ul className={s.outbox}>
              {outbox.map((o) => (
                <OutboxRow
                  key={o.id}
                  item={o}
                  onChange={(d) => onDraftChange(o.id, d)}
                />
              ))}
            </ul>
          ) : (
            <p className={s.empty}>
              Quote requests (RFQ) and tilaajavastuu document requests land
              here. Nothing is sent without your OK.
            </p>
          )}
        </section>

        {/* (e) quotes */}
        <section id="case-quotes" className={s.section}>
          <header className={s.secHead}>
            <FileText weight="fill" />
            <h3>Quotes</h3>
          </header>
          {compare ? (
            <>
              <p className={s.reco}>{compare.recommendation.headline}</p>
              <div className={s.qWrap}>
                <table className={s.qTable}>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Total</th>
                      <th>Upfront</th>
                      <th>Labour</th>
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.rows.map((r, i) => (
                      <tr
                        key={i}
                        className={
                          i === compare.recommendation.pick ? s.qPick : ""
                        }
                      >
                        <td>
                          {r.company}
                          {i === compare.recommendation.pick && <em> pick</em>}
                        </td>
                        <td>{eur(r.totalWithVat ?? r.total)}</td>
                        <td
                          className={(r.upfrontPct ?? 0) > 30 ? s.redText : ""}
                        >
                          {r.upfrontPct != null ? `${r.upfrontPct}%` : "?"}
                        </td>
                        <td>
                          {r.labourItemised ? (
                            <CheckCircle weight="fill" className={s.okText} />
                          ) : (
                            <XCircle weight="fill" className={s.redText} />
                          )}
                        </td>
                        <td>
                          {r.reds > 0 && (
                            <span className={`${s.flag} ${s.flagRed}`}>
                              {r.reds}
                            </span>
                          )}
                          {r.yellows > 0 && (
                            <span className={`${s.flag} ${s.flagYellow}`}>
                              {r.yellows}
                            </span>
                          )}
                          {!r.reds && !r.yellows && (
                            <CheckCircle weight="fill" className={s.okText} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className={s.empty}>
              {ctx.quotes.length === 1
                ? `One quote in (${ctx.quotes[0].company}). Paste the next one in the chat to compare.`
                : "Paste subcontractor quotes into the chat: each is checked, then compared side by side here."}
            </p>
          )}
        </section>

        {/* (f) watching */}
        <section id="case-watch" className={s.section}>
          <header className={s.secHead}>
            <Bell weight="fill" />
            <h3>Watching</h3>
          </header>
          {ctx.watched.length ? (
            <ul className={s.watchList}>
              {ctx.watched.map((w) => (
                <li key={w.monitorId}>
                  <span className={s.pulse} aria-hidden />
                  <div>
                    <strong>{w.name}</strong>
                    <small>
                      Daily Exa Monitor: news, register changes, bankruptcy and
                      payment-default notices{w.domain ? ` · ${w.domain}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.empty}>
              Subcontractors you sign with can be watched for the length of the
              project. Open a candidate and tap Watch.
            </p>
          )}
        </section>
      </div>

      {openCand && (
        <CandidateDrawer
          cand={openCand}
          distance={dist(openCand)}
          busy={busy}
          watching={ctx.watched.some((w) => w.name === openCand.name)}
          onClose={() => setOpen(undefined)}
          onDraft={() => {
            const r = asRanked(openCand);
            if (r) onDraft(r);
            setOpen(undefined);
          }}
          onWatch={() => {
            onWatch({ name: openCand.name, domain: openCand.domain });
            setOpen(undefined);
          }}
          onAsk={() => {
            onPrefill(`Tell me more about ${openCand.name}: `);
            setOpen(undefined);
          }}
        />
      )}
    </div>
  );
}

function OutboxRow({
  item,
  onChange,
}: {
  item: OutboxItem;
  onChange: (d: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = item.draft;
  const body = draftBody(d);
  return (
    <li className={`${s.mail} ${d.sent ? s.mailSent : ""}`}>
      <div className={s.mailTop}>
        <button
          type="button"
          className={s.mailHead}
          onClick={() => setOpen((x) => !x)}
          aria-expanded={open}
        >
          <span className={`${s.tag} ${d.kind === "docs" ? s.tagDocs : ""}`}>
            {d.kind === "docs"
              ? "Documents"
              : d.kind === "rfq"
                ? "RFQ"
                : "Request"}
          </span>
          <span className={s.mailMain}>
            <strong>{d.name}</strong>
            <small>{d.subject}</small>
          </span>
          {d.sent ? (
            <span className={s.sentTag}>
              <CheckCircle weight="fill" /> Approved
            </span>
          ) : (
            <span className={s.waitTag}>Needs OK</span>
          )}
        </button>
        {!d.sent && (
          <a
            className={s.sendBtn}
            href={mailto(d, body)}
            onClick={() => onChange({ ...d, sent: true, editing: false })}
          >
            <PaperPlaneTilt weight="fill" /> Approve and send
          </a>
        )}
      </div>
      {open && (
        <div className={s.mailBody}>
          <div className={s.mailTo}>
            <Envelope weight="bold" />{" "}
            {d.email ?? "No email found: add one in your mail app"}
          </div>
          {d.kind === "docs" && d.documents?.length ? (
            <ul className={s.docList}>
              {d.documents.map((x, i) => (
                <li key={i}>
                  <FileText weight="bold" /> {x.en}
                  {x.law && <small> · {x.law}</small>}
                </li>
              ))}
            </ul>
          ) : null}
          <pre>{body}</pre>
          <div className={s.mailActions}>
            <div className={s.langToggle} role="group" aria-label="Language">
              {(["fi", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={d.lang === l ? s.on : ""}
                  onClick={() => onChange({ ...d, lang: l, edited: undefined })}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={s.ghostBtn}
              onClick={() => {
                void navigator.clipboard?.writeText(body).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Copy weight="bold" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
