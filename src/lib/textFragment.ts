// URL Text Fragments (https://wicg.github.io/scroll-to-text-fragment/):
// `#:~:text=start,end` makes the browser scroll to and highlight that sentence.

const START_WORDS = 8;
const END_WORDS = 5;
const MAX_SHORT = START_WORDS + END_WORDS; // below this, match the whole snippet verbatim

/** Percent-encode per spec: encodeURIComponent plus the fragment-directive delimiters `-`, `,`, `&`. */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
}

/** Strip markdown / table syntax and pick the longest contiguous verbatim segment. */
function cleanSnippet(quote: string): string {
  const text = quote
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[“”"«»]/g, "");
  // Ellipses, pipes and line breaks mark places where the quote was stitched together; never span them.
  const segments = text
    .split(/…|\.{3,}|\||\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^[\s,;:.'’-]+|[\s,;:'’-]+$/g, ""))
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  return segments.sort((a, b) => b.length - a.length)[0] ?? "";
}

/** The `text=` directive value (already encoded), or "" when the quote is unusable. */
export function textDirective(quote?: string): string {
  if (!quote) return "";
  const snippet = cleanSnippet(quote);
  const words = snippet.split(" ").filter(Boolean);
  if (words.length < 2 && snippet.length < 8) return "";
  if (words.length <= MAX_SHORT) return enc(words.join(" "));
  return `${enc(words.slice(0, START_WORDS).join(" "))},${enc(words.slice(-END_WORDS).join(" "))}`;
}

/** Deep-link `url` to the exact sentence `quote` on the page. Returns `url` unchanged when it can't. */
export function withTextFragment(url: string, quote?: string): string {
  if (!url || !/^https?:/i.test(url)) return url;
  const directive = textDirective(quote);
  if (!directive) return url;
  const hash = url.indexOf("#");
  if (hash === -1) return `${url}#:~:text=${directive}`;
  if (url.includes(":~:", hash)) return url; // already has a fragment directive
  return `${url}:~:text=${directive}`;
}

export const JUMP_HINT = "Opens the page at this sentence";
