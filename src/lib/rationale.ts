// "Why this ranking": a fit score (0-100) and 2-4 plain-English reasons per company,
// built deterministically from the verification checks. Every reason carries the
// evidence of the check it came from, so nothing is asserted without a source.
import { z } from "zod";
import { askJson } from "./llm";
import type { Place } from "./exa";
import { withTimeout } from "./exa-grounded";
import type { Check, CompanyReport, Evidence, Status } from "./verify";

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

export function fitScore(place: Place, report: CompanyReport): number {
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

function candidates(place: Place, r: CompanyReport, service: string): Cand[] {
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
  list.sort((a, b) => b.fit - a.fit || b.report.score - a.report.score);
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
const facts = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?|[a-z0-9-]+\.[a-z]{2,}/gi) ?? []).map((x) => x.toLowerCase()));

/**
 * Let Claude smooth the wording. Guarded: same number of sentences, and every
 * number / domain in a rewrite must already be in the original sentence, else keep the original.
 */
export async function polishWhy(list: Ranked[], ms = 9000): Promise<Ranked[]> {
  if (!process.env.OPENAI_API_KEY || !list.length) return list;
  try {
    const out = await withTimeout(
      askJson({
        system:
          "Rewrite short reasons a customer sees next to a ranking of local businesses. Never mention tax credits unless the original sentence does. Keep comparisons exact: 'Only company of 4 confirmed in X' means this company is the single one of the 4 with X. Keep each reason's meaning, keep every number, company name and website exactly, add no new facts, max 14 words each, plain English, no exclamation marks. Return the same number of sentences per item in the same order.",
        user: JSON.stringify(list.map((x, i) => ({ i, company: x.report.name, sentences: x.why.map((w) => w.sentence) }))),
        schema: Polished,
      }),
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
        return [...facts(s)].every((f) => orig.has(f)) ? { ...w, sentence: s } : w;
      });
      return { ...x, why };
    });
  } catch {
    return list;
  }
}
