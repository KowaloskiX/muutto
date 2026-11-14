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
export type Cell = { value: string | null; status: Status; title: string };
export type Col = { key: string; label: string; crit: CriterionId; get: (a: Area) => Cell | null };

const SHORT: Partial<Record<CriterionId, string>> = {
  commute: "Commute",
  rent: "Rent level",
  pharmacy: "Pharmacy",
  grocery: "Grocery",
  cafe: "Cafés",
  school: "School",
  park: "Park",
  transit: "Stop",
  air: "Air",
  noise: "Noise",
  construction: "Works",
  traffic: "Traffic",
  safety: "Safety",
};
const ORDER: CriterionId[] = ["rent", "pharmacy", "grocery", "cafe", "school", "park", "transit", "air", "noise", "construction", "traffic", "safety"];

const fromCriterion = (a: Area, id: CriterionId): Cell | null => {
  const c = a.criteria.find((x) => x.id === id);
  if (!c) return null;
  return { value: c.status === "unknown" ? null : c.value, status: c.status, title: c.detail || c.label };
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
  const label = `${cm.estimate ? "≈" : ""}${mins(v)}`;
  const note = cm.estimate ? " (distance-based estimate)" : "";
  // Only the transit cell carries the backend's commute verdict; the car time is shown plainly.
  const status: Status = mode === "transitMin" ? (crit?.status && crit.status !== "unknown" ? crit.status : "ok") : "ok";
  return { value: label, status, title: `${mode === "transitMin" ? "Public transport" : "Car"}: ${mins(v)} to work${note}` };
};

/** Matrix columns: only criteria at least one area was measured on, in a fixed reading order. */
export function columnsFor(areas: Area[]): Col[] {
  const cols: Col[] = [];
  const hasCommute = areas.some((a) => a.commute);
  if (hasCommute) {
    cols.push({ key: "transit", label: "Transit", crit: "commute", get: (a) => commuteCell(a, "transitMin") });
    if (areas.some((a) => a.commute?.carMin != null)) cols.push({ key: "car", label: "Car", crit: "commute", get: (a) => commuteCell(a, "carMin") });
  } else if (areas.some((a) => a.criteria.some((c) => c.id === "commute"))) {
    cols.push({ key: "commute", label: "Commute", crit: "commute", get: (a) => fromCriterion(a, "commute") });
  }
  for (const id of ORDER) {
    if (!areas.some((a) => a.criteria.some((c) => c.id === id))) continue;
    cols.push({ key: id, label: SHORT[id] ?? id, crit: id, get: (a) => fromCriterion(a, id) });
  }
  return cols;
}

export const PLACE_WORD: Record<Place["kind"], string> = {
  pharmacy: "Pharmacy",
  grocery: "Grocery",
  school: "School",
  daycare: "Daycare",
  park: "Park",
  transit: "Transit stop",
  cafe: "Café",
};

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
