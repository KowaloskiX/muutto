// Deterministic fit score (0–100) and "why" lines. Each criterion's status is mapped to a
// score; weights follow the user's priority order (first priority weighs most). Unknown
// criteria are left out of the average (we don't reward or punish what we couldn't measure)
// but a weight-share of unknowns caps the score slightly so a half-measured area can't top
// a fully measured one on luck.
import type { Area, Criterion, CriterionId, MoveIntent, Status } from "./types";

const SCORE: Record<Status, number> = { good: 1, ok: 0.6, poor: 0.15, unknown: 0 };

const MAP: [RegExp, CriterionId[]][] = [
  [/commut|close to work|near work|travel/i, ["commute"]],
  [/public transport|transit|metro|train|tram/i, ["transit", "commute"]],
  [/quiet|calm|peace|noise/i, ["noise", "construction"]],
  [/construct|works|blast/i, ["construction"]],
  [/pharmac/i, ["pharmacy"]],
  [/caf|coffee|restaurant/i, ["cafe"]],
  [/grocer|shop|supermarket/i, ["grocery"]],
  [/school|daycare|kid|child|family/i, ["school"]],
  [/park|green|nature|outdoor/i, ["park"]],
  [/air/i, ["air"]],
  [/rent|budget|cheap|afford|price/i, ["rent"]],
  [/car|drive|parking|traffic/i, ["traffic"]],
];

export function weights(intent: MoveIntent): Map<CriterionId, number> {
  const w = new Map<CriterionId, number>();
  intent.priorities.forEach((p, i) => {
    const wt = Math.max(1, 6 - i); // 6, 5, 4, ...
    for (const [re, ids] of MAP) if (re.test(p)) ids.forEach((id) => w.set(id, Math.max(w.get(id) ?? 0, wt)));
  });
  if (!w.has("commute")) w.set("commute", 5);
  // Places the user named themselves ("a gym nearby") weigh like a top-three priority.
  intent.customPlaces?.forEach((c, i) => w.set(c.id, c.weight ?? Math.max(3, 5 - i)));
  if (intent.budget && !w.has("rent")) w.set("rent", 4);
  // Everything else still counts a little.
  for (const id of ["transit", "pharmacy", "grocery", "cafe", "school", "park", "air", "noise", "construction", "traffic", "rent"] as CriterionId[]) if (!w.has(id)) w.set(id, 1);
  return w;
}

export function fitScore(criteria: Criterion[], w: Map<CriterionId, number>): number {
  let sum = 0;
  let tot = 0;
  let unknownW = 0;
  for (const c of criteria) {
    const wt = w.get(c.id) ?? 1;
    if (c.status === "unknown") {
      unknownW += wt;
      continue;
    }
    sum += wt * SCORE[c.status];
    tot += wt;
  }
  if (!tot) return 0;
  const base = sum / tot;
  const coverage = tot / (tot + unknownW);
  return Math.round(100 * base * (0.85 + 0.15 * coverage));
}

export function whyLines(criteria: Criterion[], w: Map<CriterionId, number>): Area["why"] {
  const known = criteria.filter((c) => c.status !== "unknown" && c.value);
  const strong = known.filter((c) => c.status === "good").sort((a, b) => (w.get(b.id) ?? 1) - (w.get(a.id) ?? 1));
  const weak = known.filter((c) => c.status === "poor").sort((a, b) => (w.get(b.id) ?? 1) - (w.get(a.id) ?? 1));
  const line = (c: Criterion) => ({ text: `${c.label}: ${c.value}`, status: c.status, criterion: c.id });
  const out = strong.slice(0, 2).map(line);
  if (weak[0] && (w.get(weak[0].id) ?? 1) >= 3) out.push(line(weak[0]));
  else if (strong[2]) out.push(line(strong[2]));
  if (!out.length && known[0]) out.push(line(known[0]));
  return out.slice(0, 3);
}

export function rankAreas(areas: Area[]): Area[] {
  return [...areas].sort((a, b) => b.fit - a.fit);
}
