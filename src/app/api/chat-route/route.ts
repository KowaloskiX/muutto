import { NextResponse } from "next/server";
import { z } from "zod";
import { askJson } from "@/lib/llm";
import { INTENTS, keywordIntent } from "@/components/chat/intent";

// Tiny intent router for the chat view: one user message -> which tool to run.
export const dynamic = "force-dynamic";

const Out = z.object({
  intent: z.enum(INTENTS),
  reply: z.string().describe("Only for smalltalk: one or two friendly sentences, steering back to home jobs. Empty otherwise."),
});

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; hasShortlist?: boolean; quotes?: number; hired?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const fallback = keywordIntent(text);
  try {
    const out = await withTimeout(
      askJson({
        system: [
          "You route messages in a chat with Kilpi, a personal assistant that hires home-service contractors in Finland.",
          "Intents: find_contractor (the user describes a job or asks for a company/tradesperson),",
          "check_quote (the user pasted or asks to check a contractor quote / tarjous),",
          "compare_quotes (asks which quote is better, or to compare the quotes they pasted),",
          "watch (asks to monitor / keep an eye on a company), smalltalk (anything else).",
          "For smalltalk, write as Kilpi in the first person: a short, warm, optimistic reply in the user's language. Otherwise reply is empty.",
        ].join(" "),
        user: `Context: shortlist=${!!body.hasShortlist}, quotes pasted=${body.quotes ?? 0}, hired=${body.hired ?? "none"}\nMessage: ${text.slice(0, 1500)}`,
        schema: Out,
      }),
      9000,
    );
    return NextResponse.json({ intent: out.intent, reply: out.reply || undefined, by: "llm" });
  } catch {
    return NextResponse.json({ intent: fallback, by: "keywords" });
  }
}
