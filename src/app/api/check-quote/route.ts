import { NextResponse } from "next/server";
import { z } from "zod";
import { checkQuote } from "@/lib/quote";

export const maxDuration = 120;

const Body = z.object({
  text: z.string().min(20, "Paste the quote text").max(20000),
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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
