import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCompany } from "@/lib/verify";

export const maxDuration = 120;

const Body = z.object({
  name: z.string().optional(),
  website: z.string().optional(),
  businessId: z.string().optional(),
  service: z.string().min(2),
  city: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!parsed.data.name && !parsed.data.website && !parsed.data.businessId) {
    return NextResponse.json({ error: "Give a company name, website or business ID" }, { status: 400 });
  }
  try {
    return NextResponse.json(await verifyCompany(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
