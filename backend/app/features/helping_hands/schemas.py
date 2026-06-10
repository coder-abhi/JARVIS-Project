from typing import Literal

from pydantic import BaseModel, Field, model_validator


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


class HelpingHandsData(BaseModel):
    version: Literal[2] = 2
    transactions: list[HelpingHandsTransaction] = Field(default_factory=list)
