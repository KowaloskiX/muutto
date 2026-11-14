"use client";

// The move file: the job and constraints, a big map (work, ranked areas, listings), the comparison
// matrix (areas x criteria, each cell opens the drawer at that criterion), the live listings and
// the watch. Renders only what /api/move returned.
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, CircleNotch } from "@phosphor-icons/react";
import type { Area, CriterionId, Listing } from "@/lib/move/types";
import { allListings, columnsFor, DASH, fitTone, fmtDate, host, mins, price, sizeLine } from "./model";
import { ListingRow, MoveDrawer } from "./MoveDrawer";
import type { AreaPin, ListingDot } from "./MoveMap";
import type { DraftState, ResearchState, RunState, View, WatchState } from "./types";
import c from "@/components/case/Case.module.css";
import m from "@/components/case/Map.module.css";
import x from "./Move.module.css";

const MoveMap = dynamic(() => import("./MoveMap"), {
  ssr: false,
  loading: () => (
    <div className={`${m.box} ${x.mapBox}`}>
      <div className={m.loading}>
        <CircleNotch />
      </div>
    </div>
  ),
});

type Props = {
  run?: RunState;
  view?: View;
  research: Record<string, ResearchState>;
  drafts: Record<string, DraftState>;
  watch?: WatchState;
  onView: (v?: View) => void;
  onResearch: (l: Listing) => void;
  onDraft: (l: Listing) => void;
  onDraftLang: (url: string, lang: "en" | "fi") => void;
  onDraftOpened: (url: string) => void;
  onWatch: () => void;
  onPrompt: (text: string) => void;
};

const PROMPTS = [
  "I start at Wolt HQ, Arkadiankatu 6, Helsinki in January. Rent up to €1,300, 1–2 rooms, short commute, quiet, cafés, a gym and a climbing wall nearby",
  "New job at Nokia, Karakaari 7, Espoo — family with 2 kids, rent up to €2,000, schools, parks, clean air",
  "Work at Helsinki-Vantaa airport, buy a 2-room flat under €250k",
];
export { PROMPTS };

export default function MoveFile({ run, view, research, drafts, watch, onView, onResearch, onDraft, onDraftLang, onDraftOpened, onWatch, onPrompt }: Props) {
  const [hover, setHover] = useState<string | undefined>();
  const rows = useRef<Record<string, HTMLTableRowElement | null>>({});

  // While streaming: the measured areas by fit (provisional); once done: the backend's ranking.
  const areas = useMemo<Area[]>(() => (run?.ranked ? run.ranked : [...(run?.areas ?? [])].sort((a, b) => b.fit - a.fit)), [run?.ranked, run?.areas]);
  const ranked = !!run?.ranked;
  const intent = run?.intent;
  const cols = useMemo(() => columnsFor(areas), [areas]);
  const listings = useMemo(() => allListings(areas), [areas]);
  const work = intent?.work ? { lat: intent.work.lat, lng: intent.work.lng, label: intent.work.label } : undefined;

  const pins: AreaPin[] = areas.map((a, i) => {
    const t = a.commute?.transitMin;
    const tone = fitTone(a.fit);
    return {
      key: a.id,
      lat: a.center.lat,
      lng: a.center.lng,
      label: a.name,
      rank: ranked ? i + 1 : undefined,
      tone,
      tag: t != null ? `${a.commute?.estimate ? "≈" : ""}${Math.round(t)} min` : undefined,
      polygon: a.polygon,
      sub: [
        `fit ${a.fit}`,
        t != null ? `${a.commute?.estimate ? "≈" : ""}${mins(t)} transit` : "transit —",
        (() => {
          const r = a.criteria.find((c) => c.id === "rent");
          return r?.value && r.status !== "unknown" ? `rent ${r.value}` : "rent —";
        })(),
      ].join(" · "),
    };
  });
  // Candidate areas not measured yet: grey dots so the map fills in as the search runs.
  if (run && !run.finished)
    for (const cnd of run.candidates)
      if (!areas.some((a) => a.id === cnd.id)) pins.push({ key: cnd.id, lat: cnd.center.lat, lng: cnd.center.lng, label: cnd.name, tone: "grey", sub: "Measuring", polygon: cnd.polygon });
  const shortPrice = (n?: number) => (n == null ? undefined : intent?.tenure === "buy" ? `€${Math.round(n / 1000)}k` : `€${Math.round(n).toLocaleString("en-US")}`);
  const dots: ListingDot[] = listings.flatMap(({ listing: l, area }) =>
    l.geo ? [{ key: l.url, lat: l.geo.lat, lng: l.geo.lng, price: shortPrice(l.price), label: price(l, intent?.tenure) ?? l.title, sub: [l.address, sizeLine(l), area.name].filter(Boolean).join(" · ") }] : [],
  );

  const openArea = (id: string, focus?: CriterionId) => onView({ kind: "area", id, focus, n: Date.now() });
  const openId = view?.kind === "area" ? view.id : view?.kind === "listing" ? areas.find((a) => a.listings.some((l) => l.url === view.url))?.id : undefined;

  // Daily-life layer: the open area (or the one under the pointer, else the best) and a 500 m circle.
  const focusArea = areas.find((a) => a.id === openId) ?? areas.find((a) => a.places.length) ?? areas[0];
  const openListing = view?.kind === "listing" ? listings.find((l) => l.listing.url === view.url)?.listing : undefined;
  const circle = openListing?.geo
    ? { lat: openListing.geo.lat, lng: openListing.geo.lng, label: openListing.address || "the listing" }
    : focusArea
      ? { lat: focusArea.center.lat, lng: focusArea.center.lng, label: `${focusArea.name} centre` }
      : undefined;
  // Air-quality stations only when a source carries coordinates; none are placed by guess.
  const airStations = useMemo(() => {
    const seen = new Map<string, { lat: number; lng: number; label: string }>();
    for (const a of areas)
      for (const c of a.criteria)
        if (c.id === "air")
          for (const s of c.sources) {
            const g = (s as typeof s & { geo?: { lat: number; lng: number } }).geo;
            if (g) seen.set(`${g.lat},${g.lng}`, { lat: g.lat, lng: g.lng, label: s.quote?.split(":")[0] || s.label });
          }
    return [...seen.values()];
  }, [areas]);

  useEffect(() => {
    if (hover) rows.current[hover]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hover]);

  const empty = !run;
  const drawerOpen = !!view && !!areas.length;

  if (empty)
    return (
      <div className={c.case}>
        <div className={`${c.scroller} ${c.scrollerEmpty}`}>
          <section className={c.hero} aria-labelledby="move-hero">
            <div className={c.heroText}>
              <p className={c.eyebrow}>Moving to the Helsinki region</p>
              <h1 id="move-hero" className={c.heroTitle}>
                <span className={c.heroLine}>
                  <span>Got the job.</span>
                </span>{" "}
                <span className={c.heroLine}>
                  <span>Now, where to live?</span>
                </span>
              </h1>
              <p className={c.heroSub}>Tell the chat where you will work and what matters. Areas are ranked by commute and everyday life around them, with live listings. Every fact links to its source.</p>
              <ol className={c.heroSteps}>
                <li>
                  <strong>Areas</strong>
                  <p>Commute by transit, car, bike and on foot; shops, schools, air, noise, works.</p>
                </li>
                <li>
                  <strong>Listings</strong>
                  <p>Live rentals and sales, researched down to the building and landlord.</p>
                </li>
                <li>
                  <strong>Viewing</strong>
                  <p>A request drafted for you to approve. Nothing is sent on its own.</p>
                </li>
              </ol>
              <div className={x.heroPrompts}>
                {PROMPTS.slice(0, 1).map((p) => (
                  <button key={p} type="button" className={x.ghostBtn} onClick={() => onPrompt(p)}>
                    Try: Wolt HQ, rent ≤ €1,300
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    );

  const budget = intent?.budget != null ? `${intent.tenure === "buy" ? "price" : "rent"} ≤ €${intent.budget.toLocaleString("en-US")}` : null;
  const title = intent ? `Job at ${intent.work?.label || intent.workAddress}` : run.query;
  const meta = intent ? [intent.tenure === "buy" ? "Buying" : "Renting", budget, intent.size, intent.household, intent.maxCommuteMin != null ? `commute ≤ ${intent.maxCommuteMin} min` : null].filter(Boolean) : [];
  const watchedN = watch?.result?.areas.length ?? 0;

  return (
    <div className={`${c.case} ${drawerOpen ? c.caseOpen : ""}`}>
      <div className={c.scroller}>
        <header className={c.project}>
          <div className={c.projectText}>
            <p className={c.eyebrow} style={{ margin: 0 }}>
              Move file
            </p>
            <h1 className={c.title}>{title}</h1>
            {meta.length > 0 && <p className={c.meta}>{meta.join(" · ")}</p>}
            {intent?.priorities.length ? <p className={x.priorities}>Priorities: {intent.priorities.join(", ")}</p> : null}
            {!run.finished && (
              <p className={c.live}>
                <CircleNotch className={c.spin} aria-hidden /> Measuring {run.areas.length}
                {run.candidates.length ? ` of ${run.candidates.length}` : ""} areas
              </p>
            )}
            {run.failed && run.error && <p className={x.errLine}>{run.error}</p>}
          </div>
        </header>

        {(work || pins.length > 0) && (
          <section className={x.mapSection} aria-label="Map">
            <MoveMap
              work={work}
              pins={pins}
              dots={dots}
              places={focusArea?.places ?? []}
              placesFor={focusArea?.name}
              circle={circle}
              airStations={airStations}
              hover={hover}
              active={openId}
              onSelect={(k) => (areas.some((a) => a.id === k) ? openArea(k) : undefined)}
              onSelectListing={(u) => {
                const a = areas.find((ar) => ar.listings.some((l) => l.url === u));
                onView({ kind: "listing", url: u, from: a?.id });
              }}
              onHover={setHover}
            />
            {!work && intent && <small className={m.hint}>The workplace could not be placed on the map; commute times come from the backend as returned.</small>}
          </section>
        )}

        <section className={c.section} aria-labelledby="move-areas">
          <div className={c.secHead}>
            <h2 id="move-areas">Areas</h2>
            {areas.length > 0 && (
              <span className={c.tally}>
                {ranked ? `${areas.length} ranked by fit` : `${areas.length} measured so far`} · click a cell for its source
              </span>
            )}
          </div>
          {areas.length ? (
            <div className={`${c.matrixWrap} ${x.matrixWrap}`}>
              <table className={`${c.matrix} ${x.matrix}`}>
                <thead>
                  <tr>
                    <th className={`${c.cCompany} ${x.cArea}`}>Area</th>
                    <th className={c.cNum}>Fit</th>
                    {cols.map((col) => (
                      <th key={col.key} className={x.cCrit}>
                        {col.label}
                      </th>
                    ))}
                    <th className={c.cNum}>Listings</th>
                  </tr>
                </thead>
                <tbody>
                  {areas.map((a, i) => {
                    const tone = fitTone(a.fit);
                    const isOpen = openId === a.id;
                    return (
                      <tr
                        key={a.id}
                        ref={(el) => {
                          rows.current[a.id] = el;
                        }}
                        className={`${x.mrow} ${isOpen ? x.mrowOpen : hover === a.id ? x.mrowHover : ""}`}
                        onMouseEnter={() => setHover(a.id)}
                        onMouseLeave={() => setHover(undefined)}
                        onClick={() => openArea(a.id)}
                      >
                        <td className={`${c.cCompany} ${x.cArea}`}>
                          <button
                            type="button"
                            className={x.areaBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              openArea(a.id);
                            }}
                            aria-expanded={isOpen}
                          >
                            <span className={x.rank}>{ranked ? i + 1 : ""}</span>
                            <span className={x.areaName}>
                              <span>{a.name}</span>
                              <small>{[a.postalCode, a.municipality].filter(Boolean).join(" ")}</small>
                            </span>
                          </button>
                        </td>
                        <td className={`${c.cNum} ${x.fitCell}`}>
                          <span className={x.fitNum}>
                            <i className={`${x.dotI} ${x[`t_${tone}`]}`} aria-hidden />
                            {a.fit}
                          </span>
                        </td>
                        {cols.map((col) => {
                          const cell = col.get(a);
                          const status = cell?.status ?? "unknown";
                          const title = cell ? cell.title : "Not measured for this area";
                          return (
                            <td key={col.key} className={x.cCrit}>
                              <button
                                type="button"
                                className={`${x.cell} ${x[`k_${status}`]} ${isOpen && view?.kind === "area" && view.focus === col.crit ? x.cellOn : ""}`}
                                title={title}
                                aria-label={`${a.name}, ${col.label}: ${cell?.value ?? "unknown"}. ${title}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openArea(a.id, col.crit);
                                }}
                              >
                                {status === "good" && cell?.value && <Check weight="bold" aria-hidden />}
                                {cell?.value ?? DASH}
                              </button>
                            </td>
                          );
                        })}
                        <td className={`${c.cNum} ${x.listN}`}>{a.listings.length || DASH}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={c.empty}>{run.finished ? "No areas came back for this search." : "Areas appear here as each one is measured."}</p>
          )}
          {ranked && areas.some((a) => a.commute?.estimate) && <p className={x.footnote}>≈ marks a distance-based commute estimate, not a timetable result.</p>}
        </section>

        <section className={c.section} aria-labelledby="move-listings">
          <div className={c.secHead}>
            <h2 id="move-listings">Listings</h2>
            {listings.length > 0 && <span className={c.tally}>{listings.length} live · from {[...new Set(listings.map((l) => l.listing.source || host(l.listing.url)))].join(", ")}</span>}
          </div>
          {listings.length ? (
            <ul className={x.listingGrid}>
              {listings.map(({ listing: l, area }) => (
                <ListingRow
                  key={l.url}
                  l={l}
                  tenure={intent?.tenure}
                  areaName={area.name}
                  onOpen={() => onView({ kind: "listing", url: l.url, from: area.id })}
                  onResearch={() => {
                    onView({ kind: "listing", url: l.url, from: area.id, focus: "research", n: Date.now() });
                    onResearch(l);
                  }}
                  onDraft={() => {
                    onView({ kind: "listing", url: l.url, from: area.id, focus: "draft", n: Date.now() });
                    onDraft(l);
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className={c.empty}>{run.finished ? "No live listings were found in these areas." : "Live listings appear here as they are found."}</p>
          )}
        </section>

        {(watch || (ranked && areas.length > 0)) && (
          <section className={c.section} aria-labelledby="move-watch">
            <div className={c.secHead}>
              <h2 id="move-watch">Watch</h2>
              {watch?.result && (
                <span className={c.tally}>
                  Watching {watchedN} area{watchedN === 1 ? "" : "s"} · new listings appear here
                  {watch.checkedAt ? ` · checked ${new Date(watch.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
                </span>
              )}
            </div>
            {!watch ? (
              <div className={x.watchIntro}>
                <p className={c.empty}>Get new listings in the top areas as they are published (Exa Monitor).</p>
                <button type="button" className={x.ghostBtn} onClick={onWatch}>
                  Watch these areas
                </button>
              </div>
            ) : watch.loading ? (
              <p className={x.loadingLine}>
                <CircleNotch className={x.spin} aria-hidden /> Setting up the watch
              </p>
            ) : watch.error ? (
              <div className={x.watchIntro}>
                <p className={x.errLine}>{watch.error}</p>
                <button type="button" className={x.ghostBtn} onClick={onWatch}>
                  Try again
                </button>
              </div>
            ) : (
              <>
                <p className={x.watchAreas}>
                  {watch.result?.areas.join(" · ")}
                  <span>{watch.result?.mode === "live" ? "Live monitor" : "Checked periodically"}</span>
                </p>
                {watch.runs && (
                  <p className={x.footnote}>
                    {[
                      `${watch.runs.runs} monitor run${watch.runs.runs === 1 ? "" : "s"}`,
                      watch.runs.latest ? `latest ${watch.runs.latest.status}${watch.runs.latest.at ? ` ${fmtDate(watch.runs.latest.at)}` : ""}` : null,
                      watch.runs.skipped ? `${watch.runs.skipped} non-listing result${watch.runs.skipped === 1 ? "" : "s"} skipped` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {watch.runs?.items.length ? (
                  <ul className={x.listingGrid}>
                    {watch.runs.items.map((l) => (
                      <li key={l.url} className={x.listing}>
                        <a className={x.listingMain} href={l.url} target="_blank" rel="noreferrer">
                          <span className={x.lTop}>
                            <strong className={x.lPrice}>{price(l, intent?.tenure) ?? <span className={x.unknownWord}>Price not stated</span>}</strong>
                            {l.overBudget && <span className={x.overBudget}>over budget</span>}
                          </span>
                          <span className={x.lTitle}>{l.title}</span>
                          <span className={x.lMeta}>
                            {[l.area, l.source || host(l.url), fmtDate(l.date) ? `found ${fmtDate(l.date)}` : null].filter(Boolean).map((s, i) => (
                              <span key={i}>{s}</span>
                            ))}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={c.empty}>{watch.pollError ? `Last check failed: ${watch.pollError}` : watch.checkedAt ? "No new listings yet." : "Checking…"}</p>
                )}
              </>
            )}
          </section>
        )}
      </div>
      {drawerOpen && view && (
        <MoveDrawer
          view={view}
          areas={areas}
          intent={intent}
          research={research}
          drafts={drafts}
          onClose={() => onView(undefined)}
          onView={(v) => onView(v)}
          onResearch={onResearch}
          onDraft={onDraft}
          onDraftLang={onDraftLang}
          onDraftOpened={onDraftOpened}
        />
      )}
    </div>
  );
}
