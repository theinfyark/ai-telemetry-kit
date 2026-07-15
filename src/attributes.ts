import type { AttrValue, GenerationStart } from "./types.js";

/** OpenTelemetry GenAI-style attribute keys. */
export const ATTR = {
  SYSTEM: "gen_ai.system",
  OPERATION: "gen_ai.operation.name",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TOTAL_TOKENS: "gen_ai.usage.total_tokens",
  FINISH_REASON: "gen_ai.response.finish_reasons",
  PROMPT: "gen_ai.prompt",
  COMPLETION: "gen_ai.completion",
  COST_USD: "ai.cost.usd",
  REQUEST_ID: "ai.request_id",
  ERROR_TYPE: "error.type",
} as const;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function buildStartAttributes(
  start: GenerationStart,
  options: { captureContent: boolean; maxContentLength: number },
): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {
    [ATTR.SYSTEM]: String(start.provider),
    [ATTR.OPERATION]: start.operation ?? "chat",
    [ATTR.REQUEST_MODEL]: start.model,
    ...(start.requestId ? { [ATTR.REQUEST_ID]: start.requestId } : {}),
    ...(start.attributes ?? {}),
  };

  if (options.captureContent && start.prompt) {
    attrs[ATTR.PROMPT] = truncate(start.prompt, options.maxContentLength);
  }

  return attrs;
}

export function serializeError(err: unknown): {
  message: string;
  name?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}
