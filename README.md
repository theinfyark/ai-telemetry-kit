# ai-telemetry-kit

## Introduction

**ai-telemetry-kit** brings OpenTelemetry-style observability to AI applications.

It tracks **prompts**, **responses**, **cost**, **tokens**, **traces**, and **errors** using GenAI semantic attributes — so production AI systems can be monitored like any other distributed service.

> Package name note: `ai-telemetry` was previously unpublished on npm, so this library ships as **`ai-telemetry-kit`**.

Works from **TypeScript and JavaScript** (ESM + CommonJS + `.d.ts`).

## Why this package exists

AI observability is a major focus as teams ship LLM features to production. Raw logs lose correlation; cost and token metrics are scattered; failures lack trace context. **ai-telemetry-kit** standardizes generation spans and events so you can export to Jaeger, Honeycomb, Datadog, Grafana, or your own sink — without locking into a proprietary SDK.

## Installation

```bash
npm install ai-telemetry-kit
```

Optional (recommended in production):

```bash
npm install @opentelemetry/api
# plus your usual OTel SDK / exporter packages
```

Requires Node.js 18+.

## Features

- Generation spans: prompt → response lifecycle
- Token usage (`input` / `output` / `total`)
- Estimated USD cost (overrideable pricing)
- OpenTelemetry traces (inject tracer or use global provider)
- Error recording + span status
- Privacy: content capture **off** by default
- In-memory event buffer + `onEvent` sink (works without exporters)
- Zero required runtime dependencies (`@opentelemetry/api` is optional peer)

## Quick Start

### TypeScript

```ts
import { createAiTelemetry } from "ai-telemetry-kit";

const telemetry = createAiTelemetry({
  serviceName: "checkout-ai",
  onEvent: (event) => console.log(event.status, event.costUsd, event.totalTokens),
});

const gen = telemetry.startGeneration({
  provider: "openai",
  model: "gpt-4o-mini",
  prompt: "Summarize this order", // only stored if captureContent: true
});

// ... call your LLM ...

gen.end({
  response: "Order summary...",
  promptTokens: 120,
  completionTokens: 80,
});
```

### JavaScript

```js
import { createAiTelemetry } from "ai-telemetry-kit";

const telemetry = createAiTelemetry({ serviceName: "checkout-ai" });
const gen = telemetry.startGeneration({
  provider: "openai",
  model: "gpt-4o-mini",
});
gen.end({ promptTokens: 120, completionTokens: 80 });
```

### One-shot `traceGeneration`

```ts
const result = await telemetry.traceGeneration(
  { provider: "anthropic", model: "claude-3-5-haiku-latest" },
  async () => {
    const response = await callModel();
    return {
      ok: true,
      response: response.text,
      promptTokens: response.usage.input,
      completionTokens: response.usage.output,
    };
  },
);
```

## API Reference

### `createAiTelemetry(options?)`

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | `ai-telemetry-kit` | Tracer / instrumentation name |
| `captureContent` | `false` | Record prompt/response text |
| `maxContentLength` | `4096` | Truncate captured content |
| `pricing` | built-in table | USD per 1M tokens |
| `onEvent` | — | Callback per completed generation |
| `tracer` | global / no-op | Inject `@opentelemetry/api` Tracer |

### `startGeneration(start)` → `GenerationHandle`

Start fields: `provider`, `model`, optional `operation`, `prompt`, `requestId`, `attributes`.

Handle methods:

- `end(result?)` — finish span; returns `TelemetryEvent`
- `recordError(err)` — record exception on the active span
- `otelSpan` — underlying span (no-op without OTel)

### `traceGeneration(start, fn)`

Runs `fn`, ends the span with tokens/cost/error, rethrows on failure.

### Helpers

- `estimateCostUsd(provider, model, promptTokens, completionTokens)`
- `DEFAULT_PRICING` / `getRate`
- `ATTR` — GenAI attribute key constants
- `summary()` / `getEvents()` / `clearEvents()` on `AiTelemetry`

## Examples

```ts
telemetry.startGeneration({
  provider: "openai",
  model: "gpt-4o",
  operation: "chat",
  requestId: req.id,
  attributes: { "ai.user_id": userId },
}).end({
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  finishReason: "stop",
  costUsd: 0.0021, // optional override
});
```

## Advanced Examples

### Wire a real OpenTelemetry tracer

```ts
import { trace } from "@opentelemetry/api";
import { createAiTelemetry } from "ai-telemetry-kit";

// After configuring NodeSDK / TracerProvider...
const telemetry = createAiTelemetry({
  tracer: trace.getTracer("my-ai-service"),
  captureContent: false,
});
```

### Capture content for debugging (dev only)

```ts
const telemetry = createAiTelemetry({
  captureContent: process.env.NODE_ENV !== "production",
  maxContentLength: 2000,
});
```

### Custom pricing

```ts
createAiTelemetry({
  pricing: {
    openai: {
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      default: { input: 0.5, output: 1.5 },
    },
  },
});
```

## Framework Integration

### Express / Fastify / Hono

Create one `AiTelemetry` at boot. In each request handler, pass `requestId` into `startGeneration` / `traceGeneration`. Export spans with your existing OTel middleware.

### LangChain / custom agents

Wrap each model invocation:

```ts
async function chat(messages: unknown[]) {
  return telemetry.traceGeneration(
    { provider: "openai", model: "gpt-4o-mini", operation: "chat" },
    async () => {
      const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages });
      return {
        ok: true,
        response: res.choices[0]?.message?.content ?? "",
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
      };
    },
  );
}
```

## TypeScript Usage

```ts
import {
  createAiTelemetry,
  type TelemetryEvent,
  type GenerationStart,
} from "ai-telemetry-kit";

const start: GenerationStart = {
  provider: "openai",
  model: "gpt-4o-mini",
};
```

## Error Handling

```ts
const gen = telemetry.startGeneration({ provider: "openai", model: "gpt-4o-mini" });
try {
  const out = await callModel();
  gen.end({ response: out.text, promptTokens: out.in, completionTokens: out.out });
} catch (err) {
  gen.end({ error: err });
  throw err;
}
```

`traceGeneration` records the error and rethrows automatically.

## Performance

- Synchronous attribute writes on the hot path
- No required native deps
- Content capture disabled by default (smaller payloads)
- Prefer injecting a shared tracer; avoid creating providers per request

## Best Practices

- Keep `captureContent: false` in production unless you have retention/redaction policies
- Always pass `provider` + `model` for cost and grouping
- Propagate `requestId` / OTel context across services
- Override `costUsd` when the provider bill differs from estimates
- Export via your platform’s OTel pipeline — this package creates spans, not backends

## FAQ

**Do I need OpenTelemetry installed?**  
No. Without it, spans are no-ops and you still get `onEvent` / `getEvents()`.

**Is this the same as `ai-cost-insight`?**  
`ai-cost-insight` focuses on aggregating usage/cost reports. **ai-telemetry-kit** focuses on distributed tracing and GenAI attributes for live observability.

**Does it call LLM APIs?**  
No — you wrap your existing model calls.

**Can I use CommonJS?**  
Yes: `require("ai-telemetry-kit")`.

## Migration Guide

### From ad-hoc logging

Replace prompt/token `console.log` with `startGeneration` / `end` so traces and costs share one event model.

### SemVer

Breaking changes only in major versions — see `CHANGELOG.md`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| No spans in Jaeger | Install/configure `@opentelemetry/api` + SDK exporter; or pass `tracer` |
| Missing prompt text | Set `captureContent: true` |
| Cost is 0 / wrong | Pass known model names or custom `pricing` / `costUsd` |
| `end()` throws | Call `end()` only once per handle |
| Types missing | Import from `ai-telemetry-kit`; Node 18+ |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
