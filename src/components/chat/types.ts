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
  | "watch_name";

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
};

export const EMPTY_CTX: Ctx = { ranked: [], selected: [], quotes: [], watched: [] };

/** A message before it gets an id (distributes over the union). */
export type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> & { id?: string } : never) : never;
