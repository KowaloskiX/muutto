import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson } from "@/lib/llm";

// POST /api/move/followup { previous, message } -> what a chat message after a search means:
//   refine:    change the search (budget, rooms, rent/buy, commute, priorities) -> `query` = the full new request
//   criterion: ask about something per area ("is there a sauna", "near the sea") -> `criterion`
//   new:       a different move altogether (another workplace) -> search the message as is
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Out = z.object({
  action: z.enum(["refine", "criterion", "new"]),
  query: z.string().describe("For refine: the previous request rewritten with the change applied, as one complete request in the user's words. Else empty."),
  criterion: z.string().describe("For criterion: the thing to check per area, short (e.g. 'public sauna', 'near the sea', 'safe to walk at night'). Else empty."),
  reply: z.string().describe("One short sentence telling the user what you will do, in the language of the message."),
});

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { previous?: string; message?: string };
  const previous = String(b.previous ?? "").slice(0, 1500);
  const message = String(b.message ?? "").trim().slice(0, 800);
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  try {
    const r = await askJson({
      system:
        "You route a follow-up message in a relocation assistant. The user already searched for where to live near their workplace. " +
        "refine = they change the search itself (budget, rooms, size, rent vs buy, commute limit, family, priorities, other areas). " +
        "criterion = they want something checked for every area without changing the search (a kind of place nearby, or a property of the area). " +
        "new = a different move (another workplace or city) or unrelated to the previous search.",
      user: `Previous request: ${previous || "(none)"}\n\nFollow-up: ${message}`,
      schema: Out,
      effort: "low",
    });
    if (r.action === "refine" && !r.query.trim()) return NextResponse.json({ action: "new", reply: r.reply });
    if (r.action === "criterion" && !r.criterion.trim()) return NextResponse.json({ action: "refine", query: `${previous} ${message}`.trim(), reply: r.reply });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
