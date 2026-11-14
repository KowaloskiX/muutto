import { NextResponse } from "next/server";
import { z } from "zod";
import { checkQuote, QuoteInputError } from "@/lib/quote";

export const maxDuration = 120;

const Body = z.object({
  text: z.string().trim().min(1, "Paste the quote text first").min(40, "That is too short to be a quote. Paste the whole offer text (tarjous).").max(20000, "That is too long: paste just the quote (max 20 000 characters)"),
  website: z.string().max(300).optional(),
  businessId: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { text, website, businessId } = parsed.data;
  try {
    return NextResponse.json(await checkQuote({ text, website: website?.trim() || undefined, businessId: businessId?.trim() || undefined }));
  } catch (e) {
    if (e instanceof QuoteInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("check-quote failed", e);
    return NextResponse.json({ error: "Checking the quote failed. Try again in a moment." }, { status: 500 });
  }
}
