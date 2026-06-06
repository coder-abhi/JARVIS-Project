# AI Feature

Use this feature to check whether the local AI wrapper is configured and to inspect per-user OpenAI cost telemetry.

API endpoints:
- `GET /ai/status`
- `GET /ai/costs?days=30&timezone_offset_minutes=0` (authenticated)
- `GET /ai/features` (authenticated)
- `PUT /ai/features/{feature}` with `{ "enabled": true | false }` (authenticated)

Successful and failed OpenAI calls are recorded with their feature, model, token usage, latency, and estimated cost. Cost totals are returned in cents. Other features call AI helpers internally, and missing API keys do not block core app workflows.

Successful JSON responses are cached persistently by user, feature, model, prompts, token limit, and normalized input. Automatic reloads reuse the cache without creating usage events; explicit refresh actions can force one new OpenAI request.

Captain Compass is cache-only during automatic dashboard loads. Its manual refresh action is the only path that requests a new assessment from OpenAI.

Feature settings are per user and default to enabled. Disabled features bypass cached AI output and new OpenAI requests, allowing each caller's deterministic local fallback to run.
