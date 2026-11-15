import { NextResponse } from "next/server";
import { askCriterion, type AskArea } from "@/lib/move/ask";
import type { ExaTrace } from "@/lib/exa";

// POST /api/move/criterion { question, areas: [{ id, name, municipality, center }] } -> AskResult.
// Measures any user-typed criterion in every area (Exa Places or Exa search + cited judgement).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; areas?: AskArea[] };
  const question = String(body.question ?? "").trim().slice(0, 200);
  const areas = (body.areas ?? []).filter((a) => a?.id && a.name && a.center && Number.isFinite(a.center.lat) && Number.isFinite(a.center.lng)).slice(0, 12);
  if (question.length < 3) return NextResponse.json({ error: "Type what matters, e.g. “climbing wall” or “near the sea”." }, { status: 400 });
  if (!areas.length) return NextResponse.json({ error: "Run a search first; there are no areas to measure." }, { status: 400 });
  const trace: ExaTrace[] = [];
  try {
    return NextResponse.json(await askCriterion(question, areas, trace));
  } catch (e) {
    return NextResponse.json({ error: `Could not measure “${question}”: ${(e as Error).message}` }, { status: 502 });
  }
}
