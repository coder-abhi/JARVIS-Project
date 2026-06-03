# Projects Feature

Use this feature to create project containers, list projects, and load dashboard summaries.

API endpoints:
- `GET /projects`
- `GET /projects/summary`
- `POST /projects`
- `GET /projects/{project_id}/tasks`
- `GET /projects/{project_id}/pomodoro-sessions`
- `PUT /projects/pomodoro-sessions/{session_id}`
- `DELETE /projects/pomodoro-sessions/{session_id}`

Depends on auth. Task and Pomodoro data are included where projects need rollups.
