import { NextResponse } from "next/server";
import { signatureHeader, store, verifyExaSignature } from "@/lib/exa-monitor";

export const dynamic = "force-dynamic";

// Receives Exa Monitor events (monitor.created, monitor.run.created, monitor.run.completed, ...).
// Each delivery carries `Exa-Signature: t=<unix>,v1=<hex HMAC-SHA256(webhookSecret, `${t}.${rawBody}`)>`
// (scheme verified against live Exa deliveries). Unsigned / badly signed / stale requests get 401.
export async function POST(req: Request) {
  const raw = await req.text(); // verify over the exact raw bytes, before JSON parsing
  let body: { type?: string; data?: { id?: string; monitorId?: string } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const monitorId = body?.data?.monitorId ?? body?.data?.id;
  const v = verifyExaSignature(raw, signatureHeader(req.headers), monitorId);
  if (!v.ok) return NextResponse.json({ error: "invalid signature", reason: v.reason }, { status: 401 });
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  store.events.unshift({ at: new Date().toISOString(), type: body.type, monitorId, verified: true, body });
  store.events.length = Math.min(store.events.length, 50);
  return NextResponse.json({ ok: true });
}

// GET [?monitorId=] -> recent verified events for the demo dashboard.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("monitorId");
  return NextResponse.json({ events: id ? store.events.filter((e) => e.monitorId === id) : store.events });
}
