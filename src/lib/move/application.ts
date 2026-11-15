// A rental application message tailored to one listing and its landlord: Finnish and English, from
// the listing, the user's request, their profile and the landlord's cited requirements. The model
// writes the prose but may only use those facts; whatever a requirement needs and the profile lacks
// is listed as missing instead of being made up.
import { z } from "zod";
import { askJson } from "@/lib/llm";
import type { Application, LandlordIntel, Listing, MoveIntent, TenantProfile } from "./types";

const Out = z.object({
  subject: z.string(),
  bodyFi: z.string(),
  bodyEn: z.string(),
  addressed: z.array(z.string()).describe("Which landlord requirements the message answers, short English"),
  missing: z.array(z.string()).describe("Facts a requirement asks for that the profile does not give, short English (e.g. 'monthly income')"),
});

export async function buildApplication(l: Listing, intent: MoveIntent | undefined, profile: TenantProfile, intel?: LandlordIntel): Promise<Application> {
  const facts = {
    listing: { address: l.address, title: l.title, rent: l.price, sizeM2: l.sizeM2, rooms: l.rooms, url: l.url, contactName: l.contact?.name, company: l.contact?.company },
    request: { workplace: intent?.work?.label || intent?.workAddress, summary: intent?.summary, household: intent?.household },
    profile,
    landlord: intel ? { name: intel.name, requirements: intel.requirements.map((r) => r.what), apply: intel.apply?.how } : undefined,
  };
  const r = await askJson({
    system:
      "Write a short, warm, professional rental application email from a tenant to a Finnish landlord or agent, in Finnish (bodyFi) and English (bodyEn). " +
      "Use ONLY the facts given (listing, request, profile, landlord requirements). Answer the landlord's requirements where the profile covers them " +
      "(e.g. clean credit record, no pets, permanent job and start date). Never invent income, credit status, references, consents or authorisations, or dates; if a requirement needs a fact the profile lacks, " +
      "leave it out of the email and list it in `missing`. Ask for a viewing. Sign with the profile name if given, else '[your name]'. Under 170 words each.",
    user: JSON.stringify(facts),
    schema: Out,
  });
  return { listingUrl: l.url, intel, to: l.contact?.email, formUrl: l.contact?.formUrl, subject: r.subject, bodyFi: r.bodyFi, bodyEn: r.bodyEn, addressed: r.addressed, missing: r.missing };
}
