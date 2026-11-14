import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson } from "@/lib/llm";
import { documentsToRequest, THRESHOLD_EUR, tradeKind, type DocRequest } from "@/lib/tilaajavastuu";
import type { Check } from "@/lib/verify";

const Body = z.object({
  job: z.string(),
  companies: z.array(
    z.object({
      name: z.string(),
      email: z.string().optional(),
      concerns: z.array(z.string()).default([]),
      /** B2B: business ID for the document request header. */
      businessId: z.string().optional(),
      /** B2B: documents still missing (from the report's `documents`); default: the full § 5 list. */
      documents: z.array(z.object({ id: z.string().default(""), fi: z.string(), en: z.string(), law: z.string().default("") })).optional(),
      /** B2B alternative: pass the report's checks and the missing documents are derived. */
      checks: z.array(z.any()).optional(),
    }),
  ),
  /** "b2b": a main contractor's RFQ for a subcontract + tilaajavastuu document request. */
  audience: z.enum(["consumer", "b2b"]).default("consumer"),
  project: z
    .object({
      trade: z.string().default(""),
      scope: z.string().default(""),
      place: z.string().default(""),
      startDate: z.string().default(""),
      contractValueEur: z.number().optional(),
      deadline: z.string().default(""),
    })
    .optional(),
  sender: z
    .object({ name: z.string().default(""), phone: z.string().default(""), address: z.string().default(""), company: z.string().default(""), email: z.string().default("") })
    .default({ name: "", phone: "", address: "", company: "", email: "" }),
});

const Draft = z.object({
  subject: z.string(),
  bodyFi: z.string().describe("Polite quote request in Finnish"),
  bodyEn: z.string().describe("Same request in English"),
});

export type DraftOut = {
  name: string;
  email?: string;
  subject: string;
  bodyFi: string;
  bodyEn: string;
  /** B2B: separate tilaajavastuu document request (Finnish / English), deterministic wording. */
  documentRequestFi?: string;
  documentRequestEn?: string;
  /** B2B: the documents listed in the request. */
  documents?: DocRequest[];
};

// The full tilaajavastuulaki § 5 list for a construction subcontract (used when the caller
// doesn't pass the candidate's missing documents). Items 1-3 come from public registers
// for a registered company, so they're only asked for when not passed as verified.
const FULL_LIST: DocRequest[] = [
  { id: "tv-trade-register", fi: "Kaupparekisteriote", en: "Trade register extract", law: "1233/2006 5 § 2 kohta" },
  { id: "tv-tax", fi: "Verovelkatodistus tai todistus verojen maksamisesta, enintään 3 kk vanha", en: "Tax debt certificate, max 3 months old", law: "1233/2006 5 § 3 kohta" },
  { id: "tv-pension", fi: "Todistus TyEL-eläkevakuutusten ottamisesta ja maksujen suorittamisesta (tai maksusopimuksesta), enintään 3 kk vanha", en: "TyEL pension insurance certificate: policies and contributions paid (or payment plan), max 3 months old", law: "1233/2006 5 § 4 kohta" },
  { id: "tv-tes", fi: "Selvitys sovellettavasta työehtosopimuksesta tai keskeisistä työehdoista", en: "Statement of the applicable collective agreement or main terms of employment", law: "1233/2006 5 § 5 kohta" },
  { id: "tv-occ-health", fi: "Selvitys työterveyshuollon järjestämisestä", en: "Proof that occupational health care is arranged", law: "1233/2006 5 § 6 kohta" },
  { id: "tv-accident", fi: "Todistus lakisääteisen tapaturmavakuutuksen ottamisesta", en: "Certificate of statutory occupational accident insurance", law: "1233/2006 5 § 7 kohta" },
];

type Project = { trade: string; scope: string; place: string; startDate: string; contractValueEur?: number; deadline: string };
type Sender = { name: string; phone: string; address: string; company: string; email: string };

function b2bTemplate(job: string, name: string, businessId: string | undefined, concerns: string[], docs: DocRequest[], p: Project, sender: Sender): Omit<DraftOut, "name" | "email"> {
  const work = p.scope || job;
  const kind = tradeKind(`${p.trade} ${job}`);
  const licenceFi = kind === "electrical" ? ["Tukes-rekisteröinti (sähköurakoitsija) ja työn sähköpätevyydet"] : kind === "waterproofing" ? ["Asentajien vedeneristäjän henkilösertifikaatit"] : kind === "refrigeration" ? ["Tukes-rekisteröinti (kylmäala) ja F-kaasupätevyydet"] : [];
  const licenceEn = kind === "electrical" ? ["Tukes registration (electrical contractor) and electrical qualifications"] : kind === "waterproofing" ? ["Installers' wet-room waterproofer certificates"] : kind === "refrigeration" ? ["Tukes registration (refrigeration) and F-gas qualifications"] : [];
  const qFi = [
    "Urakkahinta (alv 0 %, käännetty arvonlisäverovelvollisuus) eriteltynä sekä yksikköhinnat lisä- ja muutostöille",
    "Resurssit: vastaava työnjohtaja, asentajien määrä ja alustava aikataulu",
    "2–3 referenssiä vastaavista kohteista yhteyshenkilöineen",
    ...licenceFi,
    "Sopimusehdot: YSE 1998, maksuerät, takuuaika ja vakuudet",
    ...concerns.map((c) => `Tarkennus: ${c}`),
  ];
  const qEn = [
    "Contract price (VAT 0%, reverse charge) itemised, plus unit prices for additional and changed work",
    "Resources: site supervisor, number of installers and an outline schedule",
    "2–3 references from similar projects with contact persons",
    ...licenceEn,
    "Contract terms: YSE 1998, payment schedule, warranty period and securities",
    ...concerns.map((c) => `Please clarify: ${c}`),
  ];
  const when = p.startDate ? ` Arvioitu aloitus: ${p.startDate}.` : "";
  const whenEn = p.startDate ? ` Estimated start: ${p.startDate}.` : "";
  const where = p.place ? ` (${p.place})` : "";
  const due = p.deadline || "[päivämäärä]";
  const sign = [sender.name, sender.company, sender.phone, sender.email].filter(Boolean).join("\n");
  const subject = `Tarjouspyyntö aliurakasta: ${work}${where}`;
  const bodyFi = `Hei ${name},\n\npyydämme tarjousta aliurakasta kohteeseemme${where}: ${work}.${when}\n\nPyydämme tarjoukseen:\n${qFi.map((q) => `- ${q}`).join("\n")}\n\nPyydämme tarjouksen viimeistään ${due}. Tilaajavastuulain mukaiset selvitykset pyydämme erillisellä viestillä.\n\nYstävällisin terveisin\n${sign}`.trim();
  const bodyEn = `Hello ${name},\n\nwe are requesting a quote for a subcontract on our project${where}: ${work}.${whenEn}\n\nPlease include:\n${qEn.map((q) => `- ${q}`).join("\n")}\n\nPlease send your quote by ${p.deadline || "[date]"}. We will request the documents required by the Contractor's Liability Act separately.\n\nBest regards\n${sign}`.trim();

  const idFi = businessId ? ` (Y-tunnus ${businessId})` : "";
  // § 5 documents first; licences/certificates are asked for separately (not tilaajavastuu items).
  const legal = docs.filter((d) => d.law.startsWith("1233/2006"));
  const other = docs.filter((d) => !d.law.startsWith("1233/2006"));
  const otherFi = other.length ? `\n\nLisäksi pyydämme:\n${other.map((d) => `- ${d.fi}`).join("\n")}` : "";
  const otherEn = other.length ? `\n\nWe also ask for:\n${other.map((d) => `- ${d.en}`).join("\n")}` : "";
  const below = p.contractValueEur && p.contractValueEur < THRESHOLD_EUR;
  const docRequestFi = `Hei ${name},\n\n${below ? "Hyvän käytännön mukaisesti" : "Tilaajavastuulain (1233/2006) 5 §:n mukaisesti"} pyydämme ennen sopimuksen tekemistä yrityksenne${idFi} seuraavat selvitykset. Selvitykset eivät saa olla sopimuksen tekohetkellä kolmea kuukautta vanhempia.\n\n${legal.map((d) => `- ${d.fi}`).join("\n")}${otherFi}\n- Työmaalle tulevien henkilöiden nimet ja veronumerot (rakentamisen tiedonantovelvollisuus)\n\nJos yrityksenne on Luotettava Kumppani -ohjelmassa, ajantasainen Tilaajavastuu-raportti käy kohtien korvaajaksi siltä osin kuin se ne kattaa.\n\nKiitos!\n\nYstävällisin terveisin\n${sign}`.trim();
  const docRequestEn = `Hello ${name},\n\n${below ? "As good practice," : "Under section 5 of the Contractor's Liability Act (1233/2006),"} we need the following documents from your company${businessId ? ` (business ID ${businessId})` : ""} before we sign. None may be older than three months at signing.\n\n${legal.map((d) => `- ${d.en}`).join("\n")}${otherEn}\n- Names and tax numbers of the people coming to site (construction reporting duty)\n\nIf you are in the Luotettava Kumppani programme, a current Tilaajavastuu report replaces the items it covers.\n\nThank you!\n\nBest regards\n${sign}`.trim();
  return { subject, bodyFi, bodyEn, documentRequestFi: docRequestFi, documentRequestEn: docRequestEn, documents: docs };
}

function template(job: string, name: string, concerns: string[], sender: { name: string; phone: string }): Omit<DraftOut, "name" | "email"> {
  const qFi = [
    "Kokonaishinta (työ ja materiaalit eriteltyinä kotitalousvähennystä varten)",
    "Aikaisin mahdollinen aloituspäivä ja arvioitu kesto",
    "Takuuehdot",
    "Maksuaikataulu (emme maksa ennakkoon koko summaa)",
    ...concerns.map((c) => `Tarkennus: ${c}`),
  ];
  const qEn = [
    "Total price (labour and materials itemised for the household tax credit)",
    "Earliest start date and estimated duration",
    "Warranty terms",
    "Payment schedule (we will not prepay the full amount)",
    ...concerns.map((c) => `Please clarify: ${c}`),
  ];
  return {
    subject: `Tarjouspyyntö / Quote request: ${job}`,
    bodyFi: `Hei ${name},\n\npyydän tarjousta seuraavasta työstä: ${job}.\n\nPyytäisin tarjoukseen:\n${qFi.map((q) => `- ${q}`).join("\n")}\n\nYstävällisin terveisin\n${sender.name}\n${sender.phone}`.trim(),
    bodyEn: `Hello ${name},\n\nI would like a quote for: ${job}.\n\nPlease include:\n${qEn.map((q) => `- ${q}`).join("\n")}\n\nBest regards\n${sender.name}\n${sender.phone}`.trim(),
  };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { job, companies, sender, audience } = parsed.data;
  if (audience === "b2b") {
    const project: Project = { trade: "", scope: "", place: "", startDate: "", deadline: "", ...parsed.data.project };
    const drafts: DraftOut[] = await Promise.all(
      companies.map(async (c) => {
        const fromChecks = c.checks ? documentsToRequest(c.checks as Check[]) : undefined;
        const docs = (c.documents?.length ? c.documents : fromChecks?.length ? fromChecks : FULL_LIST).map((d) => ({ ...d }));
        const base = b2bTemplate(job, c.name, c.businessId, c.concerns, docs, project, sender);
        // The legal document request stays deterministic; only the RFQ wording is polished.
        try {
          const d = await askJson({
            system:
              "You polish a Finnish construction main contractor's request for quotation (tarjouspyyntö) to a subcontractor. Professional, polite, concise Finnish business register (and a matching English version). Keep every requested item, the dates, place and signature; in the Finnish version write the project description and start date in natural Finnish (e.g. '40-apartment pipe renovation' -> '40 asunnon linjasaneeraus', 'March 2027' -> 'maaliskuu 2027'), and in the English version translate any Finnish concern into English; phrase concerns as neutral questions; keep placeholders in [brackets]; under 180 words per language. Do not add legal claims.",
            user: `Draft to improve:\nSUBJECT: ${base.subject}\nFI:\n${base.bodyFi}\n\nEN:\n${base.bodyEn}`,
            schema: Draft,
          });
          return { name: c.name, email: c.email, ...base, subject: d.subject, bodyFi: d.bodyFi, bodyEn: d.bodyEn };
        } catch {
          return { name: c.name, email: c.email, ...base };
        }
      }),
    );
    return NextResponse.json({ drafts });
  }
  const drafts: DraftOut[] = await Promise.all(
    companies.map(async (c) => {
      const base = template(job, c.name, c.concerns, sender);
      try {
        const d = await askJson({
          system:
            "You write short, polite quote requests (tarjouspyyntö) from a Finnish household to a contractor. Keep the questions from the draft, phrase the concerns as neutral questions (never accusations), and keep it under 150 words per language.",
          user: `Draft to improve:\nSUBJECT: ${base.subject}\nFI:\n${base.bodyFi}\n\nEN:\n${base.bodyEn}`,
          schema: Draft,
        });
        return { name: c.name, email: c.email, ...d };
      } catch {
        return { name: c.name, email: c.email, ...base };
      }
    }),
  );
  return NextResponse.json({ drafts });
}
