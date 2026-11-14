import { NextResponse } from "next/server";
import { call, createCompanyMonitor, monitorRuns, triggerMonitor } from "@/lib/exa";
import {
  emulatedBacktest,
  forgetMonitor,
  getAgentBacktest,
  rememberMonitor,
  startAgentBacktest,
  store,
  summarizeRuns,
} from "@/lib/exa-monitor";

export const dynamic = "force-dynamic";

const err = (e: unknown, status = 500) => NextResponse.json({ error: (e as Error).message ?? String(e) }, { status });

// Exa refuses webhook URLs on localhost / private ranges. Locally we fall back to
// polling (GET ?id=) and give Exa a no-op sink URL (Exa rejects example.com and private hosts); set PUBLIC_BASE_URL (e.g. a tunnel) for live webhooks.
function webhookUrl(req: Request): { url: string; live: boolean } {
  const origin = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const host = new URL(origin).hostname;
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || host.endsWith(".local");
  if (local || !origin.startsWith("https://")) return { url: "https://httpbin.org/status/204", live: false };
  return { url: `${origin.replace(/\/$/, "")}/api/exa-webhook`, live: true };
}

// POST {name, domain} -> creates a daily Exa Monitor for news/complaints about the company.
export async function POST(req: Request) {
  const { name, domain } = (await req.json().catch(() => ({}))) as { name?: string; domain?: string };
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const hook = webhookUrl(req);
  try {
    const m = await createCompanyMonitor(name, domain, hook.url);
    // webhookSecret is returned exactly once: keep it server-side (memory), never echo or log it.
    rememberMonitor(m, name, domain);
    await triggerMonitor(m.id).catch(() => null);
    return NextResponse.json({ id: m.id, status: m.status, name: m.name, webhook: hook.live ? "live" : "polling" });
  } catch (e) {
    return err(e);
  }
}

// GET ?id=                         -> latest runs, summarised (runs / sent / dropped + items)
// GET ?backtest=1&name=&domain=&days=30[&agent=1]
//                                  -> what the watcher would have caught over the last N days
// GET ?backtestId=agentbacktest_…  -> poll an Agent Monitors (beta) backtest
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    if (q.get("backtestId")) return NextResponse.json(await getAgentBacktest(q.get("backtestId")!));

    if (q.get("backtest")) {
      const name = q.get("name")?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const domain = q.get("domain")?.trim() || undefined;
      const days = Math.min(365, Math.max(1, Number(q.get("days")) || 30));
      const [emu, agent] = await Promise.all([
        emulatedBacktest(name, domain, days),
        q.get("agent") ? startAgentBacktest(name, domain).catch((e: Error) => ({ error: e.message })) : null,
      ]);
      return NextResponse.json({ ...emu, agentBacktest: agent });
    }

    const id = q.get("id");
    if (!id) return NextResponse.json({ error: "id or backtest required" }, { status: 400 });
    const meta = store.watched.get(id);
    const name = q.get("name") ?? meta?.name ?? "";
    const domain = q.get("domain") ?? meta?.domain;
    const runs = await monitorRuns(id);
    const webhooks = store.events.filter((e) => e.monitorId === id).length;
    return NextResponse.json({ id, ...summarizeRuns(runs, name, domain), webhooks });
  } catch (e) {
    return err(e);
  }
}

// DELETE ?id= -> stop watching (deletes the Exa monitor and forgets its secret).
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z0-9]+$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await call("DELETE", `/monitors/${id}`);
    forgetMonitor(id);
    return NextResponse.json({ id, deleted: true });
  } catch (e) {
    return err(e);
  }
}
