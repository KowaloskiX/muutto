import { NextResponse } from "next/server";
import { getIso } from "@/lib/move/reach-iso";

// GET /api/move/iso?lat=&lng=&step=1|5 — road-network car isochrones (see src/lib/move/reach-iso.ts).
// Usually already computed: /api/move warms them in the background as soon as the workplace is known.
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export type { IsoResponse } from "@/lib/move/reach-iso";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.8 || lat > 60.7 || lng < 24.2 || lng > 25.7)
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  try {
    return NextResponse.json(await getIso(lat, lng, u.searchParams.get("step") === "1" ? 1 : 5), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: `Road isochrones unavailable: ${(e as Error).message}` }, { status: 502 });
  }
}
