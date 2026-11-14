// One small JSON file per workplace for the drive-time grids and road isochrones, so they survive dev
// server restarts and can be computed before a demo. Static geography; entries expire like the memory cache.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = process.env.MUUTTO_REACH_DIR || join(tmpdir(), "muutto-reach");
const file = (key: string) => join(DIR, `${key.replace(/[^\w.-]+/g, "_")}.json`);

export function diskGet<T>(key: string, maxAgeMs: number): T | undefined {
  try {
    const { at, value } = JSON.parse(readFileSync(file(key), "utf8")) as { at: number; value: T };
    return Date.now() - at < maxAgeMs ? value : undefined;
  } catch {
    return undefined;
  }
}

export function diskSet<T>(key: string, value: T): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file(key), JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* disk cache is best-effort */
  }
}
