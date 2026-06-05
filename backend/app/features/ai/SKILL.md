# AI Feature

Use this feature to check whether the local AI wrapper is configured and to inspect per-user OpenAI cost telemetry.

API endpoints:
- `GET /ai/status`
- `GET /ai/costs?days=30&timezone_offset_minutes=0` (authenticated)

Successful and failed OpenAI calls are recorded with their feature, model, token usage, latency, and estimated cost. Cost totals are returned in cents. Other features call AI helpers internally, and missing API keys do not block core app workflows.
