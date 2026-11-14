// Exa Agent API: "find more contractors" — an async research run that sources
// new companies (excluding ones we already show) and grades each one against a
// small set of criteria with evidence. Start with startMoreRun, poll getMoreRun.
import { call, type ExaTrace } from "./exa";

export type Criterion = { key: string; label: string; description: string };
export type CriterionStatus = "met" | "not_met" | "unknown";
export type CriterionResult = { criterionKey: string; status: CriterionStatus; evidence?: string; sourceUrl?: string };
export type AgentCompany = {
  name: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  criteria: CriterionResult[];
  citations: { url: string; title?: string }[];
};
export type MoreRun = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  terminal: boolean;
  stopReason?: string;
  costDollars?: number;
  createdAt?: string;
  completedAt?: string;
  companies: AgentCompany[];
  summary?: string;
  error?: string;
};

export const AGENT_EFFORT = "low" as const;
const MAX_COMPANIES = 5;

// Static template + one job-specific criterion first.
export function deriveCriteria(job: string, city: string): Criterion[] {
  const j = job.trim().replace(/\s+/g, " ").slice(0, 80) || "the job";
  return [
    { key: "does_job", label: `Does ${j}`, description: `The company's own website or a listing says it offers "${j}" specifically (not just the general trade).` },
    { key: "serves_city", label: `Serves ${city}`, description: `The company is located in or explicitly serves ${city} (or the wider capital region including ${city}).` },
    { key: "english", label: "English-speaking", description: "The company has an English website/page or states it serves customers in English." },
    { key: "business_id", label: "Business ID on site", description: "A Finnish business ID (Y-tunnus, format 1234567-8) is shown on the company's website." },
    { key: "recent_reviews", label: "Recent reviews", description: "There are customer reviews from the last 2 years (Google, Facebook, Trustpilot, etc.)." },
  ];
}

function outputSchema(criteria: Criterion[]) {
  return {
    type: "object",
    properties: {
      companies: {
        type: "array",
        maxItems: MAX_COMPANIES,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            website: { type: "string", format: "uri" },
            phone: { type: ["string", "null"], format: "phone" },
            email: { type: ["string", "null"], format: "email" },
            city: { type: ["string", "null"] },
            criteria: {
              type: "array",
              description: `One entry per criterion key: ${criteria.map((c) => c.key).join(", ")}`,
              items: {
                type: "object",
                properties: {
                  criterionKey: { type: "string", enum: criteria.map((c) => c.key) },
                  status: { type: "string", enum: ["met", "not_met", "unknown"] },
                  evidence: { type: ["string", "null"], description: "Short verbatim quote supporting the status" },
                  sourceUrl: { type: ["string", "null"], format: "uri", description: "Page the evidence comes from" },
                },
                required: ["criterionKey", "status"],
              },
            },
          },
          required: ["name", "website", "criteria"],
        },
      },
    },
    required: ["companies"],
  };
}

export async function startMoreRun(
  input: { job: string; city: string; exclude: { name: string; website?: string }[] },
  trace?: ExaTrace[],
): Promise<{ id: string; criteria: Criterion[] }> {
  const criteria = deriveCriteria(input.job, input.city);
  const query =
    `Find up to ${MAX_COMPANIES} local Finnish companies (actual contractors, not directories, marketplaces or lead-gen sites) ` +
    `that do "${input.job}" for homeowners/housing companies in ${input.city}, Finland. ` +
    `For each, give the company website, phone and email if published, and evaluate every criterion below as met / not_met / unknown ` +
    `with a short quote and the source URL as evidence. Use unknown when you found no evidence.\n\n` +
    criteria.map((c) => `- ${c.key}: ${c.description}`).join("\n");
  const body: Record<string, unknown> = {
    query,
    effort: AGENT_EFFORT,
    outputSchema: outputSchema(criteria),
    metadata: { job: input.job.slice(0, 200), city: input.city.slice(0, 100) },
  };
  const exclusion = input.exclude.filter((e) => e.name || e.website).map((e) => ({ name: e.name, ...(e.website ? { website: e.website } : {}) }));
  if (exclusion.length) body.input = { exclusion };
  const run = await call("POST", "/agent/runs", body, trace, `agent(${AGENT_EFFORT}): more ${input.job} in ${input.city}`);
  return { id: run.id, criteria };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeRun(run: any): MoreRun {
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
  const cost = typeof run.costDollars === "number" ? run.costDollars : run.costDollars?.total;
  const grounding: any[] = run.output?.grounding ?? [];
  const raw: any[] = run.status === "completed" ? (run.output?.structured?.companies ?? []) : [];
  const companies: AgentCompany[] = raw.map((c, i) => {
    // Grounding fields look like "structured.companies[0].criteria".
    const prefix = `companies[${i}]`;
    const citations = grounding
      .filter((g) => typeof g.field === "string" && g.field.replace(/^structured\./, "").startsWith(prefix))
      .flatMap((g) => g.citations ?? []);
    const seen = new Set<string>();
    return {
      name: String(c.name ?? "Unknown"),
      website: c.website ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      city: c.city ?? undefined,
      criteria: (c.criteria ?? []).map((r: any) => ({
        criterionKey: r.criterionKey,
        status: ["met", "not_met"].includes(r.status) ? r.status : "unknown",
        evidence: r.evidence ?? undefined,
        sourceUrl: r.sourceUrl ?? undefined,
      })),
      citations: citations.filter((x: any) => x?.url && !seen.has(x.url) && seen.add(x.url)),
    };
  });
  return {
    id: run.id,
    status: run.status,
    terminal,
    stopReason: run.stopReason ?? undefined,
    costDollars: typeof cost === "number" ? cost : undefined,
    createdAt: run.createdAt ?? undefined,
    completedAt: run.completedAt ?? undefined,
    companies,
    summary: run.output?.text ?? undefined,
    error: run.error?.message ?? (run.status === "failed" ? "Agent run failed" : undefined),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getMoreRun(id: string, trace?: ExaTrace[]): Promise<MoreRun> {
  const run = await call("GET", `/agent/runs/${encodeURIComponent(id)}`, undefined, trace, `agent poll ${id}`);
  return normalizeRun(run);
}
