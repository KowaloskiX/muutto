import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson } from "@/lib/claude";

const Body = z.object({
  job: z.string(),
  companies: z.array(
    z.object({
      name: z.string(),
      email: z.string().optional(),
      concerns: z.array(z.string()).default([]),
    }),
  ),
  sender: z.object({ name: z.string().default(""), phone: z.string().default(""), address: z.string().default("") }).default({ name: "", phone: "", address: "" }),
});

const Draft = z.object({
  subject: z.string(),
  bodyFi: z.string().describe("Polite quote request in Finnish"),
  bodyEn: z.string().describe("Same request in English"),
});

export type DraftOut = { name: string; email?: string; subject: string; bodyFi: string; bodyEn: string };

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
  const { job, companies, sender } = parsed.data;
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
