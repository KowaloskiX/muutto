// Server-only helpers for the "Watch" feature: webhook-secret storage, Exa
// webhook signature verification, run summarising and the 30-day backtest.
import { createHmac, timingSafeEqual } from "node:crypto";
import { search, type ExaResult } from "@/lib/exa";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- In-memory store (shared across route modules + survives dev HMR) -------
type Watched = { id: string; name: string; domain?: string; createdAt: string };
type WebhookEvent = { at: string; type?: string; monitorId?: string; verified: boolean; body: unknown };
type Store = { secrets: Map<string, string>; watched: Map<string, Watched>; events: WebhookEvent[] };

const g = globalThis as unknown as { __exaMonitorStore?: Store };
export const store: Store = (g.__exaMonitorStore ??= { secrets: new Map(), watched: new Map(), events: [] });

/** Keep the one-time webhookSecret server-side. Never returned to clients, never logged. */
export function rememberMonitor(m: { id: string; webhookSecret?: string }, name: string, domain?: string) {
  if (m.webhookSecret) store.secrets.set(m.id, m.webhookSecret);
  store.watched.set(m.id, { id: m.id, name, domain, createdAt: new Date().toISOString() });
}

export function forgetMonitor(id: string) {
  store.secrets.delete(id);
  store.watched.delete(id);
}

/** Secrets to try for an incoming delivery. EXA_WEBHOOK_SECRETS (comma list) survives restarts. */
function candidateSecrets(monitorId?: string): string[] {
  const env = (process.env.EXA_WEBHOOK_SECRETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const own = monitorId ? store.secrets.get(monitorId) : undefined;
  return [...new Set([...(own ? [own] : []), ...store.secrets.values(), ...env])];
}

// ---- Signature verification ---------------------------------------------------
// Exa's spec only says the one-time `webhookSecret` "is used to verify webhook
// signatures"; the header format is not in the OpenAPI spec. We accept:
//   Exa-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>  (Stripe-style, used by Websets webhooks)
//   Exa-Signature: <hex|base64 HMAC-SHA256(secret, rawBody)>                          (fallback)
// Timestamps older than 5 minutes are rejected (replay guard).
const TOLERANCE_S = 300;

function safeEq(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function matches(secret: string, payload: string, sig: string): boolean {
  const mac = createHmac("sha256", secret).update(payload, "utf8").digest();
  const s = sig.trim().replace(/^sha256=/i, "");
  if (/^[0-9a-f]+$/i.test(s) && s.length === 64) return safeEq(mac, Buffer.from(s, "hex"));
  try {
    return safeEq(mac, Buffer.from(s, "base64"));
  } catch {
    return false;
  }
}

export function signatureHeader(h: Headers): string | null {
  return h.get("exa-signature") ?? h.get("x-exa-signature") ?? h.get("webhook-signature");
}

export function verifyExaSignature(
  rawBody: string,
  header: string | null,
  monitorId?: string,
  nowS = Math.floor(Date.now() / 1000),
): { ok: boolean; reason?: string } {
  if (!header) return { ok: false, reason: "missing signature header" };
  const secrets = candidateSecrets(monitorId);
  if (!secrets.length) return { ok: false, reason: "no webhook secret on file" };

  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : ["", p.trim()];
    }),
  ) as Record<string, string>;
  const v1s = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));

  if (parts.t && v1s.length) {
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S) return { ok: false, reason: "timestamp outside tolerance" };
    const payload = `${parts.t}.${rawBody}`;
    return secrets.some((s) => v1s.some((v) => matches(s, payload, v))) ? { ok: true } : { ok: false, reason: "bad signature" };
  }
  return secrets.some((s) => matches(s, rawBody, header)) ? { ok: true } : { ok: false, reason: "bad signature" };
}

// ---- Monitor definition (shared by the live monitor and the backtest) --------
export const WATCH_TERMS = "konkurssi OR yrityssaneeraus OR reklamaatio OR asiakasvalitus OR uutinen";
export const watchQuery = (name: string, domain?: string) => `${name} ${domain ?? ""} ${WATCH_TERMS}`.replace(/\s+/g, " ");

export type WatchItem = {
  date?: string;
  title: string;
  url: string;
  snippet?: string;
  signal: "insolvency" | "complaint" | "news";
  sent: boolean; // true = passed the relevance filter ("sent to agent"), false = dropped
  why?: string;
};

const INSOLVENCY = /konkurs|saneera|selvitystil|maksuh[äa]iri|bankrupt|insolven|liquidat|restructur/i;
const COMPLAINT = /reklamaat|valitu|kuluttajariit|riita|virhe|home|kosteus|complain|dispute|lawsuit|oikeu/i;

function stem(name: string) {
  return name
    .replace(/\b(oy|ab|oyj|ky|tmi|ltd|inc)\b/gi, "")
    .replace(/[^\p{L}\p{N}&\s]/gu, " ")
    .trim()
    .toLowerCase();
}

/** Does the result actually talk about this company (not just "bankruptcy" in general)? */
export function mentionsCompany(r: { title?: string; url: string; highlights?: string[]; text?: string }, name: string, domain?: string) {
  const hay = `${r.title ?? ""} ${r.url} ${(r.highlights ?? []).join(" ")} ${r.text ?? ""}`.toLowerCase();
  if (domain && hay.includes(domain.toLowerCase().replace(/^www\./, ""))) return true;
  const s = stem(name);
  if (!s) return false;
  if (hay.includes(s)) return true;
  // multi-word names: require every significant token (e.g. "espoon" + "putki" + "saneeraus")
  const toks = s.split(/\s+/).filter((t) => t.length > 2 && t !== "&");
  return toks.length > 1 && toks.every((t) => hay.includes(t));
}

export function toItem(r: ExaResult & Record<string, any>, name: string, domain?: string): WatchItem {
  const snippet = (r.highlights ?? [])[0] ?? (typeof r.text === "string" ? r.text.slice(0, 280) : undefined);
  const blob = `${r.title ?? ""} ${snippet ?? ""}`;
  const sent = mentionsCompany(r, name, domain);
  return {
    date: r.publishedDate ?? undefined,
    title: r.title || r.url,
    url: r.url,
    snippet,
    signal: INSOLVENCY.test(blob) ? "insolvency" : COMPLAINT.test(blob) ? "complaint" : "news",
    sent,
    why: sent ? undefined : "does not mention the company",
  };
}

const byDateDesc = (a: WatchItem, b: WatchItem) => (b.date ?? "").localeCompare(a.date ?? "");

/** Flatten GET /monitors/{id}/runs into counters + items for the UI. */
export function summarizeRuns(runs: { data?: any[] } | null, name: string, domain?: string) {
  const data = runs?.data ?? [];
  const seen = new Set<string>();
  const items: WatchItem[] = [];
  for (const run of data) {
    for (const r of run?.output?.results ?? []) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      items.push(toItem(r, name, domain));
    }
  }
  items.sort(byDateDesc);
  const latest = data[0];
  return {
    runs: data.length,
    completed: data.filter((r) => r.status === "completed").length,
    latest: latest ? { id: latest.id, status: latest.status, at: latest.completedAt ?? latest.createdAt, failReason: latest.failReason } : null,
    sent: items.filter((i) => i.sent).length,
    dropped: items.filter((i) => !i.sent).length,
    items,
  };
}

// ---- Backtest: "what would the watcher have caught?" ------------------------
// Emulation of the daily monitor: one Exa /search with the identical query,
// restricted to startPublishedDate = now - days. Results are bucketed per day
// (one simulated daily run per day) and filtered for actually naming the company.
export async function emulatedBacktest(name: string, domain: string | undefined, days = 30) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const query = watchQuery(name, domain);
  const res = await search({
    query,
    numResults: 25,
    startPublishedDate: start.toISOString(),
    contents: { highlights: { maxCharacters: 300 } },
  });
  const seen = new Set<string>();
  const items = res.results
    .filter((r) => r.url && !seen.has(r.url) && (seen.add(r.url), true))
    .map((r) => toItem(r, name, domain))
    .sort(byDateDesc);
  const daysWithHits = new Set(items.filter((i) => i.sent && i.date).map((i) => i.date!.slice(0, 10))).size;
  return {
    mode: "emulated" as const,
    query,
    window: { start: start.toISOString(), end: end.toISOString(), days },
    runs: days,
    runsWithAlerts: daysWithHits,
    sent: items.filter((i) => i.sent).length,
    dropped: items.filter((i) => !i.sent).length,
    items,
  };
}

// ---- Agent Monitors (beta) backtest ------------------------------------------
// POST /agent/monitors/backtest {entities, fields, startTime, endTime} -> 202 {id,status:"running"}
// GET  /agent/monitors/backtest/{id} -> {status:"completed", data:[{name, contents:{...}}]}
// Live-verified on our key. Window must start within the last 14 days (newsfeed retention).
const AGENT_BETA = "agent-monitors-2026-08-04";
export const AGENT_MAX_DAYS = 13;

export const AGENT_FIELDS = [
  {
    name: "insolvency",
    description:
      "Bankruptcy (konkurssi), corporate restructuring (yrityssaneeraus), liquidation, payment defaults or tax debt involving the company, with date and source.",
  },
  {
    name: "customer complaints",
    description:
      "Customer complaints, reclamations, consumer disputes board (kuluttajariitalautakunta) cases, lawsuits or construction quality defects reported about the company's work.",
  },
  {
    name: "company news",
    description: "Other notable news about the company: ownership changes, layoffs, new large contracts, management changes.",
  },
];

async function agentCall(method: string, path: string, body?: unknown) {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const res = await fetch(`https://api.exa.ai${path}`, {
    method,
    headers: { "x-api-key": key, "Exa-Beta": AGENT_BETA, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Exa ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function startAgentBacktest(name: string, domain: string | undefined, days = AGENT_MAX_DAYS) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(days, AGENT_MAX_DAYS) * 86400_000);
  const entity: Record<string, string> = { name };
  if (domain) entity.domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return agentCall("POST", "/agent/monitors/backtest", {
    entities: [entity],
    fields: AGENT_FIELDS,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }) as Promise<{ id: string; status: string; startTime: string; endTime: string }>;
}

export async function getAgentBacktest(id: string) {
  if (!/^agentbacktest_[a-z0-9]+$/i.test(id)) throw new Error("bad backtest id");
  return agentCall("GET", `/agent/monitors/backtest/${id}`) as Promise<{
    id: string;
    status: string;
    data?: { name: string; contents: Record<string, any> }[];
  }>;
}
