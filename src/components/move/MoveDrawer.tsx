"use client";

// The right-hand drawer of the move file: one AREA (why, every criterion with its source, nearby
// places, local news, listings) or one LISTING (details, live deep research, the viewing request).
// Only what the API returned is shown; a missing value reads "—" with the reason when we have one.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, CaretDown, Check, CircleNotch, ClockCounterClockwise, Copy, EnvelopeSimple, Globe, House, Key, ListChecks, MagnifyingGlass, Newspaper, Storefront, WarningCircle, X } from "@phosphor-icons/react";
import { withTextFragment } from "@/lib/textFragment";
import type { Area, Commute, Criterion, CriterionId, Listing, ListingResearch, MoveIntent, Source, ViewingDraft } from "@/lib/move/types";
import { DASH, eur, fmtDate, fitTone, FIT_WORD, host, isHttp, meters, mins, placeGroup, price, sizeLine } from "./model";
import type { DraftState, ResearchState, View } from "./types";
import { AreaStats, SettlingIn } from "./SettlingIn";
import { Gallery } from "./ListingCard";
import { AreaOutlook, ListingFacts, ListingHistoryView } from "./Insights";
import { MovingChecklist, ViewingCalendar } from "./Calendar";
import d from "@/components/case/Drawer.module.css";
import x from "./Move.module.css";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STATUS_WORD = { good: "Good", ok: "OK", poor: "Poor", unknown: "Unknown" } as const;
const SEV_WORD = { low: "Low", medium: "Medium", high: "High" } as const;

export function SourceCard({ src }: { src: Source }) {
  const url = isHttp(src.url) ? src.url : undefined;
  const date = fmtDate(src.asOf);
  return (
    <figure className={x.source}>
      <header className={x.sHead}>
        <span className={x.favicon} aria-hidden>
          <Globe />
        </span>
        <span className={x.sWho}>
          <strong>{src.label || host(src.url) || "Source"}</strong>
          <span>{[url ? host(url) : null, date ? `as of ${date}` : null].filter(Boolean).join(" · ") || "No link given"}</span>
        </span>
        {url && (
          <a className={x.sOpen} href={src.quote ? withTextFragment(url, src.quote) : url} target="_blank" rel="noreferrer" title={src.quote ? "Opens the page at this passage" : "Open the source"}>
            Open
            <ArrowUpRight weight="bold" aria-hidden />
          </a>
        )}
      </header>
      {src.quote && (
        <blockquote className={x.passage}>
          <span>{src.quote}</span>
        </blockquote>
      )}
    </figure>
  );
}

/** One source card, the rest as quiet links. */
function Sources({ list }: { list: Source[] }) {
  if (!list.length) return <p className={x.noSrc}>No source was returned for this value.</p>;
  const [first, ...rest] = list;
  return (
    <div className={x.srcStack}>
      <SourceCard src={first} />
      {rest.length > 0 && (
        <p className={x.also}>
          <span>Also cited</span>
          {rest.map((s, i) => (
            <SrcLink key={`${s.url}-${i}`} s={s} />
          ))}
        </p>
      )}
    </div>
  );
}

function SrcLink({ s }: { s: Source }) {
  if (!isHttp(s.url)) return <span className={x.srcPlain}>{s.label}</span>;
  return (
    <a className={x.srcLink} href={s.quote ? withTextFragment(s.url, s.quote) : s.url} target="_blank" rel="noreferrer" title={s.quote}>
      {s.label || host(s.url)}
      <ArrowUpRight weight="bold" aria-hidden />
    </a>
  );
}

function Dot({ tone }: { tone: "green" | "yellow" | "red" | "grey" }) {
  return <i className={`${x.dotI} ${x[`t_${tone}`]}`} aria-hidden />;
}

function CommuteGrid({ c }: { c?: Commute }) {
  if (!c) return <p className={x.noSrc}>{DASH} No travel times were measured.</p>;
  const rows: [string, number | null | undefined, string?][] = [
    ["Public transport", c.transitMin, c.transitMin == null ? "Not measured (no journey-planner result)" : undefined],
    ["Car", c.carMin, c.carMin == null ? "Not measured" : undefined],
    ...(c.carRushMin !== undefined ? ([["Car, morning rush", c.carRushMin, c.carRushMin == null ? "No traffic-aware source" : undefined]] as [string, number | null | undefined, string?][]) : []),
    ["Bike", c.bikeMin, c.bikeMin == null ? "Not measured" : undefined],
    ["Walk", c.walkMin, c.walkMin == null ? "Not measured" : undefined],
  ];
  return (
    <div className={x.commute}>
      <dl className={x.modes}>
        {rows.map(([k, v, why]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              {v != null ? (
                <>
                  {c.estimate ? "≈" : ""}
                  {mins(v)}
                </>
              ) : (
                <span className={x.unknown} title={why}>
                  {DASH}
                  <small>{why}</small>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {c.estimate && <p className={x.noSrc}>Distance-based estimate, not a timetable result.</p>}
      {c.sources.length > 0 && (
        <p className={x.also}>
          <span>Source</span>
          {c.sources.map((s, i) => (
            <SrcLink key={`${s.url}-${i}`} s={s} />
          ))}
        </p>
      )}
    </div>
  );
}

function CriterionRow({ c, focused, n }: { c: Criterion; focused: boolean; n?: number }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [focused, n]);
  const tone = c.status === "poor" ? "red" : c.status === "unknown" ? "grey" : "green";
  return (
    <li ref={ref} className={`${x.crit} ${focused ? x.critFocus : ""}`}>
      <button type="button" className={x.critBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={x.critLabel}>{c.label}</span>
        <span className={`${x.critVal} ${x[`v_${c.status}`]}`}>{c.status === "unknown" || c.value == null ? DASH : c.value}</span>
        <span className={`${x.critWord} ${x[`w_${tone}`]}`}>{STATUS_WORD[c.status]}</span>
        <CaretDown weight="bold" className={`${x.chev} ${open ? x.chevOpen : ""}`} aria-hidden />
      </button>
      {open && (
        <div className={x.critBody}>
          <p>{c.detail || (c.status === "unknown" ? "Could not be measured; no reason was given." : "")}</p>
          <Sources list={c.sources} />
        </div>
      )}
    </li>
  );
}

export function ListingRow({
  l,
  tenure,
  areaName,
  onOpen,
  onResearch,
  onDraft,
  compact,
}: {
  l: Listing;
  tenure?: MoveIntent["tenure"];
  areaName?: string;
  onOpen: () => void;
  onResearch: () => void;
  onDraft: () => void;
  compact?: boolean;
}) {
  const p = price(l, tenure);
  const sz = sizeLine(l);
  const pub = fmtDate(l.publishedAt);
  const t = l.commute?.transitMin;
  const contact = l.contact && (l.contact.email || l.contact.phone || l.contact.formUrl);
  return (
    <li className={`${x.listing} ${compact ? x.listingCompact : ""}`}>
      <button type="button" className={x.listingMain} onClick={onOpen}>
        <span className={x.lTop}>
          <strong className={x.lPrice}>{p ?? <span className={x.unknownWord}>Price not stated</span>}</strong>
          {sz && <span className={x.lSize}>{sz}</span>}
        </span>
        <span className={x.lTitle}>{l.address || l.title}</span>
        <span className={x.lMeta}>
          {[
            areaName,
            t != null ? `${l.commute?.estimate ? "≈" : ""}${mins(t)} transit` : null,
            l.source || host(l.url),
            pub ? `published ${pub}` : null,
            contact ? "contact listed" : "no contact in listing",
          ]
            .filter(Boolean)
            .map((s, i) => (
              <span key={i}>{s}</span>
            ))}
        </span>
      </button>
      <span className={x.lActions}>
        <button type="button" className={x.ghostBtn} onClick={onResearch}>
          Research
        </button>
        <button type="button" className={x.ghostBtn} onClick={onDraft}>
          Draft viewing request
        </button>
      </span>
    </li>
  );
}

type AreaTab = "overview" | "criteria" | "life" | "news" | "listings";
type ListingTab = "overview" | "history" | "research" | "viewing";
type TabDef<T extends string> = { id: T; label: string; icon: React.ComponentType<{ weight?: "regular" | "bold"; "aria-hidden"?: boolean }>; count?: number | string; dot?: boolean };

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabDef<T>[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className={x.dTabs} role="tablist" data-tour="drawer-tabs">
      {tabs.map((tb) => (
        <button key={tb.id} type="button" role="tab" aria-selected={value === tb.id} aria-label={tb.label} title={tb.label} className={value === tb.id ? x.dTabOn : ""} onClick={() => onChange(tb.id)}>
          <tb.icon aria-hidden />
          <span>{tb.label}</span>
          {tb.count != null && tb.count !== 0 && <b>{tb.count}</b>}
          {tb.dot && <i aria-hidden />}
        </button>
      ))}
    </div>
  );
}

function Tiles({ items }: { items: { label: string; value: React.ReactNode; sub?: string; tone?: string }[] }) {
  return (
    <div className={x.dTiles} data-tour="drawer-tiles">
      {items.map((it) => (
        <div key={it.label} className={x.dTile}>
          <span>{it.label}</span>
          <strong className={it.tone ?? ""}>{it.value ?? DASH}</strong>
          {it.sub && <small>{it.sub}</small>}
        </div>
      ))}
    </div>
  );
}

function AreaView({ a, view, tenure, tab, onListing, onResearch, onDraft }: { a: Area; view: Extract<View, { kind: "area" }>; tab: AreaTab; tenure?: MoveIntent["tenure"]; onListing: (l: Listing) => void; onResearch: (l: Listing) => void; onDraft: (l: Listing) => void }) {
  const places = [...a.places].sort((p, q) => p.distanceM - q.distanceM);
  const kinds = [...new Set(places.map(placeGroup))];
  return (
    <>
      {tab === "overview" && (
        <>
        {a.why.length > 0 && (
          <section className={d.section}>
            <h3 className={d.sh}>Why this area</h3>
            <ul className={x.why}>
              {a.why.map((w, i) => (
                <li key={i}>
                  <Dot tone={w.status === "poor" ? "red" : w.status === "unknown" ? "grey" : "green"} />
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className={d.section}>
          <h3 className={d.sh}>Commute to work</h3>
          <CommuteGrid c={a.commute} />
        </section>
        <AreaStats a={a} />
        </>
      )}
      {tab === "criteria" && (
        <>
        <section className={d.section}>
          <h3 className={d.sh}>
            Criteria <small>{a.criteria.length} measured</small>
          </h3>
          {a.criteria.length ? (
            <ul className={x.crits}>
              {a.criteria.map((c) => (
                <CriterionRow key={c.id} c={c} focused={view.focus === c.id} n={view.focus === c.id ? view.n : undefined} />
              ))}
            </ul>
          ) : (
            <p className={x.noSrc}>No criteria were returned for this area.</p>
          )}
        </section>
        </>
      )}
      {tab === "life" && (
        <>
        <section className={d.section}>
          <h3 className={d.sh}>
            Nearby <small>{places.length ? `${places.length} places` : ""}</small>
          </h3>
          {places.length ? (
            <div className={x.places}>
              {kinds.map((k) => (
                <div key={k} className={x.placeGroup}>
                  <h4>{k}</h4>
                  <ul>
                    {places
                      .filter((p) => placeGroup(p) === k)
                      .slice(0, 4)
                      .map((p, i) => (
                        <li key={`${p.name}-${i}`}>
                          {p.url && isHttp(p.url) ? (
                            <a href={p.url} target="_blank" rel="noreferrer">
                              {p.name}
                            </a>
                          ) : (
                            <span>{p.name}</span>
                          )}
                          <span className={x.placeLinks}>
                            <span className={x.num}>{meters(p.distanceM) ?? DASH}</span>
                            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name}, ${a.municipality}`)}`} target="_blank" rel="noreferrer" title="Open in Google Maps">
                              Maps
                            </a>
                            {p.url && isHttp(p.url) && (
                              <a href={p.url} target="_blank" rel="noreferrer" title="Where this place comes from">
                                {/openstreetmap/.test(p.url) ? "OSM" : /palvelukartta|servicemap/.test(p.url) ? "City" : /exa\.ai/.test(p.url) ? "Exa" : host(p.url)}
                              </a>
                            )}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className={x.noSrc}>{DASH} No places were returned for this area.</p>
          )}
        </section>
        <SettlingIn a={a} />
        <MovingChecklist a={a} />
        </>
      )}
      {tab === "news" && (
        <>
        <section className={d.section}>
          <h3 className={d.sh}>
            Local news <small>{a.news.length ? `${a.news.length}` : ""}</small>
          </h3>
          {a.news.length ? (
            <ul className={x.news}>
              {a.news.map((n, i) => (
                <li key={`${n.url}-${i}`}>
                  <span className={x.newsHead}>
                    <Dot tone={n.tone === "negative" ? "red" : n.tone === "positive" ? "green" : "grey"} />
                    {isHttp(n.url) ? (
                      <a href={n.quote ? withTextFragment(n.url, n.quote) : n.url} target="_blank" rel="noreferrer">
                        {n.title}
                      </a>
                    ) : (
                      <span>{n.title}</span>
                    )}
                  </span>
                  <span className={x.newsMeta}>{[host(n.url), fmtDate(n.date) ?? "date not given"].filter(Boolean).join(" · ")}</span>
                  {n.quote && <blockquote className={x.newsQuote}>{n.quote}</blockquote>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={x.noSrc}>{DASH} No recent local news or city decisions were found.</p>
          )}
        </section>
        <AreaOutlook a={a} />
        </>
      )}
      {tab === "listings" && (
        <>
        <section className={d.section}>
          <h3 className={d.sh}>
            Listings <small>{a.listings.length ? `${a.listings.length} live` : ""}</small>
          </h3>
          {a.listings.length ? (
            <ul className={x.listings}>
              {a.listings.map((l) => (
                <ListingRow key={l.url} l={l} tenure={tenure} compact onOpen={() => onListing(l)} onResearch={() => onResearch(l)} onDraft={() => onDraft(l)} />
              ))}
            </ul>
          ) : (
            <p className={x.noSrc}>{DASH} No live listings were found in this area.</p>
          )}
        </section>
        </>
      )}
    </>
  );
}

function Facts({ l, tenure, areaName }: { l: Listing; tenure?: MoveIntent["tenure"]; areaName?: string }) {
  const c = l.contact;
  const rows: [string, React.ReactNode][] = [
    ["Address", l.address || <span className={x.unknownWord}>{DASH} not in the listing</span>],
    ["Area", areaName || <span className={x.unknownWord}>{DASH}</span>],
    [tenure === "buy" ? "Price" : "Rent", price(l, tenure) || <span className={x.unknownWord}>{DASH} not stated</span>],
    ["Size", l.sizeM2 != null ? `${l.sizeM2} m²` : <span className={x.unknownWord}>{DASH} not stated</span>],
    ["Rooms", l.rooms || <span className={x.unknownWord}>{DASH} not stated</span>],
    ["Published", fmtDate(l.publishedAt) || <span className={x.unknownWord}>{DASH} not stated</span>],
    [
      "Listing",
      <a key="u" href={l.url} target="_blank" rel="noreferrer">
        {l.source || host(l.url)}
        <ArrowUpRight weight="bold" aria-hidden />
      </a>,
    ],
    [
      "Contact",
      c ? (
        <span key="c" className={x.contactCell}>
          <span>{[c.name, c.company].filter(Boolean).join(", ") || "Named in the listing"}</span>
          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
          {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>{c.phone}</a>}
          {c.formUrl && isHttp(c.formUrl) && (
            <a href={c.formUrl} target="_blank" rel="noreferrer">
              Contact form <ArrowUpRight weight="bold" aria-hidden />
            </a>
          )}
          {c.source && <SrcLink s={c.source} />}
        </span>
      ) : (
        <span className={x.unknownWord}>{DASH} no contact found in the listing</span>
      ),
    ],
  ];
  return (
    <dl className={x.facts}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const SECTION_WORD = { building: "Building", landlord: "Landlord", surroundings: "Surroundings", risk: "Risks" } as const;

function Finding({ text, source, tone, badge }: { text: string; source: Source; tone?: "green" | "yellow" | "red" | "grey"; badge?: string }) {
  return (
    <li className={x.finding}>
      <p>
        {tone && <Dot tone={tone} />}
        <span>{text}</span>
        {badge && <em className={x.sev}>{badge}</em>}
      </p>
      <SourceCard src={source} />
    </li>
  );
}

function ResearchDone({ r }: { r: ListingResearch }) {
  const b = r.building;
  const ll = r.landlord;
  const tone = (t: "neutral" | "negative" | "positive") => (t === "negative" ? "red" : t === "positive" ? "green" : "grey");
  const buildingFacts = [b?.builtYear != null ? `Built ${b.builtYear}` : null, b?.housingCompany ? `Housing company: ${b.housingCompany}` : null].filter(Boolean);
  return (
    <div className={x.groups}>
      {r.facts && r.facts.length > 0 && (
        <div className={x.group}>
          <h4>Read off the listing</h4>
          <dl className={x.facts}>
            {r.facts.map((f, i) => (
              <div key={i}>
                <dt>{f.label}</dt>
                <dd>
                  {f.value} <SrcLink s={f.source} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className={x.group}>
        <h4>Building</h4>
        {buildingFacts.length > 0 && <p className={x.groupLead}>{buildingFacts.join(" · ")}</p>}
        {b && (b.renovations.length || b.notes.length) ? (
          <ul className={x.findings}>
            {b.renovations.map((rv, i) => (
              <Finding key={`r${i}`} text={`${rv.what}${rv.year ? ` (${rv.year})` : ""}`} source={rv.source} />
            ))}
            {b.notes.map((n, i) => (
              <Finding key={`n${i}`} text={n.text} source={n.source} />
            ))}
          </ul>
        ) : (
          !buildingFacts.length && <p className={x.noSrc}>{DASH} Nothing citable found about the building.</p>
        )}
      </div>
      <div className={x.group}>
        <h4>Landlord</h4>
        {ll ? (
          <>
            <p className={x.groupLead}>
              {ll.name}
              {ll.kind !== "unknown" ? ` · ${ll.kind}` : ""}
            </p>
            {ll.reviews.length ? (
              <ul className={x.findings}>
                {ll.reviews.map((rv, i) => (
                  <Finding key={i} text={rv.text} source={rv.source} tone={tone(rv.tone)} />
                ))}
              </ul>
            ) : (
              <p className={x.noSrc}>{DASH} No reviews or reports found.</p>
            )}
          </>
        ) : (
          <p className={x.noSrc}>{DASH} The landlord could not be identified from the listing.</p>
        )}
      </div>
      <div className={x.group}>
        <h4>Surroundings</h4>
        {r.surroundings.length ? (
          <ul className={x.findings}>
            {r.surroundings.map((s, i) => (
              <Finding key={i} text={s.text} source={s.source} tone={tone(s.tone)} />
            ))}
          </ul>
        ) : (
          <p className={x.noSrc}>{DASH} No works, permits or openings found nearby.</p>
        )}
      </div>
      <div className={x.group}>
        <h4>Risks</h4>
        {r.risks.length ? (
          <ul className={x.findings}>
            {r.risks.map((rk, i) => (
              <Finding key={i} text={rk.text} source={rk.source} tone={rk.severity === "high" ? "red" : rk.severity === "medium" ? "yellow" : "grey"} badge={`${SEV_WORD[rk.severity]} risk`} />
            ))}
          </ul>
        ) : (
          <p className={x.noSrc}>No risks found in the sources read.</p>
        )}
      </div>
      {r.unknowns && r.unknowns.length > 0 && (
        <div className={x.group}>
          <h4>Looked for, not found</h4>
          <ul className={x.unknowns}>
            {r.unknowns.map((u, i) => (
              <li key={i}>
                <span className={x.unknownWord}>Unknown</span>
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.questions.length > 0 && (
        <div className={x.group}>
          <h4>Ask at the viewing</h4>
          <ol className={x.questions}>
            {r.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ResearchView({ st, onStart }: { st?: ResearchState; onStart: () => void }) {
  const [traceOpen, setTraceOpen] = useState(false);
  if (!st)
    return (
      <div className={x.researchIntro}>
        <p>Reads the building, the landlord and the street around it: renovations, reviews, permits and works nearby. Every finding is cited.</p>
        <button type="button" className={x.primaryBtn} onClick={onStart}>
          Run deep research
        </button>
      </div>
    );
  const showTrace = st.running || traceOpen;
  const groups = (["building", "landlord", "surroundings", "risk"] as const).map((sec) => ({ sec, items: st.findings.filter((f) => f.section === sec) }));
  return (
    <div className={x.research}>
      {st.steps.length > 0 && !showTrace && (
        <button type="button" className={x.traceLine} onClick={() => setTraceOpen(true)}>
          {st.error ? <WarningCircle weight="fill" className={x.bad} aria-hidden /> : <Check weight="bold" className={x.ok} aria-hidden />}
          <span>
            {[
              `${st.steps.length} steps`,
              st.research?.meta ? `${Math.max(1, Math.round(st.research.meta.tookMs / 1000))} s` : null,
              st.research?.meta ? `${st.research.meta.exaCalls} Exa calls` : null,
              st.research?.meta && st.research.meta.agent !== "off" ? `deep agent ${st.research.meta.agent}` : null,
              st.research ? null : st.error ? "stopped" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <CaretDown weight="bold" aria-hidden />
        </button>
      )}
      {showTrace && (
        <ol className={x.trace} aria-live="polite">
          {st.steps.map((s, i) => {
            const live = st.running && i === st.steps.length - 1;
            return (
              <li key={i} className={live ? x.traceLive : ""}>
                <span className={x.traceIcon} aria-hidden>
                  {live ? <CircleNotch className={x.spin} /> : <Check weight="bold" />}
                </span>
                <span>
                  {s.label}
                  {s.detail && <small>{s.detail}</small>}
                </span>
              </li>
            );
          })}
          {st.running && !st.steps.length && (
            <li className={x.traceLive}>
              <span className={x.traceIcon} aria-hidden>
                <CircleNotch className={x.spin} />
              </span>
              <span>Starting</span>
            </li>
          )}
          {!st.running && traceOpen && (
            <li>
              <button type="button" className={x.linkBtn} onClick={() => setTraceOpen(false)}>
                Hide steps
              </button>
            </li>
          )}
        </ol>
      )}
      {st.error && <p className={x.errLine}>{st.error}</p>}
      {st.research ? (
        <ResearchDone r={st.research} />
      ) : (
        st.findings.length > 0 && (
          <div className={x.groups}>
            {groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.sec} className={x.group}>
                  <h4>{SECTION_WORD[g.sec]}</h4>
                  <ul className={x.findings}>
                    {g.items.map((f, i) => (
                      <Finding
                        key={i}
                        text={f.text}
                        source={f.source}
                        tone={f.severity ? (f.severity === "high" ? "red" : f.severity === "medium" ? "yellow" : "grey") : f.tone ? (f.tone === "negative" ? "red" : f.tone === "positive" ? "green" : "grey") : undefined}
                        badge={f.severity ? `${SEV_WORD[f.severity]} risk` : undefined}
                      />
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )
      )}
    </div>
  );
}

const mailto = (dr: ViewingDraft, body: string) => `mailto:${dr.to ?? ""}?subject=${encodeURIComponent(dr.subject)}&body=${encodeURIComponent(body)}`;

type MailCfg = { configured: boolean; testTo?: string; missing: string[] };
type SendState = { busy?: boolean; sent?: { testTo: string; sentAt: string }; error?: string };

/** Test send: the email goes to our own inbox (MAIL_TEST_TO), never to the landlord. */
function TestSend({ dr, subject, body, listingUrl }: { dr: ViewingDraft; subject: string; body: string; listingUrl?: string }) {
  const [cfg, setCfg] = useState<MailCfg | undefined>();
  const [s, setS] = useState<SendState>({});
  useEffect(() => {
    let stop = false;
    fetch("/api/move/send")
      .then((r) => r.json())
      .then((j: MailCfg) => !stop && setCfg(j))
      .catch(() => !stop && setCfg({ configured: false, missing: ["RESEND_API_KEY", "MAIL_TEST_TO"] }));
    return () => {
      stop = true;
    };
  }, []);
  if (!cfg) return null;
  if (!cfg.configured) return <p className={x.noSrc}>Test sending is off: add {cfg.missing.join(" and ")} to .env.local.</p>;
  const send = async () => {
    setS({ busy: true });
    try {
      const r = await fetch("/api/move/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: dr.to, subject, body, listingUrl }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setS({ sent: { testTo: j.testTo, sentAt: j.sentAt } });
    } catch (e) {
      setS({ error: (e as Error).message });
    }
  };
  return (
    <div className={x.testSend} data-tour="test-send">
      <button type="button" className={x.primaryBtn} onClick={() => void send()} disabled={s.busy}>
        {s.busy ? "Sending…" : s.sent ? "Send test again" : `Approve and send test to ${cfg.testTo}`}
      </button>
      {s.sent ? (
        <span className={x.okWord}>
          <Check weight="bold" aria-hidden /> Sent to {s.sent.testTo} at {new Date(s.sent.sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · would have gone to {dr.to ?? "no address in the listing"}
        </span>
      ) : s.error ? (
        <span className={x.errLine}>{s.error}</span>
      ) : (
        <span className={x.noSrc}>Test mode: goes to your inbox, not to {dr.to ?? "the landlord"}.</span>
      )}
    </div>
  );
}

function DraftView({ st, onLang, onOpened, onStart, listingUrl }: { st?: DraftState; onLang: (l: "en" | "fi") => void; onOpened: () => void; onStart: () => void; listingUrl?: string }) {
  const [copied, setCopied] = useState(false);
  if (!st)
    return (
      <div className={x.researchIntro}>
        <p>Drafts a short viewing request in Finnish and English from the listing{" "}and the research. You read it and approve it; nothing is sent without your click (test emails go to your own inbox).</p>
        <button type="button" className={x.ghostBtn} onClick={onStart}>
          Draft viewing request
        </button>
      </div>
    );
  if (st.loading)
    return (
      <p className={x.loadingLine}>
        <CircleNotch className={x.spin} aria-hidden /> Drafting the request
      </p>
    );
  if (st.error || !st.draft)
    return (
      <div className={x.researchIntro}>
        <p className={x.errLine}>{st.error ?? "No draft was returned."}</p>
        <button type="button" className={x.ghostBtn} onClick={onStart}>
          Try again
        </button>
      </div>
    );
  const dr = st.draft;
  const body = st.lang === "fi" ? dr.bodyFi : dr.bodyEn;
  const qs = st.lang === "fi" && dr.questionsFi?.length ? dr.questionsFi : dr.questions;
  // The backend's mailto carries one language; build ours so the toggle decides the body.
  const href = mailto(dr, body);
  return (
    <div className={x.draft}>
      <div className={x.draftTop}>
        <div className={x.langToggle} role="group" aria-label="Language">
          {(["fi", "en"] as const).map((l) => (
            <button key={l} type="button" className={st.lang === l ? x.on : ""} onClick={() => onLang(l)} aria-pressed={st.lang === l}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {st.opened && <span className={x.okWord}>Opened in your mail app</span>}
      </div>
      <dl className={x.mailHead}>
        <div>
          <dt>To</dt>
          <dd>{dr.to ? [dr.contactName, dr.to].filter(Boolean).join(" · ") : dr.formUrl ? "Contact form (no email in the listing)" : <span className={x.unknownWord}>{DASH} no address in the listing; add one in your mail app</span>}</dd>
        </div>
        {dr.phone && (
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${dr.phone.replace(/\s+/g, "")}`}>{dr.phone}</a>
            </dd>
          </div>
        )}
        <div>
          <dt>Subject</dt>
          <dd>{dr.subject}</dd>
        </div>
      </dl>
      <pre className={x.mailBody}>{body}</pre>
      {qs.length > 0 && (
        <div className={x.group}>
          <h4>Questions included</h4>
          <ol className={x.questions}>
            {qs.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
      <TestSend dr={dr} subject={dr.subject} body={body} listingUrl={listingUrl} />
      <div className={x.draftActions}>
        {dr.to || !dr.formUrl ? (
          <a className={x.primaryBtn} href={href} onClick={onOpened}>
            Approve and open in mail
          </a>
        ) : (
          <a className={x.primaryBtn} href={dr.formUrl} target="_blank" rel="noreferrer" onClick={onOpened}>
            Approve and open the form
          </a>
        )}
        <button
          type="button"
          className={x.ghostBtn}
          onClick={() => {
            void navigator.clipboard?.writeText(`${dr.subject}\n\n${body}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          <Copy aria-hidden /> {copied ? "Copied" : "Copy text"}
        </button>
      </div>
      <p className={x.noSrc}>Nothing is sent automatically. Your mail app opens with this text; you press send.</p>
    </div>
  );
}

export function MoveDrawer({
  view,
  areas,
  intent,
  research,
  drafts,
  onClose,
  onView,
  onResearch,
  onDraft,
  onDraftLang,
  onDraftOpened,
}: {
  view: View;
  areas: Area[];
  intent?: MoveIntent;
  research: Record<string, ResearchState>;
  drafts: Record<string, DraftState>;
  onClose: () => void;
  onView: (v: View) => void;
  onResearch: (l: Listing) => void;
  onDraft: (l: Listing) => void;
  onDraftLang: (url: string, lang: "en" | "fi") => void;
  onDraftOpened: (url: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const key = view.kind === "area" ? `a:${view.id}` : `l:${view.url}`;
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [key]);
  const researchSec = useRef<HTMLElement>(null);
  const draftSec = useRef<HTMLElement>(null);
  const lfocus = view.kind === "listing" ? view.focus : undefined;
  const ln = view.kind === "listing" ? view.n : undefined;
  useEffect(() => {
    const el = lfocus === "research" ? researchSec.current : lfocus === "draft" ? draftSec.current : null;
    const box = body.current;
    if (!el || !box) return;
    // After the drawer has laid out: scroll its body (not the page) to the section.
    const t = setTimeout(() => {
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
      box.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    }, 80);
    return () => clearTimeout(t);
  }, [lfocus, ln]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tenure = intent?.tenure;
  const [areaTab, setAreaTab] = useState<AreaTab>("overview");
  const [listingTab, setListingTab] = useState<ListingTab>("overview");
  const viewKey = view.kind === "area" ? `a:${view.id}` : `l:${view.url}`;
  // Opening a different area/listing starts on Overview; a focus (criterion, research, draft) picks its tab.
  useEffect(() => {
    if (view.kind === "area") setAreaTab(view.focus ? "criteria" : "overview");
    else setListingTab(view.focus === "research" ? "research" : view.focus === "draft" ? "viewing" : "overview");
    body.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, view.kind === "area" ? view.focus : view.focus, view.n]);
  let tabsBar: React.ReactNode = null;
  let tiles: React.ReactNode = null;
  let head: React.ReactNode = null;
  let content: React.ReactNode = null;
  let back: { label: string; go: () => void } = { label: "Move file", go: onClose };

  if (view.kind === "area") {
    const i = areas.findIndex((a) => a.id === view.id);
    const a = areas[i];
    if (!a) return null;
    const tone = fitTone(a.fit);
    head = (
      <>
        <h2>{a.name}</h2>
        <p className={d.meta}>
          <span>#{i + 1}</span>
          <span className={x[`w_${tone}`]}>{FIT_WORD[tone]}</span>
          <span>{[a.postalCode, a.municipality].filter(Boolean).join(" ")}</span>
        </p>
      </>
    );
    tiles = (
        <Tiles
          items={[
            { label: "Fit", value: `${a.fit}`, sub: "of 100" },
            { label: "Transit", value: mins(a.commute?.transitMin) ? `${a.commute?.estimate ? "≈" : ""}${mins(a.commute?.transitMin)}` : null, sub: "to work" },
            { label: tenure === "buy" ? "Price" : "Rent", value: a.criteria.find((c) => c.id === "rent")?.value?.match(/€[\d,.]+(\/m²)?/)?.[0] ?? null, sub: "typical" },
            { label: "Listings", value: `${a.listings.length}`, sub: "live" },
          ]}
        />
    );
    tabsBar = (
      <Tabs<AreaTab>
        value={areaTab}
        onChange={setAreaTab}
        tabs={[
          { id: "overview", label: "Overview", icon: House },
          { id: "criteria", label: "Criteria", icon: ListChecks, count: a.criteria.length },
          { id: "life", label: "Daily life", icon: Storefront, count: a.places.length || undefined },
          { id: "news", label: "News & plans", icon: Newspaper, count: (a.news.length + (a.future?.length ?? 0) + (a.voices?.length ?? 0)) || undefined },
          { id: "listings", label: "Listings", icon: Key, count: a.listings.length || undefined },
        ]}
      />
    );
    content = (
      <AreaView
        a={a}
        view={view}
        tab={areaTab}
        tenure={tenure}
        onListing={(l) => onView({ kind: "listing", url: l.url, from: a.id })}
        onResearch={(l) => {
          onView({ kind: "listing", url: l.url, from: a.id, focus: "research", n: Date.now() });
          onResearch(l);
        }}
        onDraft={(l) => {
          onView({ kind: "listing", url: l.url, from: a.id, focus: "draft", n: Date.now() });
          onDraft(l);
        }}
      />
    );
  } else {
    const area = areas.find((a) => a.listings.some((l) => l.url === view.url));
    const l = area?.listings.find((q) => q.url === view.url);
    if (!l) return null;
    const from = view.from ? areas.find((a) => a.id === view.from) : undefined;
    if (from) back = { label: from.name, go: () => onView({ kind: "area", id: from.id }) };
    const sz = sizeLine(l);
    head = (
      <>
        <h2>{l.address || l.title}</h2>
        <p className={d.meta}>
          {area && <span>{area.name}</span>}
          <span>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.source || host(l.url)}
            </a>
          </span>
        </p>
      </>
    );
    tiles = (
        <Tiles
          items={[
            { label: tenure === "buy" ? "Price" : "Rent", value: eur(l.price), sub: l.price && l.sizeM2 ? `€${Math.round(l.price / l.sizeM2)}/m²` : tenure === "buy" ? undefined : "per month" },
            { label: "Size", value: l.sizeM2 ? `${Math.round(l.sizeM2 * 10) / 10} m²` : null, sub: l.rooms || undefined },
            { label: "Transit", value: mins((l.commute ?? area?.commute)?.transitMin) ? `${(l.commute ?? area?.commute)?.estimate ? "≈" : ""}${mins((l.commute ?? area?.commute)?.transitMin)}` : null, sub: l.commute ? "from the address" : "from the area" },
            { label: "Built", value: l.facts?.find((f) => f.key === "built")?.value ?? null, sub: l.facts?.find((f) => f.key === "floor")?.value ? `floor ${l.facts?.find((f) => f.key === "floor")?.value}` : undefined },
          ]}
        />
    );
    const rs = research[l.url];
    const ds = drafts[l.url];
    tabsBar = (
      <Tabs<ListingTab>
        value={listingTab}
        onChange={setListingTab}
        tabs={[
          { id: "overview", label: "Overview", icon: House },
          { id: "history", label: "History", icon: ClockCounterClockwise, count: l.history?.seen.length || undefined },
          { id: "research", label: "Research", icon: MagnifyingGlass, count: rs?.research ? rs.findings.length || undefined : undefined, dot: rs?.running },
          { id: "viewing", label: "Viewing", icon: EnvelopeSimple, dot: !!ds?.draft },
        ]}
      />
    );
    content = (
      <>
        {listingTab === "overview" && (
          <>
            {(l.photos?.length ?? 0) > 0 && <Gallery photos={l.photos} alt={l.address || l.title} className={x.drawerGallery} />}
            <div className={x.dActions}>
              <button type="button" className={x.primaryBtn} onClick={() => (setListingTab("research"), rs ? undefined : onResearch(l))}>
                <MagnifyingGlass aria-hidden /> {rs ? "Open research" : "Research this flat"}
              </button>
              <button type="button" className={x.ghostBtn} onClick={() => (setListingTab("viewing"), ds ? undefined : onDraft(l))}>
                <EnvelopeSimple aria-hidden /> Request viewing
              </button>
              <a className={x.ghostBtn} href={l.url} target="_blank" rel="noreferrer">
                Open on {l.source || host(l.url)} <ArrowUpRight weight="bold" aria-hidden />
              </a>
            </div>
            <ViewingCalendar l={l} area={area} intent={intent} questions={ds?.draft?.questions} />
            <ListingFacts l={l} />
            <section className={d.section}>
              <h3 className={d.sh}>The listing</h3>
              {l.title && l.address && <p className={x.listingTitle}>{l.title}</p>}
              <Facts l={l} tenure={tenure} areaName={area?.name} />
            </section>
            <section className={d.section}>
              <h3 className={d.sh}>Commute to work</h3>
              <CommuteGrid c={l.commute ?? area?.commute} />
              {!l.commute && area?.commute && <p className={x.noSrc}>Measured from the area centre, not this address.</p>}
            </section>
          </>
        )}
        {listingTab === "history" && (l.history ? <ListingHistoryView l={l} /> : <p className={x.loadingLine}><CircleNotch className={x.spin} aria-hidden /> Checking the portals for earlier listings of this flat…</p>)}
        {listingTab === "research" && (
          <section className={`${d.section} ${x.anchor}`} ref={researchSec}>
            <h3 className={d.sh}>
              Deep research <small>{rs?.running ? "running" : rs?.research ? "done" : ""}</small>
            </h3>
            <ResearchView st={rs} onStart={() => onResearch(l)} />
          </section>
        )}
        {listingTab === "viewing" && (
          <section className={`${d.section} ${x.anchor}`} ref={draftSec}>
            <h3 className={d.sh}>Viewing request</h3>
            <DraftView listingUrl={l.url} st={ds} onLang={(lang) => onDraftLang(l.url, lang)} onOpened={() => onDraftOpened(l.url)} onStart={() => onDraft(l)} />
            <ViewingCalendar l={l} area={area} intent={intent} questions={ds?.draft?.questions} />
          </section>
        )}
      </>
    );
  }

  return (
    <div className={`${d.wrap} ${x.dwrap}`}>
      <button type="button" className={d.scrim} onClick={onClose} aria-label="Close" tabIndex={-1} />
      <aside className={`${d.drawer} ${x.drawer}`} aria-label={view.kind === "area" ? "Area" : "Listing"} data-tour="drawer">
        <header className={d.head}>
          <button type="button" className={d.back} onClick={back.go}>
            <ArrowLeft weight="bold" aria-hidden />
            {back.label}
          </button>
          <div className={d.title}>
            {view.kind === "listing" && view.from && (
              <button type="button" className={x.crumb} onClick={back.go}>
                <ArrowLeft weight="bold" aria-hidden /> {back.label}
              </button>
            )}
            {head}
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </header>
        {tiles && <div className={x.dTilesRow}>{tiles}</div>}
        {tabsBar}
        <div className={d.body} ref={body} data-tour="drawer-body">
          {content}
        </div>
      </aside>
    </div>
  );
}

export type { CriterionId };
