"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Copy,
  Envelope,
  Info,
} from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { QuoteRow, Recommendation } from "@/lib/compare";
import { Sources, draftBody } from "@/components/chat/Bubbles";
import type { Ctx, Draft } from "@/components/chat/types";
import { CandidateDrawer, StatusIcon, VerdictBadge } from "./CandidateDrawer";
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
      <CircleNotch className={s.spin} /> Loading map
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
  const [mapOpen, setMapOpen] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(false);
  // Phones: the map stays folded until asked for; the table carries the distances.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setMapOpen(false);
  }, []);
  const rows = useRef<Record<string, HTMLTableRowElement | null>>({});
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
  const unsent = outbox.filter((o) => !o.draft.sent).length;
  const empty =
    !p && !cands.length && !outbox.length && !compare && !ctx.watched.length;
  const counts = {
    green: cands.filter((c) => verdict(c) === "green").length,
    yellow: cands.filter((c) => verdict(c) === "yellow").length,
    red: cands.filter((c) => verdict(c) === "red").length,
  };
  const facts = p
    ? [
        p.trade && { k: "Trade", v: p.trade },
        (p.site?.label || p.place) && { k: "Site", v: p.site?.label || p.place },
        p.startDate
          ? { k: "Start", v: p.startDate }
          : p.contractValueEur
            ? { k: "Value", v: `~${eur(p.contractValueEur)} excl. VAT` }
            : null,
      ].filter((x): x is { k: string; v: string } => !!x)
    : [];
  const showMap = !!(site || pins.length);

  return (
    <div className={`${s.case} ${openCand ? s.caseOpen : ""}`}>
      <div className={s.scroller}>
        {/* project */}
        <header className={s.project}>
          <div className={s.projectText}>
            <span className={s.eyebrow}>
              Project
              {ctx.searching && (
                <span className={s.live}>
                  <CircleNotch className={s.spin} /> checking candidates
                </span>
              )}
            </span>
            <h1 className={s.title}>
              {p
                ? p.scope || p.service || p.summary || "Subcontractor search"
                : cands.length
                  ? "Subcontractor check"
                  : "New project"}
            </h1>
            {facts.length > 0 && (
              <dl className={s.facts}>
                {facts.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {p?.tilaajavastuu && (
              <div className={s.notice}>
                <button
                  type="button"
                  className={s.noticeLine}
                  onClick={() => setNoticeOpen((x) => !x)}
                  aria-expanded={noticeOpen}
                >
                  <Info weight="bold" aria-hidden />
                  <span>
                    {p.tilaajavastuu.applies === "below_threshold"
                      ? "Below the tilaajavastuu threshold"
                      : p.tilaajavastuu.applies === "yes"
                        ? "Tilaajavastuulaki applies"
                        : "Tilaajavastuulaki applies from €9,000"}
                  </span>
                  <small>{noticeOpen ? "Hide" : "Details"}</small>
                  <CaretDown weight="bold" className={noticeOpen ? s.caretUp : ""} aria-hidden />
                </button>
                {noticeOpen && (
                  <div className={s.noticeBody}>
                    <p>{p.tilaajavastuu.note}</p>
                    <Sources list={p.tilaajavastuu.evidence} />
                  </div>
                )}
              </div>
            )}
            {empty && (
              <p className={s.lead}>
                Describe the trade, the project and the site in the chat. The
                candidates, their tilaajavastuu checks and your drafted requests
                appear here.
              </p>
            )}
          </div>

          {showMap && (
            <div className={s.mapCard}>
              <button
                type="button"
                className={s.mapToggle}
                onClick={() => setMapOpen((x) => !x)}
                aria-expanded={mapOpen}
                aria-controls="case-map"
              >
                <span>Map</span>
                <small>
                  {cands.length ? `${pins.length} of ${cands.length} placed` : "site"}
                </small>
                <CaretDown weight="bold" className={mapOpen ? s.caretUp : ""} />
              </button>
              {mapOpen && (
                <>
                  <div id="case-map" className={s.mapBox}>
                    <CaseMap
                      site={site}
                      pins={pins}
                      selected={selected}
                      onSelect={(k) => select(k, true)}
                    />
                  </div>
                  <span className={s.legend} aria-hidden>
                    <span><i className={s.lg_site} />Site</span>
                    <span><i className={s.lg_green} />Clear</span>
                    <span><i className={s.lg_yellow} />Clarify</span>
                    <span><i className={s.lg_red} />Flag</span>
                  </span>
                  {site?.source === "default" && (
                    <small className={s.hint}>
                      No site given, so the map is centred on Espoo.
                    </small>
                  )}
                </>
              )}
            </div>
          )}
        </header>

        {/* candidates */}
        <section className={s.section} aria-labelledby="case-cands">
          <div className={s.secHead}>
            <h2 id="case-cands">Candidates</h2>
            {cands.length > 0 &&
              (ctx.searching ? (
                <small>
                  {cands.filter((c) => c.status === "done").length} of {cands.length} checked
                </small>
              ) : (
                <span className={s.tally}>
                  <small>{cands.length} checked</small>
                  {counts.green > 0 && (
                    <small><i className={s.rd_green} />{counts.green} clear</small>
                  )}
                  {counts.yellow > 0 && (
                    <small><i className={s.rd_yellow} />{counts.yellow} to clarify</small>
                  )}
                  {counts.red > 0 && (
                    <small><i className={s.rd_red} />{counts.red} red flag{counts.red === 1 ? "" : "s"}</small>
                  )}
                </span>
              ))}
          </div>
          {cands.length ? (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.colRank}>#</th>
                    <th>Company</th>
                    <th>Verdict</th>
                    <th className={s.colNum}>Fit</th>
                    <th className={s.colFinding}>Key finding</th>
                    <th className={s.colComp}>Registers</th>
                    <th className={`${s.colNum} ${s.colKm}`}>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {cands.map((c) => {
                    const v = verdict(c);
                    const regs = publicRegisters(c.report);
                    const d = dist(c);
                    const k = findingOf(c);
                    const can = !!c.report;
                    const go = () => {
                      select(c.key);
                      if (can) setOpen(c.key);
                    };
                    return (
                      <tr
                        key={c.key}
                        ref={(el) => {
                          rows.current[c.key] = el;
                        }}
                        className={`${can ? s.rowLink : ""} ${selected === c.key || open === c.key ? s.rowOn : ""}`}
                        onMouseEnter={() => setSelected(c.key)}
                        onClick={go}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            go();
                          }
                        }}
                        tabIndex={can ? 0 : -1}
                        aria-selected={open === c.key}
                      >
                        <td className={s.colRank}>
                          {c.rank ?? (c.origin === "checked" ? "–" : "")}
                        </td>
                        <td className={s.nameCell}>
                          <strong>{c.name}</strong>
                          <small>
                            {[
                              c.origin === "checked"
                                ? "checked on its own"
                                : c.report?.businessId || c.domain || "",
                              d != null ? fmtKm(d) : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                          {k && (
                            <span className={s.findingInline}>
                              <StatusIcon status={k.status} /> <span>{k.text}</span>
                            </span>
                          )}
                        </td>
                        <td>
                          {c.status === "scanning" ? (
                            <span className={s.checkingTag}>
                              <CircleNotch className={s.spin} /> Checking
                            </span>
                          ) : c.status === "failed" ? (
                            <span className={s.checkingTag}>Not checked</span>
                          ) : (
                            <VerdictBadge v={v} />
                          )}
                        </td>
                        <td className={s.colNum}>{c.fit ?? ""}</td>
                        <td className={s.colFinding}>
                          {k && (
                            <span className={s.finding} title={k.text}>
                              <StatusIcon status={k.status} />
                              <span>{k.text}</span>
                            </span>
                          )}
                        </td>
                        <td className={s.colComp}>
                          {regs.length ? (
                            <span
                              className={s.comp}
                              title={regs.map((x) => `${regName(x)}: ${x.status === "green" ? "clear" : x.status === "grey" ? "no data" : x.status === "yellow" ? "clarify" : "failed"}`).join("\n")}
                            >
                              <span className={s.regDots} aria-hidden>
                                {regs.map((x) => (
                                  <i key={x.id} className={s[`rd_${x.status}`]} />
                                ))}
                              </span>
                              <small>
                                {regs.filter((x) => x.status === "green").length}/{regs.length}
                              </small>
                            </span>
                          ) : null}
                        </td>
                        <td className={`${s.colNum} ${s.colKm}`}>
                          {d != null ? fmtKm(d) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={s.empty}>
              No candidates yet. Ask for a trade and a site, or paste a company
              to check.
            </p>
          )}
        </section>

        {/* outbox */}
        <section className={s.section} aria-labelledby="case-outbox">
          <div className={s.secHead}>
            <h2 id="case-outbox">Outbox</h2>
            {outbox.length > 0 && (
              <small>
                {unsent ? `${unsent} waiting for your OK` : "all approved"}
              </small>
            )}
          </div>
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
              Quote requests and tilaajavastuu document requests land here.
              Nothing is sent without your OK.
            </p>
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
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th className={s.colNum}>Total</th>
                        <th className={s.colNum}>Upfront</th>
                        <th>Labour</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.rows.map((r, i) => (
                        <tr key={i}>
                          <td className={s.nameCell}>
                            <strong>{r.company}</strong>
                            {i === compare.recommendation.pick && (
                              <small>recommended</small>
                            )}
                          </td>
                          <td className={s.colNum}>
                            {eur(r.totalWithVat ?? r.total)}
                          </td>
                          <td
                            className={`${s.colNum} ${(r.upfrontPct ?? 0) > 30 ? s.redText : ""}`}
                          >
                            {r.upfrontPct != null ? `${r.upfrontPct}%` : "?"}
                          </td>
                          <td>
                            {r.labourItemised ? "Itemised" : (
                              <span className={s.redText}>Not itemised</span>
                            )}
                          </td>
                          <td>
                            {r.reds || r.yellows
                              ? [
                                  r.reds && `${r.reds} serious`,
                                  r.yellows && `${r.yellows} to clarify`,
                                ]
                                  .filter(Boolean)
                                  .join(", ")
                              : "None"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className={s.empty}>
                One quote in ({ctx.quotes[0].company}). Paste the next one in
                the chat to compare.
              </p>
            )}
          </section>
        )}

        {/* watching */}
        {ctx.watched.length > 0 && (
          <section className={s.section} aria-labelledby="case-watch">
            <div className={s.secHead}>
              <h2 id="case-watch">Watching</h2>
              <small>daily Exa Monitor</small>
            </div>
            <ul className={s.plainList}>
              {ctx.watched.map((w) => (
                <li key={w.monitorId}>
                  <strong>{w.name}</strong>
                  <small>
                    News, register changes, bankruptcy and payment-default
                    notices{w.domain ? ` · ${w.domain}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {openCand && (
        <CandidateDrawer
          key={openCand.key}
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
