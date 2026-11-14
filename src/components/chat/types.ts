import type { Ranked } from "@/lib/rationale";
import type { QuoteRow, Recommendation, QuoteInput } from "@/lib/compare";
import type { QuoteReport } from "@/lib/quote";

export type Source = { url: string; quote?: string; n?: number; title?: string };

export type Action =
  | "example"
  | "ask_top3"
  | "pick_myself"
  | "draft_selected"
  | "not_now"
  | "paste_another"
  | "compare_now"
  | "hire"
  | "not_yet"
  | "find_again"
  | "watch_name"
  | "retry_errand";

export type Chip = { label: string; action: Action; payload?: string; primary?: boolean };

export type Draft = {
  name: string;
  email?: string;
  subject: string;
  bodyFi: string;
  bodyEn: string;
  lang: "en" | "fi";
  editing?: boolean;
  edited?: string;
  sent?: boolean;
};

// ---- general errands: events from /api/agent (NDJSON) ----------------------------
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";
/** One tool call the agent made (live: running -> done/failed). */
export type PlanStep = { id: string; label: string; status: StepStatus; tool?: string; detail?: string };
export type Evidence = { id?: string; url: string; title?: string; quote?: string; via?: string };
export type ActionKind = "email" | "letter" | "calendar" | "booking_link" | "call_script" | "watch" | "form_link";
export type AgentAction = { id: string; kind: ActionKind; title: string; payload: Record<string, unknown>; requiresApproval?: boolean };
/** pending until the user clicks; never shown as done before that. */
export type ActionStatus = "pending" | "done" | "failed";
export type ActionEdit = { to?: string; subject?: string; body?: string };

type Base = { id: string; chips?: Chip[]; chipsUsed?: boolean };

export type Msg = Base &
  (
    | { role: "user"; kind: "text"; text: string; attachment?: string }
    | { role: "bot"; kind: "text"; text: string; sources?: Source[]; tone?: "progress" | "error" | "success"; exa?: boolean; note?: string }
    | { role: "bot"; kind: "checking"; items: { name: string; domain: string; status: "scanning" | "done" | "failed" }[] }
    | { role: "bot"; kind: "company"; item: Ranked; rank: number }
    | { role: "bot"; kind: "detail"; item: Ranked; rank?: number }
    | { role: "bot"; kind: "draft"; draft: Draft }
    | { role: "bot"; kind: "quoteCheck"; company: string; report: QuoteReport }
    | { role: "bot"; kind: "compare"; rows: QuoteRow[]; recommendation: Recommendation }
    | { role: "bot"; kind: "watch"; name: string; domain?: string; monitorId?: string; mode?: string }
    | { role: "bot"; kind: "welcome"; text: string }
    | { role: "bot"; kind: "plan"; plan?: string[]; steps: PlanStep[]; evidence: Evidence[]; finished?: boolean; failed?: boolean; exaCalls?: number }
    | { role: "bot"; kind: "action"; action: AgentAction; status: ActionStatus; edit?: ActionEdit; editing?: boolean; result?: string }
  );

export type Ctx = {
  job?: string;
  city?: string;
  ranked: Ranked[];
  selected: string[]; // company keys picked by hand
  quotes: QuoteInput[];
  pick?: { name: string; domain?: string };
  hired?: string;
  /** The search text that produced `ranked` (for follow-ups like "Tampere instead"). */
  lastQuery?: string;
  /** Language of the conversation (ISO 639-1), from the router. */
  lang?: string;
  /** Last company checked on its own ("check this company: ..."). */
  checked?: Ranked;
  comparison?: { headline: string; pick?: string; rows: { company: string; total?: number; upfrontPct?: number; reds: number; yellows: number }[]; reasons: string[] };
  watched: { name: string; domain?: string; monitorId: string }[];
  /** Opaque state returned by /api/agent on `done`, sent back with the next errand turn. */
  agentState?: unknown;
  /** The errand in progress (for the router: follow-ups like "AY1234" or "yes, do it" belong to it). */
  errand?: { topic: string; last?: string };
};

export const EMPTY_CTX: Ctx = { ranked: [], selected: [], quotes: [], watched: [] };

/** A message before it gets an id (distributes over the union). */
export type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> & { id?: string } : never) : never;
