"use client";

// Guided tour for demos: greys out the page, spotlights one element at a time and explains what it
// shows and where the data comes from. Each step may first act (open an area, switch a map layer,
// open a tab) so the viewer never has to know what to click. Keyboard: → / Enter next, ← back, Esc.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import x from "./Move.module.css";

export type TourStep = {
  /** CSS selector of the element to spotlight (last match wins); none = centred card. */
  target?: string;
  title: string;
  body: string;
  /** Data sources behind this part, shown as small tags. */
  sources?: string[];
  /** Runs before the step is shown (open a drawer, switch a layer…). */
  before?: () => void | Promise<void>;
  /** Show Pukki in full (the welcome step) instead of the small avatar. */
  hero?: boolean;
};

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function find(sel?: string): HTMLElement | null {
  if (!sel) return null;
  const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length);
  return all.at(-1) ?? null;
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const step = steps[i];

  const measure = useCallback(() => {
    const el = find(step?.target);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    const top = Math.max(4, r.top - PAD);
    const left = Math.max(4, r.left - PAD);
    setRect({ top, left, width: Math.min(window.innerWidth - left - 4, r.width + 2 * PAD), height: Math.min(window.innerHeight - top - 4, r.height + 2 * PAD) });
  }, [step?.target]);

  // Run the step's action, wait for its element, bring it into view, then show.
  useEffect(() => {
    let stop = false;
    setReady(false);
    (async () => {
      await step?.before?.();
      for (let k = 0; k < 40 && !stop && step?.target && !find(step.target); k++) await sleep(100);
      if (stop) return;
      find(step?.target)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      await sleep(450);
      if (stop) return;
      measure();
      setReady(true);
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useEffect(() => {
    if (!ready) return;
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    const iv = setInterval(on, 400); // content inside the spotlight may still be loading or animating
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      clearInterval(iv);
    };
  }, [ready, measure]);

  // Card beside the spotlight: below, above, left or right, whichever has room; centred otherwise.
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c) return;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (v: number) => Math.min(Math.max(12, v), vw - w - 12);
    const clampY = (v: number) => Math.min(Math.max(12, v), vh - h - 12);
    if (!rect) return setCard({ top: (vh - h) / 2, left: (vw - w) / 2 });
    if (rect.top + rect.height + h + 16 < vh) return setCard({ top: rect.top + rect.height + 12, left: clampX(rect.left) });
    if (rect.top - h - 16 > 0) return setCard({ top: rect.top - h - 12, left: clampX(rect.left) });
    if (rect.left - w - 16 > 0) return setCard({ top: clampY(rect.top), left: rect.left - w - 12 });
    if (rect.left + rect.width + w + 16 < vw) return setCard({ top: clampY(rect.top), left: rect.left + rect.width + 12 });
    setCard({ top: vh - h - 16, left: (vw - w) / 2 });
  }, [rect, i, ready]);

  const next = useCallback(() => (i < steps.length - 1 ? setI(i + 1) : onClose()), [i, steps.length, onClose]);
  const back = useCallback(() => i > 0 && setI(i - 1), [i]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [next, back, onClose]);

  if (!step) return null;
  return (
    <div className={x.tour} role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of ${steps.length}: ${step.title}`}>
      {rect && ready ? <div className={x.tourHole} style={rect} /> : <div className={x.tourDim} />}
      <div ref={cardRef} className={`${x.tourCard} ${ready ? x.tourCardOn : ""} ${step.hero ? x.tourHero : ""}`} style={card}>
        {step.hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={x.tourGoatFull} src="/media/goat-full.webp" alt="Pukki the goat, in a suit, on a market square" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} className={x.tourGoat} src="/media/logo-goat-256.png" alt="" aria-hidden />
        )}
        <div className={x.tourTop}>
          <span>
            <b>Pukki</b> · {i + 1} / {steps.length}
          </span>
          <button type="button" onClick={onClose} aria-label="End tour">
            <X weight="bold" />
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {step.sources?.length ? (
          <p className={x.tourSrc}>
            {step.sources.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </p>
        ) : null}
        <div className={x.tourNav}>
          <span className={x.tourDots} aria-hidden>
            {steps.map((_, k) => (
              <i key={k} className={k === i ? x.tourDotOn : ""} />
            ))}
          </span>
          <button type="button" className={x.ghostBtn} onClick={back} disabled={i === 0}>
            <ArrowLeft weight="bold" aria-hidden /> Back
          </button>
          <button type="button" className={x.lcPrimary} onClick={next} autoFocus>
            {i === steps.length - 1 ? "Finish" : "Next"} {i < steps.length - 1 && <ArrowRight weight="bold" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
