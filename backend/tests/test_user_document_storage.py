import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.features.storage import service


class UserDocumentStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()
        self.session.add_all(
            [
                models.User(id="user-1", username="first", password_hash="hash"),
                models.User(id="user-2", username="second", password_hash="hash"),
            ]
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_user_documents_table_is_created(self) -> None:
        self.assertIn("user_documents", inspect(self.engine).get_table_names())

    def test_documents_are_updated_and_isolated_per_user(self) -> None:
        service.write_user_document(
            self.session,
            user_id="user-1",
            key="wealth-command",
            data={"accounts": [{"id": "account-1"}]},
        )
        service.write_user_document(
            self.session,
            user_id="user-2",
            key="wealth-command",
            data={"accounts": [{"id": "account-2"}]},
        )
        service.write_user_document(
            self.session,
            user_id="user-1",
            key="wealth-command",
            data={"accounts": [{"id": "account-1"}], "cards": [{"id": "card-1"}]},
        )

        first = service.read_user_document(self.session, user_id="user-1", key="wealth-command")
        second = service.read_user_document(self.session, user_id="user-2", key="wealth-command")
        missing = service.read_user_document(self.session, user_id="user-1", key="app-settings")

        self.assertEqual(first["data"]["cards"], [{"id": "card-1"}])
        self.assertEqual(second["data"], {"accounts": [{"id": "account-2"}]})
        self.assertIsNone(missing["data"])


if __name__ == "__main__":
    unittest.main()
