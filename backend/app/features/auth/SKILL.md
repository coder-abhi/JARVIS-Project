# Auth Feature

Use this feature when a workflow needs local user signup, login, current-user lookup, or bearer-token validation.

API endpoints:
- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`

Call protected feature endpoints with `Authorization: Bearer <token>`.
