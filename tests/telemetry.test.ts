import { describe, expect, it, beforeEach } from "vitest";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import {
  createAiTelemetry,
  estimateCostUsd,
  ATTR,
  resetTracerCache,
} from "../src/index.js";

describe("estimateCostUsd", () => {
  it("estimates openai gpt-4o-mini costs", () => {
    const cost = estimateCostUsd("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 5);
  });
});

describe("createAiTelemetry", () => {
  beforeEach(() => {
    resetTracerCache();
  });

  it("tracks prompt, response, tokens, cost, and errors via events", () => {
    const events: ReturnType<ReturnType<typeof createAiTelemetry>["getEvents"]> =
      [];
    const tel = createAiTelemetry({
      captureContent: true,
      onEvent: (e) => events.push(e),
    });

    const ok = tel.startGeneration({
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "Hello",
      requestId: "req-1",
    });
    const event = ok.end({
      response: "World",
      promptTokens: 10,
      completionTokens: 5,
      finishReason: "stop",
    });

    expect(event.status).toBe("ok");
    expect(event.prompt).toBe("Hello");
    expect(event.response).toBe("World");
    expect(event.promptTokens).toBe(10);
    expect(event.completionTokens).toBe(5);
    expect(event.totalTokens).toBe(15);
    expect(event.costUsd).toBeGreaterThan(0);
    expect(event.requestId).toBe("req-1");
    expect(event.attributes[ATTR.INPUT_TOKENS]).toBe(10);
    expect(event.attributes[ATTR.COST_USD]).toBe(event.costUsd);

    const bad = tel.startGeneration({
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
    });
    const errEvent = bad.end({ error: new Error("boom") });
    expect(errEvent.status).toBe("error");
    expect(errEvent.error?.message).toBe("boom");

    const summary = tel.summary();
    expect(summary.calls).toBe(2);
    expect(summary.ok).toBe(1);
    expect(summary.errors).toBe(1);
    expect(events).toHaveLength(2);
  });

  it("does not capture content by default", () => {
    const tel = createAiTelemetry();
    const event = tel
      .startGeneration({
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "secret",
      })
      .end({ response: "secret-out", promptTokens: 1, completionTokens: 1 });
    expect(event.prompt).toBeUndefined();
    expect(event.response).toBeUndefined();
  });

  it("traceGeneration wraps success and failure", async () => {
    const tel = createAiTelemetry();
    const result = await tel.traceGeneration(
      { provider: "openai", model: "gpt-4o-mini" },
      async () => ({
        ok: true as const,
        response: "hi",
        promptTokens: 2,
        completionTokens: 3,
      }),
    );
    expect(result.response).toBe("hi");
    expect(tel.getEvents()[0]?.status).toBe("ok");

    await expect(
      tel.traceGeneration({ provider: "openai", model: "gpt-4o-mini" }, async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(tel.getEvents().at(-1)?.status).toBe("error");
  });

  it("creates real OTel spans when a tracer is injected", () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");

    const tel = createAiTelemetry({ tracer });
    tel
      .startGeneration({
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat",
      })
      .end({ promptTokens: 4, completionTokens: 6 });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("gen_ai.chat");
    expect(spans[0]!.attributes[ATTR.SYSTEM]).toBe("openai");
    expect(spans[0]!.attributes[ATTR.INPUT_TOKENS]).toBe(4);
    expect(spans[0]!.attributes[ATTR.OUTPUT_TOKENS]).toBe(6);
    expect(spans[0]!.attributes[ATTR.COST_USD]).toBeTypeOf("number");

    const event = tel.getEvents()[0]!;
    expect(event.traceId).toBeTruthy();
    expect(event.spanId).toBeTruthy();
    expect(event.traceId).not.toMatch(/^0+$/);
  });

  it("uses global tracer provider when available", () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    resetTracerCache();

    try {
      const tel = createAiTelemetry({ serviceName: "ai-test" });
      tel
        .startGeneration({ provider: "gemini", model: "gemini-2.0-flash" })
        .end({ promptTokens: 1, completionTokens: 1 });
      expect(exporter.getFinishedSpans().length).toBeGreaterThanOrEqual(1);
    } finally {
      // leave global as-is for other tests; reset cache
      resetTracerCache();
    }
  });
});
