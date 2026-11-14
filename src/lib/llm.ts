import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

// All LLM calls go through askJson (structured output validated by zod).
export const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  client ??= new OpenAI(); // reads OPENAI_API_KEY
  return client;
}

// ---- Spend guard ----------------------------------------------------------
// Hard daily token cap shared by every LLM call (askJson + the agent loop), so a
// runaway loop or a judge spamming queries cannot drain the OpenAI key.
// Persisted to the OS temp dir so a server restart doesn't reset the count.
const DAILY_TOKEN_CAP = Number(process.env.LLM_DAILY_TOKEN_CAP ?? 1_500_000);
const USAGE_FILE = path.join(os.tmpdir(), "kilpailutus-llm-usage.json");
type Usage = { day: string; input: number; output: number; calls: number };

function today() {
  return new Date().toISOString().slice(0, 10);
}
function readUsage(): Usage {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Usage;
    if (u.day === today()) return u;
  } catch {
    /* first call today */
  }
  return { day: today(), input: 0, output: 0, calls: 0 };
}

export class LlmBudgetError extends Error {}

/** Throws before a call when today's token budget is spent. */
export function assertLlmBudget() {
  const u = readUsage();
  if (u.input + u.output >= DAILY_TOKEN_CAP) {
    throw new LlmBudgetError(`Daily LLM budget reached (${u.input + u.output} tokens). Try again tomorrow.`);
  }
}

/** Records usage from an OpenAI Responses API result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recordLlmUsage(res: any) {
  const u = readUsage();
  u.input += res?.usage?.input_tokens ?? 0;
  u.output += res?.usage?.output_tokens ?? 0;
  u.calls += 1;
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(u));
  } catch {
    /* best effort */
  }
}

export function llmUsageToday(): Usage & { cap: number } {
  return { ...readUsage(), cap: DAILY_TOKEN_CAP };
}

export async function askJson<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  assertLlmBudget();
  const res = await getClient().responses.parse(
    {
      model: MODEL,
      instructions: opts.system,
      input: opts.user,
      // Reasoning effort only exists on reasoning models (gpt-5*, o*).
      ...(/^(gpt-5|o\d)/.test(MODEL) ? { reasoning: { effort: opts.effort ?? "low" } } : {}),
      text: { format: zodTextFormat(opts.schema, "result") },
    },
    { timeout: 60_000 },
  );
  recordLlmUsage(res);
  if (res.output_parsed == null) throw new Error(`No structured output (status=${res.status})`);
  return res.output_parsed as z.infer<T>;
}
