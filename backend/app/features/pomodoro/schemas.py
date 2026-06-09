from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ...schemas import PomodoroSessionLogCreate, PomodoroSessionLogRead


class PomodoroHistoryWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    completedAt: datetime
    startAt: datetime | None = None
    endAt: datetime | None = None
    minutes: int = Field(ge=1, le=1440)
    mode: Literal["focus", "short", "long"]
    projectId: str | None = None
    projectName: str = Field(default="No Fixed Project", max_length=160)
    taskId: str | None = None
    taskTitle: str = Field(default="No Continuous Project", max_length=160)
    done: str | None = Field(default=None, max_length=4000)
    focus: int | None = Field(default=None, ge=0, le=100)
    isManual: bool = False

    @model_validator(mode="after")
    def normalize_times(self):
        self.endAt = self.endAt or self.completedAt
        self.startAt = self.startAt or datetime.fromtimestamp(
            self.endAt.timestamp() - self.minutes * 60,
            tz=self.endAt.tzinfo,
        )
        if self.endAt < self.startAt:
            raise ValueError("endAt must be on or after startAt")
        return self


class PomodoroHistoryRead(PomodoroHistoryWrite):
    created_at: datetime

__all__ = [
    "PomodoroHistoryRead",
    "PomodoroHistoryWrite",
    "PomodoroSessionLogCreate",
    "PomodoroSessionLogRead",
]
