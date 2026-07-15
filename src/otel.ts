/**
 * Optional @opentelemetry/api bridge.
 * Works without OTel installed (no-op spans); plugs into the global provider when present.
 */
import { createRequire } from "node:module";

export interface OtelSpanLike {
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(err: Error | string): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): OtelSpanLike;
}

const STATUS_ERROR = 2;
const STATUS_OK = 1;

class NoopSpan implements OtelSpanLike {
  private readonly ids = {
    traceId: "0".repeat(32),
    spanId: "0".repeat(16),
  };
  setAttributes() {}
  setAttribute() {}
  setStatus() {}
  recordException() {}
  end() {}
  spanContext() {
    return this.ids;
  }
}

class NoopTracer implements OtelTracerLike {
  startSpan() {
    return new NoopSpan();
  }
}

let cachedTracer: OtelTracerLike | null | undefined;

function tryLoadGlobalTracer(serviceName: string): OtelTracerLike | null {
  try {
    const require = createRequire(import.meta.url);
    const api = require("@opentelemetry/api") as {
      trace: { getTracer: (name: string) => OtelTracerLike };
    };
    return api.trace.getTracer(serviceName);
  } catch {
    return null;
  }
}

export function resolveTracer(
  serviceName: string,
  injected?: unknown,
): OtelTracerLike {
  if (injected && typeof (injected as OtelTracerLike).startSpan === "function") {
    return injected as OtelTracerLike;
  }
  if (cachedTracer === undefined) {
    cachedTracer = tryLoadGlobalTracer(serviceName);
  }
  return cachedTracer ?? new NoopTracer();
}

export function markOk(span: OtelSpanLike) {
  span.setStatus({ code: STATUS_OK });
}

export function markError(span: OtelSpanLike, message: string) {
  span.setStatus({ code: STATUS_ERROR, message });
}

export function resetTracerCache() {
  cachedTracer = undefined;
}

export { STATUS_ERROR, STATUS_OK };
