from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    default_project_type: Mapped[str] = mapped_column(String(20), default="fixed", nullable=False)
    default_task_priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    default_task_status: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    default_task_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    show_week_operations_plan: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_efficiency_report: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_time_allocation: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )
