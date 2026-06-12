import unittest
from unittest.mock import patch

from app import feature_registry


class FeatureRegistryTests(unittest.TestCase):
    def test_disabled_dependencies_disable_dependent_features(self) -> None:
        with patch.object(
            feature_registry,
            "_load_feature_settings",
            return_value={"auth": False, "projects": True, "tasks": True, "ai": True},
        ):
            enabled_keys = {feature.key for feature in feature_registry.enabled_features()}

        self.assertNotIn("auth", enabled_keys)
        self.assertNotIn("projects", enabled_keys)
        self.assertNotIn("tasks", enabled_keys)
        self.assertIn("ai", enabled_keys)

    def test_disabling_projects_disables_project_dependent_features(self) -> None:
        with patch.object(
            feature_registry,
            "_load_feature_settings",
            return_value={"auth": True, "projects": False},
        ):
            enabled_keys = {feature.key for feature in feature_registry.enabled_features()}

        self.assertIn("auth", enabled_keys)
        self.assertNotIn("projects", enabled_keys)
        self.assertNotIn("tasks", enabled_keys)
        self.assertNotIn("pomodoro", enabled_keys)
        self.assertNotIn("goals", enabled_keys)
        self.assertIn("library", enabled_keys)


if __name__ == "__main__":
    unittest.main()
