import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowDown,
  Train,
  Storefront,
  Wind,
  Crane,
  HouseLine,
  Buildings,
} from "@phosphor-icons/react/dist/ssr";
import { HeroMedia } from "@/components/landing/HeroMedia";
import { Reveal } from "@/components/landing/Reveal";
import { SourceCardMock } from "@/components/landing/SourceCardMock";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Muutto | Find where to live in Helsinki before you land",
  description:
    "For people moving to the Helsinki region for work: areas ranked by real commute and daily life, live listings found with Exa, deep research on the flat you like, and a source for every fact.",
};

const STEPS = [
  {
    title: "Tell us where you’ll work",
    text: "Your workplace and what matters to you, in plain words. Budget, rooms, kids, a dog, a gym nearby.",
  },
  {
    title: "Areas ranked by real commute and daily life",
    text: "Travel times by public transport, car, bike and on foot, then the distance to a pharmacy, groceries, cafés, schools and parks, with air quality and noise.",
  },
  {
    title: "Live listings, and deep research on the one you like",
    text: "Rentals and homes for sale found with Exa. Pick one and Muutto looks into the building’s renovations, the landlord’s reviews and any works planned on the street.",
  },
  {
    title: "A viewing request for your OK, and a watch on your areas",
    text: "A message to the real contact on the listing is drafted for you to approve. Exa Monitors keep looking and tell you when something new appears.",
  },
];

const CHECKS = [
  {
    icon: Train,
    title: "Commute",
    text: "Public transport, car (rush hour where it can be measured), bike and walking, to your workplace.",
    from: "Digitransit journey planner and routing",
  },
  {
    icon: Storefront,
    title: "Daily life",
    text: "How far to the nearest pharmacy, grocery store, café, school, park and stop.",
    from: "OpenStreetMap",
  },
  {
    icon: Wind,
    title: "Environment",
    text: "Air quality near the address, and whether the street is known to be loud.",
    from: "Finnish Meteorological Institute, city data and local news",
  },
  {
    icon: Crane,
    title: "Change",
    text: "Street works, blasting, new tram and metro lines, buildings going up next door.",
    from: "City decisions and local news via Exa",
  },
  {
    icon: HouseLine,
    title: "Listings",
    text: "Live rentals and homes for sale, each linked back to the original ad.",
    from: "Finnish listing sites via Exa",
  },
  {
    icon: Buildings,
    title: "Landlord & building",
    text: "What tenants say about the landlord, and past or planned renovations in the building.",
    from: "Reviews, housing company pages and news via Exa",
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

const EXTRAS = [
  {
    title: "Your criteria, too",
    text: "A gym, a climbing wall, a Lidl, a dog park: name it in your own words and every area gets a column for the nearest one, with its address.",
    from: "Exa Places",
    img: "/media/move/climb.webp",
    alt: "A bright bouldering gym in a converted brick hall",
  },
  {
    title: "How far is the weekend?",
    text: "Drag the slider up to 3 hours and watch the map fill with everywhere the car gets you from work, lakes and cottages included.",
    from: "OSRM routing on OpenStreetMap",
    img: "/media/move/cottage.webp",
    alt: "A small wooden lakeside cottage and sauna in a misty Finnish forest",
  },
];

export default function Landing() {
  return (
    <div className={s.page}>
      <header className={s.bar}>
        <div className={s.barIn}>
          <Link href="/" className={s.word} aria-label="Muutto home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/logo-goat-256.png" alt="" className={s.logo} width={32} height={32} />
            Muutto
          </Link>
          <Link href="/move" className={s.barCta}>
            Open app
          </Link>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className={s.hero}>
          <div className={s.wrap}>
            <p className={`${s.eyebrow} ${s.in1}`}>
              For people moving to Helsinki for work
            </p>
            <div className={s.heroGrid}>
              <h1 className={s.h1}>
                <span className={s.line}>
                  <span className={s.in2}>Find where to live</span>
                </span>{" "}
                <span className={s.line}>
                  <span className={s.in3}>before you land.</span>
                </span>
              </h1>
              <div className={`${s.heroRow} ${s.in4}`}>
                <p className={s.lead}>
                  Tell Muutto where you&rsquo;ll work. It ranks areas by your
                  real commute and daily life, finds live listings, and links
                  every fact to its source.
                </p>
                <div className={s.ctaRow}>
                  <Cta href="/move">Start with your workplace</Cta>
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

        {/* how it works */}
        <section id="how" className={s.section}>
          <div className={`${s.wrap} ${s.how}`}>
            <div className={s.howText}>
              <Reveal>
                <p className={s.eyebrow}>How it works</p>
                <h2 className={s.h2}>
                  From a job offer to a viewing request.
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
                  src="/media/move/interior.webp"
                  alt="An empty flat on moving day, boxes on the floor and keys on the window sill"
                  fill
                  sizes="(min-width: 960px) 40vw, 100vw"
                  unoptimized
                  style={{ objectPosition: "62% 50%" }}
                />
                <figcaption className={s.credit}>
                  Image: AI-generated
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* what we check */}
        <section className={s.band}>
          <div className={s.wrap}>
            <Reveal className={s.bandHead}>
              <p className={s.eyebrow}>What we check</p>
              <h2 className={s.h2}>
                The things you&rsquo;d only learn after living there.
              </h2>
              <p className={s.bandLead}>
                Each check names where its answer comes from.
              </p>
            </Reveal>
            <div className={s.checkGrid}>
              {CHECKS.map((c, i) => (
                <Reveal
                  key={c.title}
                  className={s.check}
                  delay={(i % 3) * 90}
                >
                  <c.icon className={s.checkIcon} weight="light" aria-hidden />
                  <h3 className={s.h3}>{c.title}</h3>
                  <p className={s.checkText}>{c.text}</p>
                  <p className={s.checkFrom}>
                    <span>From</span> {c.from}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* beyond the checklist */}
        <section className={s.section}>
          <div className={s.wrap}>
            <Reveal>
              <p className={s.eyebrow}>Beyond the checklist</p>
              <h2 className={s.h2}>Ask for what matters to you.</h2>
            </Reveal>
            <div className={s.duo}>
              {EXTRAS.map((e, i) => (
                <Reveal key={e.title} className={s.duoCard} delay={i * 120}>
                  <figure className={s.duoPhoto}>
                    <Image src={e.img} alt={e.alt} fill sizes="(min-width: 960px) 50vw, 100vw" unoptimized />
                    <figcaption className={s.credit}>Image: AI-generated</figcaption>
                  </figure>
                  <h3 className={s.h3}>{e.title}</h3>
                  <p className={s.duoText}>{e.text}</p>
                  <p className={s.duoFrom}>
                    <span>From</span> {e.from}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* sources */}
        <section className={s.section}>
          <div className={`${s.wrap} ${s.proof}`}>
            <Reveal className={s.proofText}>
              <p className={s.eyebrow}>Every answer has a source</p>
              <h2 className={s.h2}>Nothing you have to take on trust.</h2>
              <ul className={s.proofList}>
                <li>The page it came from, and when it was read.</li>
                <li>The exact passage, quoted.</li>
                <li>
                  When something can&rsquo;t be found, it says so instead of
                  guessing.
                </li>
              </ul>
            </Reveal>
            <Reveal className={s.proofStage} delay={120}>
              <div className={s.proofBg} aria-hidden>
                <Image
                  src="/media/move/street.webp"
                  alt=""
                  fill
                  sizes="(min-width: 960px) 55vw, 100vw"
                  unoptimized
                  style={{ objectPosition: "60% 60%" }}
                />
              </div>
              <SourceCardMock />
              <span className={`${s.credit} ${s.creditCorner}`}>
                Image: AI-generated
              </span>
            </Reveal>
          </div>
        </section>

        {/* final call */}
        <section className={s.final}>
          <Reveal className={s.finalBand}>
            <Image
              src="/media/move/shore.webp"
              alt=""
              fill
              sizes="100vw"
              unoptimized
              className={s.finalImg}
              style={{ objectPosition: "40% 50%" }}
            />
            <div className={s.finalIn}>
              <h2 className={s.finalTitle}>Start with where you&rsquo;ll work.</h2>
              <p className={s.finalLead}>
                Muutto does the searching, the checking and the first message.
              </p>
              <Cta href="/move" light>
                Start with your workplace
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
          <span className={s.word}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/logo-goat-256.png" alt="" className={s.logo} width={24} height={24} />
            Muutto
          </span>
          <span className={s.footNote}>Built at Junction 2026 with Exa</span>
          <nav className={s.footNav} aria-label="Footer">
            <Link href="/move">App</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
