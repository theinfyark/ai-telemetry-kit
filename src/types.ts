/** USD price per 1M tokens */
export interface PriceRate {
  input: number;
  output: number;
}

export type ProviderName =
  | "openai"
  | "azure-openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "deepseek"
  | "mistral"
  | "openrouter"
  | "ollama"
  | (string & {});

export type OperationName =
  | "chat"
  | "completion"
  | "embedding"
  | "image"
  | "tool"
  | (string & {});

export type AttrValue = string | number | boolean;

export interface GenerationStart {
  provider: ProviderName;
  model: string;
  operation?: OperationName;
  /** Prompt / input text (only recorded when captureContent is true) */
  prompt?: string;
  requestId?: string;
  attributes?: Record<string, AttrValue>;
}

export interface GenerationEnd {
  response?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  finishReason?: string;
  error?: unknown;
  attributes?: Record<string, AttrValue>;
}

export interface GenerationOutcome extends GenerationEnd {
  ok: boolean;
}

export interface TelemetryEvent {
  id: string;
  name: string;
  provider: string;
  model: string;
  operation: string;
  status: "ok" | "error";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  requestId?: string;
  prompt?: string;
  response?: string;
  finishReason?: string;
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
  attributes: Record<string, AttrValue>;
  traceId?: string;
  spanId?: string;
}

export interface AiTelemetryOptions {
  /** Service / instrumentation name. Default: ai-telemetry-kit */
  serviceName?: string;
  /** Record prompt/response text on spans & events. Default: false */
  captureContent?: boolean;
  /** Max chars of content to keep when captureContent is true. Default: 4096 */
  maxContentLength?: number;
  /** Custom pricing (USD / 1M tokens) for cost estimation */
  pricing?: Record<string, Record<string, PriceRate>>;
  /** Called for every completed generation (useful without an OTel exporter) */
  onEvent?: (event: TelemetryEvent) => void;
  /**
   * Inject a Tracer from @opentelemetry/api.
   * If omitted, the package tries to use the global tracer provider when OTel is installed.
   */
  tracer?: unknown;
}
