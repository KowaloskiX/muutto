import { NextResponse } from "next/server";
import { createListingMonitor, deleteListingMonitor, listingRuns } from "@/lib/move/watch";
import type { MoveIntent } from "@/lib/move/types";

export const dynamic = "force-dynamic";

const err = (e: unknown, status = 500) => NextResponse.json({ error: (e as Error).message ?? String(e) }, { status });

// Same rule as /api/watch: Exa refuses localhost/private webhook URLs, so locally we poll
// and hand Exa a no-op sink; PUBLIC_BASE_URL (https) switches to signed live webhooks.
function webhookUrl(req: Request): { url: string; live: boolean } {
  const origin = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const host = new URL(origin).hostname;
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || host.endsWith(".local");
  if (local || !origin.startsWith("https://")) return { url: "https://httpbin.org/status/204", live: false };
  return { url: `${origin.replace(/\/$/, "")}/api/exa-webhook`, live: true };
}

// POST { intent, areas: string[] } -> WatchResult (daily Exa Monitor for new listings)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { intent?: MoveIntent; areas?: string[] } | null;
  const areas = (body?.areas ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 6);
  if (!areas.length) return NextResponse.json({ error: "areas required" }, { status: 400 });
  const intent: MoveIntent = body?.intent ?? { workAddress: "", tenure: "rent", priorities: [], summary: "" };
  try {
    return NextResponse.json(await createListingMonitor(intent, areas, webhookUrl(req)));
  } catch (e) {
    return err(e);
  }
}

// GET ?id= -> WatchRuns (latest runs summarised to new listing pages)
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    return NextResponse.json(await listingRuns(id));
  } catch (e) {
    return err(e);
  }
}

// DELETE ?id= -> removes the monitor and forgets its secret
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteListingMonitor(id);
    return NextResponse.json({ id, deleted: true });
  } catch (e) {
    return err(e);
  }
}
