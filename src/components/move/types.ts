// UI-side state for /move. The API contract lives in src/lib/move/types.ts.
import type { Area, CriterionId, Listing, ListingResearch, MoveIntent, ResearchEvent, Source, ViewingDraft, WatchResult, WatchRuns } from "@/lib/move/types";

export type StageId = "understand" | "areas" | "measure" | "listings" | "rank";
export type StageStatus = "pending" | "active" | "done" | "failed";

export type RunState = {
  id: string;
  query: string;
  stages: Record<StageId, StageStatus>;
  details: Partial<Record<StageId, string>>;
  intent?: MoveIntent;
  candidates: Pick<Area, "id" | "name" | "municipality" | "center" | "polygon">[];
  /** Areas measured so far, in arrival order. */
  areas: Area[];
  /** Final ranking (from `done`). */
  ranked?: Area[];
  notices: string[];
  error?: string;
  finished: boolean;
  failed: boolean;
  startedAt: number;
  endedAt?: number;
  tookMs?: number;
};

export type Chip = { label: string; action: "research_best" | "watch" | "retry" | "open_file" | "tour" | "apply"; payload?: string; primary?: boolean };

export type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "bot"; kind: "welcome"; chips?: Chip[] }
  | { id: string; role: "bot"; kind: "run"; runId: string }
  | { id: string; role: "bot"; kind: "text"; text: string; tone?: "error" | "note"; chips?: Chip[]; chipsUsed?: boolean };

export type Finding = Extract<ResearchEvent, { type: "finding" }>;
export type ResearchState = {
  running: boolean;
  steps: { label: string; detail?: string }[];
  findings: Finding[];
  research?: ListingResearch;
  error?: string;
};

export type DraftState = { loading: boolean; draft?: ViewingDraft; error?: string; lang: "en" | "fi"; opened?: boolean };

export type WatchState = {
  loading: boolean;
  result?: WatchResult;
  error?: string;
  /** What the monitor has found since it was created (GET /api/move/watch?id=). */
  runs?: WatchRuns;
  checkedAt?: number;
  pollError?: string;
};

/** What the drawer shows: an area (optionally at one criterion) or a listing. */
export type View = { kind: "area"; id: string; focus?: CriterionId; n?: number } | { kind: "listing"; url: string; from?: string; focus?: "research" | "draft"; n?: number };

export type { Area, Listing, MoveIntent, Source };
