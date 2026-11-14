import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// One structured-output call. Server-side refusal fallback is on by default.
export async function askJson<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Server-side refusal fallback where the model supports it (Haiku has none).
    ...(MODEL.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined this request");
  if (res.parsed_output == null) throw new Error(`No structured output (stop_reason=${res.stop_reason})`);
  return res.parsed_output as z.infer<T>;
}
