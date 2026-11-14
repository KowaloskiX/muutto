import { z } from "zod";
import { askJson } from "./llm";
import { assertLooksLikeQuote, checkQuote, type QuoteCheck, type QuoteReport } from "./quote";

export type QuoteInput = { company: string; website?: string; text: string };

export type QuoteRow = {
  company: string;
  website?: string;
  report: QuoteReport;
  total?: number;
  totalWithVat?: number;
  totalEstimated?: boolean; // hourly quote: rate x estimated hours (+ materials)
  hourlyRate?: number;
  upfrontPct?: number; // share due before or at the start of work
  upfrontAmount?: number;
  labourItemised: boolean;
  vat: "included" | "excluded" | "unclear";
  warranty: boolean;
  reds: number;
  yellows: number;
  score: number;
};

// A reason points at the checks (and so the verbatim evidence) it rests on.
// `quoteIndex` says which quote the reason is about; older payloads lack it and
// mean the picked quote.
export type ReasonRef = { quoteIndex: number; checkId: string };
export type Reason = { text: string; checkIds: string[]; quoteIndex?: number; refs?: ReasonRef[] };

export type Recommendation = {
  pick: number; // index into rows, -1 if none is safe
  headline: string;
  reasons: Reason[];
  askBeforeSigning: string[];
  decidedBy: "claude" | "rules";
};

const VAT = 0.255;

function rowOf(input: QuoteInput, report: QuoteReport): QuoteRow {
  const f = report.facts;
  const reds = report.checks.filter((c) => c.status === "red").length;
  const yellows = report.checks.filter((c) => c.status === "yellow").length;
  const totalWithVat = f.total == null ? undefined : f.vat === "excluded" ? Math.round(f.total * (1 + VAT)) : f.total;
  return {
    company: report.company?.name ?? input.company,
    website: input.website,
    report,
    total: f.total,
    totalWithVat,
    totalEstimated: f.totalEstimated,
    hourlyRate: f.hourlyRate,
    upfrontPct: f.upfrontPct,
    upfrontAmount: f.upfrontAmount,
    labourItemised: f.labourItemised,
    vat: f.vat,
    warranty: !!f.warrantyLine,
    reds,
    yellows,
    score: 0,
  };
}

// Safety first, then price: a cheap quote with 100 % prepayment should not win.
function score(rows: QuoteRow[]) {
  const prices = rows.map((r) => r.totalWithVat).filter((p): p is number => p != null);
  const min = Math.min(...prices);
  for (const r of rows) {
    let s = 100 - r.reds * 25 - r.yellows * 6;
    if ((r.upfrontPct ?? 0) > 30) s -= 20;
    if (!r.labourItemised) s -= 10;
    if (r.totalWithVat == null) s -= 10; // no comparable price at all
    if (r.totalWithVat != null && prices.length > 1) s -= Math.min(25, ((r.totalWithVat - min) / min) * 50);
    r.score = Math.round(s);
  }
}

const eur = (n?: number) => (n == null ? "?" : `${n.toLocaleString("fi-FI")} €`);

function ruleRecommendation(rows: QuoteRow[]): Recommendation {
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score);
  const best = order[0];
  const ref = (quoteIndex: number, checkId: string): Reason => ({ text: "", checkIds: [checkId], quoteIndex, refs: [{ quoteIndex, checkId }] });
  // Why the others lost: their worst check, cited against that quote.
  const others: Reason[] = order
    .filter((o) => o !== best)
    .flatMap(({ r, i }) => {
      const worst = r.report.checks.find((c) => c.status === "red") ?? r.report.checks.find((c) => c.status === "yellow");
      return worst ? [{ ...ref(i, worst.id), text: `${r.company}: ${worst.label}. ${worst.detail}` }] : [];
    });
  if (!best || best.r.reds >= 2) {
    return { pick: -1, headline: "None of these quotes is safe to sign as written", reasons: [...(best ? [{ ...ref(best.i, (best.r.report.checks.find((c) => c.status === "red") ?? best.r.report.checks[0]).id), text: `${best.r.company} has ${best.r.reds} red flags.` }] : []), ...others], askBeforeSigning: ["Ask every company for a staged payment schedule and itemised labour before choosing."], decidedBy: "rules" };
  }
  const r = best.r;
  const reasons: Reason[] = [];
  const has = (id: string) => r.report.checks.find((c) => c.id === id);
  const pay = has("payment");
  const lab = has("labour");
  if (r.totalWithVat != null && has("vat")) reasons.push({ ...ref(best.i, "vat"), text: `Total ${r.totalEstimated ? "about " : ""}${eur(r.totalWithVat)} incl. VAT` });
  if (pay) reasons.push({ ...ref(best.i, pay.id), text: pay.status === "green" ? `Reasonable payment terms (${Math.round(r.upfrontPct ?? 0)}% before work starts)` : `Payment terms: ${pay.detail}` });
  if (lab) reasons.push({ ...ref(best.i, lab.id), text: lab.status === "green" ? "Labour itemised, so the household tax credit can be claimed" : lab.detail });
  reasons.push(...others);
  const ask = r.report.checks.filter((c) => c.status === "red" || c.status === "yellow").map((c) => `${c.label}: ${c.detail}`).slice(0, 3);
  return { pick: best.i, headline: `${r.company} is the safest choice`, reasons, askBeforeSigning: ask, decidedBy: "rules" };
}

const Rec = z.object({
  pick: z.number().int().describe("Index of the recommended quote (the number after #), or -1 if none is safe to sign"),
  headline: z.string(),
  reasons: z.array(
    z.object({
      text: z.string().describe("One short sentence. Name the company it is about."),
      quoteIndex: z.number().int().describe("Index of the quote this reason is about (the number after #)"),
      checkIds: z.array(z.string()).describe("Prefixed ids of the checks this reason is based on, exactly as listed, e.g. q1.payment"),
    }),
  ),
  askBeforeSigning: z.array(z.string()).describe("Concrete questions to send the chosen company before signing"),
});

function digest(rows: QuoteRow[]) {
  return rows
    .map((r, i) => {
      const checks = r.report.checks.map((c: QuoteCheck) => `  - [q${i}.${c.id}] ${c.status.toUpperCase()} ${c.label}: ${c.detail}`).join("\n");
      const price = `${r.totalEstimated ? "estimated " : ""}total incl. VAT: ${eur(r.totalWithVat)}${r.hourlyRate ? ` (hourly ${r.hourlyRate} €/h)` : ""}`;
      return `#${i} ${r.company}\n  ${price} | due before/at start of work: ${r.upfrontPct == null ? "?" : `${Math.round(r.upfrontPct)}%`} | labour itemised: ${r.labourItemised} | VAT: ${r.vat} | warranty stated: ${r.warranty}\n${checks}`;
    })
    .join("\n\n");
}

// Map the LLM's prefixed ids ("q1.payment") back to (quote, check) pairs and
// drop anything that does not resolve: every shown reason must cite real checks.
function resolveReasons(rows: QuoteRow[], reasons: z.infer<typeof Rec>["reasons"], pick: number): Reason[] {
  const exists = (qi: number, id: string) => qi >= 0 && qi < rows.length && rows[qi].report.checks.some((c) => c.id === id);
  const out: Reason[] = [];
  for (const r of reasons) {
    const fallbackQi = r.quoteIndex >= 0 && r.quoteIndex < rows.length ? r.quoteIndex : pick;
    const refs: ReasonRef[] = [];
    for (const raw of r.checkIds) {
      const m = raw.trim().match(/^\[?q(\d+)\.(.+?)\]?$/i);
      const ref = m ? { quoteIndex: Number(m[1]), checkId: m[2] } : { quoteIndex: fallbackQi, checkId: raw.trim() };
      if (exists(ref.quoteIndex, ref.checkId) && !refs.some((x) => x.quoteIndex === ref.quoteIndex && x.checkId === ref.checkId)) refs.push(ref);
    }
    if (!refs.length) continue;
    const quoteIndex = refs.some((x) => x.quoteIndex === fallbackQi) ? fallbackQi : refs[0].quoteIndex;
    out.push({ text: r.text, quoteIndex, refs, checkIds: refs.filter((x) => x.quoteIndex === quoteIndex).map((x) => x.checkId) });
  }
  return out;
}

export async function compareQuotes(inputs: QuoteInput[]): Promise<{ rows: QuoteRow[]; recommendation: Recommendation }> {
  inputs.forEach((q) => assertLooksLikeQuote(q.text, q.company)); // fail fast, before any paid lookup
  const reports = await Promise.all(inputs.map((q) => checkQuote({ text: q.text, website: q.website, company: q.company })));
  const rows = inputs.map((q, i) => rowOf(q, reports[i]));
  score(rows);
  const fallback = ruleRecommendation(rows);
  try {
    const out = await askJson({
      system:
        "You help a household in Finland choose between contractor quotes. Decide only from the verified checks given; do not add facts. Safety beats price: large payment due before work starts, missing itemised labour (no household tax credit), invalid or missing business ID, registry problems or complaints outweigh a small price difference. Each reason is about one quote: set quoteIndex to that quote's # number and cite the prefixed check ids (e.g. q0.payment) it relies on; include reasons explaining why the other quotes lost. Write in English, short sentences.",
      user: digest(rows),
      schema: Rec,
    });
    const pick = out.pick >= -1 && out.pick < rows.length ? out.pick : fallback.pick;
    const reasons = resolveReasons(rows, out.reasons, pick);
    if (!reasons.length) return { rows, recommendation: fallback }; // nothing citable: use the rule-based reasons
    return { rows, recommendation: { pick, headline: out.headline, reasons, askBeforeSigning: out.askBeforeSigning, decidedBy: "claude" } };
  } catch {
    return { rows, recommendation: fallback };
  }
}
