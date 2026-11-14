// Shared by the chat client and /api/chat-route: keyword fallback for intent routing.
export const INTENTS = ["find_contractor", "check_quote", "compare_quotes", "watch", "smalltalk"] as const;
export type ChatIntent = (typeof INTENTS)[number];

/** Deterministic fallback so the chat still works with no LLM. */
export function keywordIntent(text: string): ChatIntent {
  const t = text.toLowerCase();
  if (text.length > 220 && /tarjous|urakka|y-tunnus|alv|€|eur\b|quote/i.test(text)) return "check_quote";
  if (/\b(compare|vertaa|which quote|which one)\b/.test(t)) return "compare_quotes";
  if (/\b(watch|monitor|keep an eye|seuraa)\b/.test(t)) return "watch";
  if (/\b(check|tarkista)\b.*\b(quote|tarjous)\b/.test(t)) return "check_quote";
  if (
    /\b(need|find|looking for|someone|company|contractor|plumber|electrician|painter|cleaner|mover|fix|install|repair|reline|renovat|etsi|tarvitsen)\w*/.test(t) ||
    /putki|sähkö|remontti|muutto|siivous|maalari|lvi/.test(t)
  )
    return "find_contractor";
  return "smalltalk";
}

