// User-named criteria: anything the person wants near home that the built-in criteria don't
// cover ("gyms", "climbing gyms", "Lidl", "dog parks", "international schools"). For each area,
// one Exa Places search around the area centre returns real venues with coordinates, address,
// phone and rating; we keep the ones that match the request best and measure the nearest.
// Nothing is guessed: no venue within reach means "none found by Exa Places", cited as such.
import { search, type ExaTrace } from "@/lib/exa";
import type { Criterion, LatLng, MoveIntent, Place, Status } from "./types";
import { fmtM, haversineM, today } from "./util";

type Custom = NonNullable<MoveIntent["customPlaces"]>[number];
type Venue = { name: string; geo: LatLng; distanceM: number; url: string; address?: string; categories: string[]; rating?: number };

const REACH_M = 3000;
const STOP = new Set(["near", "nearby", "close", "with", "and", "the", "for", "place", "places", "good", "nice", "public", "local", "big", "small", "cheap", "decent", "of", "in"]);

/** "climbing gyms" -> "custom:climbing-gyms" */
export function customId(what: string): `custom:${string}` {
  return `custom:${what.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

/** English plural -> singular, enough for place types ("gyms", "saunas", "churches", "libraries"). */
function singular(w: string): string {
  if (w.length <= 3 || w.endsWith("ss")) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  return w.replace(/s$/, "");
}

/** Significant word stems of the request ("climbing gyms" -> ["climbing", "gym"]). */
function words(what: string): string[] {
  return what
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(singular);
}

function addressOf(a: unknown): string | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return a;
  const o = a as { street?: string; postcode?: string; locality?: string };
  return [o.street, [o.postcode, o.locality].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined;
}

async function venuesNear(query: string, c: LatLng, trace: ExaTrace[]): Promise<Venue[]> {
  const res = await search({ query, type: "lite", numResults: 10, userLocation: { country: "FI", latitude: c.lat, longitude: c.lng } }, trace);
  const out = new Map<string, Venue>();
  for (const r of res.results ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (r.entities ?? []) as any[]) {
      if (e?.type !== "place") continue;
      const p = e.properties ?? e;
      const lat = p.location?.latitude ?? p.location?.lat;
      const lng = p.location?.longitude ?? p.location?.lng;
      if (!p.name || lat == null || lng == null) continue;
      const geo = { lat, lng };
      const url = String(e.id ?? r.url);
      out.set(url, { name: String(p.name).split(/\s+[|•·]\s+/)[0].trim(), geo, distanceM: Math.round(haversineM(c, geo)), url, address: addressOf(p.address), categories: p.categories ?? [], rating: p.rating?.score });
    }
  }
  return [...out.values()];
}

/**
 * Venues that match every word of the request in their name or most specific category
 * ("Sports > Gym and Studio > Yoga Studio" counts as "Yoga Studio", not as a gym).
 */
// Holiday flats "with sauna" or "with gym" are not the venue someone asked for.
const LODGING = /accommodation|lodging|apartment|hotel|hostel|vacation|holiday|rental|real estate|bed and breakfast/i;

function matching(vs: Venue[], what: string): Venue[] {
  const ws = words(what);
  const wantsLodging = LODGING.test(what);
  vs = vs.filter((v) => wantsLodging || !v.categories.some((c) => LODGING.test(c)));
  if (!ws.length) return vs;
  return vs.filter((v) => {
    const hay = `${v.name} ${v.categories.map((c) => c.split(" > ").pop()).join(" ")}`.toLowerCase();
    return ws.every((w) => hay.includes(w));
  });
}

const band = (d: number): Status => (d <= 800 ? "good" : d <= 2000 ? "ok" : "poor");

export async function measureCustom(cp: Custom, area: { name: string; municipality: string; center: LatLng }, trace: ExaTrace[]): Promise<{ criterion: Criterion; places: Place[] }> {
  const short = area.name.split(/\s+-\s+/).pop()!.trim();
  const place = short.toLowerCase() === area.municipality.toLowerCase() ? area.municipality : `${short}, ${area.municipality}`;
  const inReach = (vs: Venue[]) => matching(vs, cp.what).filter((v) => v.distanceM <= REACH_M);
  let near: Venue[];
  try {
    // Exa Places is phrasing-sensitive and sometimes answers with web pages instead of venues, so a
    // miss is retried with the bare noun ("public saunas" -> "saunas") and then city-wide.
    // "X near <area>" and "X near me" (with the area centre as the user location) return venues most
    // reliably (measured); "X in <city>" sometimes returns only web pages.
    const bare = words(cp.what).map((w) => `${w}s`).join(" ");
    const tries = [`${cp.what} near ${short}`, `${cp.what} near me`, `${cp.what} in ${place}`, ...(bare && bare !== cp.what.toLowerCase() ? [`${bare} near me`] : [])];
    near = [];
    for (const q of tries) {
      near = inReach(await venuesNear(q, area.center, trace));
      if (near.length) break;
    }
  } catch (e) {
    return { criterion: { id: cp.id, label: cp.label, status: "unknown", value: null, detail: `Exa Places unavailable (${(e as Error).message}).`, sources: [] }, places: [] };
  }
  near.sort((a, b) => a.distanceM - b.distanceM);
  const places: Place[] = near.slice(0, 5).map((v) => ({ name: v.name, kind: "custom", geo: v.geo, distanceM: v.distanceM, url: v.url, criterion: cp.id, what: cp.label }));
  const n = near[0];
  if (!n) {
    return {
      criterion: {
        id: cp.id,
        label: cp.label,
        status: "poor",
        value: `> ${REACH_M / 1000} km`,
        detail: `Exa Places found no ${cp.what} within ${REACH_M / 1000} km of the area centre (a missing listing is not proof there is none).`,
        sources: [],
      },
      places,
    };
  }
  const within1k = near.filter((v) => v.distanceM <= 1000).length;
  return {
    criterion: {
      id: cp.id,
      label: cp.label,
      status: band(n.distanceM),
      value: fmtM(n.distanceM),
      detail: `${n.name}${n.address ? `, ${n.address}` : ""} is ${fmtM(n.distanceM)} from the area centre (straight line)${within1k > 1 ? `; ${within1k} within 1 km` : ""}.`,
      sources: near.slice(0, 3).map((v) => ({
        url: v.url,
        label: "Exa Places",
        quote: [v.name, v.address, v.categories[0]?.split(" > ").pop(), v.rating ? `rating ${v.rating}` : null, `${fmtM(v.distanceM)} away`].filter(Boolean).join(" · "),
        asOf: today(),
      })),
    },
    places,
  };
}
