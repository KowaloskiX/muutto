import { NextResponse } from "next/server";

// Receives monitor.run.completed events. Kept in memory for the demo dashboard.
const events: unknown[] = [];

export async function POST(req: Request) {
  events.unshift({ at: new Date().toISOString(), body: await req.json().catch(() => null) });
  events.length = Math.min(events.length, 50);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ events });
}
