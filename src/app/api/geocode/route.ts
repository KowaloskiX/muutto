import { NextResponse } from "next/server";
import { geocode, type GeoPoint } from "@/lib/geo";

// Geocode addresses / place names for the case-file map (OpenStreetMap Nominatim via
// src/lib/geo.ts: cached, serialised at ≤ 1 request/second). A full street address that
// Nominatim can't place falls back to "postcode city", then to the city alone.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 12;

async function one(q: string): Promise<(GeoPoint & { q: string; precision: "address" | "postcode" | "city" }) | null> {
  const text = q.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return null;
  const hit = await geocode(text);
  if (hit) return { ...hit, q, precision: "address" };
  const pc = /\b(\d{5})\s+([\p{L}][\p{L}-]+)/u.exec(text);
  if (pc) {
    const p = await geocode(`${pc[1]} ${pc[2]}`);
    if (p) return { ...p, q, precision: "postcode" };
  }
  const city = pc?.[2] ?? /([\p{L}][\p{L}-]+)\s*$/u.exec(text)?.[1];
  if (city && city.toLowerCase() !== text.toLowerCase()) {
    const c = await geocode(city);
    if (c) return { ...c, q, precision: "city" };
  }
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { queries?: unknown; q?: unknown };
  const list = (Array.isArray(body.queries) ? body.queries : typeof body.q === "string" ? [body.q] : []).filter((x): x is string => typeof x === "string" && !!x.trim());
  if (!list.length) return NextResponse.json({ error: "queries required" }, { status: 400 });
  // geo.ts serialises Nominatim calls, so running these "in parallel" still respects 1 req/s.
  const results = await Promise.all(list.slice(0, MAX).map((q) => one(q).catch(() => null)));
  return NextResponse.json({ results });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ error: "q required" }, { status: 400 });
  return NextResponse.json({ result: await one(q).catch(() => null) });
}
