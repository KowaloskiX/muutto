"use client";

// Listing card for the move file, portal-style: the listing's own photos first, then price, size,
// address and how far it is from work. Photos are the portal's images, linked to the listing;
// a listing without photos says so instead of showing a stock picture.
import { useState } from "react";
import { CaretLeft, CaretRight, House, Images } from "@phosphor-icons/react";
import type { Listing, MoveIntent } from "@/lib/move/types";
import { host, mins, price } from "./model";
import x from "./Move.module.css";
import { historyLine } from "./Insights";

export function Gallery({ photos, alt, className }: { photos?: string[]; alt: string; className?: string }) {
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const ok = (photos ?? []).filter((_, k) => !broken.has(k));
  if (!ok.length)
    return (
      <div className={`${x.lcPhoto} ${x.lcNoPhoto} ${className ?? ""}`}>
        <House weight="light" aria-hidden />
        <span>No photos in the listing</span>
      </div>
    );
  const k = Math.min(i, ok.length - 1);
  const go = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setI((v) => (v + d + ok.length) % ok.length);
  };
  return (
    <div className={`${x.lcPhoto} ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={ok[k]}
        src={ok[k]}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken((b) => new Set(b).add((photos ?? []).indexOf(ok[k])))}
      />
      {ok.length > 1 && (
        <>
          <button type="button" className={`${x.lcNav} ${x.lcPrev}`} onClick={go(-1)} aria-label="Previous photo">
            <CaretLeft weight="bold" />
          </button>
          <button type="button" className={`${x.lcNav} ${x.lcNext}`} onClick={go(1)} aria-label="Next photo">
            <CaretRight weight="bold" />
          </button>
          <span className={x.lcCount}>
            <Images aria-hidden /> {k + 1}/{ok.length}
          </span>
        </>
      )}
    </div>
  );
}

export function ListingCard({
  l,
  tenure,
  areaName,
  areaTransit,
  rank,
  onOpen,
  onResearch,
  onDraft,
}: {
  l: Listing;
  tenure?: MoveIntent["tenure"];
  areaName?: string;
  /** The area's transit time, shown (and labelled) when the listing itself was not routed. */
  areaTransit?: number | null;
  rank?: number;
  onOpen: () => void;
  onResearch: () => void;
  onDraft: () => void;
}) {
  const p = price(l, tenure);
  const perM2 = l.price && l.sizeM2 ? Math.round(l.price / l.sizeM2) : undefined;
  const t = l.commute?.transitMin;
  const pub = l.publishedAt ? new Date(l.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  const contact = l.contact && (l.contact.email || l.contact.phone || l.contact.formUrl);
  const facts = [l.rooms, l.sizeM2 ? `${Math.round(l.sizeM2 * 10) / 10} m²` : null].filter(Boolean);
  return (
    <li className={x.lc}>
      <div role="button" tabIndex={0} className={x.lcMain} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())} aria-label={`${l.address || l.title}, ${p ?? "price not stated"}`}>
        <Gallery photos={l.photos} alt={l.address || l.title} />
        <span className={x.lcSource}>{l.source || host(l.url)}</span>
        <div className={x.lcBody}>
          <div className={x.lcPriceRow}>
            <strong>{p ?? <span className={x.unknownWord}>Price not stated</span>}</strong>
            {perM2 && <span>€{perM2.toLocaleString("en-US")}/m²{tenure === "buy" ? "" : " / mo"}</span>}
          </div>
          {facts.length > 0 && <p className={x.lcFacts}>{facts.join(" · ")}</p>}
          <p className={x.lcAddr}>{l.address || l.title}</p>
          {(() => {
            const pick = (l.facts ?? []).filter((f) => ["built", "lift", "sauna", "renovation", "pets", "energy"].includes(f.key)).slice(0, 4);
            const hist = historyLine(l);
            return pick.length || hist ? (
              <p className={x.lcChips}>
                {hist && <span className={x.lcHist} title="Found with Exa on the portals: same address and size">{hist}</span>}
                {pick.map((f) => (
                  <span key={f.key} className={f.tone ? x[`ft_${f.tone}`] : ""} title={`“${f.quote}”`}>
                    {f.key === "built" ? `Built ${f.value}` : f.key === "lift" ? (f.value === "Yes" ? "Lift" : "No lift") : f.key === "sauna" ? `Sauna ${f.value === "In the flat" ? "in flat" : "in building"}` : f.key === "renovation" ? `Pipes ${f.value.toLowerCase()}` : f.key === "pets" ? (f.value === "Allowed" ? "Pets OK" : "No pets") : `Energy ${f.value}`}
                  </span>
                ))}
              </p>
            ) : null;
          })()}
          <p className={x.lcMeta}>
            {[areaName, t != null ? `${l.commute?.estimate ? "≈" : ""}${mins(t)} transit` : areaTransit != null ? `≈${mins(areaTransit)} transit` : null, pub].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className={x.lcActions}>
        <button type="button" className={x.lcLink} onClick={onResearch}>
          Research
        </button>
        <button type="button" className={x.lcLink} onClick={onDraft}>
          Request viewing
        </button>
        {contact && <span className={x.lcContact}>Contact listed</span>}
      </div>
    </li>
  );
}
