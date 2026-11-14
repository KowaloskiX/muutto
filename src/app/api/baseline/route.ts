import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson, MODEL } from "@/lib/llm";

// The same request answered by the same model with NO web access: the honest
// "without Exa" baseline shown next to the Exa-backed result.
const Out = z.object({ answer: z.string() });

export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
  try {
    const out = await askJson({
      system:
        "You are a helpful assistant with no internet access and no tools. Answer the user's request as well as you can from your own knowledge, in at most 80 words. If you would recommend specific companies, only name ones you actually know.",
      user: query.slice(0, 1500),
      schema: Out,
    });
    return NextResponse.json({ answer: out.answer, model: MODEL });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
