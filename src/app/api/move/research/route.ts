import { NextResponse } from "next/server";
import { researchListing } from "@/lib/move/research";
import type { Listing, MoveIntent, ResearchEvent } from "@/lib/move/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST { listing: Listing, intent?: MoveIntent } -> NDJSON stream of ResearchEvent
// (step / finding / error, then one `done` with the full ListingResearch). ≤ 60 s.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { listing?: Listing; intent?: MoveIntent } | null;
  const listing = body?.listing;
  if (!listing?.url || !/^https?:\/\//.test(listing.url)) return NextResponse.json({ error: "listing.url required" }, { status: 400 });
  const clean: Listing = { ...listing, title: listing.title ?? listing.url, source: listing.source ?? new URL(listing.url).hostname };

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: ResearchEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false; // client went away
        }
      };
      try {
        const research = await researchListing(clean, body?.intent, send);
        send({ type: "done", research });
      } catch (e) {
        send({ type: "error", message: (e as Error).message ?? String(e) });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
