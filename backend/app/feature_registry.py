from dataclasses import dataclass
import json
from pathlib import Path
from typing import Iterable

from fastapi import APIRouter

from .features.ai.router import router as ai_router
from .features.auth.router import router as auth_router
from .features.goals.router import router as goals_router
from .features.library.router import router as library_router
from .features.money.router import router as money_router
from .features.pomodoro.router import router as pomodoro_router
from .features.projects.router import router as projects_router
from .features.settings.router import router as settings_router
from .features.tasks.router import router as tasks_router


@dataclass(frozen=True)
class FeatureDefinition:
    key: str
    name: str
    router: APIRouter
    depends_on: tuple[str, ...] = ()
    enabled_by_default: bool = True


FEATURES: tuple[FeatureDefinition, ...] = (
    FeatureDefinition("auth", "Local authentication", auth_router),
    FeatureDefinition("projects", "Projects dashboard", projects_router, depends_on=("auth",)),
    FeatureDefinition("tasks", "Tasks and assignment", tasks_router, depends_on=("auth", "projects")),
    FeatureDefinition("pomodoro", "Pomodoro desktop workflow", pomodoro_router, depends_on=("auth", "projects", "tasks")),
    FeatureDefinition("goals", "Goals cockpit", goals_router, depends_on=("auth", "projects", "tasks")),
    FeatureDefinition("library", "Reading library", library_router, depends_on=("auth",)),
    FeatureDefinition("money", "Wealth Command", money_router, depends_on=("auth",)),
    FeatureDefinition("settings", "User preferences", settings_router, depends_on=("auth",)),
    FeatureDefinition("ai", "AI cost surveillance", ai_router),
)


def enabled_features() -> list[FeatureDefinition]:
    settings = _load_feature_settings()
    return [feature for feature in FEATURES if settings.get(feature.key, feature.enabled_by_default)]


def include_enabled_feature_routers(app) -> None:
    for feature in enabled_features():
        app.include_router(feature.router)


def feature_manifest() -> list[dict]:
    enabled_keys = {feature.key for feature in enabled_features()}
    return [
        {
            "key": feature.key,
            "name": feature.name,
            "enabled": feature.key in enabled_keys,
            "depends_on": list(feature.depends_on),
        }
        for feature in FEATURES
    ]


def _load_feature_settings() -> dict[str, bool]:
    settings_path = Path(__file__).resolve().parents[2] / "data" / "feature_settings.json"
    if not settings_path.exists():
        return {}
    try:
        raw = json.loads(settings_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {str(key): bool(value) for key, value in raw.items()}
