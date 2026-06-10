import os
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .database import Base, engine
from .feature_registry import feature_manifest, include_enabled_feature_routers
from .migrations import backup_sqlite_before_structured_migration, migrate_structured_storage
from . import models  # noqa: F401 - importing registers SQLAlchemy models


Base.metadata.create_all(bind=engine)


def ensure_sqlite_compatibility() -> None:
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    project_columns = {column["name"] for column in inspector.get_columns("projects")} if "projects" in table_names else set()
    task_columns = {column["name"] for column in inspector.get_columns("tasks")} if "tasks" in table_names else set()
    goal_columns = {column["name"] for column in inspector.get_columns("goals")} if "goals" in table_names else set()
    goal_project_columns = {column["name"] for column in inspector.get_columns("goal_projects")} if "goal_projects" in table_names else set()
    completed_goal_log_columns = {column["name"] for column in inspector.get_columns("completed_goal_logs")} if "completed_goal_logs" in table_names else set()
    book_columns = {column["name"] for column in inspector.get_columns("books")} if "books" in table_names else set()
    chapter_columns = {column["name"] for column in inspector.get_columns("book_chapters")} if "book_chapters" in table_names else set()
    reading_log_columns = {column["name"] for column in inspector.get_columns("reading_logs")} if "reading_logs" in table_names else set()
    ai_feature_setting_columns = {column["name"] for column in inspector.get_columns("ai_feature_settings")} if "ai_feature_settings" in table_names else set()
    wealth_transaction_columns = {column["name"] for column in inspector.get_columns("wealth_transactions")} if "wealth_transactions" in table_names else set()

    with engine.begin() as connection:
        if project_columns and "user_id" not in project_columns:
            connection.execute(text("ALTER TABLE projects ADD COLUMN user_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_user_id ON projects (user_id)"))
        if project_columns and "goal_id" not in project_columns:
            connection.execute(text("ALTER TABLE projects ADD COLUMN goal_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_projects_goal_id ON projects (goal_id)"))
        if project_columns and "description" not in project_columns:
            connection.execute(text("ALTER TABLE projects ADD COLUMN description TEXT"))
        if goal_columns and "description" not in goal_columns:
            connection.execute(text("ALTER TABLE goals ADD COLUMN description TEXT"))
        if book_columns and "user_id" not in book_columns:
            connection.execute(text("ALTER TABLE books ADD COLUMN user_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_books_user_id ON books (user_id)"))

        if task_columns and "priority" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN priority VARCHAR(6) NOT NULL DEFAULT 'medium'"))
        if task_columns and "importance_rating" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN importance_rating INTEGER NOT NULL DEFAULT 3"))
        if task_columns and "completion_percentage" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN completion_percentage INTEGER NOT NULL DEFAULT 0"))
            connection.execute(text("UPDATE tasks SET completion_percentage = 100 WHERE status = 'done'"))
        if task_columns and "start_date" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN start_date DATETIME"))
        if task_columns and "completed_at" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN completed_at DATETIME"))
            connection.execute(text("UPDATE tasks SET completed_at = created_at WHERE status = 'done'"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_completed_at ON tasks (completed_at)"))
        if task_columns:
            connection.execute(text("UPDATE tasks SET status = 'todo' WHERE status = 'delayed'"))
        if task_columns and "goal_id" in task_columns and {"goal_id", "project_id"} <= goal_project_columns:
            connection.execute(
                text(
                    """
                    INSERT OR IGNORE INTO goal_projects (goal_id, project_id)
                    SELECT DISTINCT tasks.goal_id, tasks.project_id
                    FROM tasks
                    JOIN goals ON goals.id = tasks.goal_id
                    JOIN projects ON projects.id = tasks.project_id
                    WHERE tasks.goal_id IS NOT NULL
                      AND goals.user_id = projects.user_id
                    """
                )
            )
        if project_columns and "goal_id" not in project_columns and {"goal_id", "project_id"} <= goal_project_columns:
            connection.execute(
                text(
                    """
                    UPDATE projects
                    SET goal_id = (
                        SELECT goal_projects.goal_id
                        FROM goal_projects
                        JOIN goals ON goals.id = goal_projects.goal_id
                        WHERE goal_projects.project_id = projects.id
                          AND goals.user_id = projects.user_id
                        ORDER BY goals.created_at ASC
                        LIMIT 1
                    )
                    WHERE EXISTS (
                        SELECT 1
                        FROM goal_projects
                        JOIN goals ON goals.id = goal_projects.goal_id
                        WHERE goal_projects.project_id = projects.id
                          AND goals.user_id = projects.user_id
                    )
                    """
                )
            )
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
        if completed_goal_log_columns and "project_id" not in completed_goal_log_columns:
            connection.execute(text("ALTER TABLE completed_goal_logs ADD COLUMN project_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_completed_goal_logs_project_id ON completed_goal_logs (project_id)"))
            if task_columns:
                connection.execute(
                    text(
                        """
                        UPDATE completed_goal_logs
                        SET project_id = (
                            SELECT tasks.project_id
                            FROM tasks
                            WHERE tasks.id = completed_goal_logs.task_id
                        )
                        WHERE task_id IS NOT NULL
                        """
                    )
                )

        if ai_feature_setting_columns and "model" not in ai_feature_setting_columns:
            connection.execute(text("ALTER TABLE ai_feature_settings ADD COLUMN model VARCHAR(120)"))
        if wealth_transaction_columns and "category_id" not in wealth_transaction_columns:
            connection.execute(text("ALTER TABLE wealth_transactions ADD COLUMN category_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_wealth_transactions_category_id ON wealth_transactions (category_id)"))

        if project_columns and task_columns:
            migrate_legacy_goal_inbox_projects(connection, table_names)

    if "goal_id" in task_columns:
        drop_legacy_task_goal_id()


def migrate_legacy_goal_inbox_projects(connection, table_names: list[str]) -> None:
    legacy_rows = connection.execute(
        text(
            """
            SELECT projects.id, projects.user_id
            FROM projects
            LEFT JOIN goals ON goals.id = projects.goal_id
            WHERE projects.user_id IS NOT NULL
              AND (
                projects.name = 'Goal Inbox'
                OR (goals.id IS NOT NULL AND projects.name = substr(goals.title || ' Actions', 1, 160))
                OR (goals.id IS NOT NULL AND projects.type = 'continuous' AND projects.name LIKE '% Actions')
              )
            """
        )
    ).fetchall()

    for legacy_project_id, user_id in legacy_rows:
        general_project_id = connection.execute(
            text(
                """
                SELECT id
                FROM projects
                WHERE user_id = :user_id AND name = 'General Work' AND id != :legacy_project_id
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {"user_id": user_id, "legacy_project_id": legacy_project_id},
        ).scalar_one_or_none()
        if general_project_id is None:
            general_project_id = str(uuid.uuid4())
            connection.execute(
                text(
                    """
                    INSERT INTO projects (id, user_id, goal_id, name, description, type, created_at)
                    VALUES (
                        :id,
                        :user_id,
                        NULL,
                        'General Work',
                        'General tasks that do not clearly fit another project.',
                        'continuous',
                        CURRENT_TIMESTAMP
                    )
                    """
                ),
                {"id": general_project_id, "user_id": user_id},
            )
        else:
            connection.execute(
                text(
                    """
                    UPDATE projects
                    SET type = 'continuous',
                        goal_id = NULL,
                        description = COALESCE(NULLIF(description, ''), 'General tasks that do not clearly fit another project.')
                    WHERE id = :id
                    """
                ),
                {"id": general_project_id},
            )

        connection.execute(
            text("UPDATE tasks SET project_id = :general_id WHERE project_id = :legacy_id"),
            {"general_id": general_project_id, "legacy_id": legacy_project_id},
        )
        if "pomodoro_session_logs" in table_names:
            connection.execute(
                text("UPDATE pomodoro_session_logs SET project_id = :general_id WHERE project_id = :legacy_id"),
                {"general_id": general_project_id, "legacy_id": legacy_project_id},
            )
        if "completed_goal_logs" in table_names:
            connection.execute(
                text("UPDATE completed_goal_logs SET project_id = :general_id WHERE project_id = :legacy_id"),
                {"general_id": general_project_id, "legacy_id": legacy_project_id},
            )
        if "goal_projects" in table_names:
            connection.execute(
                text("DELETE FROM goal_projects WHERE project_id = :legacy_id"),
                {"legacy_id": legacy_project_id},
            )
        connection.execute(text("DELETE FROM projects WHERE id = :legacy_id"), {"legacy_id": legacy_project_id})


def drop_legacy_task_goal_id() -> None:
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with connection.begin():
                connection.execute(text("DROP TABLE IF EXISTS tasks_without_goal_id"))
                connection.execute(
                    text(
                        """
                        CREATE TABLE tasks_without_goal_id (
                            id VARCHAR(36) NOT NULL,
                            project_id VARCHAR(36) NOT NULL,
                            title VARCHAR(220) NOT NULL,
                            description TEXT,
                            status VARCHAR(11) NOT NULL,
                            priority VARCHAR(6) NOT NULL,
                            importance_rating INTEGER NOT NULL,
                            completion_percentage INTEGER NOT NULL,
                            eta_hours FLOAT NOT NULL,
                            time_spent_hours FLOAT NOT NULL,
                            start_date DATETIME,
                            deadline DATETIME,
                            completed_at DATETIME,
                            created_at DATETIME NOT NULL,
                            PRIMARY KEY (id),
                            FOREIGN KEY(project_id) REFERENCES projects (id)
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO tasks_without_goal_id (
                            id,
                            project_id,
                            title,
                            description,
                            status,
                            priority,
                            importance_rating,
                            completion_percentage,
                            eta_hours,
                            time_spent_hours,
                            start_date,
                            deadline,
                            completed_at,
                            created_at
                        )
                        SELECT
                            id,
                            project_id,
                            title,
                            description,
                            status,
                            priority,
                            importance_rating,
                            completion_percentage,
                            eta_hours,
                            time_spent_hours,
                            start_date,
                            deadline,
                            completed_at,
                            created_at
                        FROM tasks
                        """
                    )
                )
                connection.execute(text("DROP TABLE tasks"))
                connection.execute(text("ALTER TABLE tasks_without_goal_id RENAME TO tasks"))
                connection.execute(text("CREATE INDEX ix_tasks_project_id ON tasks (project_id)"))
                connection.execute(text("CREATE INDEX ix_tasks_completed_at ON tasks (completed_at)"))
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()


ensure_sqlite_compatibility()
backup_sqlite_before_structured_migration(engine)
migrate_structured_storage(engine)

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
