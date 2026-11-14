import { ArrowUpRight, FileText } from "@phosphor-icons/react/dist/ssr";
import s from "@/app/landing.module.css";

/* A static copy of the drawer's source card, filled with the real register passage for
   Helsingin ilmanvaihto Oy (3226458-8) from the recorded check of 14 Nov 2026. */
const FOUND = [
  ["Kaupparekisteri", "Trade register", "03.08.2021"],
  ["Verohallinnon perustiedot", "Tax Administration", "03.08.2021"],
  ["Arvonlisäverovelvollisuus", "VAT register", "31.07.2021"],
];
const MISSING = [
  ["Ennakkoperintärekisteri", "Prepayment register"],
  ["Työnantajarekisteri", "Employer register"],
];

export function SourceCardMock() {
  return (
    <figure className={s.src} aria-label="Example source card for Helsingin ilmanvaihto Oy">
      <div className={s.srcFinding}>
        <span className={s.srcDot} aria-hidden />
        <div>
          <p className={s.srcVerdict}>Clarify before signing</p>
          <p className={s.srcSentence}>Helsingin ilmanvaihto Oy is not listed in the prepayment or employer register.</p>
        </div>
      </div>
      <div className={s.srcCard}>
        <figcaption className={s.srcHead}>
          <span className={s.srcFav} aria-hidden>
            <FileText weight="bold" />
          </span>
          <span className={s.srcWho}>
            <strong>Asiakastieto · asiakastieto.fi</strong>
            <span>YTJ register data · cited passage highlighted</span>
          </span>
        </figcaption>
        <blockquote className={s.srcPassage}>
          <p className={s.srcPHead}>Active registers</p>
          {FOUND.map(([fi, en, date]) => (
            <span key={fi} className={`${s.srcRow} ${s.srcFound}`}>
              <span>
                {fi} <span className={s.srcEn}>({en})</span>
              </span>
              <span className={s.srcDate}>{date}</span>
            </span>
          ))}
          {MISSING.map(([fi, en]) => (
            <span key={fi} className={`${s.srcRow} ${s.srcMissing}`}>
              <span>
                {fi} <span className={s.srcEn}>({en})</span>
              </span>
              <span className={s.srcDate}>Not listed</span>
            </span>
          ))}
        </blockquote>
        <div className={s.srcFoot}>
          <span className={s.srcPill}>
            Open at this passage
            <ArrowUpRight weight="bold" aria-hidden />
          </span>
        </div>
      </div>
    </figure>
  );
}
