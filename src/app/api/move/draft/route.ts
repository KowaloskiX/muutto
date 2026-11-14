import { NextResponse } from "next/server";
import { buildViewingDraft, type Sender } from "@/lib/move/draft";
import type { Listing, ListingResearch, MoveIntent } from "@/lib/move/types";

export const dynamic = "force-dynamic";

// POST { listing, intent?, research?, sender?: {name, phone, email, moveDate} } -> ViewingDraft.
// Nothing is sent: the UI opens `mailto` / `formUrl` after the user approves the text.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { listing?: Listing; intent?: MoveIntent; research?: ListingResearch; sender?: Sender } | null;
  if (!body?.listing?.url) return NextResponse.json({ error: "listing.url required" }, { status: 400 });
  try {
    return NextResponse.json(await buildViewingDraft(body.listing, body.intent, body.research, body.sender ?? {}));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
