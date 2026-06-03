# Library Feature

Use this feature for book ownership, reading logs, chapter tracking, resonance flags, shelf views, and recommendations.

API endpoints:
- `GET /library/summary`
- `GET /library/books`
- `POST /library/books`
- `PUT /library/books/{book_id}`
- `POST /library/books/{book_id}/chapters`
- `POST /library/books/{book_id}/chapters/regenerate`
- `DELETE /library/books/{book_id}/chapters`
- `PUT /library/chapters/{chapter_id}`
- `DELETE /library/chapters/{chapter_id}`
- `POST /library/reading-logs`
- `GET /library/recommendations`
- `GET /library/next-reading`

Depends on auth. OpenAI metadata and recommendation calls are optional.
