from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserPreferenceData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_project_type: Literal["fixed", "continuous"] = "fixed"
    default_task_priority: Literal["high", "medium", "low"] = "medium"
    default_task_status: Literal["todo", "in_progress"] = "todo"
    default_task_minutes: int = Field(default=60, ge=5, le=480)
    show_week_operations_plan: bool = True
    show_efficiency_report: bool = True
    show_time_allocation: bool = True


class UserPreferenceRead(UserPreferenceData):
    updated_at: datetime | None = None


class UserPreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_project_type: Literal["fixed", "continuous"] | None = None
    default_task_priority: Literal["high", "medium", "low"] | None = None
    default_task_status: Literal["todo", "in_progress"] | None = None
    default_task_minutes: int | None = Field(default=None, ge=5, le=480)
    show_week_operations_plan: bool | None = None
    show_efficiency_report: bool | None = None
    show_time_allocation: bool | None = None

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("At least one setting must be provided")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Settings cannot be null")
        return self
