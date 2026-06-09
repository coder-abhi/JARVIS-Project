import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine, text


DEFAULT_MONEY_CATEGORIES = {
    "expense": ("Food", "Housing", "Transport", "Shopping", "Health", "Education", "Entertainment", "Bills", "Travel", "Other"),
    "income": ("Salary", "Freelance", "Business", "Investment", "Gift", "Refund", "Other"),
}


def backup_sqlite_before_structured_migration(engine: Engine) -> Path | None:
    if engine.dialect.name != "sqlite" or not engine.url.database or engine.url.database == ":memory:":
        return None
    database_path = Path(engine.url.database)
    backup_path = database_path.with_name(f"{database_path.name}.backup-before-structured-storage")
    if backup_path.exists() or not database_path.exists():
        return backup_path if backup_path.exists() else None
    with engine.connect() as connection:
        if "user_documents" not in _table_names(connection):
            return None
        document_count = connection.execute(
            text(
                """
                SELECT count(*)
                FROM user_documents
                WHERE key IN ('app-settings', 'pomodoro-history', 'wealth-command')
                """
            )
        ).scalar_one()
    if document_count == 0:
        return None
    source = engine.raw_connection()
    destination = sqlite3.connect(backup_path)
    try:
        source.driver_connection.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup_path


def migrate_structured_storage(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as connection:
        _migrate_money_categories(connection)
        _repair_money_sources(connection)
        _migrate_app_settings(connection)
        _migrate_pomodoro_history(connection)


def _migrate_money_categories(connection) -> None:
    tables = _table_names(connection)
    if not {"wealth_categories", "wealth_transactions"} <= tables:
        return
    columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(wealth_transactions)")}
    if "category_id" not in columns:
        return

    rows = connection.execute(
        text(
            """
            SELECT DISTINCT user_id, type, category
            FROM wealth_transactions
            WHERE category IS NOT NULL AND trim(category) != ''
            """
        )
    ).fetchall()
    user_ids = {
        row[0]
        for row in connection.execute(
            text(
                """
                SELECT user_id FROM wealth_profiles
                UNION
                SELECT user_id FROM wealth_transactions
                """
            )
        )
    }
    for user_id in user_ids:
        for transaction_type, names in DEFAULT_MONEY_CATEGORIES.items():
            for name in names:
                connection.execute(
                    text(
                        """
                        INSERT OR IGNORE INTO wealth_categories (id, user_id, transaction_type, name)
                        VALUES (:id, :user_id, :transaction_type, :name)
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "transaction_type": transaction_type,
                        "name": name,
                    },
                )
    for user_id, transaction_type, name in rows:
        category_id = connection.execute(
            text(
                """
                SELECT id FROM wealth_categories
                WHERE user_id = :user_id
                  AND transaction_type = :transaction_type
                  AND lower(name) = lower(:name)
                LIMIT 1
                """
            ),
            {"user_id": user_id, "transaction_type": transaction_type, "name": name},
        ).scalar_one_or_none()
        if category_id is None:
            category_id = str(uuid.uuid4())
            connection.execute(
                text(
                    """
                    INSERT INTO wealth_categories (id, user_id, transaction_type, name)
                    VALUES (:id, :user_id, :transaction_type, :name)
                    """
                ),
                {
                    "id": category_id,
                    "user_id": user_id,
                    "transaction_type": transaction_type,
                    "name": name,
                },
            )
        connection.execute(
            text(
                """
                UPDATE wealth_transactions
                SET category_id = :category_id
                WHERE user_id = :user_id
                  AND type = :transaction_type
                  AND lower(category) = lower(:name)
                  AND category_id IS NULL
                """
            ),
            {
                "category_id": category_id,
                "user_id": user_id,
                "transaction_type": transaction_type,
                "name": name,
            },
        )


def _repair_money_sources(connection) -> None:
    if "wealth_transactions" not in _table_names(connection):
        return
    connection.execute(
        text(
            """
            UPDATE wealth_transactions
            SET source_kind = 'cash',
                account_id = NULL,
                card_id = NULL
            WHERE (source_kind = 'account' AND account_id IS NULL)
               OR (source_kind = 'card' AND card_id IS NULL)
               OR source_kind NOT IN ('account', 'card', 'cash')
            """
        )
    )


def _migrate_app_settings(connection) -> None:
    if not {"user_documents", "user_preferences"} <= _table_names(connection):
        return
    documents = connection.execute(
        text("SELECT id, user_id, value_json FROM user_documents WHERE key = 'app-settings'")
    ).fetchall()
    for document_id, user_id, value_json in documents:
        try:
            value = json.loads(value_json)
            behavior = value.get("projectBehavior", {})
            mission = value.get("missionControl", {})
            minutes = min(max(int(behavior.get("defaultTaskMinutes", 60)), 5), 480)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        connection.execute(
            text(
                """
                INSERT INTO user_preferences (
                    user_id,
                    default_project_type,
                    default_task_priority,
                    default_task_status,
                    default_task_minutes,
                    show_week_operations_plan,
                    show_efficiency_report,
                    show_time_allocation,
                    updated_at
                )
                VALUES (
                    :user_id,
                    :project_type,
                    :priority,
                    :task_status,
                    :minutes,
                    :week_plan,
                    :efficiency,
                    :allocation,
                    CURRENT_TIMESTAMP
                )
                ON CONFLICT(user_id) DO NOTHING
                """
            ),
            {
                "user_id": user_id,
                "project_type": "continuous" if behavior.get("defaultProjectType") == "continuous" else "fixed",
                "priority": behavior.get("defaultTaskPriority")
                if behavior.get("defaultTaskPriority") in {"high", "medium", "low"}
                else "medium",
                "task_status": "in_progress" if behavior.get("defaultTaskStatus") == "in_progress" else "todo",
                "minutes": minutes,
                "week_plan": mission.get("weekOperationsPlan") is not False,
                "efficiency": mission.get("efficiencyReport") is not False,
                "allocation": mission.get("timeAllocation") is not False,
            },
        )
        connection.execute(text("DELETE FROM user_documents WHERE id = :id"), {"id": document_id})


def _migrate_pomodoro_history(connection) -> None:
    if not {"user_documents", "pomodoro_history_sessions"} <= _table_names(connection):
        return
    documents = connection.execute(
        text("SELECT id, user_id, value_json FROM user_documents WHERE key = 'pomodoro-history'")
    ).fetchall()
    for document_id, user_id, value_json in documents:
        try:
            logs = json.loads(value_json)
        except json.JSONDecodeError:
            continue
        if not isinstance(logs, list):
            continue

        migrated_all = True
        for log in logs:
            if not isinstance(log, dict):
                migrated_all = False
                continue
            try:
                completed_at = _parse_datetime(log.get("endAt") or log["completedAt"])
                minutes = max(1, min(int(log["minutes"]), 1440))
                started_at = _parse_datetime(log.get("startAt")) if log.get("startAt") else None
                started_at = started_at or datetime.fromtimestamp(
                    completed_at.timestamp() - minutes * 60,
                    tz=completed_at.tzinfo,
                )
                session_id = str(log["id"])[:80]
            except (KeyError, TypeError, ValueError):
                migrated_all = False
                continue

            fixed_project_id = _owned_project_id(connection, user_id, log.get("projectId"))
            continuous_project_id = _owned_project_id(connection, user_id, log.get("taskId"))
            connection.execute(
                text(
                    """
                    INSERT INTO pomodoro_history_sessions (
                        id,
                        user_id,
                        mode,
                        minutes,
                        started_at,
                        completed_at,
                        description,
                        focus_rating,
                        fixed_project_id,
                        continuous_project_id,
                        project_name_snapshot,
                        task_title_snapshot,
                        is_manual,
                        created_at
                    )
                    VALUES (
                        :id,
                        :user_id,
                        :mode,
                        :minutes,
                        :started_at,
                        :completed_at,
                        :description,
                        :focus_rating,
                        :fixed_project_id,
                        :continuous_project_id,
                        :project_name,
                        :task_title,
                        :is_manual,
                        CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(id) DO NOTHING
                    """
                ),
                {
                    "id": session_id,
                    "user_id": user_id,
                    "mode": log.get("mode") if log.get("mode") in {"focus", "short", "long"} else "focus",
                    "minutes": minutes,
                    "started_at": started_at.isoformat(),
                    "completed_at": completed_at.isoformat(),
                    "description": str(log.get("done") or "")[:4000] or None,
                    "focus_rating": _focus_rating(log.get("focus")),
                    "fixed_project_id": fixed_project_id,
                    "continuous_project_id": continuous_project_id,
                    "project_name": str(log.get("projectName") or "No Fixed Project")[:160],
                    "task_title": str(log.get("taskTitle") or "No Continuous Project")[:160],
                    "is_manual": bool(log.get("isManual")),
                },
            )
        if migrated_all:
            connection.execute(text("DELETE FROM user_documents WHERE id = :id"), {"id": document_id})


def _owned_project_id(connection, user_id: str, project_id) -> str | None:
    if not project_id:
        return None
    return connection.execute(
        text("SELECT id FROM projects WHERE id = :id AND user_id = :user_id"),
        {"id": str(project_id), "user_id": user_id},
    ).scalar_one_or_none()


def _parse_datetime(value) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Expected an ISO datetime")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _focus_rating(value) -> int | None:
    if value is None:
        return None
    try:
        return min(max(int(value), 0), 100)
    except (TypeError, ValueError):
        return None


def _table_names(connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            text("SELECT name FROM sqlite_master WHERE type = 'table'")
        )
    }
