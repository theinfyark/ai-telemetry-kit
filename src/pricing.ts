import type { PriceRate, ProviderName } from "./types.js";

/** Approximate USD pricing per 1M tokens (estimates for observability). */
export const DEFAULT_PRICING: Record<string, Record<string, PriceRate>> = {
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    default: { input: 0.5, output: 1.5 },
  },
  "azure-openai": {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    default: { input: 0.5, output: 1.5 },
  },
  anthropic: {
    "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
    "claude-3-5-sonnet-latest": { input: 3, output: 15 },
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "claude-opus-4-20250514": { input: 15, output: 75 },
    default: { input: 3, output: 15 },
  },
  gemini: {
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    default: { input: 0.15, output: 0.6 },
  },
  groq: {
    default: { input: 0.1, output: 0.1 },
  },
  deepseek: {
    "deepseek-chat": { input: 0.27, output: 1.1 },
    default: { input: 0.27, output: 1.1 },
  },
  mistral: {
    default: { input: 0.5, output: 1.5 },
  },
  openrouter: {
    default: { input: 0.5, output: 1.5 },
  },
  ollama: {
    default: { input: 0, output: 0 },
  },
};

export function getRate(
  provider: ProviderName,
  model: string,
  pricing: Record<string, Record<string, PriceRate>> = DEFAULT_PRICING,
): PriceRate {
  const table =
    pricing[provider] ?? pricing.openai ?? { default: { input: 0.5, output: 1.5 } };
  if (table[model]) return table[model]!;
  const fuzzy = Object.entries(table).find(
    ([k]) => k !== "default" && (model.includes(k) || k.includes(model)),
  );
  if (fuzzy) return fuzzy[1];
  return table.default ?? { input: 0.5, output: 1.5 };
}

export function estimateCostUsd(
  provider: ProviderName,
  model: string,
  promptTokens: number,
  completionTokens: number,
  pricing: Record<string, Record<string, PriceRate>> = DEFAULT_PRICING,
): number {
  const rate = getRate(provider, model, pricing);
  const cost =
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
