from datetime import date as calendar_date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class HelpingHandsTransaction(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    member: str = Field(min_length=1, max_length=160)
    direction: Literal["sent", "received"]
    amount: float = Field(gt=0)
    date: str = Field(min_length=10, max_length=10)
    note: str = Field(default="", max_length=1000)
    createdAt: str = Field(default="", max_length=40)

    @model_validator(mode="after")
    def normalize_text(self):
        self.member = self.member.strip()
        self.note = self.note.strip()
        if not self.member:
            raise ValueError("Member name is required")
        return self

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        try:
            calendar_date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("date must be a valid YYYY-MM-DD value") from exc
        return value


class HelpingHandsData(BaseModel):
    version: Literal[2] = 2
    startMonth: str = Field(default="", max_length=7)
    transactions: list[HelpingHandsTransaction] = Field(default_factory=list)

    @field_validator("startMonth")
    @classmethod
    def validate_start_month(cls, value: str) -> str:
        if value and (
            len(value) != 7
            or value[4] != "-"
            or not value[:4].isdigit()
            or not value[5:].isdigit()
            or not 1 <= int(value[5:]) <= 12
        ):
            raise ValueError("startMonth must use YYYY-MM format")
        return value


class HelpingHandsStartMonth(BaseModel):
    startMonth: str = Field(min_length=7, max_length=7)

    @field_validator("startMonth")
    @classmethod
    def validate_start_month(cls, value: str) -> str:
        return HelpingHandsData(startMonth=value).startMonth
