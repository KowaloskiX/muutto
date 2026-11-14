// PRH / YTJ open data API (no key). https://avoindata.prh.fi/opendata-ytj-api/v3
import type { ExaTrace } from "./exa";
import { fallbackByBusinessId, fallbackByName, type RegistryFallback } from "./registry-fallback";

const BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3";

export type PrhCompany = {
  businessId: string;
  name: string;
  otherNames: string[]; // auxiliary / former names: explains brand vs legal name
  registrationDate?: string;
  website?: string;
  mainBusinessLine?: string;
  /** TOL code of the main line of business, e.g. "43210" (electrical installation). */
  mainBusinessLineCode?: string;
  inPrepaymentRegister: boolean; // ennakkoperintärekisteri (register code 5)
  inTradeRegister: boolean;
  vatLiable: boolean;
  employerRegister: boolean;
  situations: string[]; // bankruptcy, liquidation, ...
  addresses: string[];
  raw: unknown;
  /**
   * Set only when PRH was unreachable and the entry was read from a public copy of the
   * register page instead (registry-fallback.ts): cite `url`, and treat a register that is
   * not listed as "not listed", not as "not registered".
   */
  fallback?: RegistryFallback;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function pickText(descs: any[] | undefined, lang = "3"): string | undefined {
  if (!Array.isArray(descs)) return undefined;
  return (descs.find((d) => d.languageCode === lang) ?? descs[0])?.description;
}

function isActive(entry: any): boolean {
  return !entry?.endDate;
}

function parseCompany(c: any): PrhCompany {
  const regs: any[] = (c.registeredEntries ?? []).filter(isActive);
  const hasReg = (code: string) => regs.some((r) => String(r.register) === code);
  const name =
    (c.names ?? []).find((n: any) => isActive(n) && String(n.type) === "1")?.name ??
    c.names?.[0]?.name ??
    "";
  return {
    businessId: c.businessId?.value ?? "",
    name,
    otherNames: (c.names ?? []).map((n: any) => n.name).filter((n: string) => n && n !== name),
    registrationDate: c.registrationDate ?? c.businessId?.registrationDate,
    website: c.website?.url ?? undefined,
    mainBusinessLine: pickText(c.mainBusinessLine?.descriptions),
    mainBusinessLineCode: c.mainBusinessLine?.type ? String(c.mainBusinessLine.type) : undefined,
    inPrepaymentRegister: hasReg("5"),
    inTradeRegister: hasReg("1"),
    vatLiable: hasReg("6"),
    employerRegister: hasReg("7"),
    situations: (c.companySituations ?? [])
      .filter(isActive)
      .map((s: any) => String(s.type ?? s.description ?? "unknown")),
    addresses: (c.addresses ?? []).map((a: any) =>
      [a.street, a.buildingNumber, a.postCode, (a.postOffices?.find((p: any) => p.languageCode === "1") ?? a.postOffices?.[0])?.city]
        .filter(Boolean)
        .join(" "),
    ),
    raw: c,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const cache = new Map<string, Promise<PrhCompany[]>>();

// Last time the register could not be reached (outage, 5xx, timeout): callers that cache
// results built on register data (verification reports) skip caching after a failure.
let lastFailureAt = 0;
let lastSuccessAt = 0;
let lastSkipAt = 0; // breaker open: PRH not even tried
export const prhFailedSince = (t: number) => lastFailureAt >= t || lastSkipAt >= t;
/** PRH answered after time t (a report built on fallback data before then should be redone). */
export const prhOkSince = (t: number) => lastSuccessAt > t;
// Circuit breaker: right after a failure (and no success since), skip PRH for a minute and
// go straight to the fallback instead of waiting on refused/hanging connections each time.
function prhDown(): boolean {
  const down = lastFailureAt > lastSuccessAt && Date.now() - lastFailureAt < 60000;
  if (down) lastSkipAt = Date.now();
  return down;
}

async function queryOnce(url: string): Promise<PrhCompany[]> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) }).catch((e) => {
    lastFailureAt = Date.now();
    throw e;
  });
  if (res.status === 404) {
    lastSuccessAt = Date.now();
    return [];
  }
  if (!res.ok) {
    lastFailureAt = Date.now();
    throw new Error(`PRH ${res.status} for ${url}`);
  }
  const data = await res.json();
  lastSuccessAt = Date.now();
  return (data.companies ?? []).map(parseCompany);
}

// PRH gets slow under parallel load: retry once, and cache successful lookups.
async function query(params: Record<string, string>): Promise<PrhCompany[]> {
  const url = `${BASE}/companies?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit) return hit;
  const p = queryOnce(url).catch(() => queryOnce(url));
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

// PRH first; only when it cannot be reached, public copies of the register page via Exa.
// A PRH "not found" is an answer, not an outage: no fallback then.
export async function prhByBusinessId(businessId: string, trace?: ExaTrace[]): Promise<PrhCompany | null> {
  if (!prhDown()) {
    try {
      const rows = await query({ businessId });
      return rows[0] ?? null;
    } catch {
      /* unreachable: fall through */
    }
  }
  return fallbackByBusinessId(businessId, trace);
}

export async function prhByName(name: string, location?: string, trace?: ExaTrace[]): Promise<PrhCompany[]> {
  if (!prhDown()) {
    try {
      return await query(location ? { name, location } : { name });
    } catch {
      /* unreachable: fall through */
    }
  }
  return fallbackByName(name, trace);
}

export function domainOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
