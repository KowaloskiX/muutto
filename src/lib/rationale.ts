// "Why this ranking": a fit score (0-100) and 2-4 plain-English reasons per company,
// built deterministically from the verification checks. Every reason carries the
// evidence of the check it came from, so nothing is asserted without a source.
import { z } from "zod";
import { askJson } from "./llm";
import type { Place } from "./exa";
import { withTimeout } from "./exa-grounded";
import { cached, HOUR } from "./cache";
import type { Check, CompanyReport, Evidence, Status } from "./verify";
import { fitAdjust } from "./sitefit";
import { monthYear } from "./public-wins";

export type Why = { sentence: string; status: Status; evidence: Evidence[] };
export type Ranked = { place: Place; report: CompanyReport; why: Why[]; fit: number };

const find = (r: CompanyReport, id: string) => r.checks.find((c) => c.id === id);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
// Exa's place pages carry the map listing's customer reviews; name them as such, not "exa.ai".
const sourceOf = (u: string) => (/^https?:\/\/(www\.)?exa\.ai\/library\/place\//.test(u) ? "map-listing reviews" : hostOf(u));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- fit ----------------------------------------------------------------
// Service proof weighs most: a clean company that doesn't do the job is the wrong hire.
const W = { service: 35, identity: 15, prepayment: 15, reputation: 15, rating: 10, age: 5 };
const MAX = Object.values(W).reduce((a, b) => a + b, 0);
const SHARE: Record<string, Partial<Record<Status, number>>> = {
  service: { green: 1, grey: 0, yellow: 0.3, red: 0 },
  identity: { green: 1, yellow: 0.5, grey: 0, red: 0 },
  prepayment: { green: 1, yellow: 0.3, red: 0 },
  reputation: { green: 1, grey: 0.5, yellow: 0.25, red: 0 },
  age: { green: 1, yellow: 0.4 },
};

function ratingShare(p: Place): number | null {
  if (!p.rating?.score) return null;
  const quality = Math.max(0, Math.min(1, (p.rating.score - 3) / 2)); // 3★ -> 0, 5★ -> 1
  const trust = Math.min(1, (p.rating.count || 1) / 20); // few reviews -> pulled to neutral
  return 0.5 + (quality - 0.5) * trust;
}

// ---- B2B fit -------------------------------------------------------------------
// A main contractor weighs compliance (tilaajavastuu registers) and capability
// (does the job, has the crew, real references, licence) over map ratings.
const W_B2B = { service: 25, compliance: 25, capacity: 15, references: 10, licence: 10, reputation: 10, identity: 5 };
const MAX_B2B = Object.values(W_B2B).reduce((a, b) => a + b, 0);
const PUBLIC_TV = ["tv-prepayment", "tv-employer", "tv-vat", "tv-trade-register", "tv-tax", "tv-insolvency", "tv-registers"];
const share = (s: Status | undefined, m: Partial<Record<Status, number>>, dflt: number) => (s ? m[s] ?? 0 : dflt);

export const isB2B = (r: CompanyReport) => r.audience === "b2b";

/** Public tilaajavastuu items verified green / total public items checked. */
export function complianceTally(r: CompanyReport): { ok: number; total: number; red: number; toRequest: number } {
  const pub = r.checks.filter((c) => PUBLIC_TV.includes(c.id));
  return {
    ok: pub.filter((c) => c.status === "green").length,
    total: pub.length,
    red: pub.filter((c) => c.status === "red").length,
    toRequest: r.checks.filter((c) => c.needsDocument).length,
  };
}

function fitScoreB2B(report: CompanyReport): number {
  const st = (id: string) => find(report, id)?.status;
  const pub = report.checks.filter((c) => PUBLIC_TV.includes(c.id));
  const compliance = pub.length ? pub.reduce((a, c) => a + (share(c.status, { green: 1, yellow: 0.4, grey: 0.3, red: 0 }, 0)), 0) / pub.length : 0;
  let pts =
    W_B2B.service * share(st("service"), { green: 1, yellow: 0.3 }, 0.4) +
    W_B2B.compliance * compliance +
    W_B2B.capacity * share(st("cap-capacity"), { green: 1, yellow: 0.35, grey: 0.3 }, 0.3) +
    W_B2B.references * share(st("cap-references"), { green: 1, grey: 0.5 }, 0.2) +
    // No licence check = the trade needs none: neutral rather than full marks.
    W_B2B.licence * share(st("cap-licence"), { green: 1, grey: 0.3 }, 0.7) +
    W_B2B.reputation * share(st("reputation"), { green: 1, grey: 0.5, yellow: 0.25 }, 0.5) +
    W_B2B.identity * share(st("identity"), { green: 1, yellow: 0.5 }, 0);
  if (st("tv-insolvency") === "red" || st("situation") === "red") pts -= 40;
  if (st("id-checksum") === "red") pts -= 40;
  if (st("tv-prepayment") === "red") pts -= 25;
  if (st("tv-tax") === "red") pts -= 20;
  if (st("reputation") === "red") pts -= 15;
  pts -= 3 * report.checks.filter((c) => c.id.startsWith("claim-") && c.status === "yellow").length;
  // Job search: off-trade registered line or a firm far from the site ranks lower.
  const adj = report.siteFit ? fitAdjust(report.siteFit) : 0;
  // Won public contracts in this trade (Hilma award notices): a modest bonus, never a penalty.
  const relWins = find(report, "cap-public-wins")?.wins?.items.filter((w) => w.relevant).length ?? 0;
  const winsBonus = relWins >= 2 ? 5 : relWins === 1 ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round((pts / MAX_B2B) * 100) + adj + winsBonus));
}

export function fitScore(place: Place, report: CompanyReport): number {
  if (isB2B(report)) return fitScoreB2B(report);
  let pts = 0;
  for (const id of ["service", "identity", "prepayment", "reputation", "age"] as const) {
    const c = find(report, id);
    pts += W[id] * (c ? (SHARE[id][c.status] ?? 0) : id === "reputation" ? 0.5 : 0);
  }
  pts += W.rating * (ratingShare(place) ?? 0.4);
  // Hard negatives: insolvency, fake business ID, not in prepayment register, claims that contradict the register.
  if (find(report, "situation")?.status === "red") pts -= 40;
  if (find(report, "id-checksum")?.status === "red") pts -= 40;
  if (find(report, "prepayment")?.status === "red") pts -= 10;
  if (find(report, "reputation")?.status === "red") pts -= 15;
  pts -= 3 * report.checks.filter((c) => c.id.startsWith("claim-") && c.status === "yellow").length;
  // "Verify <company>" without a job: there is no service to prove, so score on the rest.
  const max = report.domain && !find(report, "service") ? MAX - W.service : MAX;
  return Math.max(0, Math.min(100, Math.round((pts / max) * 100)));
}

// ---- reasons --------------------------------------------------------------

type Cand = Why & { weight: number };

function complaints(c: Check): { n: number; hosts: string[]; positive: number } {
  const neg = c.evidence.filter((e) => !/^positive review/i.test(e.claim ?? "") && !(c.status === "green" && !e.claim));
  const pos = c.evidence.filter((e) => /^positive review/i.test(e.claim ?? ""));
  const fromDetail = Number(/Found (\d+) issue/.exec(c.detail)?.[1] ?? NaN);
  const n = Number.isFinite(fromDetail) ? fromDetail : neg.length;
  return { n, hosts: [...new Set(neg.map((e) => sourceOf(e.url)).filter(Boolean))], positive: pos.length };
}

const DOC_SHORT: Record<string, string> = {
  "tv-pension": "TyEL certificate",
  "tv-tes": "collective agreement",
  "tv-occ-health": "occupational health",
  "tv-accident": "accident insurance",
  "tv-tax": "tax debt certificate",
  "tv-trade-register": "trade register extract",
  "tv-registers": "register extract",
  "cap-licence": "licence/certificate",
};

function candidatesB2B(r: CompanyReport, service: string): Cand[] {
  const out: Cand[] = [];
  const add = (weight: number, status: Status, sentence: string, evidence: Evidence[]) => out.push({ weight, status, sentence, evidence });
  const c = (id: string) => find(r, id);

  for (const id of ["id-checksum", "tv-insolvency", "situation", "tv-prepayment", "tv-tax"]) {
    const x = c(id);
    if (x?.status === "red") add(100, "red", x.detail.split(/(?<=\.)\s/)[0], x.evidence);
  }
  const rep = c("reputation");
  if (rep?.status === "red") add(95, "red", `Serious issues in news or reviews${complaints(rep).hosts.length ? ` (${complaints(rep).hosts.slice(0, 2).join(", ")})` : ""}`, rep.evidence);

  const svc = c("service");
  if (svc?.status === "green") add(90, "green", `Their own site covers this work (${service})`, svc.evidence);
  else if (svc) add(80, "grey", `Their site doesn't clearly mention ${service}; confirm scope`, svc.evidence);

  const cap = c("cap-capacity");
  if (cap && cap.status !== "grey") add(cap.status === "yellow" ? 85 : 75, cap.status, cap.detail.split(/(?<=\.)\s/)[0], cap.evidence);

  const t = complianceTally(r);
  const pubEv = r.checks.filter((x) => PUBLIC_TV.includes(x.id) && x.status === "green").flatMap((x) => x.evidence.slice(0, 1)).slice(0, 2);
  if (t.total && t.red === 0) {
    const missing = r.checks.filter((x) => PUBLIC_TV.includes(x.id) && x.status === "yellow");
    if (!missing.length) add(70, "green", `Tilaajavastuu public checks clear: ${t.ok} of ${t.total} (tax registers, trade register${find(r, "tv-tax")?.status === "green" ? ", no tax debt" : ""}, no insolvency)`, pubEv);
    else {
      // Registers the company is simply not listed in read better as one short line than as the first check's detail.
      const notListed = missing.filter((x) => /not listed/i.test(x.detail)).map((x) => x.label.replace(/^Tilaajavastuu: /, "").replace(/ register$/, ""));
      const sentence = notListed.length
        ? `Not in the ${notListed.join(" or ")} register${notListed.length > 1 ? "s" : ""}: ask why before signing`
        : `${missing[0].label.replace(/^Tilaajavastuu: /, "")}: ${missing[0].detail.split(/(?<=\.)\s/)[0]}`;
      add(78, "yellow", sentence, missing[0].evidence);
    }
  }

  const refs = c("cap-references");
  if (refs?.status === "green") add(72, "green", refs.detail, refs.evidence);
  else if (refs && refs.evidence.length) add(40, "grey", refs.detail.split(/(?<=\.)\s/)[0], refs.evidence);

  const pw = c("cap-public-wins");
  const wins = pw?.status === "green" ? pw.wins : undefined;
  if (pw && wins?.items.length) {
    const rel = wins.items.filter((w) => w.relevant);
    const shown = rel.length ? rel : wins.items;
    const latest = shown[0];
    const meta = [monthYear(latest.date) && `latest ${monthYear(latest.date)}`, latest.buyer].filter(Boolean).join(", ");
    const kind = rel.length && wins.tradeLabel ? `${wins.tradeLabel} ` : "";
    const ev = pw.evidence.filter((e) => shown.some((w) => w.url === e.url));
    add(rel.length ? 74 : 52, "green", `Won ${plural(shown.length, `public ${kind}contract`)} in Hilma${meta ? ` (${meta})` : ""}`, ev);
  }

  const lic = c("cap-licence");
  if (lic?.status === "green") add(68, "green", lic.detail.split(/(?<=\.)\s/)[0], lic.evidence);
  else if (lic) add(66, "grey", lic.detail.split(/(?<=;)\s|(?<=\.)\s/)[0].replace(/;$/, ""), lic.evidence);

  const lk = c("tv-reliable-partner");
  if (lk) add(60, "green", "Luotettava Kumppani member: one Tilaajavastuu report covers the documents", lk.evidence);

  // Trade and locality fit from the trade register (job search only).
  const sf = r.siteFit;
  if (sf) {
    const regEv: Evidence[] = r.businessId
      ? [{ url: `https://tietopalvelu.ytj.fi/yritys/${r.businessId}`, quote: [r.registry?.mainBusinessLine, ...(r.registry?.addresses ?? []).slice(0, 2)].filter(Boolean).join(" · "), source: "registry" }]
      : [];
    const m = sf.tradeLine?.match;
    const line = sf.tradeLine?.label;
    if (m === "off" && sf.textTrade < 2) add(88, "yellow", `Registered line of business is "${line}", not this trade; confirm they do ${service} with their own crew`, regEv);
    else if (m === "general" && sf.textTrade < 2) add(84, "yellow", `Registered as a general building contractor ("${line}"): likely to subcontract ${service} onwards`, regEv);
    else if (m === "trade") add(62, "green", `Registered line of business matches the trade: ${line}`, regEv);
    const where = sf.municipality ? `Registered address in ${sf.municipality}` : "Map listing";
    const postal = sf.postalMunicipality ? ` (postal address ${sf.postalMunicipality})` : "";
    if (sf.local === "far" && sf.distanceKm != null)
      add(
        86,
        "yellow",
        `${where}${postal}, about ${sf.distanceKm} km from the site${sf.servesArea === "area" ? "; their site names the area as served" : sf.servesArea === "nationwide" ? "; they say they work nationwide" : ": ask whether they cover this site"}`,
        regEv,
      );
    else if (sf.local === "near" && sf.distanceKm != null) add(56, "green", `${where}${postal}, ${sf.distanceKm < 15 ? "in the site's area" : `about ${sf.distanceKm} km from the site`}`, regEv);
    else if (sf.local === "region" && sf.distanceKm != null) add(46, "grey", `${where}${postal}, about ${sf.distanceKm} km from the site`, regEv);
  }

  const docs = r.checks.filter((x) => x.needsDocument);
  if (docs.length)
    add(
      50,
      "grey",
      `Request before signing: ${[...new Set(docs.map((d) => DOC_SHORT[d.id] ?? d.label))].slice(0, 4).join(", ")}`,
      docs.flatMap((d) => d.evidence.slice(0, 1)).slice(0, 2),
    );
  if (rep?.status === "yellow") add(64, "yellow", `Some complaints found${complaints(rep).hosts.length ? ` on ${complaints(rep).hosts.slice(0, 2).join(" and ")}` : ""}`, rep.evidence);
  return out.sort((a, b) => b.weight - a.weight);
}

function candidates(place: Place, r: CompanyReport, service: string): Cand[] {
  if (isB2B(r)) return candidatesB2B(r, service);
  const out: Cand[] = [];
  const add = (weight: number, status: Status, sentence: string, evidence: Evidence[]) => out.push({ weight, status, sentence, evidence });

  const checksum = find(r, "id-checksum");
  if (checksum?.status === "red") add(100, "red", checksum.detail, checksum.evidence);
  const sit = find(r, "situation");
  if (sit?.status === "red") add(100, "red", sit.detail.replace(/ \(e\.g\.[^)]*\)/, ""), sit.evidence);

  const svc = find(r, "service");
  if (svc?.status === "green") add(90, "green", `Their own site covers this job (${service})`, svc.evidence);
  else if (svc) add(80, "grey", `Their site doesn't clearly mention this job (${service}); ask before booking`, svc.evidence);

  const pre = find(r, "prepayment");
  const household = r.householdWork ?? pre?.label === "Household tax credit";
  if (household) {
    if (pre?.status === "green") add(70, "green", "In the prepayment register, so the household tax credit applies", pre.evidence);
    else if (pre?.status === "red") add(95, "red", "Not in the prepayment register: the household tax credit can be refused", pre.evidence);
  } else if (pre?.status === "green") add(30, "green", "Registered in the tax prepayment register", pre.evidence);
  else if (pre && pre.status !== "grey") add(62, "yellow", "Not in the tax prepayment register; ask why before paying upfront", pre.evidence);

  const rep = find(r, "reputation");
  if (rep) {
    const { n, hosts, positive } = complaints(rep);
    const where = hosts.length ? ` on ${hosts.slice(0, 2).join(" and ")}` : "";
    const bankrupt = rep.evidence.some((e) => /^bankruptcy/i.test(e.claim ?? ""));
    if (rep.status === "red" && bankrupt) add(96, "red", `Bankruptcy or insolvency reported${where}`, rep.evidence);
    else if (rep.status === "red") add(92, "red", `Serious complaints found: ${plural(n || 1, "issue")}${where}`, rep.evidence);
    else if (rep.status === "yellow")
      add(65, "yellow", `${positive ? "Mixed reviews" : "Some complaints"}: ${plural(n || 1, "complaint")}${where}`, rep.evidence);
    else if (rep.status === "green") {
      const src = [...new Set(rep.evidence.map((e) => sourceOf(e.url)).filter(Boolean))];
      add(55, "green", `Reviews and news found are positive or neutral${src.length ? ` (${src.slice(0, 2).join(", ")})` : ""}`, rep.evidence);
    } else add(20, "grey", "No reviews or news found that are clearly about them", rep.evidence);
  }

  if (place.rating?.score) {
    const { score, count } = place.rating;
    const status: Status = count >= 5 && score >= 4.3 ? "green" : score < 3.8 ? "yellow" : "grey";
    const ev: Evidence[] = place.placeUrl && /^https?:/.test(place.placeUrl) ? [{ url: place.placeUrl, quote: `${score}★ (${count})`, source: "web", via: "Exa Places" }] : [];
    add(status === "green" ? 50 : status === "yellow" ? 60 : 30, status, `Rated ${score.toFixed(1)}★ from ${plural(count, "review")} on their map listing`, ev);
  }

  const id = find(r, "identity");
  if (id?.status === "green") add(45, "green", `Business ID ${r.businessId} on their site matches the trade register`, id.evidence);
  else if (id?.status === "yellow" && !r.businessId)
    add(
      60,
      "yellow",
      /^Business ID \d/.test(id.detail)
        ? "Their business ID isn't in the open trade register (likely a sole trader); ask for a register extract"
        : "No business ID on their site and no register match; ask for it before paying",
      id.evidence,
    );
  else if (id?.status === "yellow") add(35, "yellow", `Registered as ${r.registry?.name ?? r.name} (${r.businessId}), but site and register don't fully match`, id.evidence);

  const age = find(r, "age");
  const year = r.registry?.registrationDate?.slice(0, 4);
  if (age && year) {
    const yrs = new Date().getFullYear() - Number(year);
    add(age.status === "yellow" ? 55 : yrs >= 10 ? 40 : 25, age.status, age.status === "yellow" ? "Registered less than a year ago" : `In business since ${year} (${plural(yrs, "year")})`, age.evidence);
  }

  const bad = r.checks.filter((c) => c.id.startsWith("claim-") && c.status === "yellow");
  if (bad.length) add(58, "yellow", `Their site claims "${bad[0].label}", which doesn't match the register`, bad[0].evidence);

  return out.sort((a, b) => b.weight - a.weight);
}

// Something only the #1 company has, relative to the rest of the shortlist.
function comparative(list: Ranked[], service: string): Why | null {
  if (list.length < 2) return null;
  const [top, second] = list;
  const n = list.length;
  if (isB2B(top.report)) {
    const ev = (id: string) => find(top.report, id)?.evidence ?? [];
    const only = (id: string) => find(top.report, id)?.status === "green" && list.filter((x) => find(x.report, id)?.status === "green").length === 1;
    if (only("cap-references")) return { sentence: `Only candidate of ${n} with a reference confirmed by an independent source`, status: "green", evidence: ev("cap-references") };
    if (only("cap-licence")) return { sentence: `Only candidate of ${n} whose site shows the relevant licence or certificate`, status: "green", evidence: ev("cap-licence") };
    if (only("service")) return { sentence: `Only candidate of ${n} whose own site mentions ${service}`, status: "green", evidence: ev("service") };
    return null;
  }
  const has = (x: Ranked, id: string, s: Status = "green") => find(x.report, id)?.status === s;
  const ev = (id: string) => find(top.report, id)?.evidence ?? [];
  if (has(top, "service") && list.filter((x) => has(x, "service")).length === 1)
    return { sentence: `Only company of ${n} whose own site mentions ${service}`, status: "green", evidence: ev("service") };
  if (has(top, "prepayment") && list.filter((x) => has(x, "prepayment")).length === 1)
    return { sentence: `Only company of ${n} confirmed in the prepayment register`, status: "green", evidence: ev("prepayment") };
  const flags = (x: Ranked) => x.report.checks.filter((c) => c.status === "red" || (c.id === "reputation" && c.status === "yellow")).length;
  if (flags(top) === 0 && flags(second) > 0)
    return { sentence: `No red flags, unlike #2 ${second.report.name} (${plural(flags(second), "warning")})`, status: "green", evidence: ev("reputation").length ? ev("reputation") : ev("identity") };
  if (has(top, "service") && has(second, "service") && top.fit - second.fit >= 10) {
    const better = (["prepayment", "identity", "reputation"] as const).find((id) => has(top, id) && !has(second, id));
    if (better) {
      const what = { prepayment: "prepayment-register status", identity: "verified business ID", reputation: "cleaner reviews" }[better];
      return { sentence: `Ahead of #2 ${second.report.name} on ${what}`, status: "green", evidence: ev(better) };
    }
  }
  return null;
}

/** Score, sort and explain. Input must already be de-duplicated. */
export function buildRanking(items: { place: Place; report: CompanyReport }[], serviceName: string): Ranked[] {
  // "Pipe relining" -> "pipe relining" mid-sentence (keep acronyms like "LVI").
  const service = /^[A-Z][a-z]/.test(serviceName) ? serviceName[0].toLowerCase() + serviceName.slice(1) : serviceName;
  const list: Ranked[] = items.map(({ place, report }) => ({ place, report, fit: fitScore(place, report), why: [] }));
  // Ties break on the domain, never on which check happened to finish first.
  const id = (x: Ranked) => x.report.domain ?? x.report.name;
  list.sort((a, b) => b.fit - a.fit || b.report.score - a.report.score || id(a).localeCompare(id(b)));
  list.forEach((x, i) => {
    const cands = candidates(x.place, x.report, service);
    const why: Why[] = cands.slice(0, 3).map(({ sentence, status, evidence }) => ({ sentence, status, evidence }));
    if (i === 0) {
      const cmp = comparative(list, service);
      if (cmp && !why.some((w) => w.sentence === cmp.sentence)) why.splice(1, 0, cmp);
    }
    if (why.length < 2 && cands[why.length]) why.push(cands[why.length]);
    x.why = why.slice(0, 4);
  });
  return list;
}

// ---- optional polish ------------------------------------------------------
const Polished = z.object({ items: z.array(z.object({ i: z.number(), sentences: z.array(z.string()) })) });
const TERMS = [/tilaajavastuu/i, /\bTyEL\b/, /\bTukes\b/, /luotettava kumppani/i, /ennakkoperintä/i];
const facts = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?|[a-z0-9-]+\.[a-z]{2,}/gi) ?? []).map((x) => x.toLowerCase()));

/**
 * Let Claude smooth the wording. Guarded: same number of sentences, and every
 * number / domain in a rewrite must already be in the original sentence, else keep the original.
 */
export async function polishWhy(list: Ranked[], ms = 9000): Promise<Ranked[]> {
  if (!process.env.OPENAI_API_KEY || !list.length) return list;
  try {
    const user = JSON.stringify(list.map((x, i) => ({ i, company: x.report.name, sentences: x.why.map((w) => w.sentence) })));
    // Same reasons in -> same wording out (the rewrite is cosmetic; don't let it vary between runs).
    const { value: out } = await withTimeout(
      cached("polish", user, 6 * HOUR, () => askJson({
        system:
          "Rewrite short reasons shown next to a ranking of businesses (for a consumer hiring locally, or a main contractor vetting construction subcontractors). Keep Finnish legal and register terms (tilaajavastuu, TyEL, Tukes, Luotettava Kumppani) as written. Never mention tax credits unless the original sentence does. Keep comparisons exact: 'Only company of 4 confirmed in X' means this company is the single one of the 4 with X. Keep each reason's meaning, keep every number, company name and website exactly, add no new facts, max 14 words each, plain English, no exclamation marks. Return the same number of sentences per item in the same order.",
        user,
        schema: Polished,
      })),
      ms,
      "LLM polish",
    );
    return list.map((x, i) => {
      const p = out.items.find((it) => it.i === i);
      if (!p || p.sentences.length !== x.why.length) return x;
      const why = x.why.map((w, j) => {
        const s = p.sentences[j]?.trim();
        if (!s) return w;
        const orig = facts(w.sentence);
        // Legal/register terms must survive verbatim (the model once wrote "Tilaavastuu").
        const termsKept = TERMS.every((t) => !t.test(w.sentence) || t.test(s));
        return termsKept && [...facts(s)].every((f) => orig.has(f)) ? { ...w, sentence: s } : w;
      });
      return { ...x, why };
    });
  } catch {
    return list;
  }
}
