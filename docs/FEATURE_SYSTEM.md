# Jarvis Feature System

Jarvis is organized as local-first feature modules. Each backend feature lives in `backend/app/features/<feature>/` with a router, models/schema exports, service/repository exports, migrations folder, and `SKILL.md`.

Frontend features live in `apps/desktop/src/features/<feature>/` with page components, route declarations, sidebar metadata, API/type wrappers, and `feature.config.ts`.

Feature availability is controlled by `data/feature_settings.json`. The backend exposes the resolved manifest at `GET /features`.

Current feature dependencies:
- `auth`: base local identity feature.
- `projects`: depends on `auth`.
- `tasks`: depends on `auth` and `projects`.
- `pomodoro`: depends on `auth`, `projects`, and `tasks`.
- `goals`: depends on `auth`, `projects`, and `tasks`.
- `library`: depends on `auth`.
- `ai`: optional wrapper used by goals, library, and Pomodoro assignment.

SQLite is stored at `backend/local.db` by default. The app still honors `DATABASE_URL` when provided.
