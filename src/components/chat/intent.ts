// Shared by the chat client and /api/chat-route.
export const INTENTS = [
  "find_contractor", // a job to find companies for (new search or a refinement of the last one)
  "check_company", // verify one named company / website / business ID
  "company_detail", // show everything we know about a shortlisted company
  "about_shortlist", // a question answered from the shortlist / quotes already on screen
  "request_quotes", // draft quote requests to shortlisted companies
  "check_quote", // the message is (or asks to check) a contractor quote
  "compare_quotes",
  "watch",
  "unwatch",
  "errand", // an in-scope question/task (deposits, contracts, complaints, tax credit...): streamed from /api/agent
  "start_over",
  "smalltalk",
  "out_of_scope", // anything not about hiring/paying a contractor: friendly redirect + examples
] as const;
export type ChatIntent = (typeof INTENTS)[number];

export type RouteArgs = {
  query?: string;
  /** The job in a few words, in the user's language (for progress messages). */
  jobLabel?: string;
  company?: string;
  refs?: number[];
  target?: string;
  /** errand: a web search query, used only if /api/agent is unavailable (falls back to /api/ask). */
  searchQuery?: string;
  finland?: boolean;
};

export type RouteOut = {
  intent: ChatIntent;
  lang: string;
  args: RouteArgs;
  reply?: string;
  /** about_shortlist: answer built from the on-screen data, cited [n] against `sources`. */
  answer?: string;
  sources?: { n: number; url: string; quote?: string }[];
  by: "llm" | "keywords";
};

/** Last-resort fallback when the LLM router is unreachable: only the obvious cases. */
export function keywordIntent(text: string): ChatIntent {
  const t = text.toLowerCase();
  if (text.length > 220 && /tarjous|urakka|y-tunnus|alv|€|eur\b|quote/i.test(text)) return "check_quote";
  if (/\b(compare|vertaa|which quote)\b/.test(t)) return "compare_quotes";
  if (/\b(stop watching|unwatch|lopeta seuranta)\b/.test(t)) return "unwatch";
  if (/\b(watch|monitor|keep an eye|seuraa)\b/.test(t)) return "watch";
  if (/\b(start over|reset|alusta)\b/.test(t)) return "start_over";
  // Only a named trade goes to the contractor search; everything else is a general errand.
  if (
    /\b(contractor|plumber|electrician|painter|cleaner|mover|carpenter|roofer|tiler|handyman|reline|relining|renovat)\w*/.test(t) ||
    /putki|sähkö|remontti|muutto|siivous|maalari|lvi|kirvesmies|katto/.test(t)
  )
    return "find_contractor";
  if (/^(hi|hello|hey|thanks|thank you|moi|hei|kiitos|terve)\b[\s!.]*$/.test(t.trim())) return "smalltalk";
  return "errand";
}
