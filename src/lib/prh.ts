// PRH / YTJ open data API (no key). https://avoindata.prh.fi/opendata-ytj-api/v3
const BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3";

export type PrhCompany = {
  businessId: string;
  name: string;
  otherNames: string[]; // auxiliary / former names: explains brand vs legal name
  registrationDate?: string;
  website?: string;
  mainBusinessLine?: string;
  inPrepaymentRegister: boolean; // ennakkoperintärekisteri (register code 5)
  inTradeRegister: boolean;
  vatLiable: boolean;
  employerRegister: boolean;
  situations: string[]; // bankruptcy, liquidation, ...
  addresses: string[];
  raw: unknown;
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

async function queryOnce(url: string): Promise<PrhCompany[]> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`PRH ${res.status} for ${url}`);
  const data = await res.json();
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

export async function prhByBusinessId(businessId: string): Promise<PrhCompany | null> {
  const rows = await query({ businessId });
  return rows[0] ?? null;
}

export async function prhByName(name: string, location?: string): Promise<PrhCompany[]> {
  return query(location ? { name, location } : { name });
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
