import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .database import Base, engine
from .feature_registry import feature_manifest, include_enabled_feature_routers
from . import models  # noqa: F401 - importing registers SQLAlchemy models


Base.metadata.create_all(bind=engine)


def ensure_sqlite_compatibility() -> None:
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    project_columns = {column["name"] for column in inspector.get_columns("projects")} if "projects" in table_names else set()
    task_columns = {column["name"] for column in inspector.get_columns("tasks")} if "tasks" in table_names else set()
    completed_goal_log_columns = {column["name"] for column in inspector.get_columns("completed_goal_logs")} if "completed_goal_logs" in table_names else set()
    book_columns = {column["name"] for column in inspector.get_columns("books")} if "books" in table_names else set()
    chapter_columns = {column["name"] for column in inspector.get_columns("book_chapters")} if "book_chapters" in table_names else set()
    reading_log_columns = {column["name"] for column in inspector.get_columns("reading_logs")} if "reading_logs" in table_names else set()

    with engine.begin() as connection:
        if project_columns and "user_id" not in project_columns:
            connection.execute(text("ALTER TABLE projects ADD COLUMN user_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_user_id ON projects (user_id)"))
        if book_columns and "user_id" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN user_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_books_user_id ON books (user_id)"))

        if task_columns and "priority" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN priority VARCHAR(6) NOT NULL DEFAULT 'medium'"))
        if task_columns and "goal_id" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN goal_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_goal_id ON tasks (goal_id)"))
        if task_columns and "importance_rating" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN importance_rating INTEGER NOT NULL DEFAULT 3"))
        if task_columns and "start_date" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN start_date DATETIME"))
        if task_columns:
            connection.execute(text("UPDATE tasks SET status = 'todo' WHERE status = 'delayed'"))
        if "projects" in table_names:
            connection.execute(text("UPDATE projects SET type = 'continuous' WHERE type = 'study'"))

        if book_columns and "category" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'General'"))
            if "area" in book_columns:
                connection.execute(text("UPDATE books SET category = area WHERE area IS NOT NULL AND area != ''"))
        if book_columns and "area" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN area VARCHAR(80) NOT NULL DEFAULT 'General'"))
            if "category" in book_columns:
                connection.execute(text("UPDATE books SET area = category WHERE category IS NOT NULL AND category != ''"))
        if book_columns and "current_page" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN current_page INTEGER NOT NULL DEFAULT 0"))
        if book_columns and "purchase_date" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN purchase_date DATETIME"))
            if "purchased_at" in book_columns:
                connection.execute(text("UPDATE books SET purchase_date = purchased_at WHERE purchased_at IS NOT NULL"))
        if book_columns and "purchased_at" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN purchased_at DATETIME"))
            if "purchase_date" in book_columns:
                connection.execute(text("UPDATE books SET purchased_at = purchase_date WHERE purchase_date IS NOT NULL"))
        if book_columns and "notes" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN notes TEXT"))
        if book_columns and "rating" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN rating INTEGER"))

        if chapter_columns and "resonated" not in chapter_columns:
            connection.execute(text("ALTER TABLE book_chapters ADD COLUMN resonated BOOLEAN NOT NULL DEFAULT 0"))
            if "is_liked" in chapter_columns:
                connection.execute(text("UPDATE book_chapters SET resonated = is_liked WHERE is_liked IS NOT NULL"))
        if chapter_columns and "is_liked" not in chapter_columns:
            connection.execute(text("ALTER TABLE book_chapters ADD COLUMN is_liked BOOLEAN NOT NULL DEFAULT 0"))
            if "resonated" in chapter_columns:
                connection.execute(text("UPDATE book_chapters SET is_liked = resonated WHERE resonated IS NOT NULL"))
        if chapter_columns and "created_at" not in chapter_columns:
            connection.execute(text("ALTER TABLE book_chapters ADD COLUMN created_at DATETIME"))

        if reading_log_columns and "read_at" not in reading_log_columns:
            connection.execute(text("ALTER TABLE reading_logs ADD COLUMN read_at DATETIME"))
            if "read_on" in reading_log_columns:
                connection.execute(text("UPDATE reading_logs SET read_at = read_on WHERE read_on IS NOT NULL"))
            if "created_at" in reading_log_columns:
                connection.execute(text("UPDATE reading_logs SET read_at = created_at WHERE read_at IS NULL"))
        if reading_log_columns and "read_on" not in reading_log_columns:
            connection.execute(text("ALTER TABLE reading_logs ADD COLUMN read_on DATETIME"))
            if "read_at" in reading_log_columns:
                connection.execute(text("UPDATE reading_logs SET read_on = read_at WHERE read_at IS NOT NULL"))
        if reading_log_columns and "created_at" not in reading_log_columns:
            connection.execute(text("ALTER TABLE reading_logs ADD COLUMN created_at DATETIME"))
        if reading_log_columns and "start_page" not in reading_log_columns:
            connection.execute(text("ALTER TABLE reading_logs ADD COLUMN start_page INTEGER"))
        if reading_log_columns and "end_page" not in reading_log_columns:
            connection.execute(text("ALTER TABLE reading_logs ADD COLUMN end_page INTEGER"))
        if completed_goal_log_columns and "task_id" not in completed_goal_log_columns:
            connection.execute(text("ALTER TABLE completed_goal_logs ADD COLUMN task_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_completed_goal_logs_task_id ON completed_goal_logs (task_id)"))


ensure_sqlite_compatibility()

app = FastAPI(title="Jarvis Local API")

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGIN",
        "http://localhost:1420,http://127.0.0.1:1420,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

include_enabled_feature_routers(app)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/features")
async def list_features():
    return feature_manifest()
