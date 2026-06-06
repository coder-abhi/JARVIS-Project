from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import AiFeatureSetting, AiResponseCache, AiUsageEvent


def list_usage_events(db: Session, user_id: str) -> list[AiUsageEvent]:
    return list(
        db.scalars(
            select(AiUsageEvent)
            .where(AiUsageEvent.user_id == user_id)
            .order_by(AiUsageEvent.created_at.desc())
        )
    )


def get_cached_response(
    db: Session,
    *,
    user_id: str,
    feature: str,
    model: str,
    input_fingerprint: str,
) -> AiResponseCache | None:
    return db.scalar(
        select(AiResponseCache).where(
            AiResponseCache.user_id == user_id,
            AiResponseCache.feature == feature,
            AiResponseCache.model == model,
            AiResponseCache.input_fingerprint == input_fingerprint,
        )
    )


def upsert_cached_response(
    db: Session,
    *,
    user_id: str,
    feature: str,
    model: str,
    input_fingerprint: str,
    response_json: str,
) -> AiResponseCache:
    cached = get_cached_response(
        db,
        user_id=user_id,
        feature=feature,
        model=model,
        input_fingerprint=input_fingerprint,
    )
    if cached is None:
        cached = AiResponseCache(
            user_id=user_id,
            feature=feature,
            model=model,
            input_fingerprint=input_fingerprint,
            response_json=response_json,
        )
        db.add(cached)
    else:
        cached.response_json = response_json

    db.commit()
    db.refresh(cached)
    return cached


def prune_cached_responses(
    db: Session,
    *,
    user_id: str,
    feature: str,
    model: str,
    keep: int,
) -> None:
    stale_ids = list(
        db.scalars(
            select(AiResponseCache.id)
            .where(
                AiResponseCache.user_id == user_id,
                AiResponseCache.feature == feature,
                AiResponseCache.model == model,
            )
            .order_by(AiResponseCache.updated_at.desc(), AiResponseCache.created_at.desc())
            .offset(keep)
        )
    )
    if not stale_ids:
        return
    db.execute(delete(AiResponseCache).where(AiResponseCache.id.in_(stale_ids)))
    db.commit()


def list_feature_settings(db: Session, user_id: str) -> list[AiFeatureSetting]:
    return list(
        db.scalars(
            select(AiFeatureSetting)
            .where(AiFeatureSetting.user_id == user_id)
            .order_by(AiFeatureSetting.feature.asc())
        )
    )


def get_feature_setting(db: Session, *, user_id: str, feature: str) -> AiFeatureSetting | None:
    return db.scalar(
        select(AiFeatureSetting).where(
            AiFeatureSetting.user_id == user_id,
            AiFeatureSetting.feature == feature,
        )
    )


def set_feature_setting(
    db: Session,
    *,
    user_id: str,
    feature: str,
    enabled: bool | None = None,
    model: str | None = None,
) -> AiFeatureSetting:
    setting = get_feature_setting(db, user_id=user_id, feature=feature)
    if setting is None:
        setting = AiFeatureSetting(
            user_id=user_id,
            feature=feature,
            enabled=True if enabled is None else enabled,
            model=model,
        )
        db.add(setting)
    else:
        if enabled is not None:
            setting.enabled = enabled
        if model is not None:
            setting.model = model

    db.commit()
    db.refresh(setting)
    return setting
