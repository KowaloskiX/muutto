// Wire types for POST /api/agent (NDJSON stream, one JSON event per line).

export type Via = "exa.search" | "exa.contents" | "exa.places" | "exa.agent";

/** One retrieved document. `text` is the verbatim text Exa returned (highlights or page text). */
export type Evidence = {
  id: string; // "e1", "e2", ... stable across turns (kept in state)
  url: string;
  title?: string;
  date?: string;
  text: string;
  via: Via;
};

export type ActionKind = "email" | "letter" | "calendar" | "booking_link" | "call_script" | "watch" | "form_link";

export type AgentAction = {
  id: string;
  kind: ActionKind;
  title: string;
  /** Kind-specific; see README in route.ts. Always includes `basedOn` (evidence the proposal rests on). */
  payload: Record<string, unknown>;
  requiresApproval: true;
};

export type Source = { n: number; id: string; url: string; title?: string; quote?: string; via: Via };

export type AgentState = {
  evidence: Evidence[];
  actions: { id: string; kind: ActionKind; title: string }[];
  turns: number;
};

export type AgentEvent =
  | { type: "plan"; steps: string[] }
  | { type: "step"; id: string; status: "running" | "done" | "error"; label: string; tool: string; detail?: string }
  | { type: "evidence"; items: { id: string; url: string; title?: string; quote: string; via: Via; date?: string }[] }
  | {
      type: "message";
      text: string;
      sources: Source[];
      kind: "answer" | "clarify";
      /** What the grounding guard removed (citations to unknown ids, links never retrieved, non-verbatim quotes). */
      guard?: { droppedMarkers: string[]; droppedLinks: string[]; droppedQuotes: number };
    }
  | { type: "action"; action: AgentAction }
  | { type: "handoff"; to: "contractors"; query: string }
  | { type: "done"; state: AgentState; stats: { rounds: number; ms: number; exaCalls: number } }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant" | "bot"; content: string };

export const emptyState = (): AgentState => ({ evidence: [], actions: [], turns: 0 });
