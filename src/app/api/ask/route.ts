import { NextResponse } from "next/server";
import { groundedAnswer } from "@/lib/ask";

// POST {question, query?, lang?, finland?} -> {answer, sources[], grounded}
// Exa search + an answer that only states what the retrieved passages say, cited inline as [n].
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; query?: string; lang?: string; finland?: boolean };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
  const lang = typeof body.lang === "string" && /^[a-z]{2,3}$/i.test(body.lang) ? body.lang.toLowerCase() : "en";
  try {
    const r = await groundedAnswer(question, { query: typeof body.query === "string" ? body.query : undefined, lang, finland: body.finland !== false });
    return NextResponse.json({ answer: r.answer, sources: r.sources, grounded: r.grounded, query: r.query, trace: r.trace });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
