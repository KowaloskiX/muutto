import { NextResponse } from "next/server";
import { z } from "zod";
import { compareQuotes } from "@/lib/compare";
import { QuoteInputError } from "@/lib/quote";

export const maxDuration = 180;

const Body = z.object({
  quotes: z
    .array(
      z.object({
        company: z.string().trim().min(1, "Every quote needs a company name").max(200),
        website: z.string().max(300).optional(),
        text: z.string().trim().min(40, "Each quote must be the full offer text (40+ characters)").max(20000, "A quote is too long (max 20 000 characters)"),
      }),
    )
    .min(1, "Paste at least one quote")
    .max(4, "Compare at most 4 quotes at a time"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const which = typeof issue?.path[1] === "number" ? `Quote ${issue.path[1] + 1}: ` : "";
    return NextResponse.json({ error: issue ? `${which}${issue.message}` : "Paste at least one quote" }, { status: 400 });
  }
  try {
    return NextResponse.json(await compareQuotes(parsed.data.quotes));
  } catch (e) {
    if (e instanceof QuoteInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("compare-quotes failed", e);
    return NextResponse.json({ error: "Comparing the quotes failed. Try again in a moment." }, { status: 500 });
  }
}
