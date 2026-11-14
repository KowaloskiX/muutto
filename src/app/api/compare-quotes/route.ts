import { NextResponse } from "next/server";
import { z } from "zod";
import { compareQuotes } from "@/lib/compare";

export const maxDuration = 180;

const Body = z.object({
  quotes: z
    .array(z.object({ company: z.string().min(1).max(200), website: z.string().max(300).optional(), text: z.string().min(20).max(20000) }))
    .min(1)
    .max(4),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Paste at least one quote (20+ characters)" }, { status: 400 });
  try {
    return NextResponse.json(await compareQuotes(parsed.data.quotes));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
