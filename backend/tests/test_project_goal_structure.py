import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
