"use client";

// Area drawer sections: "The area in numbers" (Statistics Finland Paavo, from the search result)
// and "Settling in" (GET /api/move/services, fetched when the drawer opens): the real health,
// kids, everyday, official and landlord contacts around the area, each with its register as source.
import { useEffect, useState } from "react";
import { ArrowUpRight, CircleNotch, EnvelopeSimple, Phone } from "@phosphor-icons/react";
import type { Area, AreaServices, ServiceContact, ServiceGroup } from "@/lib/move/types";
import { DASH, host, isHttp, meters } from "./model";
import d from "@/components/case/Drawer.module.css";
import x from "./Move.module.css";
import { Baby, Bank, ChartBar, FirstAidKit, House, Lifebuoy, Storefront } from "@phosphor-icons/react";

const GROUP_ICON: Record<ServiceGroup, typeof Baby> = { health: FirstAidKit, kids: Baby, everyday: Storefront, official: Bank, landlords: House };

const GROUPS: { id: ServiceGroup; label: string }[] = [
  { id: "health", label: "Health" },
  { id: "kids", label: "Kids" },
  { id: "everyday", label: "Everyday" },
  { id: "official", label: "Official" },
  { id: "landlords", label: "Landlords" },
];

const cache = new Map<string, AreaServices>();
const pct = (v?: number) => (v == null ? undefined : `${Math.round(v)} %`);
const eur = (v?: number) => (v == null ? undefined : `€${Math.round(v).toLocaleString("en-US")}`);

export function AreaStats({ a }: { a: Area }) {
  const s = a.stats;
  if (!s) return null;
  const items = [
    ["Residents", s.population.toLocaleString("en-US")],
    ["Median household income", s.medianHouseholdIncome != null ? `${eur(s.medianHouseholdIncome)} / yr` : undefined],
    ["Median income", s.medianIncome != null ? `${eur(s.medianIncome)} / yr` : undefined],
    ["Mean age", s.meanAge != null ? `${s.meanAge.toFixed(0)}` : undefined],
    ["Households renting", pct(s.rentedShare)],
    ["Households with children", pct(s.familiesShare)],
    ["Under 18", pct(s.under18Share)],
    ["65 and over", pct(s.over65Share)],
  ].filter((i): i is [string, string] => !!i[1]);
  return (
    <section className={d.section}>
      <h3 className={d.sh}>
        <span className={x.st}><ChartBar weight="bold" aria-hidden className={x.stIcon} />The area in numbers</span> <small>{s.year ? `Paavo ${s.year}` : "Paavo"}</small>
      </h3>
      <dl className={x.statGrid}>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={x.num}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={x.statSrc}>
        Source:{" "}
        {isHttp(s.source.url) ? (
          <a href={s.source.url} target="_blank" rel="noreferrer">
            {s.source.label}
          </a>
        ) : (
          s.source.label
        )}
      </p>
    </section>
  );
}

function Contact({ c }: { c: ServiceContact }) {
  const src = isHttp(c.source.url) ? c.source.url : undefined;
  return (
    <li className={x.svc}>
      <div className={x.svcHead}>
        {c.website && isHttp(c.website) ? (
          <a href={c.website} target="_blank" rel="noreferrer">
            {c.name}
          </a>
        ) : (
          <span>{c.name}</span>
        )}
        {c.distanceM != null && <span className={x.num}>{meters(c.distanceM) ?? DASH}</span>}
      </div>
      {(c.address || c.note) && <span className={x.svcMeta}>{[c.address, c.note].filter(Boolean).join(" · ")}</span>}
      <span className={x.svcActions}>
        {c.phone && (
          <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>
            <Phone aria-hidden /> {c.phone}
          </a>
        )}
        {c.email && (
          <a href={`mailto:${c.email}`}>
            <EnvelopeSimple aria-hidden /> {c.email}
          </a>
        )}
        {src && (
          <a className={x.svcSrc} href={src} target="_blank" rel="noreferrer" title={c.source.quote}>
            {c.source.label || host(src)}
            <ArrowUpRight weight="bold" aria-hidden />
          </a>
        )}
      </span>
    </li>
  );
}

export function SettlingIn({ a }: { a: Area }) {
  const key = `${a.id}|${a.center.lat.toFixed(4)},${a.center.lng.toFixed(4)}`;
  const [st, setSt] = useState<{ key: string; data?: AreaServices; error?: string }>(() => ({ key, data: cache.get(key) }));
  useEffect(() => {
    if (cache.has(key)) {
      setSt({ key, data: cache.get(key) });
      return;
    }
    let stop = false;
    setSt({ key });
    const q = new URLSearchParams({ areaId: a.id, lat: String(a.center.lat), lng: String(a.center.lng), municipality: a.municipality });
    fetch(`/api/move/services?${q}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as AreaServices;
      })
      .then((data) => {
        cache.set(key, data);
        if (!stop) setSt({ key, data });
      })
      .catch((e: Error) => !stop && setSt({ key, error: e.message }));
    return () => {
      stop = true;
    };
  }, [key, a.id, a.center.lat, a.center.lng, a.municipality]);

  const [openG, setOpenG] = useState<ServiceGroup | undefined>();
  const data = st.key === key ? st.data : undefined;
  const error = st.key === key ? st.error : undefined;
  return (
    <section className={d.section}>
      <h3 className={d.sh}>
        <span className={x.st}><Lifebuoy weight="bold" aria-hidden className={x.stIcon} />Settling in</span> <small>{data ? `${data.contacts.length} contacts` : ""}</small>
      </h3>
      {error ? (
        <p className={x.noSrc}>
          {DASH} Contacts unavailable: {error}
        </p>
      ) : !data ? (
        <p className={x.svcBusy}>
          <CircleNotch className={x.spin} aria-hidden /> Looking up health centres, daycare, schools, offices and landlords…
        </p>
      ) : (
        <>
          <div className={x.cgTiles}>
            {GROUPS.map((g) => {
              const list = data.contacts.filter((c) => c.group === g.id);
              if (!list.length) return null;
              const I = GROUP_ICON[g.id];
              const top = list[0];
              return (
                <button key={g.id} type="button" className={`${x.cgTile} ${openG === g.id ? x.cgOn : ""}`} onClick={() => setOpenG(openG === g.id ? undefined : g.id)} aria-expanded={openG === g.id}>
                  <span className={x.cgLabel}>
                    <span className={x.cgIcon}>
                      <I aria-hidden />
                    </span>
                    {g.label}
                  </span>
                  <strong className={x.svcTop}>{top.name}</strong>
                  <small className={x.nbName}>
                    {[top.distanceM != null ? meters(top.distanceM) : null, list.length > 1 ? `+${list.length - 1} more` : null].filter(Boolean).join(" · ") || "official page"}
                  </small>
                </button>
              );
            })}
          </div>
          {openG && (
            <ul className={x.svcOpen}>
              {data.contacts
                .filter((c) => c.group === openG)
                .map((c, i) => (
                  <Contact key={`${c.kind}-${c.name}-${i}`} c={c} />
                ))}
            </ul>
          )}
          {data.unknowns.length > 0 && <p className={x.noSrc}>Not found: {data.unknowns.join(", ")}.</p>}
          {data.sources.length > 0 && <p className={x.statSrc}>From: {data.sources.join(" · ")}</p>}
        </>
      )}
    </section>
  );
}
