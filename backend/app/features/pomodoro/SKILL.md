# Pomodoro Feature

Use this feature for focus timers and session logging. The active timer is local to the desktop UI; completed project session logs are persisted through the project session endpoints.

API endpoints:
- `GET /pomodoro/status`
- `GET /projects/{project_id}/pomodoro-sessions`
- `PUT /projects/pomodoro-sessions/{session_id}`
- `DELETE /projects/pomodoro-sessions/{session_id}`
- `POST /tasks/pomodoro-assignment`

Depends on auth, projects, and tasks.
