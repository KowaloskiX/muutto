import { connectVerify } from "@/lib/exa-connect";
import type { ExaTrace } from "@/lib/exa";

export const maxDuration = 150;

// POST {name, businessId?, website?} -> ConnectCheck (Exa Agent + Exa Connect partner data)
export async function POST(req: Request) {
  try {
    const { name, businessId, website } = (await req.json()) as { name?: string; businessId?: string; website?: string };
    if (!name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
    const trace: ExaTrace[] = [];
    const check = await connectVerify(name.trim().slice(0, 200), businessId?.trim() || undefined, website?.trim() || undefined, trace);
    return Response.json({ ...check, trace });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
