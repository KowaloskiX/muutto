import { geocode } from "@/lib/geo";

// POST /api/move/locate { listings: [{ url, address, municipality, center }] } -> NDJSON lines
// { url, lat, lng } as each listing is geocoded (Nominatim, 1 req/s, cached). Results must fall near
// their area's centre, otherwise the listing is skipped rather than pinned in the wrong place.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type In = { url: string; address?: string; municipality?: string; center?: { lat: number; lng: number } };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { listings?: In[] };
  const list = (b.listings ?? []).filter((l) => l?.url && l.address && /\d/.test(l.address)).slice(0, 60);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const l of list) {
        const q = /\b\d{5}\b/.test(l.address!) ? l.address! : `${l.address}, ${l.municipality ?? ""}`;
        const g = await geocode(q).catch(() => null);
        const near = g && (!l.center || (Math.abs(g.lat - l.center.lat) < 0.05 && Math.abs(g.lng - l.center.lng) < 0.1));
        if (g && near) controller.enqueue(enc.encode(JSON.stringify({ url: l.url, lat: g.lat, lng: g.lng }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
