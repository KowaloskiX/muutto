import { NextResponse } from "next/server";
import { areaFuture, areaVoices } from "@/lib/move/outlook";
import type { ExaTrace } from "@/lib/exa";

// POST /api/move/outlook { name, municipality } -> { future, voices }: what is coming to the area and what
// residents say (Exa). Loaded when an area drawer opens, off the search's critical path; 30 min memo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memo = new Map<string, { at: number; v: { future: unknown[]; voices: unknown[] } }>();
const inflight = new Map<string, Promise<{ future: unknown[]; voices: unknown[] }>>();

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; municipality?: string };
  if (!b.name || !b.municipality) return NextResponse.json({ error: "name and municipality required" }, { status: 400 });
  const key = `${b.name}|${b.municipality}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return NextResponse.json(hit.v);
  let p = inflight.get(key);
  if (!p) {
    const trace: ExaTrace[] = [];
    const area = { name: b.name, municipality: b.municipality };
    p = Promise.all([areaFuture(area, trace).catch(() => []), areaVoices(area, trace).catch(() => [])]).then(([future, voices]) => ({ future, voices }));
    inflight.set(key, p);
  }
  try {
    const v = await p;
    memo.set(key, { at: Date.now(), v });
    return NextResponse.json(v);
  } finally {
    inflight.delete(key);
  }
}
