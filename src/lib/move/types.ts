// Shared contract between /api/move (backend) and the /move workspace (UI).
// "Muutto" = moving: someone got a job in the Helsinki region and wants to know where to live.
// Every fact carries its source. Nothing is invented: a value we could not measure is `null`
// with a `status: "unknown"`, never a guess presented as data.

export type Status = "good" | "ok" | "poor" | "unknown";

/** One citable piece of evidence. */
export type Source = {
  url: string;
  /** Publisher/host shown in the UI, e.g. "oikotie.fi", "FMI open data", "OpenStreetMap". */
  label: string;
  /** Verbatim passage or value as the source states it. */
  quote?: string;
  /** ISO date the fact refers to or was fetched/published. */
  asOf?: string;
};

export type LatLng = { lat: number; lng: number };

/** What the user asked for, parsed. */
export type MoveIntent = {
  workAddress: string;
  work?: LatLng & { label: string };
  tenure: "rent" | "buy";
  /** Monthly rent (rent) or price (buy) ceiling in euros, if given. */
  budget?: number;
  /** Rooms or size wanted, free text like "2 rooms", "50 m²". */
  size?: string;
  household?: string; // "single", "couple", "family with 2 kids"
  /** Ordered priorities, e.g. ["short commute","quiet","pharmacy nearby","clean air","schools"]. */
  priorities: string[];
  /** Max commute the user accepts, minutes (default 35). */
  maxCommuteMin?: number;
  summary: string;
};

/** A criterion measured for an area. `id` is stable so the UI can build matrix columns. */
export type CriterionId =
  | "commute" // to the workplace
  | "rent" // typical asking rent / price level from live listings
  | "pharmacy" // nearest pharmacy
  | "grocery"
  | "school" // or daycare, depending on household
  | "park" // green space
  | "cafe" // cafés / restaurants within walking distance
  | "traffic" // car commute in rush hour vs free flow, or road congestion near the area
  | "air" // air quality
  | "noise" // traffic/rail noise level
  | "construction" // ongoing works, blasting, noise permits (news + city decisions)
  | "transit" // nearest metro/train/tram stop + public-transport commute
  | "safety"; // only if a credible public source exists; otherwise omitted

export type Criterion = {
  id: CriterionId;
  label: string; // "Commute", "Nearest pharmacy", …
  status: Status;
  /** Short display value: "18 min", "350 m", "€1,150 / 2h", "55–60 dB", "Good (AQI 1)". */
  value: string | null;
  /** One plain sentence explaining the value. */
  detail: string;
  sources: Source[];
};

export type Listing = {
  url: string;
  title: string;
  address?: string;
  price?: number; // €/month for rent, € for buy
  sizeM2?: number;
  rooms?: string; // "2h+k"
  publishedAt?: string;
  geo?: LatLng;
  source: string; // "oikotie.fi" | "vuokraovi.com" | "etuovi.com" | …
  /** Who rents/sells it, as the listing states (agency, SATO, Lumo, private), and how to reach them. */
  contact?: { name?: string; company?: string; email?: string; phone?: string; formUrl?: string; source: Source };
  /** Area id this listing belongs to. */
  areaId?: string;
  commute?: Commute;
};

/** Deep research on ONE listing / building / landlord (POST /api/move/research). Every item cited. */
export type ListingResearch = {
  listingUrl: string;
  address?: string;
  building?: { builtYear?: number; renovations: { what: string; year?: string; source: Source }[]; housingCompany?: string; notes: { text: string; source: Source }[] };
  landlord?: { name: string; kind: "agency" | "company" | "private" | "unknown"; reviews: { text: string; source: Source; tone: "neutral" | "negative" | "positive" }[]; contact?: Listing["contact"] };
  surroundings: { text: string; source: Source; tone: "neutral" | "negative" | "positive" }[]; // works, noise permits, new openings nearby
  risks: { text: string; severity: "low" | "medium" | "high"; source: Source }[];
  questions: string[]; // what to ask at the viewing, derived from findings
  steps: { label: string; detail?: string; at: number }[]; // research trace for the live UI
};

/** NDJSON from POST /api/move/research (body: { listing: Listing; intent: MoveIntent }). */
export type ResearchEvent =
  | { type: "step"; label: string; detail?: string }
  | { type: "finding"; section: "building" | "landlord" | "surroundings" | "risk"; text: string; source: Source }
  | { type: "error"; message: string }
  | { type: "done"; research: ListingResearch };

/** POST /api/move/draft (body: { listing, intent, research? }) → a viewing-request email the user approves. */
export type ViewingDraft = { to?: string; formUrl?: string; subject: string; bodyEn: string; bodyFi: string; questions: string[] };

/** POST /api/move/watch (body: { intent, areas: string[] }) → Exa Monitor for new listings in those areas. */
export type WatchResult = { id: string; mode: "live" | "polling"; areas: string[] };

export type Place = { name: string; kind: "pharmacy" | "grocery" | "school" | "daycare" | "park" | "transit" | "cafe"; geo: LatLng; distanceM: number; url?: string };

/** Travel times from an area (or listing) to the workplace, by mode. Null when not measurable. */
export type Commute = {
  transitMin: number | null; // public transport, weekday 8:30 arrival (Digitransit) — null without a key
  carMin: number | null; // car, typical
  carRushMin?: number | null; // car in morning rush, if a traffic-aware source exists
  bikeMin: number | null;
  walkMin: number | null;
  sources: Source[];
  estimate: boolean; // true = distance-based estimate, say so in the UI
};

export type Area = {
  /** Postal code + name, e.g. "00530 Kallio". */
  id: string;
  name: string;
  postalCode?: string;
  municipality: string; // Helsinki | Espoo | Vantaa | Kauniainen
  center: LatLng;
  /** 0–100 fit to the user's priorities (deterministic from criteria). */
  fit: number;
  criteria: Criterion[];
  listings: Listing[];
  places: Place[];
  /** Up to 3 recent local news / city-decision items relevant to living there. */
  news: { title: string; url: string; date?: string; quote?: string; tone: "neutral" | "negative" | "positive" }[];
  commute?: Commute;
  /** 1–3 one-line reasons, best first, each tied to a criterion. */
  why: { text: string; status: Status; criterion?: CriterionId }[];
};

/** NDJSON events streamed by POST /api/move (body: { query: string }). */
export type MoveEvent =
  | { type: "stage"; id: "understand" | "areas" | "measure" | "listings" | "rank"; status: "active" | "done"; detail?: string }
  | { type: "intent"; intent: MoveIntent }
  | { type: "areas"; areas: Pick<Area, "id" | "name" | "municipality" | "center">[] } // candidates before measuring
  | { type: "area"; area: Area } // one area fully measured (stream as each finishes)
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; ranked: Area[]; tookMs: number };
