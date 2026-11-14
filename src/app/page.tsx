import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowDown } from "@phosphor-icons/react/dist/ssr";
import { HeroMedia } from "@/components/landing/HeroMedia";
import { Reveal } from "@/components/landing/Reveal";
import { SourceCardMock } from "@/components/landing/SourceCardMock";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Kilpi for contractors | Vet subcontractors before you sign",
  description:
    "For main contractors in Finland: find subcontractors with Exa, check them against the tilaajavastuu registers with a source for every finding, draft quote and document requests, and watch them during the project.",
};

const STEPS = [
  {
    title: "Describe the job",
    text: "Trade, site and timing, in plain words. Finnish or English.",
  },
  {
    title: "Exa finds local subcontractors",
    text: "Exa searches the web for firms that actually do the work near your site.",
  },
  {
    title: "Every register check cited to its source",
    text: "Trade, VAT, prepayment and employer registers, each linked to the passage it came from.",
  },
  {
    title: "Draft requests, then watch",
    text: "Quote and missing-document requests drafted for your approval; Exa Monitors watch the firms you hire during the project.",
  },
];

function Cta({
  href,
  children,
  light = false,
}: {
  href: string;
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <Link href={href} className={`${s.cta} ${light ? s.ctaLight : ""}`}>
      <span>{children}</span>
      <span className={s.ctaDisc} aria-hidden>
        <ArrowRight weight="bold" />
      </span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className={s.page}>
      <header className={s.bar}>
        <div className={s.barIn}>
          <Link href="/" className={s.word} aria-label="Kilpi home">
            Kilpi
          </Link>
          <Link href="/chat" className={s.barCta}>
            Open app
          </Link>
        </div>
      </header>

      <main>
        {/* 1 · hero */}
        <section className={s.hero}>
          <div className={s.wrap}>
            <p className={`${s.eyebrow} ${s.in1}`}>
              For main contractors in Finland
            </p>
            <div className={s.heroGrid}>
              <h1 className={s.h1}>
                <span className={s.line}>
                  <span className={s.in2}>Vet subcontractors</span>
                </span>{" "}
                <span className={s.line}>
                  <span className={s.in3}>before you sign.</span>
                </span>
              </h1>
              <div className={`${s.heroRow} ${s.in4}`}>
                <p className={s.lead}>
                  Kilpi finds subcontractors for your project and checks them
                  against the public registers, with a source for every finding.
                </p>
                <div className={s.ctaRow}>
                  <Cta href="/chat">Start a search</Cta>
                  <a href="#how" className={s.textLink}>
                    See how it works <ArrowDown weight="bold" aria-hidden />
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className={`${s.mediaWrap} ${s.in5}`}>
            <HeroMedia />
          </div>
        </section>

        {/* 2 · how it works */}
        <section id="how" className={s.section}>
          <div className={`${s.wrap} ${s.how}`}>
            <div className={s.howText}>
              <Reveal>
                <p className={s.eyebrow}>How it works</p>
                <h2 className={s.h2}>
                  From a job description to a vetted shortlist.
                </h2>
              </Reveal>
              <ol className={s.steps}>
                {STEPS.map((st, i) => (
                  <Reveal
                    as="li"
                    key={st.title}
                    delay={i * 90}
                    className={s.step}
                  >
                    <span className={s.stepNo}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className={s.h3}>{st.title}</h3>
                      <p className={s.stepText}>{st.text}</p>
                    </div>
                  </Reveal>
                ))}
              </ol>
            </div>
            <Reveal className={s.howImg} delay={120}>
              <figure className={s.photo}>
                <Image
                  src="/media/facade.webp"
                  alt="Scaffolded apartment facade under renovation in Helsinki"
                  fill
                  sizes="(min-width: 960px) 40vw, 100vw"
                  unoptimized
                  style={{ objectPosition: "50% 40%" }}
                />
                <figcaption className={s.credit}>
                  Image: AI-generated
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* 3 · why it matters */}
        <section className={s.law}>
          <div className={s.wrap}>
            <Reveal className={s.lawHead}>
              <p className={s.eyebrow}>Why it matters</p>
              <h2 className={s.h2}>
                The Contractor&rsquo;s Liability Act puts the checks on you.
              </h2>
              <p className={s.lawLead}>
                Tilaajavastuulaki (1233/2006) applies to subcontracts worth over
                €9,000, excl. VAT.
              </p>
            </Reveal>
            <div className={s.lawGrid}>
              <Reveal className={s.lawItem} delay={0}>
                <span className={s.lawRef}>§ 5</span>
                <h3 className={s.h3}>Collect the documents first</h3>
                <p>
                  Register entries, trade register extract, tax and pension
                  certificates, the collective agreement, and for construction
                  accident insurance and occupational health care. None older
                  than three months.
                </p>
              </Reveal>
              <Reveal className={s.lawItem} delay={90}>
                <span className={s.lawRef}>§ 9</span>
                <h3 className={s.h3}>Neglect has a price</h3>
                <p>
                  The main contractor can be fined (laiminlyöntimaksu) for not
                  collecting them.
                </p>
              </Reveal>
              <Reveal className={s.lawItem} delay={180}>
                <span className={s.lawRef}>Beyond</span>
                <h3 className={s.h3}>Registers are not the whole story</h3>
                <p>
                  Registers can&rsquo;t show references, licences or news. Kilpi
                  checks those too.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 4 · proof */}
        <section className={s.section}>
          <div className={`${s.wrap} ${s.proof}`}>
            <Reveal className={s.proofText}>
              <p className={s.eyebrow}>Proof, not claims</p>
              <h2 className={s.h2}>Every finding shows where it came from.</h2>
              <ul className={s.proofList}>
                <li>The page that was read, and when.</li>
                <li>The exact passage, highlighted.</li>
                <li>What is missing is shown as missing, never guessed.</li>
              </ul>
            </Reveal>
            <Reveal className={s.proofStage} delay={120}>
              <div className={s.proofBg} aria-hidden>
                <Image
                  src="/media/corridor.webp"
                  alt=""
                  fill
                  sizes="(min-width: 960px) 55vw, 100vw"
                  unoptimized
                  style={{ objectPosition: "50% 45%" }}
                />
              </div>
              <SourceCardMock />
              <span className={`${s.credit} ${s.creditCorner}`}>
                Image: AI-generated
              </span>
            </Reveal>
          </div>
        </section>

        {/* 5 · final call */}
        <section className={s.final}>
          <Reveal className={s.finalBand}>
            <Image
              src="/media/aerial.webp"
              alt=""
              fill
              sizes="100vw"
              unoptimized
              className={s.finalImg}
              style={{ objectPosition: "56% 50%" }}
            />
            <div className={s.finalIn}>
              <h2 className={s.finalTitle}>Start with a real project.</h2>
              <p className={s.finalLead}>
                Describe the job. Kilpi does the searching and the checking.
              </p>
              <Cta href="/chat" light>
                Start a search
              </Cta>
            </div>
            <span className={`${s.credit} ${s.creditCorner}`}>
              Image: AI-generated
            </span>
          </Reveal>
        </section>
      </main>

      <footer className={s.foot}>
        <div className={`${s.wrap} ${s.footIn}`}>
          <span className={s.word}>Kilpi</span>
          <span className={s.footNote}>Built at Junction 2026 with Exa</span>
          <nav className={s.footNav} aria-label="Footer">
            <Link href="/chat">App</Link>
            <Link href="/classic">Classic</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
