import { ArrowUpRight, Globe } from "@phosphor-icons/react/dist/ssr";
import s from "@/app/landing.module.css";

/* The shape of a source card, with field names in place of values: the landing does not show
   invented facts, so every value is a neutral placeholder bar. */
function Bar({ w }: { w: string }) {
  return <span className={s.srcBar} style={{ width: w }} aria-hidden />;
}

export function SourceCardMock() {
  return (
    <figure className={s.src} aria-label="Structure of a source card: claim, source, published date, date read and quoted passage">
      <div className={s.srcFinding}>
        <span className={s.srcDot} aria-hidden />
        <div className={s.srcFindingBody}>
          <p className={s.srcLabel}>Claim</p>
          <p className={s.srcSentence}>
            <Bar w="92%" />
            <Bar w="58%" />
          </p>
        </div>
        <span className={s.srcRef} aria-hidden>
          1
        </span>
      </div>
      <div className={s.srcCard}>
        <div className={s.srcHead}>
          <span className={s.srcFav} aria-hidden>
            <Globe weight="bold" />
          </span>
          <span className={s.srcWho}>
            <span className={s.srcLabel}>Source</span>
            <span className={s.srcWhoName}>Publisher · domain</span>
          </span>
        </div>
        <dl className={s.srcMeta}>
          <div>
            <dt className={s.srcLabel}>Published</dt>
            <dd>
              <Bar w="72px" />
            </dd>
          </div>
          <div>
            <dt className={s.srcLabel}>Read</dt>
            <dd>
              <Bar w="72px" />
            </dd>
          </div>
        </dl>
        <div className={s.srcQuoteWrap}>
          <p className={s.srcLabel}>Quote</p>
          <blockquote className={s.srcQuote}>
            <Bar w="100%" />
            <Bar w="96%" />
            <Bar w="70%" />
          </blockquote>
        </div>
        <div className={s.srcFoot}>
          <span className={s.srcPill}>
            Open at this passage
            <ArrowUpRight weight="bold" aria-hidden />
          </span>
        </div>
      </div>
      <figcaption className={s.srcCaption}>
        The shape of a source card. Values appear when you run a search.
      </figcaption>
    </figure>
  );
}
