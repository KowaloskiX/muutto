import { z } from "zod";
import { askJson } from "./llm";
import { checkQuote, type QuoteCheck, type QuoteReport } from "./quote";

export type QuoteInput = { company: string; website?: string; text: string };

export type QuoteRow = {
  company: string;
  website?: string;
  report: QuoteReport;
  total?: number;
  totalWithVat?: number;
  upfrontPct?: number;
  labourItemised: boolean;
  vat: "included" | "excluded" | "unclear";
  warranty: boolean;
  reds: number;
  yellows: number;
  score: number;
};

export type Recommendation = {
  pick: number; // index into rows, -1 if none is safe
  headline: string;
  reasons: { text: string; checkIds: string[] }[];
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
    upfrontPct: f.upfrontPct,
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
    if (r.totalWithVat != null && prices.length > 1) s -= Math.min(25, ((r.totalWithVat - min) / min) * 50);
    r.score = Math.round(s);
  }
}

const eur = (n?: number) => (n == null ? "?" : `${n.toLocaleString("fi-FI")} €`);

function ruleRecommendation(rows: QuoteRow[]): Recommendation {
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score);
  const best = order[0];
  if (!best || best.r.reds >= 2) {
    return { pick: -1, headline: "None of these quotes is safe to sign as written", reasons: [], askBeforeSigning: ["Ask every company for a staged payment schedule and itemised labour before choosing."], decidedBy: "rules" };
  }
  const r = best.r;
  const reasons: Recommendation["reasons"] = [];
  const pay = r.report.checks.find((c) => c.id.includes("payment"));
  const lab = r.report.checks.find((c) => c.id.includes("labour"));
  if (r.totalWithVat != null) reasons.push({ text: `Total ${eur(r.totalWithVat)} incl. VAT`, checkIds: [] });
  if (pay) reasons.push({ text: pay.status === "green" ? `Reasonable payment terms (${r.upfrontPct ?? 0}% upfront)` : `Payment terms: ${pay.detail}`, checkIds: [pay.id] });
  if (lab) reasons.push({ text: lab.status === "green" ? "Labour itemised, so the household tax credit can be claimed" : lab.detail, checkIds: [lab.id] });
  const ask = r.report.checks.filter((c) => c.status === "red" || c.status === "yellow").map((c) => `${c.label}: ${c.detail}`).slice(0, 3);
  return { pick: best.i, headline: `${r.company} is the safest choice`, reasons, askBeforeSigning: ask, decidedBy: "rules" };
}

const Rec = z.object({
  pick: z.number().int().describe("Index of the recommended quote, or -1 if none is safe to sign"),
  headline: z.string(),
  reasons: z.array(z.object({ text: z.string(), checkIds: z.array(z.string()).describe("ids of the checks this reason is based on") })),
  askBeforeSigning: z.array(z.string()).describe("Concrete questions to send the chosen company before signing"),
});

function digest(rows: QuoteRow[]) {
  return rows
    .map((r, i) => {
      const checks = r.report.checks.map((c: QuoteCheck) => `  - [${c.id}] ${c.status.toUpperCase()} ${c.label}: ${c.detail}`).join("\n");
      return `#${i} ${r.company}\n  total incl. VAT: ${eur(r.totalWithVat)} | upfront: ${r.upfrontPct ?? "?"}% | labour itemised: ${r.labourItemised} | VAT: ${r.vat} | warranty stated: ${r.warranty}\n${checks}`;
    })
    .join("\n\n");
}

export async function compareQuotes(inputs: QuoteInput[]): Promise<{ rows: QuoteRow[]; recommendation: Recommendation }> {
  const reports = await Promise.all(inputs.map((q) => checkQuote({ text: q.text, website: q.website })));
  const rows = inputs.map((q, i) => rowOf(q, reports[i]));
  score(rows);
  const fallback = ruleRecommendation(rows);
  try {
    const out = await askJson({
      system:
        "You help a household in Finland choose between contractor quotes. Decide only from the verified checks given; do not add facts. Safety beats price: large prepayment, missing itemised labour (no household tax credit), registry problems or complaints outweigh a small price difference. Cite the check ids each reason relies on. Write in English, short sentences.",
      user: digest(rows),
      schema: Rec,
    });
    const ids = new Set(rows.flatMap((r) => r.report.checks.map((c) => c.id)));
    const pick = out.pick >= -1 && out.pick < rows.length ? out.pick : fallback.pick;
    return {
      rows,
      recommendation: { ...out, pick, reasons: out.reasons.map((r) => ({ ...r, checkIds: r.checkIds.filter((id) => ids.has(id)) })), decidedBy: "claude" },
    };
  } catch {
    return { rows, recommendation: fallback };
  }
}
