# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-07-16

### Changed

- Improved npm keywords for better discoverability

## [1.0.0] - 2026-07-15

### Added

- OpenTelemetry-friendly AI telemetry for prompts, responses, tokens, cost, traces, and errors
- GenAI-style attributes (`gen_ai.*`, `ai.cost.usd`)
- `startGeneration` / `traceGeneration` APIs
- Optional content capture (off by default)
- Built-in cost estimates with overrideable pricing
- Optional peer dependency on `@opentelemetry/api` (no-op spans when absent)
- Dual ESM + CJS + TypeScript declarations
