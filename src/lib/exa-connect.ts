// Exa Connect: premium partner data inside an Exa Agent run, enabled with
// `dataSources: [{ provider }]` on POST /agent/runs (no partner key needed).
// Verified on our key: fiber, similarweb, baselayer, polymarket, macrobond,
// jinko, particle, financial_datasets, affiliate(_com) all pass validation.
//
// connectVerify cross-checks a company against Fiber.ai's B2B database
// (company record, LinkedIn, headcount, key person). Baselayer is US-centric
// KYB; Finnish companies need its "international business search" at $4.00
// per call, so it is opt-in via EXA_CONNECT_BASELAYER=1.
import { call, type ExaTrace } from "./exa";
import type { Check, Evidence } from "./verify";

export type ConnectProvider = "fiber" | "similarweb" | "baselayer" | "polymarket" | "macrobond" | "jinko" | "particle" | "financial_datasets" | "affiliate_com";

export type ConnectCheck = Check & {
  provider: ConnectProvider[];
  runId?: string;
  costDollars?: number;
  record?: {
    name?: string;
    domain?: string;
    linkedinUrl?: string;
    employeeCount?: number;
    keyPerson?: string;
    keyPersonTitle?: string;
    registrationStatus?: string;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function runAgentToCompletion(body: Record<string, unknown>, trace?: ExaTrace[], label = "agent", timeoutMs = 120_000): Promise<any> {
  const started = await call("POST", "/agent/runs", body, trace, label);
  const t0 = Date.now();
  let run = started;
  while (!["completed", "failed", "cancelled"].includes(run.status)) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`Agent run ${started.id} still ${run.status} after ${timeoutMs / 1000}s`);
    await sleep(3000);
    run = await call("GET", `/agent/runs/${encodeURIComponent(started.id)}`, undefined, trace, `agent poll ${started.id}`);
  }
  return run;
}

const schema = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "True only if the partner database returned a record that matches this company (same name/domain)." },
    name: { type: ["string", "null"] },
    domain: { type: ["string", "null"] },
    linkedinUrl: { type: ["string", "null"] },
    employeeCount: { type: ["number", "null"] },
    keyPerson: { type: ["string", "null"], description: "Owner / CEO (toimitusjohtaja) name" },
    keyPersonTitle: { type: ["string", "null"] },
    registrationStatus: { type: ["string", "null"], description: "Active / dissolved etc. if the data source reports it" },
    domainMatches: { type: ["boolean", "null"], description: "Does the record's domain match the claimed website?" },
    notes: { type: ["string", "null"], description: "One sentence on what the data source confirmed or contradicted" },
  },
  required: ["found"],
};

export async function connectVerify(name: string, businessId?: string, website?: string, trace?: ExaTrace[]): Promise<ConnectCheck> {
  const providers: ConnectProvider[] = process.env.EXA_CONNECT_BASELAYER === "1" ? ["fiber", "baselayer"] : ["fiber"];
  const ident = [`"${name}"`, website && `website ${website}`, businessId && `Finnish business ID (Y-tunnus) ${businessId}`].filter(Boolean).join(", ");
  const query =
    `Look up the Finnish company ${ident} in the connected B2B/business-verification database` +
    (providers.includes("baselayer") ? "s (Fiber.ai and Baselayer international business search)" : " (Fiber.ai)") +
    `. Do one company lookup (numResults 1) and, if found, one person lookup for the owner/CEO. ` +
    `Do NOT reveal emails or phone numbers. Report whether a matching record exists, its domain, LinkedIn URL, headcount and key person, ` +
    `and whether the domain matches the claimed website. If nothing matches, set found=false; do not guess from web pages.`;
  const body = { query, effort: "minimal", dataSources: providers.map((provider) => ({ provider })), outputSchema: schema };

  const base = { id: "exa-connect", label: "Partner data (Exa Connect)", provider: providers };
  let run: any;
  try {
    run = await runAgentToCompletion(body, trace, `connect(${providers.join("+")}): ${name}`);
  } catch (e) {
    return { ...base, status: "grey", detail: `Exa Connect lookup failed: ${(e as Error).message}`, evidence: [] };
  }
  const cost = typeof run.costDollars === "number" ? run.costDollars : run.costDollars?.total;
  const s = run.output?.structured ?? {};
  const citations: any[] = (run.output?.grounding ?? []).flatMap((g: any) => g.citations ?? []);
  const seen = new Set<string>();
  const evidence: Evidence[] = citations
    .filter((c) => c?.url && !seen.has(c.url) && seen.add(c.url))
    .slice(0, 5)
    .map((c) => ({ url: c.url, quote: c.title ?? undefined, source: "web", via: `exa.agent dataSources:${providers.join(",")}` }));
  if (s.linkedinUrl && !seen.has(s.linkedinUrl)) evidence.unshift({ url: s.linkedinUrl, source: "web", via: "exa.agent dataSources:fiber", claim: `${s.name ?? name} on LinkedIn` });

  const meta = { runId: run.id as string, costDollars: typeof cost === "number" ? cost : undefined };
  if (run.status !== "completed") return { ...base, ...meta, status: "grey", detail: `Exa Connect run ${run.status}: ${run.error?.message ?? run.stopReason ?? ""}`.trim(), evidence: [] };
  if (!s.found) {
    return { ...base, ...meta, status: "grey", detail: `Not in Fiber.ai's B2B database (common for small Finnish firms; not a red flag on its own).`, evidence };
  }
  const record = {
    name: s.name ?? undefined,
    domain: s.domain ?? undefined,
    linkedinUrl: s.linkedinUrl ?? undefined,
    employeeCount: typeof s.employeeCount === "number" ? s.employeeCount : undefined,
    keyPerson: s.keyPerson ?? undefined,
    keyPersonTitle: s.keyPersonTitle ?? undefined,
    registrationStatus: s.registrationStatus ?? undefined,
  };
  const parts = [
    `Found in partner data as ${record.name ?? name}`,
    record.employeeCount != null && `~${record.employeeCount} employees`,
    record.keyPerson && `${record.keyPersonTitle ?? "key person"}: ${record.keyPerson}`,
    record.registrationStatus && `status ${record.registrationStatus}`,
  ].filter(Boolean);
  const inactive = /dissolv|inactive|bankrupt|konkurssi|lakkautet/i.test(record.registrationStatus ?? "");
  const status = inactive || s.domainMatches === false ? (inactive ? "red" : "yellow") : "green";
  const tail = s.domainMatches === false ? ` Domain on record (${record.domain}) differs from the claimed website.` : "";
  return { ...base, ...meta, record, status, detail: parts.join(", ") + "." + tail + (s.notes ? ` ${s.notes}` : ""), evidence };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
