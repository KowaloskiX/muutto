// "Settling in": the real services a newcomer needs around an area, each with its register as source.
//  1. Helsinki region Service Map API (api.hel.fi/servicemap/v2, keyless, CC BY 4.0; the register
//     behind palvelukartta.hel.fi). Covers Helsinki, Espoo, Vantaa, Kauniainen fully and some units
//     of Kerava, Kirkkonummi, Järvenpää… Queried by service id near the point, sorted by distance,
//     filtered to the area's own municipality for municipal services (health centre, child health
//     clinic, daycare, school, newcomer desk, public landlord). Phone / www / email / hours are the
//     unit's own register fields; placeholder emails ("etunimi.sukunimi@…") are dropped.
//  2. OpenStreetMap via Overpass (ODbL) for any kind the register has no unit for in that
//     municipality (typical outside the four capital-region cities).
//  3. Exa search restricted to official domains: the municipality's own newcomer page, DVV
//     (registration) and Kela pages, the municipal landlord where the register has none, and whether
//     SATO / Lumo / Avara / M2-Kodit show rental homes in that municipality (cited result URL).
// Nothing is filled in: a kind with no hit is listed in `unknowns`. Cached 24 h per point.
import { search, type ExaResult } from "@/lib/exa";
import type { AreaServices, LatLng, ServiceContact, ServiceGroup, ServiceKind, Source } from "./types";
import { regionPois } from "./amenities";
import { fetchJson, haversineM, limiter, today, withTimeout } from "./util";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SM = "https://api.hel.fi/servicemap/v2/unit/";
const SM_LABEL = "Helsinki region Service Map";
const smGate = limiter(5);

type SmSpec = { kind: ServiceKind; group: ServiceGroup; services: string; radius: number; ownMunicipality: boolean; take?: number; anywhere?: boolean; prefer?: (u: any) => boolean; filter?: (u: any) => boolean };

const isPublic = (u: any) => u.provider_type === "SELF_PRODUCED" || u.provider_type === "MUNICIPALITY" || u.organizer_type === "MUNICIPALITY" || u.organizer_type === "MUNICIPALLY_OWNED_COMPANY";
const NEWCOMER_RE = /international house|helsinki-info|hello espoo|integration|koto|kotoutu|maahanmuutt|infopiste|neuvontapiste/i;
const NEWCOMER_NOT = /group home|ryhmäkoti|after-care|hätämajoitus|social work|sosiaalityö|social services|social counselling/i;

const SPECS: SmSpec[] = [
  { kind: "health-centre", group: "health", services: "703", radius: 10_000, ownMunicipality: true, take: 1, prefer: (u) => !/anticoag|poliklin|laborator|AK-/i.test(nameOf(u) + " " + (u.name?.fi ?? "")) },
  { kind: "pharmacy", group: "health", services: "57", radius: 4_000, ownMunicipality: false },
  { kind: "child-health", group: "kids", services: "379", radius: 8_000, ownMunicipality: true },
  { kind: "daycare", group: "kids", services: "663,603", radius: 3_000, ownMunicipality: true, prefer: (u) => isPublic(u) && (u.services ?? []).includes(663) },
  { kind: "school", group: "kids", services: "661,601", radius: 4_000, ownMunicipality: true, prefer: (u) => isPublic(u) && (u.services ?? []).includes(661) },
  { kind: "library", group: "everyday", services: "813", radius: 6_000, ownMunicipality: false },
  { kind: "swimming", group: "everyday", services: "729", radius: 10_000, ownMunicipality: false },
  { kind: "newcomer", group: "official", services: "420", radius: 40_000, ownMunicipality: true, take: 2, filter: (u) => NEWCOMER_RE.test(nameOf(u)) && !NEWCOMER_NOT.test(nameOf(u)) },
  { kind: "kela", group: "official", services: "286", radius: 40_000, ownMunicipality: false },
  { kind: "registration", group: "official", services: "335", radius: 60_000, ownMunicipality: false },
  { kind: "landlord", group: "landlords", services: "268", radius: 60_000, ownMunicipality: true, take: 3, anywhere: true }, // landlord offices often have no map point
];

const KIND_WORD: Record<ServiceKind, string> = {
  "health-centre": "Health centre",
  pharmacy: "Pharmacy",
  "child-health": "Child health clinic (neuvola)",
  daycare: "Daycare",
  school: "Primary school",
  library: "Library",
  swimming: "Swimming hall",
  newcomer: "Newcomer info",
  registration: "Registration (DVV)",
  kela: "Kela",
  landlord: "Public landlord",
};

function nameOf(u: any): string {
  return u.name?.en || u.name?.fi || u.name?.sv || "";
}
const pick = (o: any, ...langs: string[]) => (o ? langs.map((l) => o[l]).find((v) => typeof v === "string" && v.trim()) : undefined) as string | undefined;
const realEmail = (e?: string | null) => (e && !/etunimi|sukunimi|firstname|lastname/i.test(e) ? e : undefined);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function hoursOf(u: any): string | undefined {
  const c = (u.connections ?? []).find((x: any) => x.section_type === "OPENING_HOURS" && (x.name?.en || x.name?.fi));
  const h = c ? pick(c.name, "en", "fi") : undefined;
  return h ? clip(h.replace(/\s*\n\s*/g, " · ").replace(/^(Valid until further notice|Voimassa toistaiseksi):?\s*·?\s*/i, ""), 160) : undefined;
}

function smContact(spec: SmSpec, u: any, c: LatLng): ServiceContact | null {
  const coords = u.location?.coordinates;
  const geo = coords ? { lat: coords[1], lng: coords[0] } : null;
  const name = nameOf(u);
  if (!name) return null;
  const street = pick(u.street_address, "fi", "en");
  const address = street ? [street, [u.address_zip, u.municipality ? u.municipality[0].toUpperCase() + u.municipality.slice(1) : ""].filter(Boolean).join(" ")].filter(Boolean).join(", ") : undefined;
  const notes: string[] = [];
  if ((spec.kind === "daycare" || spec.kind === "school") && !isPublic(u)) notes.push(pick(u.displayed_service_owner, "en", "fi") ?? "not run by the city");
  if (spec.kind === "school" && (u.services ?? []).includes(601)) notes.push("Swedish-language");
  if (spec.kind === "daycare" && (u.services ?? []).includes(603)) notes.push("Swedish-language");
  const source: Source = { url: `https://palvelukartta.hel.fi/en/unit/${u.id}`, label: `${SM_LABEL} (palvelukartta.hel.fi)`, quote: [name, address].filter(Boolean).join(", "), asOf: today() };
  return {
    kind: spec.kind,
    group: spec.group,
    name,
    address,
    phone: u.phone || undefined,
    website: pick(u.www, "en", "fi", "sv"),
    email: realEmail(u.email),
    hours: hoursOf(u),
    distanceM: geo ? Math.round(haversineM(c, geo)) : undefined,
    note: notes.join(" · ") || undefined,
    source,
  };
}

async function serviceMap(spec: SmSpec, c: LatLng, muni: string): Promise<ServiceContact[]> {
  const q = new URLSearchParams({
    ...(spec.anywhere ? {} : { lat: c.lat.toFixed(5), lon: c.lng.toFixed(5), distance: String(spec.radius) }),
    service: spec.services,
    page_size: spec.filter ? "40" : "12",
    only: "name,street_address,address_zip,municipality,phone,www,email,location,connections,provider_type,organizer_type,displayed_service_owner,services",
    format: "json",
  });
  if (spec.ownMunicipality && muni) q.set("municipality", muni);
  const d = await smGate(() => fetchJson<any>(`${SM}?${q}`, { timeoutMs: 7_000 }));
  let units: any[] = (d.results ?? []).filter((u: any) => !spec.filter || spec.filter(u));
  if (spec.prefer) {
    const pref = units.filter(spec.prefer);
    // Nearest city-run unit first; the nearest private one too if it is closer.
    units = pref.length ? [pref[0], ...units.filter((u) => u !== pref[0] && !spec.prefer!(u)).slice(0, 1)] : units;
  }
  return units
    .map((u) => smContact(spec, u, c))
    .filter((x): x is ServiceContact => !!x)
    // With a preference the city-run unit stays first; otherwise nearest first.
    .sort((a, b) => (spec.prefer ? 0 : (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)))
    .slice(0, spec.take ?? (spec.prefer ? 2 : 1));
}

// ---- OpenStreetMap: the shared regional POI snapshot (amenities.ts) first --------------
async function regionalOsm(c: LatLng, want: ServiceKind[]): Promise<ServiceContact[]> {
  const { pois } = await regionPois();
  const best = new Map<ServiceKind, ServiceContact>();
  for (const p of pois) {
    const kind: ServiceKind | null = p.kind === "daycare" ? "daycare" : p.kind === "school" && /koulu|skola|school/i.test(p.name) && !SCHOOL_NOT.test(p.name) ? "school" : p.kind === "pharmacy" ? "pharmacy" : null;
    if (!kind || !want.includes(kind) || p.name === p.kind) continue;
    const distanceM = Math.round(haversineM(c, p.geo));
    if (distanceM > 4000 || (best.has(kind) && best.get(kind)!.distanceM! <= distanceM)) continue;
    best.set(kind, { kind, group: kind === "pharmacy" ? "health" : "kids", name: p.name, distanceM, source: { url: p.url ?? `https://www.openstreetmap.org/?mlat=${p.geo.lat}&mlon=${p.geo.lng}`, label: "OpenStreetMap (ODbL)", quote: p.name, asOf: today() } });
  }
  return [...best.values()];
}

// ---- OpenStreetMap fallback --------------------------------------------------------
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const SCHOOL_NOT = /lukio|gymnasium|ammatti|keuda|opisto|yliopisto|university|aikuis|autokoulu|musiikki|tanssi/i;
const OSM_KINDS: ServiceKind[] = ["health-centre", "pharmacy", "daycare", "school", "library", "swimming"];

function osmKind(t: any): ServiceKind | null {
  const name = String(t.name ?? "");
  if (t.amenity === "pharmacy") return "pharmacy";
  if (t.amenity === "kindergarten") return "daycare";
  if (t.amenity === "school") return /koulu|skola|school/i.test(name) && !SCHOOL_NOT.test(name) ? "school" : null;
  if (t.amenity === "library") return "library";
  if (t.healthcare === "centre" || ((t.amenity === "clinic" || t.amenity === "doctors") && /terveysasema|terveyskeskus|health cent/i.test(name))) return "health-centre";
  if ((t.leisure === "sports_centre" && /swimming/.test(t.sport ?? "")) || /uimahalli/i.test(name)) return "swimming";
  return null;
}

async function overpass(c: LatLng, want: ServiceKind[]): Promise<ServiceContact[]> {
  const r = 5000;
  const a = `around:${r},${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
  const q = `[out:json][timeout:9];(nwr(${a})["amenity"~"^(pharmacy|kindergarten|school|library|clinic|doctors)$"];nwr(${a})["healthcare"="centre"];nwr(${a})["leisure"="sports_centre"]["sport"~"swimming"];);out center tags;`;
  let d: any = null;
  for (const url of OVERPASS) {
    d = await fetchJson<any>(url, { method: "POST", timeoutMs: 9_000, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(q)}` }).catch(() => null);
    if (d?.elements) break;
  }
  if (!d?.elements) throw new Error("Overpass unavailable");
  const best = new Map<ServiceKind, ServiceContact>();
  for (const e of d.elements) {
    const t = e.tags ?? {};
    const kind = osmKind(t);
    if (!kind || !want.includes(kind) || !t.name) continue;
    const geo = e.type === "node" ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : null;
    if (!geo) continue;
    const distanceM = Math.round(haversineM(c, geo));
    if (best.has(kind) && best.get(kind)!.distanceM! <= distanceM) continue;
    const street = t["addr:street"] ? `${t["addr:street"]} ${t["addr:housenumber"] ?? ""}`.trim() : undefined;
    const address = street ? [street, [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ")].filter(Boolean).join(", ") : undefined;
    const url = `https://www.openstreetmap.org/${e.type}/${e.id}`;
    best.set(kind, {
      kind,
      group: kind === "daycare" || kind === "school" ? "kids" : kind === "library" || kind === "swimming" ? "everyday" : "health",
      name: t.name,
      address,
      phone: t.phone || t["contact:phone"] || undefined,
      website: t.website || t["contact:website"] || undefined,
      email: realEmail(t.email || t["contact:email"]),
      hours: t.opening_hours || undefined,
      distanceM,
      source: { url, label: "OpenStreetMap (ODbL)", quote: [t.name, address].filter(Boolean).join(", "), asOf: today() },
    });
  }
  return [...best.values()];
}

// ---- Exa on official domains -------------------------------------------------------
const MUNI_DOMAIN: Record<string, string> = {
  helsinki: "hel.fi",
  espoo: "espoo.fi",
  vantaa: "vantaa.fi",
  kauniainen: "kauniainen.fi",
  kerava: "kerava.fi",
  järvenpää: "jarvenpaa.fi",
  kirkkonummi: "kirkkonummi.fi",
  tuusula: "tuusula.fi",
  sipoo: "sipoo.fi",
  nurmijärvi: "nurmijarvi.fi",
  vihti: "vihti.fi",
};
// Municipally owned rental landlords that the Service Map does not list (Helsinki's Heka and
// Espoon Asunnot come from the register itself). Searched only on their own domain.
const MUNI_LANDLORD: Record<string, { name: string; domain: string; query: string }> = {
  vantaa: { name: "VAV Asunnot (City of Vantaa)", domain: "vav.fi", query: "VAV vuokra-asunnot Vantaa asiakaspalvelu yhteystiedot" },
};
const NATIONAL_LANDLORDS: { name: string; domain: string }[] = [
  { name: "SATO", domain: "sato.fi" },
  { name: "Lumo (Kojamo)", domain: "lumo.fi" },
  { name: "Avara", domain: "avara.fi" },
  { name: "M2-Kodit (Y-Säätiö)", domain: "m2kodit.fi" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const onDomain = (u: string, d: string) => {
  const h = hostOf(u);
  return h === d || h.endsWith(`.${d}`);
};
const hl = (r: ExaResult) => (r.highlights ?? []).join(" … ").replace(/\s+/g, " ").trim();
const PHONE_RE = /(?:\+358|\b0)\s?\d{1,3}(?:[\s-]?\d{2,4}){2,3}\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function exaSource(r: ExaResult, label: string): Source {
  const q = hl(r);
  return { url: r.url, label, quote: q ? clip(q, 240) : r.title, asOf: r.publishedDate?.slice(0, 10) ?? today() };
}

async function exa(query: string, domains: string[], n = 4): Promise<ExaResult[]> {
  const r = await search({ query, numResults: n, includeDomains: domains, contents: { highlights: { maxCharacters: 320, query } } });
  return r.results.filter((x) => domains.some((d) => onDomain(x.url, d)) && !/\.pdf($|\?)/i.test(x.url));
}

// Long-lived (24 h) memo for per-municipality / national lookups shared by many areas.
const g = globalThis as unknown as { __moveSvc?: Map<string, { at: number; p: Promise<unknown> }> };
const memo = (g.__moveSvc ??= new Map());
const TTL = 24 * 3600 * 1000;
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}

function pageContact(kind: ServiceKind, group: ServiceGroup, name: string, r: ExaResult, label: string, note?: string): ServiceContact {
  const text = hl(r);
  const email = text.match(EMAIL_RE)?.[0];
  const phone = text.match(PHONE_RE)?.[0];
  return { kind, group, name, website: r.url, email: realEmail(email), phone: phone?.trim(), note, source: exaSource(r, label) };
}

async function newcomerPages(muni: string): Promise<ServiceContact[]> {
  const domain = MUNI_DOMAIN[muni];
  if (!domain) return [];
  const M = cap(muni);
  const domains = muni === "helsinki" ? [domain, "ihhelsinki.fi"] : [domain];
  const res = await exa(`Moving to ${M}: information for newcomers and international residents (registering, services in English)`, domains, 4);
  return res.slice(0, 2).map((r) => pageContact("newcomer", "official", clip(r.title?.trim() || `${M} newcomer information`, 90), r, hostOf(r.url)));
}

async function nationalPages(): Promise<ServiceContact[]> {
  const [dvv, kela] = await Promise.all([
    exa("Moving to Finland: register your address and municipality of residence at DVV (Digital and Population Data Services Agency)", ["dvv.fi"], 4).catch(() => []),
    exa("Moving to Finland: when Kela social security covers you, how to apply, Kela contact", ["kela.fi"], 4).catch(() => []),
  ]);
  const prefEn = (rs: ExaResult[]) => rs.find((r) => /\/en(\/|$)|-en\b|lang=en/i.test(r.url)) ?? rs[0];
  const out: ServiceContact[] = [];
  const d = prefEn(dvv);
  if (d) out.push(pageContact("registration", "official", clip(d.title?.trim() || "DVV: registering in Finland", 90), d, "dvv.fi"));
  const k = prefEn(kela);
  if (k) out.push(pageContact("kela", "official", clip(k.title?.trim() || "Kela: moving to Finland", 90), k, "kela.fi"));
  return out;
}

async function municipalLandlord(muni: string): Promise<ServiceContact[]> {
  const known = MUNI_LANDLORD[muni];
  const domain = known?.domain ?? MUNI_DOMAIN[muni];
  if (!domain) return [];
  const res = await exa(known?.query ?? `${cap(muni)} kaupungin vuokra-asunnot, vuokra-asunnon hakeminen`, [domain], 3);
  const r = res[0];
  if (!r) return [];
  return [pageContact("landlord", "landlords", known?.name ?? clip(r.title?.trim() || `${cap(muni)} rental housing`, 90), r, hostOf(r.url), known ? undefined : `${cap(muni)}'s own page on rental housing`)];
}

async function landlordContacts(): Promise<Map<string, ExaResult>> {
  const res = await exa("asiakaspalvelu yhteystiedot puhelin vuokra-asunnot", NATIONAL_LANDLORDS.map((l) => l.domain), 12);
  const out = new Map<string, ExaResult>();
  for (const l of NATIONAL_LANDLORDS) {
    const hit = res.find((r) => onDomain(r.url, l.domain) && /yhteys|contact|asiakaspalvelu|customer/i.test(r.url + " " + (r.title ?? "")) && !/nakovammai|visually/i.test(r.url));
    if (hit) out.set(l.domain, hit);
  }
  return out;
}

async function nationalLandlords(muni: string, area: string): Promise<ServiceContact[]> {
  const M = cap(muni);
  const [res, contacts] = await Promise.all([
    exa(`vuokra-asunnot ${area} ${M} vapaat vuokra-asunnot`, NATIONAL_LANDLORDS.map((l) => l.domain), 10),
    once("svc:landlord-contacts-v2", landlordContacts).catch(() => new Map<string, ExaResult>()),
  ]);
  const stem = muni.slice(0, 5).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mentions = (r: ExaResult) => {
    const t = `${r.url} ${r.title ?? ""} ${hl(r)}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return t.includes(stem);
  };
  const out: ServiceContact[] = [];
  for (const l of NATIONAL_LANDLORDS) {
    const hit = res.find((r) => onDomain(r.url, l.domain) && mentions(r));
    if (!hit) continue;
    const c = contacts.get(l.domain);
    const text = c ? hl(c) : "";
    out.push({
      kind: "landlord",
      group: "landlords",
      name: l.name,
      website: c?.url ?? `https://${l.domain}/`,
      phone: text.match(PHONE_RE)?.[0]?.trim(),
      email: realEmail(text.match(EMAIL_RE)?.[0]),
      note: `has rental homes listed in ${M}`,
      source: exaSource(hit, l.domain),
    });
  }
  return out;
}

// ---- Entry point ---------------------------------------------------------------------
const cache = (g as any).__moveSvcArea ?? ((g as any).__moveSvcArea = new Map<string, { at: number; p: Promise<AreaServices> }>());

export function areaServices(areaId: string, c: LatLng, municipality: string): Promise<{ data: AreaServices; cached: boolean }> {
  const muni = municipality.trim().toLowerCase();
  const key = `${c.lat.toFixed(3)},${c.lng.toFixed(3)}|${muni}`;
  const hit = cache.get(key) as { at: number; p: Promise<AreaServices> } | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.p.then((data) => ({ data: { ...data, areaId }, cached: true }));
  const p = build(areaId, c, muni);
  cache.set(key, { at: Date.now(), p });
  // Do not keep a run where every register failed.
  p.then((d) => d.contacts.length || cache.delete(key)).catch(() => cache.delete(key));
  return p.then((data) => ({ data, cached: false }));
}

async function build(areaId: string, c: LatLng, muni: string): Promise<AreaServices> {
  const t0 = Date.now();
  const used = new Set<string>();
  const unknowns: string[] = [];
  const area = areaId.replace(/^\d{5}\s*/, "").trim() || cap(muni);
  const box = <T,>(p: Promise<T>, ms: number, fallback: T, label?: string) =>
    withTimeout(p, ms).then(
      (v) => (label && (Array.isArray(v) ? v.length : v) && used.add(label), v),
      () => fallback,
    );

  const smRuns = SPECS.map((s) => box(serviceMap(s, c, muni), 8_000, null as ServiceContact[] | null));
  const exaRuns = Promise.all([
    box(once(`svc:newcomer:${muni}`, () => newcomerPages(muni)), 11_000, [] as ServiceContact[], "Exa (official sites)"),
    box(once("svc:national", nationalPages), 11_000, [] as ServiceContact[], "Exa (official sites)"),
    ["helsinki", "espoo"].includes(muni) ? Promise.resolve([] as ServiceContact[]) : box(once(`svc:muni-landlord:${muni}`, () => municipalLandlord(muni)), 11_000, [] as ServiceContact[], "Exa (official sites)"),
    box(once(`svc:nat-landlords-v2:${muni}:${area}`, () => nationalLandlords(muni, area)), 11_000, [] as ServiceContact[], "Exa (official sites)"),
  ]);
  const sm = await Promise.all(smRuns);
  const contacts: ServiceContact[] = [];
  const have = new Set<ServiceKind>();
  sm.forEach((r, i) => {
    if (r?.length) {
      used.add(SM_LABEL);
      contacts.push(...r);
      have.add(SPECS[i].kind);
    }
  });
  let missing = OSM_KINDS.filter((k) => !have.has(k));
  if (missing.some((k) => k === "daycare" || k === "school" || k === "pharmacy")) {
    const osm = await box(regionalOsm(c, missing), 1_500, [] as ServiceContact[], "OpenStreetMap");
    for (const o of osm) (contacts.push(o), have.add(o.kind));
    missing = missing.filter((k) => !have.has(k));
  }
  if (missing.length) {
    const osm = await box(overpass(c, missing), Math.max(2_000, 12_500 - (Date.now() - t0)), [] as ServiceContact[], "OpenStreetMap");
    for (const o of osm) (contacts.push(o), have.add(o.kind));
  }
  const exaOut = (await exaRuns).flat();
  for (const e of exaOut) {
    // Same page twice (DVV page found for both registration and newcomer) → keep the first.
    if (contacts.some((x) => x.website && e.website && x.website === e.website)) continue;
    contacts.push(e);
    have.add(e.kind);
  }
  for (const k of Object.keys(KIND_WORD) as ServiceKind[]) if (!have.has(k)) unknowns.push(`${KIND_WORD[k]}: not found in ${have.size ? "the registers we checked" : "any source (all unavailable)"}`);
  return { areaId, municipality: cap(muni), center: c, contacts, unknowns, sources: [...used], tookMs: Date.now() - t0, fetchedAt: new Date().toISOString() };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
