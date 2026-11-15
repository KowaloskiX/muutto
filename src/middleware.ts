import { NextResponse, type NextRequest } from "next/server";

// Public deployment guard (PUBLIC=1): a per-IP limit on the routes that call paid APIs (Exa, OpenAI).
// In-memory per server instance, so it is a speed bump, not a hard quota; the LLM daily token cap in
// src/lib/llm.ts is the spend backstop.
const COSTLY = /^\/api\/move(\/(apply|criterion|research|draft|followup|history|outlook|services|watch|reply|send))?$/;
const PER_MIN = Number(process.env.RATE_PER_MIN ?? 12);
const hits = new Map<string, number[]>();

export function middleware(req: NextRequest) {
  if (process.env.PUBLIC !== "1" || req.method !== "POST" || !COSTLY.test(req.nextUrl.pathname)) return NextResponse.next();
  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "?").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MIN) return NextResponse.json({ error: "Too many requests from your address. Please wait a minute." }, { status: 429 });
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return NextResponse.next();
}

export const config = { matcher: "/api/move/:path*" };
