from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FeatureDefinition:
    key: str
    name: str
    router: Any = None
    depends_on: tuple[str, ...] = ()
    enabled_by_default: bool = True
