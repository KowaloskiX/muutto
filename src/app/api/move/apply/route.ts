import { landlordIntel } from "@/lib/move/landlord";
import { buildApplication } from "@/lib/move/application";
import type { Application, Listing, MoveIntent, TenantProfile } from "@/lib/move/types";
import type { ExaTrace } from "@/lib/exa";

// POST /api/move/apply { listings, intent, profile } -> NDJSON: one { type: "application", application }
// per listing as it is ready (landlord research with Exa + tailored message), then { type: "done" }.
// Nothing is sent here: the user approves each message; sending goes through /api/move/send (test mode).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { listings?: Listing[]; intent?: MoveIntent; profile?: TenantProfile };
  const list = (b.listings ?? []).filter((l) => l?.url).slice(0, 5);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const out = (e: unknown) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const trace: ExaTrace[] = [];
      await Promise.all(
        list.map(async (l) => {
          try {
            const intel = await landlordIntel(l, trace).catch(() => undefined);
            const application: Application = await buildApplication(l, b.intent, b.profile ?? {}, intel);
            out({ type: "application", application });
          } catch (e) {
            out({ type: "error", listingUrl: l.url, message: (e as Error).message });
          }
        }),
      );
      out({ type: "done" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
