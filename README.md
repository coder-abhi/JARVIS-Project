# Jarvis

Local-first desktop Jarvis app scaffolded with:

- Tauri + Vite + React for the desktop UI
- FastAPI for the local API
- SQLite at `backend/local.db`
- Optional OpenAI-backed AI helpers

The app follows `code_structure.md`: frontend and backend are organized by feature modules.

## Features Ported

- Auth: local signup, login, bearer token session
- Dashboard: project summaries and execution rollups
- Projects: project detail, task CRUD, filters, timeline bars
- Timeline: cross-project planning view
- Pomodoro: persistent local timer, manual sessions, history, task assignment
- Goals: goal overview, goal log, completions, AI-backed suggestions
- Library: book shelf, reading logs, chapters, recommendations
- AI: `/ai/status`, per-feature cost surveillance, and optional OpenAI wrappers

## Run Locally

Backend:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Desktop web shell:

```bash
cd apps/desktop
npm run dev
```

Open:

```text
http://127.0.0.1:1420
```

## Build Checks

```bash
../.venv/bin/python -m compileall backend/app
cd apps/desktop
npm run build
```

## Feature Settings

Feature toggles live in:

```text
data/feature_settings.json
```

The backend manifest is available at:

```text
GET /features
```
