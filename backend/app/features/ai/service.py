import hashlib
import json
import logging
import os
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from threading import Lock
from typing import Iterator

from sqlalchemy.orm import Session

from ...database import SessionLocal
from . import models, repository


logger = logging.getLogger(__name__)

ANONYMOUS_CACHE_USER = "__anonymous__"
AI_CACHE_ENTRIES_PER_FEATURE = 25


@dataclass
class _CacheLockEntry:
    lock: Lock = field(default_factory=Lock)
    users: int = 0


_cache_locks: dict[str, _CacheLockEntry] = {}
_cache_locks_guard = Lock()

FEATURE_LABELS = {
    "book_metadata": "Book metadata",
    "book_recommendations": "Book recommendations",
    "next_reading_recommendations": "Next reading",
    "goal_log_classification": "Goal log",
    "goal_next_actions": "Goal next actions",
    "personality_insight": "Personality insight",
    "pomodoro_assignment": "Pomodoro assignment",
}

# USD per one million tokens. The app's default model and snapshot share these rates.
MODEL_PRICING_PER_MILLION = {
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-4.1-mini-2025-04-14": (0.40, 0.10, 1.60),
}


def ai_status() -> dict[str, str | bool]:
    has_api_key = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "connected": has_api_key,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "message": "OpenAI API key is configured." if has_api_key else "OPENAI_API_KEY is not configured.",
    }


def build_cache_fingerprint(
    *,
    feature: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
) -> str:
    canonical_input = json.dumps(
        {
            "feature": feature,
            "max_tokens": max_tokens,
            "model": model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical_input.encode("utf-8")).hexdigest()


def get_cached_json(
    *,
    user_id: str | None,
    feature: str,
    model: str,
    input_fingerprint: str,
) -> dict | None:
    session = SessionLocal()
    try:
        cached = repository.get_cached_response(
            session,
            user_id=_cache_user_id(user_id),
            feature=feature,
            model=model,
            input_fingerprint=input_fingerprint,
        )
        if cached is None:
            return None
        try:
            data = json.loads(cached.response_json)
        except json.JSONDecodeError:
            logger.warning("Ignoring invalid cached AI JSON for %s.", feature)
            return None
        return data if isinstance(data, dict) else None
    finally:
        session.close()


def store_cached_json(
    *,
    user_id: str | None,
    feature: str,
    model: str,
    input_fingerprint: str,
    data: dict,
) -> None:
    session = SessionLocal()
    cache_user_id = _cache_user_id(user_id)
    try:
        repository.upsert_cached_response(
            session,
            user_id=cache_user_id,
            feature=feature,
            model=model,
            input_fingerprint=input_fingerprint,
            response_json=json.dumps(data, ensure_ascii=True, separators=(",", ":"), sort_keys=True),
        )
        repository.prune_cached_responses(
            session,
            user_id=cache_user_id,
            feature=feature,
            model=model,
            keep=AI_CACHE_ENTRIES_PER_FEATURE,
        )
    except Exception:
        session.rollback()
        logger.exception("Could not persist AI response cache.")
    finally:
        session.close()


@contextmanager
def cache_lock(
    *,
    user_id: str | None,
    feature: str,
    model: str,
    input_fingerprint: str,
) -> Iterator[None]:
    lock_key = ":".join((_cache_user_id(user_id), feature, model, input_fingerprint))
    with _cache_locks_guard:
        entry = _cache_locks.setdefault(lock_key, _CacheLockEntry())
        entry.users += 1
    try:
        with entry.lock:
            yield
    finally:
        with _cache_locks_guard:
            entry.users -= 1
            if entry.users == 0 and _cache_locks.get(lock_key) is entry:
                del _cache_locks[lock_key]


def _cache_user_id(user_id: str | None) -> str:
    return user_id or ANONYMOUS_CACHE_USER


def record_ai_usage(
    *,
    db: Session | None = None,
    user_id: str | None,
    feature: str,
    model: str,
    response_id: str | None,
    input_tokens: int = 0,
    cached_input_tokens: int = 0,
    output_tokens: int = 0,
    reasoning_tokens: int = 0,
    total_tokens: int = 0,
    status: str = "success",
    latency_ms: int = 0,
) -> None:
    cost_usd, pricing_available, pricing_source = estimate_cost_usd(
        model=model,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
    )
    session = db or SessionLocal()
    owns_session = db is None
    try:
        session.add(
            models.AiUsageEvent(
                user_id=user_id,
                openai_response_id=response_id,
                feature=feature,
                model=model,
                input_tokens=input_tokens,
                cached_input_tokens=cached_input_tokens,
                output_tokens=output_tokens,
                reasoning_tokens=reasoning_tokens,
                total_tokens=total_tokens,
                estimated_cost_usd=cost_usd,
                pricing_available=pricing_available,
                pricing_source=pricing_source,
                status=status,
                latency_ms=max(latency_ms, 0),
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("Could not persist OpenAI usage telemetry.")
    finally:
        if owns_session:
            session.close()


def estimate_cost_usd(
    *,
    model: str,
    input_tokens: int,
    cached_input_tokens: int,
    output_tokens: int,
) -> tuple[float, bool, str | None]:
    pricing = _pricing_for_model(model)
    if pricing is None:
        return 0, False, None

    input_rate, cached_rate, output_rate, source = pricing
    cached_tokens = min(max(cached_input_tokens, 0), max(input_tokens, 0))
    uncached_tokens = max(input_tokens - cached_tokens, 0)
    cost = (
        (uncached_tokens * input_rate)
        + (cached_tokens * cached_rate)
        + (max(output_tokens, 0) * output_rate)
    ) / 1_000_000
    return cost, True, source


def get_cost_summary(
    db: Session,
    *,
    user_id: str,
    days: int,
    timezone_offset_minutes: int,
) -> dict:
    events = repository.list_usage_events(db, user_id)
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=timezone_offset_minutes)
    local_today = local_now.date()
    period_start_local = local_today - timedelta(days=days - 1) if days else None
    period_start_utc = (
        datetime.combine(period_start_local, time.min, tzinfo=timezone.utc)
        + timedelta(minutes=timezone_offset_minutes)
        if period_start_local
        else None
    )

    selected = [
        event
        for event in events
        if period_start_utc is None or _as_aware(event.created_at) >= period_start_utc
    ]
    today_events = [event for event in events if _local_date(event.created_at, timezone_offset_minutes) == local_today]
    month_events = [
        event
        for event in events
        if (
            _local_date(event.created_at, timezone_offset_minutes).year,
            _local_date(event.created_at, timezone_offset_minutes).month,
        )
        == (local_today.year, local_today.month)
    ]

    total_cost_cents = _cost_cents(selected)
    feature_groups: dict[str, list[models.AiUsageEvent]] = defaultdict(list)
    daily_groups: dict[date, list[models.AiUsageEvent]] = defaultdict(list)
    for event in selected:
        feature_groups[event.feature].append(event)
        daily_groups[_local_date(event.created_at, timezone_offset_minutes)].append(event)

    by_feature = []
    for feature, feature_events in feature_groups.items():
        feature_cost = _cost_cents(feature_events)
        by_feature.append(
            {
                "feature": feature,
                "label": feature_label(feature),
                "cost_cents": _rounded(feature_cost),
                "share_percentage": _rounded((feature_cost / total_cost_cents) * 100 if total_cost_cents else 0),
                "requests": len(feature_events),
                "input_tokens": sum(event.input_tokens for event in feature_events),
                "cached_input_tokens": sum(event.cached_input_tokens for event in feature_events),
                "output_tokens": sum(event.output_tokens for event in feature_events),
                "total_tokens": sum(event.total_tokens for event in feature_events),
                "average_cost_cents": _rounded(feature_cost / len(feature_events) if feature_events else 0),
            }
        )
    by_feature.sort(key=lambda item: (item["cost_cents"], item["requests"]), reverse=True)

    daily_start = period_start_local
    if daily_start is None and selected:
        daily_start = min(_local_date(event.created_at, timezone_offset_minutes) for event in selected)
    daily = []
    if daily_start is not None:
        cursor = daily_start
        while cursor <= local_today:
            day_events = daily_groups.get(cursor, [])
            daily.append(
                {
                    "date": cursor.isoformat(),
                    "cost_cents": _rounded(_cost_cents(day_events)),
                    "requests": len(day_events),
                    "total_tokens": sum(event.total_tokens for event in day_events),
                }
            )
            cursor += timedelta(days=1)

    return {
        "period_days": days or None,
        "period_start": period_start_utc,
        "total_cost_cents": _rounded(total_cost_cents),
        "today_cost_cents": _rounded(_cost_cents(today_events)),
        "month_cost_cents": _rounded(_cost_cents(month_events)),
        "total_requests": len(selected),
        "successful_requests": sum(event.status == "success" for event in selected),
        "failed_requests": sum(event.status != "success" for event in selected),
        "unpriced_requests": sum(not event.pricing_available for event in selected),
        "input_tokens": sum(event.input_tokens for event in selected),
        "cached_input_tokens": sum(event.cached_input_tokens for event in selected),
        "output_tokens": sum(event.output_tokens for event in selected),
        "total_tokens": sum(event.total_tokens for event in selected),
        "average_cost_cents": _rounded(total_cost_cents / len(selected) if selected else 0),
        "by_feature": by_feature,
        "daily": daily,
        "recent_requests": [
            {
                "id": event.id,
                "feature": event.feature,
                "label": feature_label(event.feature),
                "model": event.model,
                "cost_cents": _rounded(event.estimated_cost_usd * 100),
                "total_tokens": event.total_tokens,
                "status": event.status,
                "latency_ms": event.latency_ms,
                "pricing_available": event.pricing_available,
                "created_at": _as_aware(event.created_at),
            }
            for event in selected[:8]
        ],
    }


def feature_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, feature.replace("_", " ").title())


def _pricing_for_model(model: str) -> tuple[float, float, float, str] | None:
    override_names = (
        "OPENAI_INPUT_COST_PER_MILLION",
        "OPENAI_CACHED_INPUT_COST_PER_MILLION",
        "OPENAI_OUTPUT_COST_PER_MILLION",
    )
    if all(os.getenv(name) for name in override_names):
        try:
            return (
                float(os.environ[override_names[0]]),
                float(os.environ[override_names[1]]),
                float(os.environ[override_names[2]]),
                "environment override",
            )
        except ValueError:
            logger.warning("OpenAI pricing overrides must be numeric.")

    rates = MODEL_PRICING_PER_MILLION.get(model)
    if rates is None:
        return None
    return (*rates, "OpenAI standard token pricing")


def _cost_cents(events: list[models.AiUsageEvent]) -> float:
    return sum(event.estimated_cost_usd for event in events) * 100


def _local_date(value: datetime, timezone_offset_minutes: int) -> date:
    return (_as_aware(value) - timedelta(minutes=timezone_offset_minutes)).date()


def _as_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _rounded(value: float) -> float:
    return round(value, 6)
