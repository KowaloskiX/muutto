import { NextResponse } from "next/server";
import { listingHistory } from "@/lib/move/history";
import type { Listing, ListingHistory } from "@/lib/move/types";
import type { ExaTrace } from "@/lib/exa";

// POST /api/move/history { listings: [{ url, address, sizeM2 }] } -> { [url]: ListingHistory | null }
// Earlier appearances of each flat on the portals (Exa), at most 30 listings, 6 at a time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same listing within 30 min: reuse the earlier answer.
const memo = new Map<string, { at: number; v: ListingHistory | null }>();
const MEMO_MS = 30 * 60_000;

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
        const hit = memo.get(l.url);
        if (hit && Date.now() - hit.at < MEMO_MS) {
          out[l.url] = hit.v;
          continue;
        }
        out[l.url] = await listingHistory(l, trace).catch(() => null);
        memo.set(l.url, { at: Date.now(), v: out[l.url] });
      }
    }),
  );
  return NextResponse.json(out);
}
