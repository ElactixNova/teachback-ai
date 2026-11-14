// Structured-output helper for the examiner routes (T9). Server-only: uses ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** Final marking and mark-scheme generation. */
export const MODEL = process.env.ANALYZE_MODEL ?? "claude-opus-5-5";
/** Live marking runs every ~20s while the student talks, so it uses a faster model. */
export const LIVE_MODEL = process.env.ANALYZE_LIVE_MODEL ?? "claude-sonnet-5-5";

const STRIP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "format"]);

/** JSON schema for the API's structured output, derived from the zod schema (bounds the API rejects are removed). */
export function modelSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !STRIP.has(k)).map(([k, x]) => [k, clean(x)]));
    }
    return v;
  };
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export type ImageInput = { pngBase64: string };

interface GenerateArgs<T extends z.ZodType> {
  model: string;
  /** Stable instructions, then optional cached context (e.g. lecture notes). */
  system: string;
  cachedContext?: string;
  userText: string;
  image?: ImageInput;
  schema: T;
  maxTokens?: number;
}

function toMessages(userText: string, image?: ImageInput): Anthropic.Beta.BetaMessageParam[] {
  return [
    {
      role: "user",
      content: [
        ...(image
          ? [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/png" as const,
                  data: image.pngBase64.replace(/^data:image\/png;base64,/, ""),
                },
              },
            ]
          : []),
        { type: "text" as const, text: userText },
      ],
    },
  ];
}

async function callOnce(args: GenerateArgs<z.ZodType>, messages: Anthropic.Beta.BetaMessageParam[]): Promise<string> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 8000,
    // Low effort: the student waits on this during a live demo.
    output_config: { effort: "low", format: { type: "json_schema", schema: modelSchema(args.schema) } },
    // If a safety classifier declines the request, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: args.system },
      ...(args.cachedContext ? [{ type: "text" as const, text: args.cachedContext, cache_control: { type: "ephemeral" as const } }] : []),
    ],
    messages,
  });
  if (response.stop_reason !== "end_turn") throw new Error(`The model did not finish (${response.stop_reason}).`);
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("The model returned no content.");
  return text;
}

/**
 * Calls the model for JSON matching `schema`. Every response is validated with zod; on a validation
 * failure we retry once with the error message appended to the request.
 */
export async function generateJson<T extends z.ZodType>(args: GenerateArgs<T>): Promise<z.infer<T>> {
  const messages = toMessages(args.userText, args.image);
  const first = await callOnce(args, messages);
  const parsed = parse(args.schema, first);
  if (parsed.ok) return parsed.value;

  const retry: Anthropic.Beta.BetaMessageParam[] = [
    ...messages,
    { role: "assistant", content: first },
    {
      role: "user",
      content: `Your previous response failed validation: ${parsed.error}\nReturn the corrected JSON only, matching the schema.`,
    },
  ];
  const second = await callOnce(args, retry);
  const again = parse(args.schema, second);
  if (again.ok) return again.value;
  throw new Error(`The model's response did not match the expected format: ${again.error}`);
}

function parse<T extends z.ZodType>(schema: T, text: string): { ok: true; value: z.infer<T> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "the response was not valid JSON" };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
