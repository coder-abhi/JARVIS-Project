# Goals Feature

Use this feature to manage monthly, quarterly, yearly, and five-year goals, goal-linked tasks, and completion logs.

API endpoints:
- `GET /goals/overview`
- `POST /goals`
- `PUT /goals/{goal_id}`
- `POST /goals/log`
- `PUT /goals/tasks/{task_id}/complete`
- `PUT /goals/completions/{completion_id}/restore`
- `POST /goals/personality/refresh`
- `GET /goals/next-actions?refresh=false` (`refresh=true` forces a new AI result)
- `GET /goals/captain-compass?refresh=false&days=30&timezone_offset_minutes=0` (`days` supports 7, 30, or 90; the timezone offset uses the browser `Date.getTimezoneOffset()` convention; cache/fallback only unless refreshed)

Depends on auth, projects, and tasks. AI enrichment is optional and has deterministic fallbacks.
