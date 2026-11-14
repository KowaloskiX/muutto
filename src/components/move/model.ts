// Display helpers for the /move workspace. Everything here formats what the API returned; nothing
// fills a gap with a guess. A missing value renders as "—" with the reason when the API gave one.
import type { Area, CriterionId, Listing, MoveIntent, Place, Status } from "@/lib/move/types";

export type Tone = "green" | "yellow" | "red" | "grey";

export const DASH = "—";

export const host = (u?: string) => {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);

export const eur = (n?: number | null) => (n == null || !Number.isFinite(n) ? null : `€${Math.round(n).toLocaleString("en-US")}`);
export const mins = (n?: number | null) => (n == null || !Number.isFinite(n) ? null : `${Math.round(n)} min`);
export const meters = (m?: number | null) => (m == null || !Number.isFinite(m) ? null : m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

export const fmtDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** Pin and dot colour from the backend's fit score (0–100). */
export const fitTone = (fit?: number | null): Tone => (fit == null ? "grey" : fit >= 70 ? "green" : fit >= 45 ? "yellow" : "red");
export const FIT_WORD: Record<Tone, string> = { green: "Strong fit", yellow: "Fair fit", red: "Weak fit", grey: "Measuring" };

export const statusTone = (s?: Status): Tone => (s === "good" ? "green" : s === "ok" ? "green" : s === "poor" ? "red" : "grey");

export const price = (l: Pick<Listing, "price">, tenure?: MoveIntent["tenure"]) => {
  const v = eur(l.price);
  if (!v) return null;
  return tenure === "buy" ? v : `${v} / mo`;
};

/** One cell of the comparison matrix. `crit` is the criterion the drawer opens at. */
export type Cell = { value: string | null; status: Status; title: string; /** number used to find the best value in a column */ n?: number };
export type ColGroup = "Commute" | "Your picks" | "Cost" | "Daily life" | "Surroundings";
export type Col = { key: string; label: string; crit: CriterionId; group: ColGroup; /** lower or higher is better; none = not compared */ better?: "low" | "high"; get: (a: Area) => Cell | null };

const SHORT: Partial<Record<CriterionId, string>> = {
  commute: "Commute",
  rent: "Rent / mo",
  pharmacy: "Pharmacy",
  grocery: "Grocery",
  cafe: "Cafés 500 m",
  school: "School",
  park: "Park",
  transit: "Stop",
  air: "Air",
  noise: "Noise",
  construction: "Works",
  traffic: "Traffic",
  safety: "Safety",
};
const GROUP: Partial<Record<CriterionId, ColGroup>> = {
  rent: "Cost",
  pharmacy: "Daily life",
  grocery: "Daily life",
  cafe: "Daily life",
  school: "Daily life",
  park: "Daily life",
  transit: "Daily life",
  air: "Surroundings",
  noise: "Surroundings",
  construction: "Surroundings",
  traffic: "Surroundings",
  safety: "Surroundings",
};
const BETTER: Partial<Record<CriterionId, "low" | "high">> = { rent: "low", pharmacy: "low", grocery: "low", cafe: "high", school: "low", park: "low", transit: "low", noise: "low", construction: "low" };
const ORDER: CriterionId[] = ["rent", "pharmacy", "grocery", "cafe", "school", "park", "transit", "air", "noise", "construction", "traffic", "safety"];

/** "1.4 km" -> 1400, "390 m" -> 390 */
const metres = (s: string) => {
  const m = s.match(/([\d.,]+)\s*(km|m)\b/);
  return m ? parseFloat(m[1].replace(",", "")) * (m[2] === "km" ? 1000 : 1) : undefined;
};
/** Compact cell text for the matrix; the full value stays in the drawer and the tooltip. */
function compact(id: CriterionId, v: string): { value: string; n?: number } {
  if (id === "rent") {
    const m = v.match(/€[\d,.]+(\/m²)?/);
    return m ? { value: m[0], n: parseFloat(m[0].replace(/[€,]/g, "")) } : { value: v };
  }
  if (id === "cafe") {
    const m = v.match(/^(\d+)/);
    return m ? { value: m[1], n: +m[1] } : { value: v };
  }
  if (id === "school") {
    const m = v.match(/school\s+([\d.,]+\s*k?m)/i) ?? v.match(/([\d.,]+\s*k?m)/);
    return m ? { value: m[1], n: metres(m[1]) } : { value: v };
  }
  if (id === "transit") {
    const m = v.match(/([\d.,]+\s*k?m)/);
    return m ? { value: m[1], n: metres(m[1]) } : { value: v };
  }
  if (id === "air") return { value: v.replace(/\s*\(.*\)$/, "") };
  if (id === "noise") {
    const m = v.match(/(\d+)\s*[–-]\s*(\d+)\s*dB/);
    return m ? { value: `${m[1]}–${m[2]} dB`, n: +m[1] } : { value: v };
  }
  if (id === "construction") {
    if (/none/i.test(v)) return { value: "0", n: 0 };
    const m = v.match(/^(\d+)/);
    return m ? { value: m[1], n: +m[1] } : { value: v };
  }
  const d = metres(v);
  return { value: v, n: d };
}

const fromCriterion = (a: Area, id: CriterionId): Cell | null => {
  const c = a.criteria.find((x) => x.id === id);
  if (!c) return null;
  if (c.status === "unknown" || !c.value) return { value: null, status: c.status, title: c.detail || c.label };
  const k = compact(id, c.value);
  return { value: k.value, n: k.n, status: c.status, title: `${c.value}. ${c.detail}` };
};

const commuteCell = (a: Area, mode: "transitMin" | "carMin"): Cell | null => {
  const cm = a.commute;
  const crit = a.criteria.find((x) => x.id === "commute");
  if (!cm) return mode === "transitMin" ? fromCriterion(a, "commute") : null;
  const v = cm[mode];
  if (v == null) {
    const why = mode === "transitMin" ? "No public-transport time was measured for this area." : "No car time was measured for this area.";
    return { value: null, status: "unknown", title: why };
  }
  const label = `${cm.estimate && mode === "transitMin" ? "≈" : ""}${mins(v)}`;
  const note = cm.estimate && mode === "transitMin" ? " (distance-based estimate)" : "";
  // Only the transit cell carries the backend's commute verdict; the car time is shown plainly.
  const status: Status = mode === "transitMin" ? (crit?.status && crit.status !== "unknown" ? crit.status : "ok") : "ok";
  return { value: label, n: v, status, title: `${mode === "transitMin" ? "Public transport" : "Car"}: ${mins(v)} to work${note}` };
};

export type Matrix = {
  cols: Col[];
  /** Criteria with the same value in every area: listed under the table instead of a column. */
  same: { label: string; value: string }[];
  /** Best value per column key (the cell to highlight), only when areas differ. */
  best: Record<string, number>;
};

/**
 * Matrix columns in reading order, grouped. Columns nobody was measured on are dropped, and a
 * criterion that reads the same everywhere moves to one line under the table: it can't help choose.
 */
export function columnsFor(areas: Area[], tenure?: MoveIntent["tenure"]): Matrix {
  const cols: Col[] = [];
  const same: Matrix["same"] = [];
  if (areas.some((a) => a.commute)) {
    cols.push({ key: "transitMin", label: "Transit", crit: "commute", group: "Commute", better: "low", get: (a) => commuteCell(a, "transitMin") });
    if (areas.some((a) => a.commute?.carMin != null)) cols.push({ key: "car", label: "Car", crit: "commute", group: "Commute", better: "low", get: (a) => commuteCell(a, "carMin") });
  } else if (areas.some((a) => a.criteria.some((c) => c.id === "commute"))) {
    cols.push({ key: "commute", label: "Commute", crit: "commute", group: "Commute", get: (a) => fromCriterion(a, "commute") });
  }
  // The user's own criteria (Exa Places) come right after commute: they asked for them by name.
  const custom = new Map<CriterionId, string>();
  for (const a of areas) for (const c of a.criteria) if (c.id.startsWith("custom:") && !custom.has(c.id)) custom.set(c.id, c.label);
  for (const [id, label] of custom) cols.push({ key: id, label, crit: id, group: "Your picks", better: "low", get: (a) => fromCriterion(a, id) });
  for (const id of ORDER) {
    const cells = areas.map((a) => fromCriterion(a, id)).filter((c): c is Cell => !!c);
    if (!cells.length || cells.every((c) => c.value == null)) continue;
    const label = id === "rent" && tenure === "buy" ? "Price" : SHORT[id] ?? id;
    if (areas.length > 2 && cells.length === areas.length && cells.every((c) => c.value != null && c.value === cells[0].value)) {
      same.push({ label, value: cells[0].value! });
      continue;
    }
    cols.push({ key: id, label, crit: id, group: GROUP[id] ?? "Surroundings", better: BETTER[id], get: (a) => fromCriterion(a, id) });
  }
  const best: Record<string, number> = {};
  for (const col of cols) {
    if (!col.better) continue;
    const ns = areas.map((a) => col.get(a)?.n).filter((n): n is number => n != null);
    if (ns.length < 2 || new Set(ns).size < 2) continue;
    best[col.key] = col.better === "low" ? Math.min(...ns) : Math.max(...ns);
  }
  return { cols, same, best };
}

// Which built-in criteria a priority phrase asks for (same reading as the backend's ranking).
const ASKS: [RegExp, CriterionId[]][] = [
  [/quiet|calm|peace|noise/i, ["noise", "construction"]],
  [/construct|works|blast/i, ["construction"]],
  [/pharmac/i, ["pharmacy"]],
  [/caf|coffee|restaurant/i, ["cafe"]],
  [/grocer|shop|supermarket/i, ["grocery"]],
  [/school|daycare|kid|child|family/i, ["school"]],
  [/park|green|nature|outdoor/i, ["park"]],
  [/air/i, ["air"]],
  [/public transport|transit|metro|train|tram/i, ["transit"]],
  [/car|drive|parking|traffic/i, ["traffic"]],
];
const DEFAULT_EXTRA: CriterionId[] = ["pharmacy", "grocery", "noise", "construction"];

/**
 * The compact view: commute, the user's own picks, cost, and the built-in criteria their request
 * asked for (topped up to four with everyday basics). The rest is one click away.
 */
export function focusCols(cols: Col[], priorities: string[] = []): Col[] {
  const asked = new Set<CriterionId>();
  for (const p of priorities) for (const [re, ids] of ASKS) if (re.test(p)) ids.forEach((id) => asked.add(id));
  for (const id of DEFAULT_EXTRA) if (asked.size < 4) asked.add(id);
  return cols.filter((c) => c.group === "Commute" || c.group === "Your picks" || c.group === "Cost" || asked.has(c.crit));
}

export const PLACE_WORD: Record<Place["kind"], string> = {
  pharmacy: "Pharmacy",
  grocery: "Grocery",
  school: "School",
  daycare: "Daycare",
  park: "Park",
  transit: "Transit stop",
  cafe: "Café",
  custom: "Your pick",
};

/** Group label for a place: the user's own criterion name for custom places. */
export const placeGroup = (p: Place) => (p.kind === "custom" ? p.what ?? PLACE_WORD.custom : PLACE_WORD[p.kind]);

/** All listings across the ranked areas, in rank order, de-duplicated by URL. */
export function allListings(areas: Area[]): { listing: Listing; area: Area; rank: number }[] {
  const seen = new Set<string>();
  const out: { listing: Listing; area: Area; rank: number }[] = [];
  areas.forEach((a, i) => {
    for (const l of a.listings) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      out.push({ listing: l, area: a, rank: i + 1 });
    }
  });
  return out;
}

export const sizeLine = (l: Listing) => [l.sizeM2 != null ? `${l.sizeM2} m²` : null, l.rooms || null].filter(Boolean).join(" · ");
