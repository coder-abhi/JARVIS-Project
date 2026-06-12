import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models as root_models
from app.database import Base
from app.features.helping_hands import schemas, service


class HelpingHandsStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()
        self.session.add_all(
            [
                root_models.User(id="user-1", username="first", password_hash="hash"),
                root_models.User(id="user-2", username="second", password_hash="hash"),
            ]
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_transaction_upsert_round_trips_and_is_user_scoped(self) -> None:
        sent = schemas.HelpingHandsTransaction(
            id="transaction-1",
            member="Asha",
            direction="sent",
            amount=5000,
            date="2026-06-10",
        )
        saved = service.upsert_transaction(self.session, user_id="user-1", transaction=sent)
        updated = service.upsert_transaction(
            self.session,
            user_id="user-1",
            transaction=sent.model_copy(update={"amount": 4500, "note": "Corrected"}),
        )
        other_user = service.get_helping_hands_data(self.session, user_id="user-2")

        self.assertEqual(len(saved.transactions), 1)
        self.assertEqual(len(updated.transactions), 1)
        self.assertEqual(updated.transactions[0].amount, 4500)
        self.assertEqual(updated.transactions[0].note, "Corrected")
        self.assertTrue(updated.transactions[0].createdAt)
        self.assertEqual(other_user.transactions, [])

    def test_transaction_delete_is_scoped_and_requires_existing_id(self) -> None:
        service.upsert_transaction(
            self.session,
            user_id="user-1",
            transaction=schemas.HelpingHandsTransaction(
                id="transaction-1",
                member="Ravi",
                direction="received",
                amount=3000,
                date="2026-06-14",
            ),
        )

        deleted = service.delete_transaction(
            self.session,
            user_id="user-1",
            transaction_id="transaction-1",
        )

        self.assertEqual(deleted.transactions, [])
        with self.assertRaises(ValueError):
            service.delete_transaction(
                self.session,
                user_id="user-2",
                transaction_id="transaction-1",
            )

    def test_transaction_date_must_be_a_real_calendar_date(self) -> None:
        with self.assertRaises(ValidationError):
            schemas.HelpingHandsTransaction(
                id="invalid-date",
                member="Asha",
                direction="sent",
                amount=100,
                date="2026-99-99",
            )

    def test_start_month_persists_with_transactions(self) -> None:
        saved = service.update_start_month(
            self.session,
            user_id="user-1",
            start_month="2025-12",
        )
        updated = service.upsert_transaction(
            self.session,
            user_id="user-1",
            transaction=schemas.HelpingHandsTransaction(
                id="transaction-1",
                member="Ravi",
                direction="received",
                amount=3000,
                date="2025-12-08",
            ),
        )

        self.assertEqual(saved.startMonth, "2025-12")
        self.assertEqual(updated.startMonth, "2025-12")
        self.assertEqual(
            service.get_helping_hands_data(self.session, user_id="user-2").startMonth,
            "",
        )


if __name__ == "__main__":
    unittest.main()
