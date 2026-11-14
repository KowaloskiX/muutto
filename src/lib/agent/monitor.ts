// Approved "watch" actions become Exa Monitors: a saved search re-run daily;
// new results are delivered to our webhook (or polled locally).
import { call, triggerMonitor, type ExaTrace } from "@/lib/exa";
import { rememberMonitor } from "@/lib/exa-monitor";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Exa refuses webhook URLs on localhost / private ranges (same logic as /api/watch).
export function webhookUrl(reqUrl: string): { url: string; live: boolean } {
  const origin = process.env.PUBLIC_BASE_URL ?? new URL(reqUrl).origin;
  const host = new URL(origin).hostname;
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || host.endsWith(".local");
  if (local || !origin.startsWith("https://")) return { url: "https://httpbin.org/status/204", live: false };
  return { url: `${origin.replace(/\/$/, "")}/api/exa-webhook`, live: true };
}

export async function createWatch(p: { query: string; why?: string; includeDomains?: string[] }, reqUrl: string, trace?: ExaTrace[]) {
  const hook = webhookUrl(reqUrl);
  const domains = (p.includeDomains ?? []).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).slice(0, 5);
  const m = await call(
    "POST",
    "/monitors",
    {
      name: `Errand watch: ${p.query.slice(0, 80)}`,
      search: { query: p.query.slice(0, 300), numResults: 10, contents: { highlights: true }, ...(domains.length ? { includeDomains: domains } : {}) },
      trigger: { type: "interval", period: "1d" },
      metadata: { kind: "errand-watch", why: (p.why ?? "").slice(0, 200) },
      webhook: { url: hook.url },
    },
    trace,
    `monitor: ${p.query.slice(0, 60)}`,
  );
  // webhookSecret is returned once: kept server-side only.
  rememberMonitor(m, p.query.slice(0, 80));
  await triggerMonitor(m.id).catch(() => null);
  return { monitorId: m.id as string, status: m.status as string, webhook: hook.live ? "live" : "polling" };
}

/** Latest runs of a watch, flattened to result items (url, title, date, highlight). */
export async function watchRuns(id: string) {
  const runs = await call("GET", `/monitors/${encodeURIComponent(id)}/runs`);
  const data: any[] = runs?.data ?? [];
  return data.slice(0, 5).map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    items: (r.output?.results ?? r.results ?? []).slice(0, 10).map((x: any) => ({ url: x.url, title: x.title, date: x.publishedDate?.slice(0, 10), highlight: x.highlights?.[0] })),
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
