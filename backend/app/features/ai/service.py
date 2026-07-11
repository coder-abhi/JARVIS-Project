import hashlib
import json
import logging
import os
import re
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from threading import Lock
from time import perf_counter
from typing import Iterator

from sqlalchemy.orm import Session

from ...database import SessionLocal
from . import models, repository

try:
    from openai import OpenAI, OpenAIError
except ImportError:  # pragma: no cover - depends on local environment setup
    OpenAI = None
    OpenAIError = Exception


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
    "captain_compass": "Captain Compass",
}

FEATURE_DESCRIPTIONS = {
    "book_metadata": "Corrects book details and generates chapters when a book is added or chapters are regenerated.",
    "book_recommendations": "Suggests new books to buy from your reading history.",
    "next_reading_recommendations": "Prioritizes which already-owned unread book to read next.",
    "goal_log_classification": "Corrects mission log text, allocates it to an existing project, and estimates effort and importance.",
    "goal_next_actions": "Generates mission analysis and recommended next actions from goals and tasks.",
    "personality_insight": "Generates the working-style insight shown on the Goals page.",
    "pomodoro_assignment": "Matches a completed Pomodoro note to the most relevant project and task.",
    "captain_compass": "Rates execution speed, direction, and consistency from goals and project timelines.",
}

FEATURE_KEYS = tuple(FEATURE_LABELS)
AVAILABLE_MODELS = (
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5-mini",
    "gpt-4.1-mini",
)
FEATURE_DEFAULT_MODELS = {
    "captain_compass": "gpt-5.4-mini",
}

# Standard-processing USD per one million tokens.
MODEL_PRICING_PER_MILLION = {
    "gpt-5.4-mini": (0.75, 0.075, 4.50),
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
}


def ai_status() -> dict[str, str | bool]:
    has_api_key = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "connected": has_api_key,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "message": "OpenAI API key is configured." if has_api_key else "OPENAI_API_KEY is not configured.",
    }


def list_ai_feature_settings(db: Session, *, user_id: str) -> list[dict]:
    saved_settings = {
        setting.feature: setting
        for setting in repository.list_feature_settings(db, user_id)
    }
    return [
        {
            "feature": feature,
            "label": FEATURE_LABELS[feature],
            "description": FEATURE_DESCRIPTIONS[feature],
            "enabled": saved_settings[feature].enabled if feature in saved_settings else True,
            "model": (
                saved_settings[feature].model
                if feature in saved_settings and saved_settings[feature].model
                else default_model_for_feature(feature)
            ),
            "available_models": list(AVAILABLE_MODELS),
        }
        for feature in FEATURE_KEYS
    ]


def update_ai_feature_setting(
    db: Session,
    *,
    user_id: str,
    feature: str,
    enabled: bool | None,
    model: str | None = None,
) -> dict[str, str | bool | list[str]] | None:
    if feature not in FEATURE_LABELS:
        return None
    if model is not None and model not in AVAILABLE_MODELS:
        raise ValueError("Unsupported OpenAI model")
    setting = repository.set_feature_setting(
        db,
        user_id=user_id,
        feature=feature,
        enabled=enabled,
        model=model,
    )
    return {
        "feature": feature,
        "label": FEATURE_LABELS[feature],
        "description": FEATURE_DESCRIPTIONS[feature],
        "enabled": setting.enabled,
        "model": setting.model or default_model_for_feature(feature),
        "available_models": list(AVAILABLE_MODELS),
    }


def is_ai_feature_enabled(*, user_id: str | None, feature: str) -> bool:
    if user_id is None or feature not in FEATURE_LABELS:
        return True
    session = SessionLocal()
    try:
        setting = repository.get_feature_setting(session, user_id=user_id, feature=feature)
        return setting.enabled if setting is not None else True
    finally:
        session.close()


def default_model_for_feature(feature: str) -> str:
    return FEATURE_DEFAULT_MODELS.get(feature, os.getenv("OPENAI_MODEL", "gpt-4.1-mini"))


def resolve_ai_model(*, user_id: str | None, feature: str) -> str:
    default_model = default_model_for_feature(feature)
    if user_id is None or feature not in FEATURE_LABELS:
        return default_model
    session = SessionLocal()
    try:
        setting = repository.get_feature_setting(session, user_id=user_id, feature=feature)
        return setting.model if setting is not None and setting.model else default_model
    finally:
        session.close()


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


def call_ai_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    *,
    feature: str,
    user_id: str | None = None,
    usage_db: Session | None = None,
    use_cache: bool = True,
    force_refresh: bool = False,
    cache_only: bool = False,
) -> dict:
    if not is_ai_feature_enabled(user_id=user_id, feature=feature):
        return {}

    model = resolve_ai_model(user_id=user_id, feature=feature)
    input_fingerprint = build_cache_fingerprint(
        feature=feature,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=max_tokens,
    )

    if use_cache and not force_refresh:
        cached = get_cached_json(
            user_id=user_id,
            feature=feature,
            model=model,
            input_fingerprint=input_fingerprint,
        )
        if cached is not None:
            return cached
        if cache_only:
            return {}

    if cache_only:
        return {}

    if not use_cache:
        return _request_openai_json(
            system_prompt,
            user_prompt,
            max_tokens,
            feature=feature,
            model=model,
            user_id=user_id,
            usage_db=usage_db,
        ) or {}

    with cache_lock(
        user_id=user_id,
        feature=feature,
        model=model,
        input_fingerprint=input_fingerprint,
    ):
        if not force_refresh:
            cached = get_cached_json(
                user_id=user_id,
                feature=feature,
                model=model,
                input_fingerprint=input_fingerprint,
            )
            if cached is not None:
                return cached

        data = _request_openai_json(
            system_prompt,
            user_prompt,
            max_tokens,
            feature=feature,
            model=model,
            user_id=user_id,
            usage_db=usage_db,
        )
        if data is None:
            return {}
        store_cached_json(
            user_id=user_id,
            feature=feature,
            model=model,
            input_fingerprint=input_fingerprint,
            data=data,
        )
        return data


def _request_openai_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    *,
    feature: str,
    model: str,
    user_id: str | None,
    usage_db: Session | None,
) -> dict | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("OPENAI_API_KEY is not set. Skipping OpenAI LLM call.")
        return None

    if OpenAI is None:
        logger.warning("OpenAI Python SDK is not installed. Run `pip install -r backend/requirements.txt`.")
        return None

    client = OpenAI(api_key=api_key)
    started_at = perf_counter()

    try:
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            text={"format": {"type": "json_object"}},
            max_output_tokens=max_tokens,
        )
    except (OpenAIError, OSError) as err:
        record_ai_usage(
            db=usage_db,
            user_id=user_id,
            feature=feature,
            model=model,
            response_id=None,
            status="failed",
            latency_ms=round((perf_counter() - started_at) * 1000),
        )
        logger.warning("OpenAI LLM call failed: %s", err)
        return None

    text = getattr(response, "output_text", None) or _extract_response_text(response)
    usage = getattr(response, "usage", None)
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    cached_input_tokens = int(getattr(input_details, "cached_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    reasoning_tokens = int(getattr(output_details, "reasoning_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", input_tokens + output_tokens) or 0)
    usage_fields = {
        "db": usage_db,
        "user_id": user_id,
        "feature": feature,
        "model": str(getattr(response, "model", model) or model),
        "response_id": getattr(response, "id", None),
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning_tokens,
        "total_tokens": total_tokens,
    }

    try:
        data = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        record_ai_usage(
            **usage_fields,
            status="invalid_json",
            latency_ms=round((perf_counter() - started_at) * 1000),
        )
        logger.warning("OpenAI LLM returned non-JSON content.")
        return None

    if not isinstance(data, dict):
        record_ai_usage(
            **usage_fields,
            status="invalid_json",
            latency_ms=round((perf_counter() - started_at) * 1000),
        )
        logger.warning("OpenAI LLM returned a non-object JSON response.")
        return None

    record_ai_usage(
        **usage_fields,
        status="success",
        latency_ms=round((perf_counter() - started_at) * 1000),
    )
    return data


def _extract_response_text(response: object) -> str:
    response_dict = response.model_dump() if hasattr(response, "model_dump") else {}
    text_parts = []
    for output in response_dict.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text":
                text_parts.append(content.get("text", ""))
    return "".join(text_parts)


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
    _backfill_unpriced_events(db, events)
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
    override_model = os.getenv("OPENAI_PRICING_MODEL") or os.getenv("OPENAI_MODEL")
    if override_model and _model_matches_alias(model, override_model) and all(os.getenv(name) for name in override_names):
        try:
            return (
                float(os.environ[override_names[0]]),
                float(os.environ[override_names[1]]),
                float(os.environ[override_names[2]]),
                f"environment override for {override_model}",
            )
        except ValueError:
            logger.warning("OpenAI pricing overrides must be numeric.")

    priced_model = next(
        (
            candidate
            for candidate in sorted(MODEL_PRICING_PER_MILLION, key=len, reverse=True)
            if _model_matches_alias(model, candidate)
        ),
        None,
    )
    rates = MODEL_PRICING_PER_MILLION.get(priced_model) if priced_model else None
    if rates is None:
        return None
    return (*rates, f"OpenAI standard token pricing for {priced_model}")


def _model_matches_alias(model: str, alias: str) -> bool:
    return model == alias or re.fullmatch(rf"{re.escape(alias)}-\d{{4}}-\d{{2}}-\d{{2}}", model) is not None


def _backfill_unpriced_events(db: Session, events: list[models.AiUsageEvent]) -> None:
    updated = 0
    for event in events:
        if event.pricing_available:
            continue
        cost_usd, pricing_available, pricing_source = estimate_cost_usd(
            model=event.model,
            input_tokens=event.input_tokens,
            cached_input_tokens=event.cached_input_tokens,
            output_tokens=event.output_tokens,
        )
        if not pricing_available:
            continue
        event.estimated_cost_usd = cost_usd
        event.pricing_available = True
        event.pricing_source = pricing_source
        updated += 1

    if not updated:
        return
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not backfill OpenAI pricing for existing usage telemetry.")


def _cost_cents(events: list[models.AiUsageEvent]) -> float:
    return sum(event.estimated_cost_usd for event in events) * 100


def _local_date(value: datetime, timezone_offset_minutes: int) -> date:
    return (_as_aware(value) - timedelta(minutes=timezone_offset_minutes)).date()


def _as_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _rounded(value: float) -> float:
    return round(value, 6)
