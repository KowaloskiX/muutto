import { NextResponse } from "next/server";
import { buildIcsMulti, googleCalendarUrl, type IcsEvent } from "@/lib/agent/ics";

// POST /api/move/calendar { events: IcsEvent[] } -> { ics, google: (url|null)[] }
// Local Europe/Helsinki times ("2026-11-15T12:00" or "2026-12-01"). Nothing is written to anyone's
// calendar by us: the user downloads the .ics or opens the prefilled Google Calendar event.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { events?: IcsEvent[] };
  const events = (b.events ?? [])
    .filter((e) => e?.title && e.start)
    .slice(0, 12)
    .map((e) => ({ ...e, title: e.title.slice(0, 200), location: e.location?.slice(0, 300), notes: e.notes?.slice(0, 3000) }));
  const ics = buildIcsMulti(events);
  if (!ics) return NextResponse.json({ error: "No valid event (check the dates)." }, { status: 400 });
  return NextResponse.json({ ics, google: events.map(googleCalendarUrl) });
}
