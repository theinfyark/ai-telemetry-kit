import { randomUUID } from "node:crypto";
import { ATTR, buildStartAttributes, serializeError, truncate } from "./attributes.js";
import { DEFAULT_PRICING, estimateCostUsd } from "./pricing.js";
import { markError, markOk, resolveTracer, type OtelSpanLike } from "./otel.js";
import type {
  AiTelemetryOptions,
  AttrValue,
  GenerationEnd,
  GenerationOutcome,
  GenerationStart,
  PriceRate,
  TelemetryEvent,
} from "./types.js";

export class GenerationHandle {
  private ended = false;
  private readonly startedAtMs: number;
  private readonly startedAt: string;
  private readonly id: string;
  private readonly span: OtelSpanLike;
  private readonly start: GenerationStart;
  private readonly attrs: Record<string, AttrValue>;

  constructor(
    private readonly telemetry: AiTelemetry,
    start: GenerationStart,
    span: OtelSpanLike,
    attrs: Record<string, AttrValue>,
  ) {
    this.id = randomUUID();
    this.start = start;
    this.span = span;
    this.attrs = attrs;
    this.startedAtMs = Date.now();
    this.startedAt = new Date(this.startedAtMs).toISOString();
  }

  /** Active OTel span (no-op when OTel is not installed). */
  get otelSpan(): OtelSpanLike {
    return this.span;
  }

  recordError(err: unknown): void {
    const serialized = serializeError(err);
    const error =
      err instanceof Error ? err : new Error(serialized.message);
    this.span.recordException(error);
    this.span.setAttribute(ATTR.ERROR_TYPE, serialized.name ?? "Error");
    markError(this.span, serialized.message);
  }

  end(result: GenerationEnd = {}): TelemetryEvent {
    if (this.ended) {
      throw new Error("GenerationHandle.end() called twice");
    }
    this.ended = true;

    const promptTokens = result.promptTokens ?? 0;
    const completionTokens = result.completionTokens ?? 0;
    const totalTokens =
      result.totalTokens ?? promptTokens + completionTokens;
    const costUsd =
      result.costUsd ??
      estimateCostUsd(
        this.start.provider,
        this.start.model,
        promptTokens,
        completionTokens,
        this.telemetry.pricing,
      );

    const endAttrs: Record<string, AttrValue> = {
      ...(result.attributes ?? {}),
      [ATTR.RESPONSE_MODEL]: this.start.model,
      [ATTR.INPUT_TOKENS]: promptTokens,
      [ATTR.OUTPUT_TOKENS]: completionTokens,
      [ATTR.TOTAL_TOKENS]: totalTokens,
      [ATTR.COST_USD]: costUsd,
    };

    if (result.finishReason) {
      endAttrs[ATTR.FINISH_REASON] = result.finishReason;
    }

    if (this.telemetry.captureContent && result.response) {
      endAttrs[ATTR.COMPLETION] = truncate(
        result.response,
        this.telemetry.maxContentLength,
      );
    }

    this.span.setAttributes(endAttrs);

    let status: TelemetryEvent["status"] = "ok";
    let error: TelemetryEvent["error"];

    if (result.error) {
      status = "error";
      error = serializeError(result.error);
      this.recordError(result.error);
    } else {
      markOk(this.span);
    }

    this.span.end();

    const endedAtMs = Date.now();
    const ctx = this.span.spanContext();
    const isNoopTrace = /^0+$/.test(ctx.traceId);

    const event: TelemetryEvent = {
      id: this.id,
      name: `gen_ai.${this.start.operation ?? "chat"}`,
      provider: String(this.start.provider),
      model: this.start.model,
      operation: this.start.operation ?? "chat",
      status,
      startedAt: this.startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - this.startedAtMs,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      requestId: this.start.requestId,
      finishReason: result.finishReason,
      error,
      attributes: { ...this.attrs, ...endAttrs },
      ...(isNoopTrace
        ? {}
        : { traceId: ctx.traceId, spanId: ctx.spanId }),
    };

    if (this.telemetry.captureContent) {
      if (this.start.prompt) {
        event.prompt = truncate(
          this.start.prompt,
          this.telemetry.maxContentLength,
        );
      }
      if (result.response) {
        event.response = truncate(
          result.response,
          this.telemetry.maxContentLength,
        );
      }
    }

    this.telemetry.emit(event);
    return event;
  }
}

/**
 * OpenTelemetry-oriented AI observability helper.
 *
 * Tracks prompts, responses, tokens, cost, traces, and errors.
 */
export class AiTelemetry {
  readonly serviceName: string;
  readonly captureContent: boolean;
  readonly maxContentLength: number;
  readonly pricing: Record<string, Record<string, PriceRate>>;
  private readonly onEvent?: (event: TelemetryEvent) => void;
  private readonly tracer: ReturnType<typeof resolveTracer>;
  private readonly events: TelemetryEvent[] = [];

  constructor(options: AiTelemetryOptions = {}) {
    this.serviceName = options.serviceName ?? "ai-telemetry-kit";
    this.captureContent = options.captureContent ?? false;
    this.maxContentLength = options.maxContentLength ?? 4096;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
    this.onEvent = options.onEvent;
    this.tracer = resolveTracer(this.serviceName, options.tracer);
  }

  /** Start a generation span. Call `end()` when the model call finishes. */
  startGeneration(start: GenerationStart): GenerationHandle {
    if (!start.provider) throw new Error("provider is required");
    if (!start.model) throw new Error("model is required");

    const attrs = buildStartAttributes(start, {
      captureContent: this.captureContent,
      maxContentLength: this.maxContentLength,
    });

    const span = this.tracer.startSpan(
      `gen_ai.${start.operation ?? "chat"}`,
      { attributes: attrs },
    );

    return new GenerationHandle(this, start, span, attrs);
  }

  /**
   * Trace an async generation in one call.
   * Throw or return `{ error }` to mark the span failed.
   */
  async traceGeneration<T extends GenerationOutcome>(
    start: GenerationStart,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const handle = this.startGeneration(start);
    try {
      const result = await fn();
      const { ok: _ok, ...rest } = result;
      handle.end({
        ...rest,
        error: result.ok === false ? result.error ?? new Error("generation failed") : result.error,
      });
      return result;
    } catch (err) {
      handle.end({ error: err });
      throw err;
    }
  }

  /** In-memory events collected for this process (useful in tests). */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  /** Aggregate token/cost totals from collected events. */
  summary(): {
    calls: number;
    ok: number;
    errors: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  } {
    return this.events.reduce(
      (acc, e) => {
        acc.calls += 1;
        if (e.status === "ok") acc.ok += 1;
        else acc.errors += 1;
        acc.promptTokens += e.promptTokens;
        acc.completionTokens += e.completionTokens;
        acc.totalTokens += e.totalTokens;
        acc.costUsd += e.costUsd;
        return acc;
      },
      {
        calls: 0,
        ok: 0,
        errors: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    );
  }

  /** @internal */
  emit(event: TelemetryEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }
}

export function createAiTelemetry(options?: AiTelemetryOptions): AiTelemetry {
  return new AiTelemetry(options);
}
