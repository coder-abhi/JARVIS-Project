import importlib
import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app import crud, models
from app.database import Base
from app.features.ai import models as ai_models
from app.features.ai import service as ai_service


goals_router = importlib.import_module("app.features.goals.router")


class FakeOpenAI:
    calls = 0
    delay_seconds = 0
    outputs: list[object] = []
    lock = threading.Lock()

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.responses = self

    @classmethod
    def configure(cls, *outputs: object, delay_seconds: float = 0) -> None:
        cls.calls = 0
        cls.delay_seconds = delay_seconds
        cls.outputs = list(outputs)

    def create(self, **_kwargs):
        with self.lock:
            call_index = self.calls
            type(self).calls += 1
        if self.delay_seconds:
            time.sleep(self.delay_seconds)

        output = self.outputs[min(call_index, len(self.outputs) - 1)]
        if isinstance(output, Exception):
            raise output
        output_text = output if isinstance(output, str) else json.dumps(output)
        usage = SimpleNamespace(
            input_tokens=100,
            output_tokens=25,
            total_tokens=125,
            input_tokens_details=SimpleNamespace(cached_tokens=0),
            output_tokens_details=SimpleNamespace(reasoning_tokens=0),
        )
        return SimpleNamespace(
            id=f"response-{call_index}",
            model="gpt-4.1-mini",
            output_text=output_text,
            usage=usage,
        )


class AiResponseCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = os.path.join(self.temp_dir.name, "test.db")
        self.engine = create_engine(
            f"sqlite:///{database_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session_patcher = patch.object(ai_service, "SessionLocal", self.session_factory)
        self.openai_patcher = patch.object(crud, "OpenAI", FakeOpenAI)
        self.environment_patcher = patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "gpt-4.1-mini"},
        )
        self.session_patcher.start()
        self.openai_patcher.start()
        self.environment_patcher.start()
        with ai_service._cache_locks_guard:
            ai_service._cache_locks.clear()

    def tearDown(self) -> None:
        self.environment_patcher.stop()
        self.openai_patcher.stop()
        self.session_patcher.stop()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_sequential_identical_requests_use_one_openai_call(self) -> None:
        FakeOpenAI.configure({"value": "cached"})

        first = self.call_ai()
        second = self.call_ai()

        self.assertEqual(first, {"value": "cached"})
        self.assertEqual(second, first)
        self.assertEqual(FakeOpenAI.calls, 1)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 1)
        self.assertEqual(self.count_rows(ai_models.AiUsageEvent), 1)

    def test_concurrent_identical_requests_use_one_openai_call(self) -> None:
        FakeOpenAI.configure({"value": "shared"}, delay_seconds=0.08)

        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(lambda _index: self.call_ai(user_prompt="same"), range(5)))

        self.assertEqual(results, [{"value": "shared"}] * 5)
        self.assertEqual(FakeOpenAI.calls, 1)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 1)
        self.assertEqual(self.count_rows(ai_models.AiUsageEvent), 1)

    def test_cache_isolated_by_user_feature_model_prompt_and_token_limit(self) -> None:
        FakeOpenAI.configure({"value": "fresh"})

        self.call_ai()
        self.call_ai(user_id="user-2")
        self.call_ai(feature="other_feature")
        self.call_ai(user_prompt="different")
        self.call_ai(max_tokens=301)
        with patch.dict(os.environ, {"OPENAI_MODEL": "different-model"}):
            self.call_ai()

        self.assertEqual(FakeOpenAI.calls, 6)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 6)

    def test_force_refresh_replaces_cache_and_records_each_paid_call(self) -> None:
        FakeOpenAI.configure({"version": 1}, {"version": 2})

        first = self.call_ai()
        second = self.call_ai(force_refresh=True)
        cached = self.call_ai()

        self.assertEqual(first, {"version": 1})
        self.assertEqual(second, {"version": 2})
        self.assertEqual(cached, {"version": 2})
        self.assertEqual(FakeOpenAI.calls, 2)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 1)
        self.assertEqual(self.count_rows(ai_models.AiUsageEvent), 2)

    def test_cache_history_is_bounded_per_user_feature_and_model(self) -> None:
        FakeOpenAI.configure({"value": "fresh"})

        for index in range(ai_service.AI_CACHE_ENTRIES_PER_FEATURE + 5):
            self.call_ai(user_prompt=f"prompt-{index}")

        self.assertEqual(
            self.count_rows(ai_models.AiResponseCache),
            ai_service.AI_CACHE_ENTRIES_PER_FEATURE,
        )

    def test_failed_request_is_not_cached(self) -> None:
        FakeOpenAI.configure(OSError("offline"), {"value": "recovered"})

        first = self.call_ai()
        second = self.call_ai()

        self.assertEqual(first, {})
        self.assertEqual(second, {"value": "recovered"})
        self.assertEqual(FakeOpenAI.calls, 2)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 1)
        self.assertEqual(self.usage_statuses(), ["failed", "success"])

    def test_ai_feature_settings_default_on_and_persist_per_user(self) -> None:
        with self.session_factory() as session:
            defaults = ai_service.list_ai_feature_settings(session, user_id="user-1")
            updated = ai_service.update_ai_feature_setting(
                session,
                user_id="user-1",
                feature="book_recommendations",
                enabled=False,
            )
            user_one = ai_service.list_ai_feature_settings(session, user_id="user-1")
            user_two = ai_service.list_ai_feature_settings(session, user_id="user-2")

        self.assertEqual(len(defaults), len(ai_service.FEATURE_KEYS))
        self.assertTrue(all(setting["enabled"] for setting in defaults))
        self.assertIsNotNone(updated)
        self.assertFalse(next(setting["enabled"] for setting in user_one if setting["feature"] == "book_recommendations"))
        self.assertTrue(next(setting["enabled"] for setting in user_two if setting["feature"] == "book_recommendations"))

    def test_unknown_ai_feature_setting_is_rejected(self) -> None:
        with self.session_factory() as session:
            updated = ai_service.update_ai_feature_setting(
                session,
                user_id="user-1",
                feature="unknown",
                enabled=False,
            )

        self.assertIsNone(updated)
        self.assertEqual(self.count_rows(ai_models.AiFeatureSetting), 0)

    def test_disabled_feature_blocks_cached_and_forced_openai_results(self) -> None:
        FakeOpenAI.configure({"value": "cached"}, {"value": "should-not-run"})
        first = self.call_ai(feature="book_recommendations")

        with self.session_factory() as session:
            ai_service.update_ai_feature_setting(
                session,
                user_id="user-1",
                feature="book_recommendations",
                enabled=False,
            )

        cached_attempt = self.call_ai(feature="book_recommendations")
        forced_attempt = self.call_ai(feature="book_recommendations", force_refresh=True)

        self.assertEqual(first, {"value": "cached"})
        self.assertEqual(cached_attempt, {})
        self.assertEqual(forced_attempt, {})
        self.assertEqual(FakeOpenAI.calls, 1)
        self.assertEqual(self.count_rows(ai_models.AiUsageEvent), 1)

    def test_invalid_json_is_not_cached(self) -> None:
        FakeOpenAI.configure("not-json", {"value": "valid"})

        first = self.call_ai()
        second = self.call_ai()

        self.assertEqual(first, {})
        self.assertEqual(second, {"value": "valid"})
        self.assertEqual(FakeOpenAI.calls, 2)
        self.assertEqual(self.count_rows(ai_models.AiResponseCache), 1)
        self.assertEqual(self.usage_statuses(), ["invalid_json", "success"])

    def test_book_recommendation_dependencies_invalidate_only_relevant_changes(self) -> None:
        FakeOpenAI.configure(
            {
                "suggestions": [
                    {
                        "title": "Recommendation",
                        "author": "Author",
                        "category": "General",
                        "reason": "Reason",
                    }
                ]
            }
        )
        book = models.Book(
            id="book-1",
            user_id="user-1",
            title="Existing",
            author="Writer",
            area="General",
            category="General",
            total_pages=200,
            current_page=20,
            status=models.BookStatus.reading,
            liked=False,
            rating=7,
            purchase_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            purchase_price=10,
            created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )

        crud.generate_book_suggestions([book], user_id="user-1")
        book.purchase_price = 20
        crud.generate_book_suggestions([book], user_id="user-1")
        book.liked = True
        crud.generate_book_suggestions([book], user_id="user-1")

        self.assertEqual(FakeOpenAI.calls, 2)

    def test_next_reading_dependencies_include_progress_but_not_purchase_price(self) -> None:
        FakeOpenAI.configure(
            {
                "recommendations": [
                    {
                        "book_id": "book-1",
                        "reason": "Continue this book.",
                    }
                ]
            }
        )
        book = self.make_book()

        crud.generate_next_owned_book_suggestions([book], user_id="user-1")
        book.purchase_price = 20
        crud.generate_next_owned_book_suggestions([book], user_id="user-1")
        book.current_page = 40
        crud.generate_next_owned_book_suggestions([book], user_id="user-1")

        self.assertEqual(FakeOpenAI.calls, 2)

    def test_goal_next_action_dependencies_include_goals_completions_and_tasks(self) -> None:
        FakeOpenAI.configure(
            {
                "actions": [
                    {
                        "title": "Do the next step",
                        "related_goal": "Ship",
                        "importance": 4,
                        "urgency": 3,
                    }
                ]
            }
        )
        goal = models.Goal(
            id="goal-1",
            user_id="user-1",
            category=models.GoalCategory.monthly,
            title="Ship",
            target_value=10,
            current_value=2,
            unit="tasks",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        project = models.Project(
            id="project-1",
            user_id="user-1",
            name="Project",
            type=models.ProjectType.fixed,
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            linked_goals=[goal],
        )
        task = models.Task(
            id="task-1",
            project_id=project.id,
            title="Initial task",
            description="Original",
            status=models.TaskStatus.todo,
            priority=models.TaskPriority.high,
            importance_rating=4,
            eta_hours=1,
            time_spent_hours=0,
            created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            project=project,
        )
        completion = models.CompletedGoalLog(
            id="completion-1",
            user_id="user-1",
            goal_id=goal.id,
            title="Earlier work",
            goal_label=goal.title,
            created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
        )

        crud.generate_goal_next_actions([goal], [completion], [task], user_id="user-1")
        task.description = "Not part of the AI context"
        crud.generate_goal_next_actions([goal], [completion], [task], user_id="user-1")
        task.title = "Changed task"
        crud.generate_goal_next_actions([goal], [completion], [task], user_id="user-1")
        completion.title = "Changed completion"
        crud.generate_goal_next_actions([goal], [completion], [task], user_id="user-1")
        goal.current_value = 3
        crud.generate_goal_next_actions([goal], [completion], [task], user_id="user-1")

        self.assertEqual(FakeOpenAI.calls, 4)

    def test_goal_next_actions_route_forwards_explicit_refresh(self) -> None:
        current_user = SimpleNamespace(id="user-1")
        db = object()
        with patch.object(crud, "suggest_goal_next_actions", return_value=[]) as suggest:
            result = self.run_async(
                goals_router.next_goal_actions(
                    refresh=True,
                    db=db,
                    current_user=current_user,
                )
            )

        self.assertEqual(result, [])
        suggest.assert_called_once_with(db, current_user, force_refresh=True)

    def call_ai(
        self,
        *,
        user_id: str = "user-1",
        feature: str = "test_feature",
        user_prompt: str = "prompt",
        max_tokens: int = 300,
        force_refresh: bool = False,
    ) -> dict:
        return crud._call_openai_json(
            "system",
            user_prompt,
            max_tokens,
            feature=feature,
            user_id=user_id,
            force_refresh=force_refresh,
        )

    def count_rows(self, model: type) -> int:
        with self.session_factory() as session:
            return int(session.scalar(select(func.count()).select_from(model)) or 0)

    def usage_statuses(self) -> list[str]:
        with self.session_factory() as session:
            return list(session.scalars(select(ai_models.AiUsageEvent.status).order_by(ai_models.AiUsageEvent.created_at)))

    def make_book(self) -> models.Book:
        return models.Book(
            id="book-1",
            user_id="user-1",
            title="Existing",
            author="Writer",
            area="General",
            category="General",
            total_pages=200,
            current_page=20,
            status=models.BookStatus.reading,
            liked=False,
            rating=7,
            purchase_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            purchase_price=10,
            created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )

    def run_async(self, coroutine):
        import asyncio

        return asyncio.run(coroutine)


if __name__ == "__main__":
    unittest.main()
