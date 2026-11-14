import { NextResponse } from "next/server";
import { areaServices } from "@/lib/move/services";

// GET /api/move/services?areaId=&lat=&lng=&municipality= → AreaServices (settling-in contacts).
// Static-ish register data: cached in memory 24 h per point (see src/lib/move/services.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  const municipality = (u.searchParams.get("municipality") ?? "").trim();
  const areaId = (u.searchParams.get("areaId") ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 59.5 || lat > 61 || lng < 23.5 || lng > 26.5) {
    return NextResponse.json({ error: "lat/lng must be a point in the Helsinki region" }, { status: 400 });
  }
  if (!municipality) return NextResponse.json({ error: "municipality is required" }, { status: 400 });
  try {
    const { data, cached } = await areaServices(areaId || municipality, { lat, lng }, municipality);
    return NextResponse.json({ ...data, cached });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
