import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models as root_models
from app.database import Base
from app.features.money import models as money_models
from app.features.pomodoro import models as pomodoro_models
from app.features.settings import models as settings_models
from app.migrations import backup_sqlite_before_structured_migration, migrate_structured_storage


class StructuredStorageMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()
        self.user = root_models.User(id="user-1", username="tester", password_hash="hash")
        self.project = root_models.Project(
            id="project-1",
            user_id=self.user.id,
            name="Focused work",
            type=root_models.ProjectType.fixed,
        )
        self.session.add_all([self.user, self.project])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_structured_documents_migrate_and_are_removed(self) -> None:
        self.session.add_all(
            [
                root_models.UserDocument(
                    user_id=self.user.id,
                    key="app-settings",
                    value_json=json.dumps(
                        {
                            "projectBehavior": {
                                "defaultProjectType": "continuous",
                                "defaultTaskPriority": "high",
                                "defaultTaskStatus": "in_progress",
                                "defaultTaskMinutes": 90,
                            },
                            "missionControl": {
                                "weekOperationsPlan": False,
                                "efficiencyReport": True,
                                "timeAllocation": False,
                            },
                        }
                    ),
                ),
                root_models.UserDocument(
                    user_id=self.user.id,
                    key="pomodoro-history",
                    value_json=json.dumps(
                        [
                            {
                                "id": "session-1",
                                "mode": "focus",
                                "minutes": 25,
                                "startAt": "2026-06-09T10:00:00Z",
                                "completedAt": "2026-06-09T10:25:00Z",
                                "projectId": self.project.id,
                                "projectName": self.project.name,
                                "taskTitle": "No Continuous Project",
                                "done": "Implemented persistence",
                                "focus": 90,
                            }
                        ]
                    ),
                ),
            ]
        )
        self.session.commit()
        self.session.close()

        backup_path = backup_sqlite_before_structured_migration(self.engine)
        self.assertIsNotNone(backup_path)
        self.assertTrue(backup_path.exists())
        migrate_structured_storage(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()

        preferences = self.session.get(settings_models.UserPreference, "user-1")
        history = self.session.get(pomodoro_models.PomodoroHistorySession, "session-1")
        documents = list(self.session.scalars(select(root_models.UserDocument)))

        self.assertEqual(preferences.default_project_type, "continuous")
        self.assertEqual(preferences.default_task_minutes, 90)
        self.assertFalse(preferences.show_week_operations_plan)
        self.assertEqual(history.fixed_project_id, "project-1")
        self.assertEqual(history.description, "Implemented persistence")
        self.assertEqual(history.focus_rating, 90)
        self.assertEqual(documents, [])

    def test_finance_category_text_is_backfilled_to_category_row(self) -> None:
        transaction = money_models.WealthTransaction(
            id="transaction-1",
            user_id=self.user.id,
            type="expense",
            amount=10,
            description="Lunch",
            category="Food",
            date_time=datetime.fromisoformat("2026-06-09T12:00:00"),
            source_kind="cash",
        )
        self.session.add(transaction)
        self.session.commit()
        self.session.close()

        migrate_structured_storage(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()

        migrated = self.session.get(money_models.WealthTransaction, "transaction-1")
        category = self.session.get(money_models.WealthCategory, migrated.category_id)
        self.assertEqual(category.name, "Food")
        self.assertEqual(category.transaction_type, "expense")


if __name__ == "__main__":
    unittest.main()
