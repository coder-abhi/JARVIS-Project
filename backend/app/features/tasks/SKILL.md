# Tasks Feature

Use this feature to create, update, filter, complete, and assign work items.

API endpoints:
- `POST /tasks`
- `PUT /tasks/{task_id}`
- `POST /tasks/pomodoro-assignment`

Depends on auth and projects. The Pomodoro assignment endpoint can call the AI wrapper but falls back safely when no API key is configured.
