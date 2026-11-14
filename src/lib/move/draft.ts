// Viewing-request email for one listing. Deterministic template (no invented facts): it only
// uses what the listing, the user's intent and the cited research say. The one optional LLM
// call translates the research questions to Finnish; without it the Finnish body keeps the
// questions in English, which is clearly marked rather than guessed.
import { z } from "zod";
import { askJson, assertLlmBudget } from "@/lib/llm";
import type { Listing, ListingResearch, MoveIntent, ViewingDraft } from "./types";

export type Sender = { name?: string; phone?: string; email?: string; moveDate?: string };

const firstName = (n?: string) => n?.trim().split(/\s+/)[0];

function llmOk() {
  if (!process.env.OPENAI_API_KEY) return false;
  try {
    assertLlmBudget();
    return true;
  } catch {
    return false;
  }
}

/** Up to 3 questions: research questions first, then ones tied to unknowns, then availability. */
export function pickQuestions(research?: ListingResearch): string[] {
  const out: string[] = [];
  for (const raw of research?.questions ?? []) {
    // Internal research notes ("We found no source either way") do not belong in a letter.
    const q = raw.replace(/\s*We found no source[^.?]*[.?]?\s*$/i, "").trim();
    if (out.length < 3 && q.length > 10 && q.length < 260) out.push(q);
  }
  if (out.length < 2 && research?.risks.some((r) => r.severity === "high"))
    out.push("Is the apartment still available? The listing page looked as if it might have been taken.");
  if (out.length < 2) out.push("When could I come to see the apartment, and is there a planned viewing time?");
  if (out.length < 3) out.push("What is included in the rent (water, internet, electricity), and what deposit do you require?");
  return out.slice(0, 3);
}

const Fi = z.object({ questions: z.array(z.string()) });

export async function buildViewingDraft(listing: Listing, intent: MoveIntent | undefined, research: ListingResearch | undefined, sender: Sender = {}): Promise<ViewingDraft> {
  const contact = research?.landlord?.contact ?? listing.contact;
  const to = contact?.email;
  const formUrl = contact?.formUrl;
  const greetName = firstName(contact?.name);
  const addr = research?.address ?? listing.address ?? listing.title;
  const questions = pickQuestions(research);

  const work = intent?.work?.label ?? intent?.workAddress;
  const moveDate = sender.moveDate?.trim();
  const hh = intent?.household?.trim();

  const enLines = [
    `I am interested in the apartment at ${addr}${listing.price ? ` (${listing.price} €/month)` : ""}${listing.url ? `, listed at ${listing.url}` : ""}.`,
    work ? `I am moving to the Helsinki region for work${work ? ` (my workplace is at ${work})` : ""}${moveDate ? ` and would like to move in around ${moveDate}` : ""}.` : moveDate ? `I would like to move in around ${moveDate}.` : "",
    hh ? `The apartment would be for: ${hh}.` : "",
  ].filter(Boolean);
  const fiLines = [
    `Olen kiinnostunut asunnosta osoitteessa ${addr}${listing.price ? ` (${listing.price} €/kk)` : ""}${listing.url ? `, ilmoitus: ${listing.url}` : ""}.`,
    work ? `Muutan pääkaupunkiseudulle töiden vuoksi${work ? ` (työpaikkani on osoitteessa ${work})` : ""}${moveDate ? ` ja toivoisin pääseväni muuttamaan noin ${moveDate}` : ""}.` : moveDate ? `Toivoisin pääseväni muuttamaan noin ${moveDate}.` : "",
  ].filter(Boolean);

  let questionsFi: string[] | undefined;
  if (llmOk()) {
    try {
      const fi = await askJson({
        system: "Translate to natural, polite Finnish. Keep addresses, names, numbers and years exactly. Return the same number of questions in the same order.",
        user: JSON.stringify({ questions }),
        schema: Fi,
      });
      if (fi.questions.length === questions.length) questionsFi = fi.questions;
    } catch {
      /* keep English questions */
    }
  }

  const sign = [sender.name, sender.phone, sender.email].filter((x) => x?.trim()).join("\n");
  const list = (qs: string[]) => qs.map((q) => `- ${q}`).join("\n");
  const bodyEn = [
    `Hello${greetName ? ` ${greetName}` : ""},`,
    "",
    enLines.join(" "),
    "",
    "Could I come to a viewing? Before that, I would like to ask:",
    list(questions),
    "",
    "Thank you, I look forward to hearing from you.",
    "",
    `Best regards${sign ? `\n${sign}` : ""}`,
  ].join("\n");
  const bodyFi = [
    `Hei${greetName ? ` ${greetName}` : ""},`,
    "",
    fiLines.join(" "),
    "",
    questionsFi ? "Olisiko mahdollista tulla katsomaan asuntoa? Haluaisin myös kysyä:" : "Olisiko mahdollista tulla katsomaan asuntoa? Haluaisin myös kysyä (englanniksi):",
    list(questionsFi ?? questions),
    "",
    "Kiitos, odotan vastaustanne.",
    "",
    `Ystävällisin terveisin${sign ? `\n${sign}` : ""}`,
  ].join("\n");

  const subject = `Viewing request / Asunnon esittely: ${addr}`;
  const mailto = to ? `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${bodyFi}\n\n---\n\n${bodyEn}`)}` : undefined;
  return {
    ...(to ? { to } : {}),
    ...(formUrl ? { formUrl } : !to && listing.url ? { formUrl: listing.url } : {}),
    subject,
    bodyEn,
    bodyFi,
    questions,
    ...(questionsFi ? { questionsFi } : {}),
    ...(contact?.name ? { contactName: contact.name } : {}),
    ...(contact?.phone ? { phone: contact.phone } : {}),
    ...(mailto ? { mailto } : {}),
  };
}
