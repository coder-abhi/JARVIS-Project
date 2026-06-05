from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AiUsageEvent


def list_usage_events(db: Session, user_id: str) -> list[AiUsageEvent]:
    return list(
        db.scalars(
            select(AiUsageEvent)
            .where(AiUsageEvent.user_id == user_id)
            .order_by(AiUsageEvent.created_at.desc())
        )
    )
