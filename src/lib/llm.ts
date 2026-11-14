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

export async function askJson<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
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
  if (res.output_parsed == null) throw new Error(`No structured output (status=${res.status})`);
  return res.output_parsed as z.infer<T>;
}
