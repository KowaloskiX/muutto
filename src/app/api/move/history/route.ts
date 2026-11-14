import { NextResponse } from "next/server";
import { listingHistory } from "@/lib/move/history";
import type { Listing, ListingHistory } from "@/lib/move/types";
import type { ExaTrace } from "@/lib/exa";

// POST /api/move/history { listings: [{ url, address, sizeM2 }] } -> { [url]: ListingHistory | null }
// Earlier appearances of each flat on the portals (Exa), at most 30 listings, 6 at a time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { listings?: Pick<Listing, "url" | "address" | "sizeM2">[] };
  const list = (body.listings ?? []).filter((l) => l?.url).slice(0, 30);
  const trace: ExaTrace[] = [];
  const out: Record<string, ListingHistory | null> = {};
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, list.length) }, async () => {
      while (i < list.length) {
        const l = list[i++];
        out[l.url] = await listingHistory(l, trace).catch(() => null);
      }
    }),
  );
  return NextResponse.json(out);
}
