// Finnish business ID (Y-tunnus): 7 digits + check digit, e.g. "3502206-6".
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2];

export function normalizeYTunnus(raw: string): string | null {
  const m = raw.replace(/\s/g, "").match(/^(\d{6,7})-?(\d)$/);
  if (!m) return null;
  return `${m[1].padStart(7, "0")}-${m[2]}`;
}

export function isValidYTunnus(raw: string): boolean {
  const id = normalizeYTunnus(raw);
  if (!id) return false;
  const digits = id.slice(0, 7).split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i], 0);
  const rem = sum % 11;
  if (rem === 1) return false;
  const check = rem === 0 ? 0 : 11 - rem;
  return check === Number(id[8]);
}

// Find checksum-valid business IDs in free text (footer, contact page, quote).
// Bank accounts / phone numbers rarely pass the checksum, which filters most noise.
export function extractYTunnukset(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\d-])(\d{7})\s?-\s?(\d)(?![\d-])/g)) {
    const id = `${m[1]}-${m[2]}`;
    if (isValidYTunnus(id)) found.add(id);
  }
  return [...found];
}

/** The check digit a 7-digit base must have, or null when no valid ID can start with it (remainder 1). */
export function expectedCheckDigit(raw: string): number | null {
  const base = raw.replace(/\D/g, "").slice(0, 7).padStart(7, "0");
  const rem = base.split("").map(Number).reduce((acc, d, i) => acc + d * WEIGHTS[i], 0) % 11;
  if (rem === 1) return null;
  return rem === 0 ? 0 : 11 - rem;
}

/** Business-ID-looking tokens in free text ("1234567-8", "1234567 - 8"), valid or not. */
export function idLikeTokens(text: string): string[] {
  return [...text.matchAll(/(?<![\d-])(\d{7})\s?-\s?(\d)(?![\d-])/g)].map((m) => `${m[1]}-${m[2]}`);
}
