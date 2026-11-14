import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson } from "@/lib/llm";

// POST /api/move/reply { text, address?, today? } -> the viewing time the landlord's reply proposes or
// confirms, with the exact sentence it came from. One small LLM call; the quote must appear in the
// pasted text, otherwise nothing is returned. No reply, no event.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Out = z.object({
  found: z.boolean().describe("true only if the reply proposes or confirms a specific viewing date AND time"),
  status: z.enum(["confirmed", "proposed", "none"]).describe("confirmed = they confirm a time; proposed = they offer a time to accept"),
  start: z.string().describe("Local Helsinki start as YYYY-MM-DDTHH:mm, empty if not found"),
  end: z.string().describe("Local end as YYYY-MM-DDTHH:mm if stated, else empty"),
  place: z.string().describe("Meeting place/address if the reply states one (e.g. 'at the front door, Museokatu 11 C'), else empty"),
  contact: z.string().describe("Name and/or phone of the person meeting you if stated, else empty"),
  quote: z.string().describe("The exact sentence from the reply that states the time, copied character for character"),
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string; address?: string; today?: string };
  const text = String(b.text ?? "").trim().slice(0, 6000);
  if (text.length < 15) return NextResponse.json({ error: "Paste the landlord's reply." }, { status: 400 });
  const today = b.today || new Date().toISOString().slice(0, 10);
  try {
    const r = await askJson({
      system: `You read a landlord's or agent's reply to a viewing request (Finnish or English). Today is ${today} (resolve weekdays and "tomorrow" relative to it, Europe/Helsinki). Extract the viewing time only if the reply states a specific date and time. Never invent one.`,
      user: `Flat: ${b.address ?? "unknown"}\n\nReply:\n${text}`,
      schema: Out,
    });
    const quoteOk = !!r.quote && norm(text).includes(norm(r.quote));
    if (!r.found || r.status === "none" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.start) || !quoteOk) {
      return NextResponse.json({ found: false, reason: r.found && !quoteOk ? "The time could not be matched to a sentence in the reply." : "The reply does not state a specific viewing time." });
    }
    return NextResponse.json({ found: true, status: r.status, start: r.start, end: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.end) ? r.end : undefined, place: r.place || undefined, contact: r.contact || undefined, quote: r.quote });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
