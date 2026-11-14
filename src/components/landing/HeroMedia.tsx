"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import s from "@/app/landing.module.css";
import { usePageHidden } from "./usePageHidden";

/* Three AI-generated scenes crossfading on one 21 s CSS timeline (7 s each, 1.4 s crossfade,
   slow Ken Burns). Scenes, names and progress hairlines share the per-scene delay, so pausing
   them together (tab hidden) keeps them in step. */
const SCENES = [
  { src: "/media/aerial.webp", name: "Courtyard blocks · Helsinki", pos: "56% 50%" },
  { src: "/media/facade.webp", name: "Facade renovation · Helsinki", pos: "50% 38%" },
  { src: "/media/corridor.webp", name: "Ventilation works · school", pos: "50% 45%" },
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
