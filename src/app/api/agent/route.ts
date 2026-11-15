// Errand agent API.
//
// POST /api/agent {messages:[{role:"user"|"assistant", content}], state?}
//   -> NDJSON stream (one JSON object per line):
//   {type:"plan", steps:string[]}
//   {type:"step", id, status:"running"|"done"|"error", label, tool, detail?}
//   {type:"evidence", items:[{id:"e3", url, title, quote, via:"exa.search"|"exa.contents"|"exa.places"|"exa.agent", date?}]}
//   {type:"action", action:{id, kind, title, payload, requiresApproval:true}}
//       kind email|letter|call_script: payload {format, to, subject, body, language, basedOn[], mailto?, tel?, warnings?}
//       kind calendar:                 payload {title, start, end?, location?, notes, timezone, allDay, icsUrl, basedOn[]}
//       kind booking_link|form_link:   payload {url, label, instructions, basedOn[]}   (url always from Exa evidence)
//       kind watch:                    payload {query, why, includeDomains[], cadence, engine:"exa.monitors", basedOn[]}
//   {type:"handoff", to:"contractors", query}   -> UI runs /api/find with `query`
//   {type:"message", kind:"answer"|"clarify", text (with [n] markers), sources:[{n, id, url, title, quote?, via}]}
//   {type:"done", state, stats:{rounds, ms, exaCalls}}  -> send `state` back with the next turn
//   {type:"error", message}
//
// POST /api/agent {approve:{kind:"watch", payload:{query, why, includeDomains}}}
//   -> JSON {monitorId, status, webhook:"live"|"polling"}  (creates the Exa Monitor)
// GET  /api/agent?monitorId=  -> JSON {runs:[{id,status,createdAt,items:[{url,title,date,highlight}]}]}
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/loop";
import { createWatch, watchRuns } from "@/lib/agent/monitor";
import { emptyState, type AgentEvent, type AgentState, type ChatMessage } from "@/lib/agent/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sanitizeState(s: unknown): AgentState {
  const st = (s ?? {}) as Partial<AgentState>;
  const base = emptyState();
  return {
    evidence: Array.isArray(st.evidence) ? st.evidence.slice(-30) : base.evidence,
    actions: Array.isArray(st.actions) ? st.actions.slice(-20) : base.actions,
    turns: typeof st.turns === "number" ? st.turns : 0,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; state?: unknown; approve?: { kind?: string; payload?: Record<string, unknown> } } | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  if (body.approve) {
    const { kind, payload } = body.approve;
    if (kind !== "watch" || typeof payload?.query !== "string" || !payload.query.trim())
      return NextResponse.json({ error: "only kind 'watch' is executed server-side; other actions are completed by the user (mailto, .ics, links)" }, { status: 400 });
    try {
      const out = await createWatch(
        { query: payload.query, why: typeof payload.why === "string" ? payload.why : undefined, includeDomains: Array.isArray(payload.includeDomains) ? (payload.includeDomains as string[]) : [] },
        req.url,
      );
      return NextResponse.json(out);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages[messages.length - 1]?.role !== "user" || !String(messages[messages.length - 1]?.content ?? "").trim())
    return NextResponse.json({ error: "messages must end with a non-empty user message" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await runAgent({ messages, state: sanitizeState(body.state), emit, signal: req.signal });
      } catch (e) {
        emit({ type: "error", message: (e as Error).message ?? String(e) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("monitorId");
  if (!id || !/^[a-z0-9_-]+$/i.test(id)) return NextResponse.json({ error: "monitorId required" }, { status: 400 });
  try {
    return NextResponse.json({ monitorId: id, runs: await watchRuns(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
