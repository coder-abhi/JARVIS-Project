import os
import unittest
from unittest.mock import patch

from app import auth


class AuthConfigurationTests(unittest.TestCase):
    def test_missing_secret_is_rejected(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "AUTH_SECRET_KEY must be set"):
                auth.validate_auth_configuration()

    def test_legacy_secret_key_is_supported(self) -> None:
        with patch.dict(
            os.environ,
            {"SECRET_KEY": "legacy-secret-key-that-is-at-least-32-bytes"},
            clear=True,
        ):
            auth.validate_auth_configuration()

    def test_placeholder_secret_is_rejected(self) -> None:
        with patch.dict(
            os.environ,
            {"AUTH_SECRET_KEY": "change-me-for-your-machine"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "AUTH_SECRET_KEY must be set"):
                auth.validate_auth_configuration()

    def test_access_token_round_trip_uses_configured_secret(self) -> None:
        with patch.dict(
            os.environ,
            {"AUTH_SECRET_KEY": "test-secret-key-that-is-at-least-32-bytes"},
            clear=True,
        ):
            token = auth.create_access_token("user-1")
            self.assertEqual(auth.verify_access_token(token), "user-1")


if __name__ == "__main__":
    unittest.main()
