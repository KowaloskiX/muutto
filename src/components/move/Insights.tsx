"use client";

// Exa-sourced extras shown in the drawer: what the listing page states (facts), earlier appearances
// of the same flat (history), what is coming to the area, and what residents say. All quoted.
import { ArrowUpRight } from "@phosphor-icons/react";
import type { Area, Listing } from "@/lib/move/types";
import { withTextFragment } from "@/lib/textFragment";
import { DASH, eur, fmtDate, host } from "./model";
import d from "@/components/case/Drawer.module.css";
import x from "./Move.module.css";

export function ListingFacts({ l }: { l: Listing }) {
  if (!l.facts?.length) return null;
  return (
    <section className={d.section}>
      <h3 className={d.sh}>
        In the listing <small>as stated on {l.source || host(l.url)}</small>
      </h3>
      <dl className={x.factGrid}>
        {l.facts.map((f) => (
          <div key={f.key} title={`“${f.quote}”`}>
            <dt>{f.label}</dt>
            <dd className={f.tone ? x[`ft_${f.tone}`] : ""}>{f.value}</dd>
            <small>“{f.quote}”</small>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function historyLine(l: Listing): string | null {
  const h = l.history;
  if (!h?.seen.length) return null;
  const removed = h.seen.find((s) => s.removedOn);
  if (removed) return `Listed before · removed ${removed.removedOn}`;
  const other = h.seen.find((s) => s.price && l.price && s.price !== l.price);
  if (other) return `Also seen at ${eur(other.price)}`;
  return `Also on ${[...new Set(h.seen.map((s) => s.source))].join(", ")}`;
}

export function ListingHistoryView({ l }: { l: Listing }) {
  const h = l.history;
  if (!h) return null;
  return (
    <section className={d.section}>
      <h3 className={d.sh}>
        History <small>same address &amp; size</small>
      </h3>
      {h.seen.length ? (
        <ul className={x.histList}>
          {h.seen.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.source}
                <ArrowUpRight weight="bold" aria-hidden />
              </a>
              <span className={x.num}>{s.price ? eur(s.price) : DASH}</span>
              <span>{s.removedOn ? `removed ${s.removedOn}` : s.publishedAt ? `seen ${fmtDate(s.publishedAt)}` : ""}</span>
              {s.quote && <small>“{s.quote}”</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={x.noSrc}>No earlier listing of this flat found on the portals.</p>
      )}
      {h.buildingPage && (
        <p className={x.statSrc}>
          Whole building:{" "}
          <a href={h.buildingPage.url} target="_blank" rel="noreferrer">
            {h.buildingPage.label} building page
          </a>
          {h.buildingPage.quote ? ` — “${h.buildingPage.quote}”` : ""}
        </p>
      )}
    </section>
  );
}

function Quotes({ items }: { items: { title: string; url: string; date?: string; quote: string; meta?: string }[] }) {
  return (
    <ul className={x.news}>
      {items.map((n) => (
        <li key={n.url}>
          <span className={x.newsHead}>
            <a href={withTextFragment(n.url, n.quote)} target="_blank" rel="noreferrer">
              {n.title}
            </a>
          </span>
          <span className={x.newsMeta}>{[n.meta ?? host(n.url), fmtDate(n.date) ?? "date not given"].filter(Boolean).join(" · ")}</span>
          <blockquote className={x.newsQuote}>{n.quote}</blockquote>
        </li>
      ))}
    </ul>
  );
}

export function AreaOutlook({ a }: { a: Area }) {
  return (
    <>
      <section className={d.section}>
        <h3 className={d.sh}>
          Coming next <small>city plans · local news</small>
        </h3>
        {a.future?.length ? (
          <Quotes items={a.future.map((f) => ({ ...f, meta: [host(f.url), f.when && `for ${f.when}`].filter(Boolean).join(" · ") }))} />
        ) : (
          <p className={x.noSrc}>{DASH} No plans or upcoming projects naming this area were found in the last year.</p>
        )}
      </section>
      <section className={d.section}>
        <h3 className={d.sh}>
          What residents say <small>forums · opinions</small>
        </h3>
        {a.voices?.length ? <Quotes items={a.voices.map((v) => ({ ...v, meta: v.host }))} /> : <p className={x.noSrc}>{DASH} No recent forum threads naming this area were found.</p>}
      </section>
    </>
  );
}
