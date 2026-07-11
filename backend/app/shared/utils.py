import json
from datetime import datetime, timezone


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def as_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def bounded_int(value: object, minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = round(float(value))
    except (TypeError, ValueError):
        return default
    return min(max(parsed, minimum), maximum)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def as_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
