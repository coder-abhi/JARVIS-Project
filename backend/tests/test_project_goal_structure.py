import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app import crud, models, schemas
from app.database import Base


class ProjectGoalStructureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()
        self.user = models.User(id="user-1", username="tester", password_hash="hash")
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_tasks_require_projects_and_do_not_store_goal_ids(self) -> None:
        columns = {column["name"]: column for column in inspect(self.engine).get_columns("tasks")}

        self.assertNotIn("goal_id", columns)
        self.assertFalse(columns["project_id"]["nullable"])

    def test_project_links_goals_and_tasks_inherit_that_context(self) -> None:
        goal = models.Goal(
            id="goal-1",
            user_id=self.user.id,
            category=models.GoalCategory.monthly,
            title="Ship the release",
            target_value=4,
            current_value=0,
            unit="tasks",
        )
        self.session.add(goal)
        self.session.commit()

        project = crud.create_project(
            self.session,
            schemas.ProjectCreate(
                name="Release",
                type=models.ProjectType.fixed,
                linked_goal_ids=[goal.id],
            ),
            self.user,
        )
        task = crud.create_task(
            self.session,
            schemas.TaskCreate(
                project_id=project.id,
                title="Publish build",
            ),
        )

        task_read = crud._goal_task_read(crud.list_goal_active_tasks(self.session, self.user)[0])
        self.assertEqual([linked_goal.id for linked_goal in task_read.linked_goals], [goal.id])

        completion = crud.complete_goal_task(self.session, task.id, self.user)
        self.assertIsNotNone(completion)
        self.session.refresh(goal)
        self.assertEqual(goal.current_value, 1)

    def test_project_has_one_optional_goal_parent_and_editable_metadata(self) -> None:
        first_goal = models.Goal(
            id="goal-1",
            user_id=self.user.id,
            category=models.GoalCategory.monthly,
            title="Publish consistently",
            description="Writing, editing, and publishing work.",
        )
        second_goal = models.Goal(
            id="goal-2",
            user_id=self.user.id,
            category=models.GoalCategory.yearly,
            title="Build an audience",
        )
        self.session.add_all([first_goal, second_goal])
        self.session.commit()

        with self.assertRaises(ValueError):
            schemas.ProjectCreate(
                name="Content",
                type=models.ProjectType.continuous,
                linked_goal_ids=[first_goal.id, second_goal.id],
            )

        project = crud.create_project(
            self.session,
            schemas.ProjectCreate(
                name="Content",
                description="LinkedIn posts and long-form writing.",
                type=models.ProjectType.continuous,
                goal_id=first_goal.id,
            ),
            self.user,
        )
        updated = crud.update_project(
            self.session,
            project.id,
            schemas.ProjectUpdate(
                name="Content Engine",
                description="Posts, essays, and publishing tasks.",
                type=models.ProjectType.fixed,
                goal_id=second_goal.id,
            ),
            self.user,
        )

        self.assertIsNotNone(updated)
        self.assertEqual(updated.name, "Content Engine")
        self.assertEqual(updated.description, "Posts, essays, and publishing tasks.")
        self.assertEqual(updated.type, models.ProjectType.fixed)
        self.assertEqual(updated.parent_goal.id, second_goal.id)
        summary = next(item for item in crud.list_project_summaries(self.session, self.user) if item.id == project.id)
        self.assertEqual(summary.description, "Posts, essays, and publishing tasks.")
        self.assertEqual(summary.goal_id, second_goal.id)
        self.assertEqual([goal.id for goal in summary.linked_goals], [second_goal.id])

    def test_general_work_metadata_is_not_reset_when_reused(self) -> None:
        goal = models.Goal(
            id="goal-1",
            user_id=self.user.id,
            category=models.GoalCategory.monthly,
            title="Clear the backlog",
        )
        self.session.add(goal)
        self.session.commit()
        project = crud.create_project(
            self.session,
            schemas.ProjectCreate(
                name="General Work",
                type=models.ProjectType.continuous,
            ),
            self.user,
        )

        crud.update_project(
            self.session,
            project.id,
            schemas.ProjectUpdate(type=models.ProjectType.fixed, goal_id=goal.id),
            self.user,
        )
        reused = crud._get_or_create_general_work_project(self.session, self.user)

        self.assertEqual(reused.type, models.ProjectType.fixed)
        self.assertEqual(reused.parent_goal.id, goal.id)

    def test_goal_log_uses_existing_project_or_general_work_only(self) -> None:
        project = crud.create_project(
            self.session,
            schemas.ProjectCreate(
                name="Content Engine",
                description="LinkedIn posts, essays, and publishing tasks.",
                type=models.ProjectType.continuous,
            ),
            self.user,
        )

        with patch.object(
            crud,
            "_call_openai_json",
            return_value={
                "corrected_text": "Draft a LinkedIn post",
                "project_id": project.id,
                "estimated_minutes": 45,
                "importance": 4,
            },
        ):
            response = crud.log_goal_entry(
                self.session,
                schemas.GoalLogRequest(text="+ draft linkedin post"),
                self.user,
            )

        self.assertEqual(response.task.project_id, project.id)
        self.assertEqual(len(crud.list_projects(self.session, self.user)), 1)

        with patch.object(
            crud,
            "_call_openai_json",
            return_value={
                "corrected_text": "Handle an unmatched errand",
                "project_id": None,
                "estimated_minutes": 20,
                "importance": 2,
            },
        ):
            fallback_response = crud.log_goal_entry(
                self.session,
                schemas.GoalLogRequest(text="+ handle unmatched errand"),
                self.user,
            )

        fallback_project = crud.get_project(self.session, fallback_response.task.project_id, self.user)
        self.assertEqual(fallback_project.name, "General Work")
        self.assertEqual(fallback_project.type, models.ProjectType.continuous)
        self.assertFalse(any(item.name.endswith(" Actions") for item in crud.list_projects(self.session, self.user)))


if __name__ == "__main__":
    unittest.main()
