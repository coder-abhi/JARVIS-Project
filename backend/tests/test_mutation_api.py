import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


class MutationApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(
            f"sqlite:///{database_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)

        def override_db():
            session = self.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        signup = self.client.post(
            "/auth/signup",
            json={"username": "tester", "password": "password"},
        )
        self.assertEqual(signup.status_code, 201)
        token = signup.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {token}"}

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_settings_finance_and_pomodoro_mutations(self) -> None:
        settings = self.client.put(
            "/settings",
            headers=self.headers,
            json={
                "default_project_type": "continuous",
                "default_task_priority": "high",
                "default_task_status": "in_progress",
                "default_task_minutes": 45,
                "show_week_operations_plan": False,
                "show_efficiency_report": True,
                "show_time_allocation": True,
            },
        )
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.json()["default_task_minutes"], 45)

        account = self.client.post(
            "/money/accounts",
            headers=self.headers,
            json={
                "id": "account-1",
                "bankName": "Main Bank",
                "name": "Checking",
                "accountType": "Current",
                "balance": 1000,
            },
        )
        self.assertEqual(account.status_code, 201)

        transaction = self.client.post(
            "/money/transactions",
            headers=self.headers,
            json={
                "id": "transaction-1",
                "type": "expense",
                "amount": 25,
                "description": "Lunch",
                "category": "Food",
                "dateTime": datetime(2026, 6, 10, 12, 0).isoformat(),
                "sourceKind": "account",
                "sourceId": "account-1",
                "tags": ["#food"],
            },
        )
        self.assertEqual(transaction.status_code, 201)
        self.assertIn("Food", [category["name"] for category in transaction.json()["categories"]])

        invalid = self.client.post(
            "/money/transactions",
            headers=self.headers,
            json={
                "type": "expense",
                "amount": 25,
                "description": "Invalid",
                "category": "Food",
                "dateTime": datetime(2026, 6, 10, 12, 0).isoformat(),
                "sourceKind": "account",
                "sourceId": "missing",
            },
        )
        self.assertEqual(invalid.status_code, 404)

        pomodoro = self.client.post(
            "/pomodoro/sessions",
            headers=self.headers,
            json={
                "id": "session-1",
                "completedAt": "2026-06-10T10:25:00Z",
                "startAt": "2026-06-10T10:00:00Z",
                "minutes": 25,
                "mode": "focus",
                "done": "Storage refactor",
                "focus": 90,
            },
        )
        self.assertEqual(pomodoro.status_code, 201)
        self.assertEqual(pomodoro.json()["done"], "Storage refactor")
        self.assertEqual(pomodoro.json()["startAt"], "2026-06-10T10:00:00Z")
        self.assertEqual(pomodoro.json()["endAt"], "2026-06-10T10:25:00Z")

        pomodoro_history = self.client.get("/pomodoro/sessions", headers=self.headers)
        self.assertEqual(pomodoro_history.status_code, 200)
        self.assertEqual(pomodoro_history.json()[0]["startAt"], "2026-06-10T10:00:00Z")
        self.assertEqual(pomodoro_history.json()[0]["endAt"], "2026-06-10T10:25:00Z")

    def test_library_page_count_update_and_historical_reading_log(self) -> None:
        book = self.client.post(
            "/library/books",
            headers=self.headers,
            json={
                "title": "Test Book",
                "author": "Test Author",
                "category": "Technical",
                "total_pages": 200,
                "status": "reading",
                "liked": False,
            },
        )
        self.assertEqual(book.status_code, 201)
        book_id = book.json()["id"]

        reading_log = self.client.post(
            "/library/reading-logs",
            headers=self.headers,
            json={
                "book_id": book_id,
                "start_page": 1,
                "end_page": 50,
                "read_at": "2026-06-09T12:00:00Z",
            },
        )
        self.assertEqual(reading_log.status_code, 201)
        self.assertEqual(datetime.fromisoformat(reading_log.json()["read_at"]).date().isoformat(), "2026-06-09")

        updated = self.client.put(
            f"/library/books/{book_id}",
            headers=self.headers,
            json={"total_pages": 250},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["total_pages"], 250)
        self.assertEqual(updated.json()["current_page"], 50)
        self.assertEqual(updated.json()["pages_remaining"], 200)

    def test_helping_hands_uses_one_transaction_upsert_for_create_and_update(self) -> None:
        payload = {
            "id": "helping-transaction-1",
            "member": "Asha",
            "direction": "sent",
            "amount": 5000,
            "date": "2026-06-10",
            "note": "",
            "createdAt": "",
        }
        created = self.client.put(
            "/helping-hands/transactions/helping-transaction-1",
            headers=self.headers,
            json=payload,
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(len(created.json()["transactions"]), 1)
        self.assertTrue(created.json()["transactions"][0]["createdAt"])

        payload["amount"] = 4500
        payload["note"] = "Corrected amount"
        updated = self.client.put(
            "/helping-hands/transactions/helping-transaction-1",
            headers=self.headers,
            json=payload,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(len(updated.json()["transactions"]), 1)
        self.assertEqual(updated.json()["transactions"][0]["amount"], 4500)
        self.assertEqual(updated.json()["transactions"][0]["note"], "Corrected amount")


if __name__ == "__main__":
    unittest.main()
