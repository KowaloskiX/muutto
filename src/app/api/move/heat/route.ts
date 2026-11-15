import { NextResponse } from "next/server";
import { getHeat, type HeatScale } from "@/lib/move/reach-heat";

// GET /api/move/heat?lat=&lng=[&scale=region] — car travel time to the workplace on a regular grid
// (see src/lib/move/reach-heat.ts). Usually already computed: /api/move warms it in the background.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export type { HeatGrid, HeatResponse, HeatScale } from "@/lib/move/reach-heat";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.8 || lat > 60.7 || lng < 24.2 || lng > 25.7)
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  const scale: HeatScale = u.searchParams.get("scale") === "region" ? "region" : "city";
  try {
    return NextResponse.json(await getHeat(lat, lng, scale), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: `Drive-time grid unavailable: ${(e as Error).message}` }, { status: 502 });
  }
}
