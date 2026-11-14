"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import s from "@/app/landing.module.css";

/**
 * Fades its children up the first time they scroll into view. The hidden starting state only
 * applies once JavaScript has run (data-armed), so the content is never lost without it, and
 * reduced motion shows everything at once (see landing.module.css).
 */
export function Reveal({ as: Tag = "div", delay = 0, className = "", children }: { as?: ElementType; delay?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }
    // already on screen at load: show without the hidden flash
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
      setArmed(true);
      requestAnimationFrame(() => setShown(true));
      return;
    }
    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`${s.reveal} ${className}`} data-armed={armed ? "" : undefined} data-shown={shown ? "" : undefined} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}
