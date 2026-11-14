"use client";

// Listing card for the move file, portal-style: the listing's own photos first, then price, size,
// address and how far it is from work. Photos are the portal's images, linked to the listing;
// a listing without photos says so instead of showing a stock picture.
import { useState } from "react";
import { CaretLeft, CaretRight, House, Images } from "@phosphor-icons/react";
import type { Listing, MoveIntent } from "@/lib/move/types";
import { fmtDate, host, mins, price } from "./model";
import x from "./Move.module.css";

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
  const car = l.commute?.carMin;
  const pub = fmtDate(l.publishedAt);
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
          <p className={x.lcMeta}>
            {[areaName && `${rank ? `#${rank} ` : ""}${areaName}`, t != null ? `${l.commute?.estimate ? "≈" : ""}${mins(t)} transit` : areaTransit != null ? `≈${mins(areaTransit)} transit (area)` : null, car != null ? `${mins(car)} car` : null].filter(Boolean).join(" · ")}
          </p>
          <p className={x.lcFoot}>
            <span>{pub ? `Published ${pub}` : "Date not stated"}</span>
            <span className={contact ? x.lcContact : ""}>{contact ? "Contact listed" : "No contact in listing"}</span>
          </p>
        </div>
      </div>
      <div className={x.lcActions}>
        <button type="button" className={x.lcPrimary} onClick={onResearch}>
          Research
        </button>
        <button type="button" className={x.ghostBtn} onClick={onDraft}>
          Request viewing
        </button>
      </div>
    </li>
  );
}
