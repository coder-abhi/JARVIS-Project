import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base
from ...models import PomodoroSessionLog


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PomodoroHistorySession(Base):
    __tablename__ = "pomodoro_history_sessions"

    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    focus_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fixed_project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    continuous_project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    project_name_snapshot: Mapped[str] = mapped_column(String(160), default="No Fixed Project", nullable=False)
    task_title_snapshot: Mapped[str] = mapped_column(String(160), default="No Continuous Project", nullable=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

__all__ = ["PomodoroHistorySession", "PomodoroSessionLog"]
