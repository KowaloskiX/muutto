// GET /api/agent/ics?title=&start=&end=&location=&notes= -> text/calendar download.
// Stateless: the agent's calendar proposal carries this URL in payload.icsUrl.
import { buildIcs } from "@/lib/agent/ics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const title = (q.get("title") ?? "").slice(0, 200);
  const start = q.get("start") ?? "";
  if (!title || !start) return new Response("title and start required", { status: 400 });
  const ics = buildIcs({
    title,
    start,
    end: q.get("end") ?? undefined,
    location: q.get("location")?.slice(0, 300) || undefined,
    notes: q.get("notes")?.slice(0, 2000) || undefined,
  });
  if (!ics) return new Response("invalid start date", { status: 400 });
  const file = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "event";
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.ics"` },
  });
}
