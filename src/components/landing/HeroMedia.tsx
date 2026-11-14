"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import s from "@/app/landing.module.css";
import { usePageHidden } from "./usePageHidden";

/* Four AI-generated scenes crossfading on one 28 s CSS timeline (7 s each, 1.4 s crossfade,
   slow Ken Burns). Scenes, names and progress hairlines share the per-scene delay, so pausing
   them together (tab hidden) keeps them in step. */
const SCENES = [
  { src: "/media/move/street.webp", name: "A tram street in winter", pos: "50% 55%" },
  { src: "/media/move/interior.webp", name: "Moving day", pos: "62% 50%" },
  { src: "/media/move/shore.webp", name: "Seaside blocks at dusk", pos: "40% 50%" },
  { src: "/media/aerial.webp", name: "Courtyards from above", pos: "56% 50%" },
];

export function HeroMedia() {
  const hidden = usePageHidden();
  return (
    <div className={`${s.media} ${hidden ? s.paused : ""}`}>
      <div className={s.scenes} aria-hidden>
        {SCENES.map((sc, i) => (
          <div key={sc.src} className={s.scene} style={{ "--i": i } as CSSProperties}>
            <Image src={sc.src} alt="" fill sizes="100vw" unoptimized priority={i === 0} loading="eager" style={{ objectPosition: sc.pos }} />
          </div>
        ))}
      </div>
      <div className={s.mediaFoot} aria-hidden>
        <span className={s.sceneBars}>
          {SCENES.map((sc, i) => (
            <i key={sc.src} style={{ "--i": i } as CSSProperties} />
          ))}
        </span>
        <span className={s.sceneNames}>
          {SCENES.map((sc, i) => (
            <span key={sc.src} className={s.sceneName} style={{ "--i": i } as CSSProperties}>
              {sc.name}
            </span>
          ))}
        </span>
        <span className={s.credit}>Image: AI-generated</span>
      </div>
    </div>
  );
}
