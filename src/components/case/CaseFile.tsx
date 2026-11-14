"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CaretDown, CheckCircle, CircleNotch, Copy, Envelope } from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { Check } from "@/lib/verify";
import type { QuoteRow, Recommendation } from "@/lib/compare";
import { Sources, companyKey, draftBody } from "@/components/chat/Bubbles";
import type { Ctx, Draft } from "@/components/chat/types";
import { CandidateDrawer, Glyph, VerdictWord } from "./CandidateDrawer";
import {
  addressOf,
  fmtKm,
  findingOf,
  fromRanked,
  geocodeClient,
  keyOf,
  km,
  publicRegisters,
  regName,
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
      <CircleNotch className={s.spin} />
    </div>
  ),
});

export type OutboxItem = { id: string; draft: Draft };

type Props = {
  ctx: Ctx;
  outbox: OutboxItem[];
  compare?: { rows: QuoteRow[]; recommendation: Recommendation };
  busy: boolean;
  /** Companies ticked for "draft for my picks" (chat's companyKey). */
  picked: string[];
  onTogglePick: (key: string) => void;
  onDraft: (r: Ranked) => void;
  onWatch: (target: { name: string; domain?: string }) => void;
  onDraftChange: (id: string, d: Draft) => void;
  onPrefill: (text: string) => void;
};

const eur = (n?: number) => (n == null ? "?" : `${Math.round(n).toLocaleString("fi-FI")} €`);
const asRanked = (c: Cand): Ranked | null => (c.report ? { place: c.place, report: c.report, why: c.why, fit: c.fit ?? 0 } : null);
const mailto = (d: Draft, body: string) => `mailto:${d.email ?? ""}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`;

/** Matrix column headers: short, the full register name in the tooltip. */
const REG_SHORT: Record<string, string> = {
  "tv-prepayment": "Prepay",
  "tv-employer": "Employer",
  "tv-vat": "VAT",
  "tv-trade-register": "Trade",
  "tv-tax": "Tax debt",
  "tv-insolvency": "Insolv.",
  "tv-reliable-partner": "Partner",
};
const STATUS_TITLE = { green: "clear", yellow: "clarify", red: "failed", grey: "no data" } as const;
/** A check backed by a web source the drawer can cite. */
const sourced = (c: Check) => c.evidence.some((e) => !!e.url && /^https?:/i.test(e.url));

export default function CaseFile({ ctx, outbox, compare, busy, picked, onTogglePick, onDraft, onWatch, onDraftChange, onPrefill }: Props) {
  const [selected, setSelected] = useState<string | undefined>();
  const [open, setOpen] = useState<string | undefined>();
  // A clicked matrix cell: open that company's drawer at that check (n re-triggers on a repeat click).
  const [focus, setFocus] = useState<{ id: string; n: number } | undefined>();
  const [geo, setGeo] = useState<Record<string, Geo | null>>({});
  const [mapOpen, setMapOpen] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(false);
  // Phones: the map stays folded until asked for; the matrix carries the distances.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setMapOpen(false);
  }, []);
  const rows = useRef<Record<string, HTMLTableSectionElement | null>>({});
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
        sub: [VERDICT_LABEL[verdict(c)], c.fit != null ? `fit ${c.fit}` : "", d != null ? `${fmtKm(d)} from site` : ""].filter(Boolean).join(" · "),
      },
    ];
  });

  const select = (key: string, scroll = false) => {
    setSelected(key);
    if (scroll) rows.current[key]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // The register columns: every public register any candidate was checked against, in the fixed order.
  const regCols = useMemo(() => {
    const seen = new Map<string, Check>();
    for (const c of cands) for (const k of publicRegisters(c.report)) if (!seen.has(k.id)) seen.set(k.id, k);
    return [...seen.values()];
  }, [cands]);

  const openCand = cands.find((c) => c.key === open);
  const unsent = outbox.filter((o) => !o.draft.sent).length;
  const empty = !p && !cands.length && !outbox.length && !compare && !ctx.watched.length;
  const done = cands.filter((c) => c.status === "done");
  const counts = {
    green: cands.filter((c) => verdict(c) === "green").length,
    yellow: cands.filter((c) => verdict(c) === "yellow").length,
    red: cands.filter((c) => verdict(c) === "red").length,
  };
  const meta = p
    ? [
        p.trade,
        p.site?.label || p.place,
        p.startDate ? `start ${p.startDate}` : p.contractValueEur ? `~${eur(p.contractValueEur)} excl. VAT` : "",
      ].filter(Boolean)
    : [];
  const tv = p?.tilaajavastuu;
  const tvLine = tv
    ? tv.applies === "below_threshold"
      ? "Below the tilaajavastuu threshold"
      : `Tilaajavastuulaki applies${tv.applies === "yes" ? (p?.contractValueEur ? ` (${eur(p.contractValueEur)})` : "") : " from €9,000"}`
    : "";
  const showMap = !!(site || pins.length);
  const cols = 3 + regCols.length + (regCols.length ? 1 : 0) + 2; // company, fit, distance, registers (+ strip), verdict, finding

  return (
    <div className={`${s.case} ${openCand ? s.caseOpen : ""}`}>
      <div className={`${s.scroller} ${empty ? s.scrollerEmpty : ""}`}>
        {empty ? (
          <section className={s.hero} aria-labelledby="case-hero">
            <h1 id="case-hero" className={s.heroTitle}>
              Vet subcontractors before you sign.
            </h1>
            <p className={s.heroSub}>Describe the trade, the project and the site in the chat. Candidates, their register checks and your drafted requests collect here. Nothing is sent without your OK.</p>
            <ol className={s.heroSteps}>
              <li>
                <strong>Candidates</strong>
                <p>Ranked by fit and distance to the site.</p>
              </li>
              <li>
                <strong>Register checks</strong>
                <p>Every tilaajavastuu check, cited to its source.</p>
              </li>
              <li>
                <strong>Outbox</strong>
                <p>Quote and document requests, drafted for your OK.</p>
              </li>
            </ol>
          </section>
        ) : (
        <>
        <header className={`${s.project} ${showMap ? s.projectMap : ""}`}>
          <div className={s.projectText}>
            <h1 className={s.title}>
              {p ? p.scope || p.service || p.summary || "Subcontractor search" : cands.length ? "Subcontractor check" : "New project"}
            </h1>
            {meta.length > 0 && <p className={s.meta}>{meta.join(" · ")}</p>}
            {tv && (
              <div className={s.notice}>
                <button type="button" className={s.noticeLine} onClick={() => setNoticeOpen((x) => !x)} aria-expanded={noticeOpen}>
                  {tvLine}
                  <CaretDown weight="bold" className={noticeOpen ? s.caretUp : ""} aria-hidden />
                </button>
                {noticeOpen && (
                  <div className={s.noticeBody}>
                    <p>{tv.note}</p>
                    {tv.obligations?.length ? (
                      <ul>
                        {tv.obligations.map((o) => (
                          <li key={o}>{o}</li>
                        ))}
                      </ul>
                    ) : null}
                    <Sources list={tv.evidence} />
                  </div>
                )}
              </div>
            )}
            {ctx.searching && (
              <p className={s.live}>
                <CircleNotch className={s.spin} aria-hidden /> Checking {done.length} of {cands.length}
              </p>
            )}
          </div>

          {showMap && (
            <div className={s.mapSlot}>
              <button type="button" className={s.mapToggle} onClick={() => setMapOpen((x) => !x)} aria-expanded={mapOpen} aria-controls="case-map">
                {mapOpen ? "Hide map" : "Show map"}
                <CaretDown weight="bold" className={mapOpen ? s.caretUp : ""} aria-hidden />
              </button>
              {mapOpen && (
                <div id="case-map" className={s.mapBox}>
                  <CaseMap site={site} pins={pins} selected={selected} onSelect={(k) => select(k, true)} />
                </div>
              )}
              {mapOpen && site?.source === "default" && <small className={s.hint}>No site given; centred on Espoo.</small>}
            </div>
          )}
        </header>

        {/* candidates: the comparison matrix */}
        <section className={s.section} aria-labelledby="case-cands">
          <div className={s.secHead}>
            <h2 id="case-cands">Candidates</h2>
            {cands.length > 0 && !ctx.searching && (
              <span className={s.tally}>
                {[
                  `${cands.length} checked`,
                  counts.green && `${counts.green} clear`,
                  counts.yellow && `${counts.yellow} to clarify`,
                  counts.red && `${counts.red} red flag${counts.red === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          {cands.length ? (
            <div className={s.matrixWrap}>
              <table className={s.matrix}>
                <thead>
                  <tr>
                    <th className={s.cCompany}>Company</th>
                    <th className={s.cNum}>Fit</th>
                    <th className={`${s.cNum} ${s.cKm}`}>Distance</th>
                    {regCols.map((k, i) => (
                      <th key={k.id} className={`${s.cReg} ${i === 0 ? s.cRegFirst : ""}`} title={regName(k)}>
                        {REG_SHORT[k.id] ?? regName(k)}
                      </th>
                    ))}
                    {regCols.length > 0 && <th className={s.cStrip}>Registers</th>}
                    <th className={`${s.cVerdict} ${regCols.length ? s.cRegAfter : ""}`}>Verdict</th>
                    <th className={s.cFinding}>Finding</th>
                  </tr>
                </thead>
                {cands.map((c) => {
                  const v = verdict(c);
                  const regs = publicRegisters(c.report);
                  const d = dist(c);
                  const k = findingOf(c);
                  const can = !!c.report;
                  const ranked = asRanked(c);
                  const pickable = c.origin === "ranked" && !!ranked;
                  const pk = ranked ? companyKey(ranked) : "";
                  const isPicked = pickable && picked.includes(pk);
                  const go = (checkId?: string) => {
                    select(c.key);
                    if (!can) return;
                    setOpen(c.key);
                    setFocus(checkId ? { id: checkId, n: Date.now() } : undefined);
                  };
                  return (
                    <tbody
                      key={c.key}
                      ref={(el) => {
                        rows.current[c.key] = el;
                      }}
                      className={`${s.cand} ${can ? s.candLink : ""} ${open === c.key ? s.candOpen : selected === c.key ? s.candHover : ""}`}
                      onMouseEnter={() => setSelected(c.key)}
                      onClick={() => go()}
                    >
                      <tr>
                        <td className={s.cCompany}>
                          <span className={s.company}>
                            <span className={s.pickSlot}>
                                {pickable && (
                                  <input
                                    type="checkbox"
                                    className={s.pick}
                                    checked={isPicked}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => onTogglePick(pk)}
                                    aria-label={`Pick ${c.name}`}
                                    title="Pick for a quote request"
                                  />
                                )}
                            </span>
                            <span className={s.rank}>{c.rank ?? ""}</span>
                            <button
                              type="button"
                              className={s.nameBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                go();
                              }}
                              disabled={!can}
                              aria-expanded={open === c.key}
                            >
                              <span className={s.name}>{c.name}</span>
                              <span className={s.sub}>
                                {c.origin === "checked" ? "Checked separately" : c.report?.businessId || c.domain || ""}
                                {d != null && <span className={s.subKm}> · {fmtKm(d)}</span>}
                                {c.fit != null && <span className={s.subFit}> · fit {c.fit}</span>}
                              </span>
                            </button>
                          </span>
                        </td>
                        <td className={`${s.cNum} ${s.fit}`}>{c.fit ?? ""}</td>
                        <td className={`${s.cNum} ${s.cKm} ${s.km}`}>{d != null ? fmtKm(d) : ""}</td>
                        {regCols.map((col, i) => {
                          const x = regs.find((r) => r.id === col.id);
                          return (
                            <td key={col.id} className={`${s.cReg} ${i === 0 ? s.cRegFirst : ""}`} title={x ? `${regName(x)}: ${STATUS_TITLE[x.status]}` : undefined}>
                              {x && can ? (
                                <button
                                  type="button"
                                  className={`${s.cell} ${open === c.key && focus?.id === x.id ? s.cellOn : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    go(x.id);
                                  }}
                                  aria-label={`${c.name}, ${regName(x)}: ${STATUS_TITLE[x.status]}. Show the source`}
                                >
                                  <Glyph status={x.status} />
                                  {sourced(x) && <i className={s.citeMark} aria-hidden />}
                                </button>
                              ) : x ? (
                                <Glyph status={x.status} />
                              ) : c.status === "scanning" ? (
                                <span className={s.pending} aria-hidden />
                              ) : null}
                            </td>
                          );
                        })}
                        {regCols.length > 0 && (
                          <td className={s.cStrip}>
                            <span className={s.strip}>
                              {regCols.map((col) => {
                                const x = regs.find((r) => r.id === col.id);
                                return (
                                  <span key={col.id} title={x ? `${regName(x)}: ${STATUS_TITLE[x.status]}` : regName(col)}>
                                    {x && can ? (
                                      <button
                                        type="button"
                                        className={`${s.cell} ${s.cellSm} ${open === c.key && focus?.id === x.id ? s.cellOn : ""}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          go(x.id);
                                        }}
                                        aria-label={`${c.name}, ${regName(x)}: ${STATUS_TITLE[x.status]}. Show the source`}
                                      >
                                        <Glyph status={x.status} />
                                      </button>
                                    ) : x ? (
                                      <Glyph status={x.status} />
                                    ) : c.status === "scanning" ? (
                                      <span className={s.pending} aria-hidden />
                                    ) : null}
                                  </span>
                                );
                              })}
                            </span>
                          </td>
                        )}
                        <td className={`${s.cVerdict} ${regCols.length ? s.cRegAfter : ""}`}>
                          {c.status === "scanning" ? (
                            <span className={s.checking}>
                              <CircleNotch className={s.spin} aria-hidden /> Checking
                            </span>
                          ) : c.status === "failed" ? (
                            <span className={s.checking}>Not checked</span>
                          ) : (
                            <VerdictWord v={v} />
                          )}
                        </td>
                        <td className={s.cFinding} title={k?.text}>
                          {k?.text}
                        </td>
                      </tr>
                      {k && (
                        <tr className={s.findRow}>
                          <td colSpan={cols}>
                            <span>{k.text}</span>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            </div>
          ) : (
            <p className={s.empty}>No candidates yet. Ask for a trade and a site, or paste a company to check.</p>
          )}
        </section>

        {/* outbox */}
        <section className={s.section} aria-labelledby="case-outbox">
          <div className={s.secHead}>
            <h2 id="case-outbox">Outbox</h2>
            {outbox.length > 0 && <span className={s.tally}>{unsent ? `${unsent} waiting for your OK` : "All approved"}</span>}
          </div>
          {outbox.length ? (
            <ul className={s.outbox}>
              {outbox.map((o) => (
                <OutboxRow key={o.id} item={o} onChange={(d) => onDraftChange(o.id, d)} />
              ))}
            </ul>
          ) : (
            <p className={s.empty}>Quote and document requests land here. Nothing is sent without your OK.</p>
          )}
        </section>

        {/* quotes */}
        {(compare || ctx.quotes.length > 0) && (
          <section className={s.section} aria-labelledby="case-quotes">
            <div className={s.secHead}>
              <h2 id="case-quotes">Quotes</h2>
            </div>
            {compare ? (
              <>
                <p className={s.reco}>{compare.recommendation.headline}</p>
                <div className={s.matrixWrap}>
                  <table className={`${s.matrix} ${s.plainTable}`}>
                    <thead>
                      <tr>
                        <th className={s.cCompany}>Company</th>
                        <th className={s.cNum}>Total</th>
                        <th className={s.cNum}>Upfront</th>
                        <th>Labour</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.rows.map((r, i) => (
                        <tr key={i}>
                          <td className={s.cCompany}>
                            <span className={s.name}>{r.company}</span>
                            {i === compare.recommendation.pick && <span className={s.sub}>Recommended</span>}
                          </td>
                          <td className={`${s.cNum} ${s.fit}`}>{eur(r.totalWithVat ?? r.total)}</td>
                          <td className={`${s.cNum} ${(r.upfrontPct ?? 0) > 30 ? s.redText : ""}`}>{r.upfrontPct != null ? `${r.upfrontPct}%` : "?"}</td>
                          <td>{r.labourItemised ? "Itemised" : <span className={s.redText}>Not itemised</span>}</td>
                          <td>
                            {r.reds || r.yellows
                              ? [r.reds && `${r.reds} serious`, r.yellows && `${r.yellows} to clarify`].filter(Boolean).join(", ")
                              : "None"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className={s.empty}>One quote in ({ctx.quotes[0].company}). Paste the next one in the chat to compare.</p>
            )}
          </section>
        )}

        {/* watching */}
        {ctx.watched.length > 0 && (
          <section className={s.section} aria-labelledby="case-watch">
            <div className={s.secHead}>
              <h2 id="case-watch">Watching</h2>
              <span className={s.tally}>Daily, via Exa Monitor</span>
            </div>
            <ul className={s.plainList}>
              {ctx.watched.map((w) => (
                <li key={w.monitorId}>
                  <span className={s.name}>{w.name}</span>
                  <span className={s.sub}>News, register changes, bankruptcy and payment-default notices{w.domain ? ` · ${w.domain}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        </>
        )}
      </div>

      {openCand && (
        <CandidateDrawer
          key={openCand.key}
          cand={openCand}
          focus={focus}
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
    <li className={s.mail}>
      <div className={s.mailTop}>
        <button
          type="button"
          className={s.mailHead}
          onClick={() => setOpen((x) => !x)}
          aria-expanded={open}
        >
          <CaretDown weight="bold" className={`${s.caret} ${open ? s.caretUp : ""}`} />
          <span className={s.mailMain}>
            <strong>
              {d.name}
              <span className={s.kind}>
                {d.kind === "docs"
                  ? "Document request"
                  : d.kind === "rfq"
                    ? "Quote request"
                    : "Request"}
              </span>
            </strong>
            <small>{d.subject}</small>
          </span>
        </button>
        {d.sent ? (
          <span className={s.sentTag}>
            <CheckCircle weight="fill" /> Approved
          </span>
        ) : (
          <a
            className={s.sendBtn}
            href={mailto(d, body)}
            onClick={() => onChange({ ...d, sent: true, editing: false })}
          >
            Approve and send
          </a>
        )}
      </div>
      {open && (
        <div className={s.mailBody}>
          <div className={s.mailTo}>
            <Envelope weight="bold" />{" "}
            {d.email ?? "No email found: add one in your mail app"}
          </div>
          <pre>{body}</pre>
          <div className={s.mailActions}>
            <div className={s.langToggle} role="group" aria-label="Language">
              {(["fi", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={d.lang === l ? s.on : ""}
                  aria-pressed={d.lang === l}
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
