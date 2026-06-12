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

Create local environment files before starting the API:

```bash
cp backend/.env.example backend/.env
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set the generated value as `AUTH_SECRET_KEY` in `backend/.env`. Keep API keys
out of Git and rotate any key that has been shared outside your machine.

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
.venv/bin/python -m compileall -q backend/app
(cd backend && ../.venv/bin/python -m unittest discover -s tests -v)
(cd apps/desktop && npm run typecheck)
(cd apps/desktop && npm test)
(cd apps/desktop && npm run build)
```

## Desktop Packaging

The current Tauri shell does not bundle or start the Python API. A packaged
desktop build still requires the FastAPI process to be installed and running
at `VITE_API_URL`. Do not ship it as a standalone installer until the backend
is packaged as a managed sidecar or replaced with an embedded service.

## Feature Settings

Feature toggles live in:

```text
data/feature_settings.json
```

The backend manifest is available at:

```text
GET /features
```
