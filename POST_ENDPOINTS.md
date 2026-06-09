# Jarvis Mutation Endpoints

This catalog intentionally excludes GET and DELETE endpoints. All endpoints except signup and login require `Authorization: Bearer <token>` and JSON bodies use `Content-Type: application/json`.

Validation failures return `422`, missing owned records return `404`, authentication failures return `401`, and ownership or identifier conflicts return `409` unless noted otherwise.

## Authentication

### POST `/auth/signup`

- **Feature:** Authentication
- **Purpose:** Create a local user and return a bearer session.
- **Required fields:** `username`, `password`
- **Optional fields:** None
- **Request:** `{"username":"agent_user","password":"strong-password"}`
- **Response:** `{"access_token":"...","token_type":"bearer","user":{"id":"uuid","username":"agent_user","created_at":"2026-06-10T00:00:00Z"}}`
- **AI notes:** Store and send the returned token on later calls. Do not create duplicate accounts.
- **Validation:** Username 3-80 characters; password 6-128 characters; normalized username must be unique.

### POST `/auth/login`

- **Feature:** Authentication
- **Purpose:** Authenticate an existing local user.
- **Required fields:** `username`, `password`
- **Optional fields:** None
- **Request:** `{"username":"agent_user","password":"strong-password"}`
- **Response:** Same session shape as signup.
- **AI notes:** A failed login does not reveal whether the username exists.
- **Validation:** Non-empty username/password; invalid credentials return `401`.

## Projects And Tasks

### POST `/projects`

- **Feature:** Projects
- **Purpose:** Create a project owned by the authenticated user.
- **Required fields:** `name`, `type`
- **Optional fields:** `description`, `goal_id`, `linked_goal_ids`
- **Request:** `{"name":"Release","type":"fixed","description":"Ship v1","goal_id":"goal-uuid"}`
- **Response:** `{"id":"project-uuid","name":"Release","description":"Ship v1","type":"fixed","goal_id":"goal-uuid","created_at":"...","linked_goals":[]}`
- **AI notes:** Prefer `goal_id`; `linked_goal_ids` exists for compatibility and may contain at most one id.
- **Validation:** Name 1-160 characters; description at most 4000; type is `fixed` or `continuous`; linked goal must belong to the user.

### PUT `/projects/{project_id}`

- **Feature:** Projects
- **Purpose:** Update project metadata or its optional parent goal.
- **Required fields:** At least one update field.
- **Optional fields:** `name`, `description`, `type`, `goal_id`
- **Request:** `{"name":"Release v1","description":"Production launch"}`
- **Response:** Updated project object.
- **AI notes:** Send only intended changes. Use `goal_id: null` to detach the project.
- **Validation:** Same field limits as project creation; project and goal must belong to the user.

### POST `/tasks`

- **Feature:** Tasks
- **Purpose:** Create a task inside an owned project.
- **Required fields:** `project_id`, `title`
- **Optional fields:** `description`, `status`, `priority`, `importance_rating`, `eta_hours`, `time_spent_hours`, `start_date`, `deadline`
- **Request:** `{"project_id":"project-uuid","title":"Publish build","status":"todo","priority":"high","eta_hours":1.5}`
- **Response:** `{"id":"task-uuid","project_id":"project-uuid","title":"Publish build","status":"todo","priority":"high","importance_rating":3,"eta_hours":1.5,"time_spent_hours":0,"created_at":"..."}`
- **AI notes:** Times are hours, not minutes. A task cannot exist without a project.
- **Validation:** Title 1-220 characters; ratings 1-5; hour values non-negative; status is `todo`, `in_progress`, or `done`.

### PUT `/tasks/{task_id}`

- **Feature:** Tasks
- **Purpose:** Update a task.
- **Required fields:** At least one update field.
- **Optional fields:** `title`, `description`, `status`, `priority`, `importance_rating`, `eta_hours`, `time_spent_hours`, `start_date`, `deadline`
- **Request:** `{"status":"in_progress","time_spent_hours":0.5}`
- **Response:** Updated task object.
- **AI notes:** Updating status to `done` records completion time through the task service.
- **Validation:** Same field rules as task creation; task must belong to an owned project.

### POST `/tasks/pomodoro-assignment`

- **Feature:** Tasks
- **Purpose:** Suggest a project/task assignment for a Pomodoro note.
- **Required fields:** None
- **Optional fields:** `note`, `project_ids`
- **Request:** `{"note":"Finish release notes","project_ids":["project-uuid"]}`
- **Response:** `{"assigned":true,"confidence":0.92,"project_id":"project-uuid","task_id":"task-uuid","reason":"Matched release task"}`
- **AI notes:** This endpoint suggests context; it does not create or update a session.
- **Validation:** Note at most 4000 characters; supplied projects must be visible to the user.

### PUT `/projects/pomodoro-sessions/{session_id}`

- **Feature:** Project time logs
- **Purpose:** Idempotently write a project-linked Pomodoro time log.
- **Required fields:** `id`, `project_id`, `minutes`, `started_at`, `completed_at`
- **Optional fields:** `mode`, `description`
- **Request:** `{"id":"session:project","project_id":"project-uuid","mode":"focus","minutes":25,"description":"Release notes","started_at":"2026-06-10T09:00:00Z","completed_at":"2026-06-10T09:25:00Z"}`
- **Response:** Request fields plus `created_at`.
- **AI notes:** Path id and body id must match. Repeating the same id updates the log.
- **Validation:** Id 1-80 characters; minutes at least 1; description at most 4000; project must belong to the user.

## Pomodoro History

### POST `/pomodoro/sessions`

- **Feature:** Pomodoro
- **Purpose:** Create a durable completed Pomodoro history record.
- **Required fields:** `id`, `completedAt`, `minutes`, `mode`
- **Optional fields:** `startAt`, `endAt`, `projectId`, `projectName`, `taskId`, `taskTitle`, `done`, `focus`, `isManual`
- **Request:** `{"id":"session-uuid","completedAt":"2026-06-10T09:25:00Z","startAt":"2026-06-10T09:00:00Z","minutes":25,"mode":"focus","done":"Release notes","focus":90}`
- **Response:** Request fields plus `created_at`.
- **AI notes:** This is the canonical focus-history record. Project time logs are separate and should be written only when project allocation is needed.
- **Validation:** Mode is `focus`, `short`, or `long`; minutes 1-1440; focus 0-100; end cannot precede start; extra fields are rejected.

### PUT `/pomodoro/sessions/{session_id}`

- **Feature:** Pomodoro
- **Purpose:** Update or idempotently import a client-identified Pomodoro history record.
- **Required fields:** Same as create.
- **Optional fields:** Same as create.
- **Request:** Same shape as create with the updated values.
- **Response:** Updated Pomodoro history record.
- **AI notes:** Path id and body id must match.
- **Validation:** Same as create; conflicting ownership returns `409`.

## Goals

### POST `/goals`

- **Feature:** Goals
- **Purpose:** Create a measurable or descriptive goal.
- **Required fields:** `category`, `title`
- **Optional fields:** `description`, `target_value`, `current_value`, `unit`, `linked_project_ids`
- **Request:** `{"category":"quarterly","title":"Ship four releases","target_value":4,"current_value":0,"unit":"releases"}`
- **Response:** Goal object with `measurable`, `progress_percentage`, and linked projects.
- **AI notes:** Categories are `monthly`, `quarterly`, `yearly`, or `five_year`.
- **Validation:** Title 1-260 characters; description at most 4000; numeric values non-negative; linked projects must be owned.

### PUT `/goals/{goal_id}`

- **Feature:** Goals
- **Purpose:** Update goal metadata, progress, or linked projects.
- **Required fields:** At least one update field.
- **Optional fields:** `title`, `description`, `target_value`, `current_value`, `unit`, `linked_project_ids`
- **Request:** `{"current_value":2,"description":"Two releases shipped"}`
- **Response:** Updated goal object.
- **AI notes:** Send explicit project ids when changing links.
- **Validation:** Same field limits as goal creation.

### POST `/goals/log`

- **Feature:** Goals
- **Purpose:** Convert a natural-language log into a task or completion.
- **Required fields:** `text`
- **Optional fields:** None
- **Request:** `{"text":"+ draft release announcement"}`
- **Response:** `{"mode":"created_task","corrected_text":"Draft release announcement","related_goal":"Release","task":{...},"completion":null}`
- **AI notes:** This endpoint intentionally invokes assignment logic and may create a task. Prefer direct task endpoints when exact fields are known.
- **Validation:** Text 1-1000 characters.

### PUT `/goals/tasks/{task_id}/complete`

- **Feature:** Goals
- **Purpose:** Complete a task and create its completion log.
- **Required fields:** No body.
- **Optional fields:** None
- **Request:** Empty body.
- **Response:** `{"id":"completion-uuid","goal_id":"goal-uuid","project_id":"project-uuid","task_id":"task-uuid","title":"Publish build","goal_label":"Release","created_at":"..."}`
- **AI notes:** Use only for an existing active task.
- **Validation:** Task must be owned; missing task returns `404`.

### PUT `/goals/completions/{completion_id}/restore`

- **Feature:** Goals
- **Purpose:** Restore a completed task to active work.
- **Required fields:** No body.
- **Optional fields:** None
- **Request:** Empty body.
- **Response:** Restored goal-task object.
- **AI notes:** This reverses the completion log and related measurable progress.
- **Validation:** Completion must belong to the user.

### POST `/goals/personality/refresh`

- **Feature:** Goals AI
- **Purpose:** Refresh the stored personality/productivity insight.
- **Required fields:** No body.
- **Optional fields:** None
- **Request:** Empty body.
- **Response:** `{"text":"...","refreshed_at":"2026-06-10T00:00:00Z"}`
- **AI notes:** This can call the configured model and incur cost; do not poll it.
- **Validation:** Requires authentication and an enabled/configured AI feature.

## Library

### POST `/library/books`

- **Feature:** Library
- **Purpose:** Add an owned book.
- **Required fields:** `title`
- **Optional fields:** `author`, `category`, `total_pages`, `status`, `liked`, `rating`, `purchase_date`, `purchase_price`
- **Request:** `{"title":"Deep Work","author":"Cal Newport","category":"Productivity","total_pages":304}`
- **Response:** Book object with progress and chapters.
- **AI notes:** Metadata/chapter enrichment is queued after creation.
- **Validation:** Title 1-220; author at most 160; category at most 80; pages and price non-negative; rating 1-10.

### PUT `/library/books/{book_id}`

- **Feature:** Library
- **Purpose:** Update book metadata.
- **Required fields:** At least one update field.
- **Optional fields:** Same mutable fields as book creation.
- **Request:** `{"status":"reading","liked":true,"rating":9}`
- **Response:** Updated book object.
- **AI notes:** Reading progress should normally be recorded with `/library/reading-logs`.
- **Validation:** Same field limits as book creation.

### POST `/library/books/{book_id}/chapters`

- **Feature:** Library
- **Purpose:** Add one chapter.
- **Required fields:** `title`
- **Optional fields:** None
- **Request:** `{"title":"Work Deeply"}`
- **Response:** `{"id":"chapter-uuid","book_id":"book-uuid","title":"Work Deeply","position":1,"resonated":false}`
- **AI notes:** Position is assigned by the backend.
- **Validation:** Title 1-240 characters; book must be owned.

### PUT `/library/chapters/{chapter_id}`

- **Feature:** Library
- **Purpose:** Update whether a chapter resonated.
- **Required fields:** `resonated`
- **Optional fields:** None
- **Request:** `{"resonated":true}`
- **Response:** Updated chapter object.
- **AI notes:** This endpoint does not edit chapter text.
- **Validation:** Boolean value; chapter must belong to an owned book.

### POST `/library/books/{book_id}/chapters/regenerate`

- **Feature:** Library AI
- **Purpose:** Queue chapter regeneration for a book.
- **Required fields:** No body.
- **Optional fields:** None
- **Request:** Empty body.
- **Response:** `{"status":"queued"}`
- **AI notes:** This can invoke external enrichment and is asynchronous.
- **Validation:** Book must be owned; missing book returns `404`.

### POST `/library/reading-logs`

- **Feature:** Library
- **Purpose:** Record reading progress.
- **Required fields:** `book_id` plus either `pages_read` or both `start_page` and `end_page`
- **Optional fields:** `read_at`, `note`
- **Request:** `{"book_id":"book-uuid","start_page":10,"end_page":34,"read_at":"2026-06-10T20:00:00Z","note":"Strong chapter"}`
- **Response:** `{"id":"log-uuid","book_id":"book-uuid","start_page":10,"end_page":34,"pages_read":25,"read_at":"...","note":"Strong chapter"}`
- **AI notes:** Do not send both an inconsistent page count and page range.
- **Validation:** Pages at least 1; end page cannot be before start page; book must be owned.

## Money

### PUT `/money`

- **Feature:** Money bulk import
- **Purpose:** Replace the authenticated user's complete finance dataset in one transaction.
- **Required fields:** `version`, `currency`; collection fields default to empty lists.
- **Optional fields:** `categories`, `transactions`, `accounts`, `cards`, `loans`, `investments`, `goals`, `incomes`, `bills`
- **Request:** `{"version":1,"currency":"INR","categories":[],"transactions":[],"accounts":[],"cards":[],"loans":[],"investments":[],"goals":[],"incomes":[],"bills":[]}`
- **Response:** The complete normalized finance dataset.
- **AI notes:** Destructive replacement endpoint. Prefer the resource endpoints below for normal agent writes.
- **Validation:** Entire payload is strictly validated; omitted collections become empty and existing rows in them are removed.

All finance resource endpoints return the complete current `WealthData` snapshot after a successful write. POST creates and rejects an existing id. PUT requires an existing id and requires the path/body ids to match. Unknown fields are rejected.

| Feature | Method and path | Purpose | Required fields | Optional fields | Example request | AI notes and validation |
|---|---|---|---|---|---|---|
| Accounts | POST `/money/accounts` | Create bank account | `bankName`, `name`, `accountType`, `balance` | `id` | `{"bankName":"HDFC","name":"Salary","accountType":"Savings","balance":50000}` | Names are bounded to 160 chars; account type to 40; id is generated when omitted. |
| Accounts | PUT `/money/accounts/{entry_id}` | Update bank account | `id`, `bankName`, `name`, `accountType`, `balance` | None | `{"id":"uuid","bankName":"HDFC","name":"Salary","accountType":"Savings","balance":52000}` | Full replacement of that account row; owned id required. |
| Categories | POST `/money/categories` | Create transaction category | `transactionType`, `name` | `id` | `{"transactionType":"expense","name":"Food"}` | Type is `expense` or `income`; name unique per user/type. |
| Categories | PUT `/money/categories/{entry_id}` | Update category | `id`, `transactionType`, `name` | None | `{"id":"uuid","transactionType":"expense","name":"Dining"}` | Existing transactions retain the category id and display the new name. |
| Cards | POST `/money/cards` | Create credit card | `issuer`, `name`, `billDay`, `dueDay` | `id`, `lastFour`, `generatedBill`, `currentBill` | `{"issuer":"ICICI","name":"Rewards","lastFour":"1234","billDay":5,"dueDay":20}` | Last four max 4 chars; day values 1-31; bill values non-negative. |
| Cards | PUT `/money/cards/{entry_id}` | Update credit card | Full card fields including `id` | None | `{"id":"uuid","issuer":"ICICI","name":"Rewards","lastFour":"1234","generatedBill":5000,"currentBill":2500,"billDay":5,"dueDay":20}` | Path/body ids must match. |
| Transactions | POST `/money/transactions` | Create ledger transaction | `type`, `amount`, `description`, `category`, `dateTime`, `sourceKind` | `id`, `categoryId`, `sourceId`, `tags` | `{"type":"expense","amount":450,"description":"Dinner","category":"Food","dateTime":"2026-06-10T20:00:00Z","sourceKind":"cash","sourceId":"","tags":["#food"]}` | Amount must be positive. Account/card sources require an owned `sourceId`; cash requires an empty id. Category is created when no categoryId is supplied. |
| Transactions | PUT `/money/transactions/{entry_id}` | Update transaction | Full transaction fields including `id` | `categoryId`, `sourceId`, `tags` | Same as create with `"id":"uuid"` | Category type must match transaction type; tags are replaced atomically. |
| Loans | POST `/money/loans` | Create loan record | `direction`, `person`, `principal`, `outstanding`, `interestRate`, `expectedReturnDate` | `id`, `note` | `{"direction":"given","person":"Alex","principal":10000,"outstanding":6000,"interestRate":0,"expectedReturnDate":"2026-12-01"}` | Direction is `taken` or `given`; monetary values non-negative. |
| Loans | PUT `/money/loans/{entry_id}` | Update loan | Full loan fields including `id` | `note` | Same as create with `"id":"uuid"` | Owned existing id required. |
| Investments | POST `/money/investments` | Create investment | `type`, `name`, `investedAmount`, `currentValue` | `id`, `platform` | `{"type":"Index Fund","name":"Nifty 50","platform":"Zerodha","investedAmount":100000,"currentValue":112000}` | Amounts non-negative; type max 80; name max 200. |
| Investments | PUT `/money/investments/{entry_id}` | Update investment | Full investment fields including `id` | `platform` | Same as create with `"id":"uuid"` | Owned existing id required. |
| Saving goals | POST `/money/saving-goals` | Create saving goal | `name`, `targetAmount`, `savedAmount`, `dueDate` | `id`, `note` | `{"name":"Emergency Fund","targetAmount":300000,"savedAmount":50000,"dueDate":"2026-12-31"}` | Target must be positive; saved amount non-negative. |
| Saving goals | PUT `/money/saving-goals/{entry_id}` | Update saving goal | Full saving-goal fields including `id` | `note` | Same as create with `"id":"uuid"` | Owned existing id required. |
| Expected income | POST `/money/expected-incomes` | Create expected income | `source`, `amount`, `expectedDate` | `id`, `note`, `accountId` | `{"source":"Salary","amount":80000,"expectedDate":"2026-06-30","accountId":"account-uuid"}` | Amount positive; optional account must be owned. |
| Expected income | PUT `/money/expected-incomes/{entry_id}` | Update expected income | Full income fields including `id` | `note`, `accountId` | Same as create with `"id":"uuid"` | Path/body ids must match. |
| Expected bills | POST `/money/expected-bills` | Create expected bill | `payee`, `amount`, `expectedDate` | `id`, `note`, `accountId` | `{"payee":"Rent","amount":25000,"expectedDate":"2026-07-01","accountId":"account-uuid"}` | Amount positive; optional account must be owned. |
| Expected bills | PUT `/money/expected-bills/{entry_id}` | Update expected bill | Full bill fields including `id` | `note`, `accountId` | Same as create with `"id":"uuid"` | Path/body ids must match. |

**Finance response example:** `{"version":1,"currency":"INR","categories":[...],"transactions":[...],"accounts":[...],"cards":[...],"loans":[...],"investments":[...],"goals":[...],"incomes":[...],"bills":[...]}`

## Settings And AI

### PUT `/settings`

- **Feature:** User settings
- **Purpose:** Replace typed per-user behavior and dashboard preferences.
- **Required fields:** At least one field shown below.
- **Optional fields:** All settings fields.
- **Request:** `{"default_project_type":"fixed","default_task_priority":"medium","default_task_status":"todo","default_task_minutes":60,"show_week_operations_plan":true,"show_efficiency_report":true,"show_time_allocation":true}`
- **Response:** Request fields plus `updated_at`.
- **AI notes:** Send only fields that should change; omitted settings are preserved.
- **Validation:** Project type, priority, and status are enums; minutes 5-480; extra fields rejected.

### PUT `/ai/features/{feature}`

- **Feature:** AI configuration
- **Purpose:** Enable/disable an AI feature or select its model.
- **Required fields:** At least one of `enabled`, `model`
- **Optional fields:** `enabled`, `model`
- **Request:** `{"enabled":true,"model":"gpt-5.4-mini"}`
- **Response:** `{"feature":"captain_compass","label":"Captain Compass","description":"...","enabled":true,"model":"gpt-5.4-mini","available_models":["gpt-5.4-mini"]}`
- **AI notes:** Use only a model listed in `available_models`. Model changes affect future calls and cache keys.
- **Validation:** Feature key and model must be supported; model string 1-120 characters.
