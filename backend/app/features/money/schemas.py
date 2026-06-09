from datetime import date, datetime
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WealthTransactionData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    type: Literal["expense", "income"]
    amount: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)
    category: str = Field(min_length=1, max_length=80)
    categoryId: str = ""
    dateTime: datetime
    sourceKind: Literal["account", "card", "cash"]
    sourceId: str = ""
    tags: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_source(self):
        if self.sourceKind == "cash" and self.sourceId:
            raise ValueError("sourceId must be empty for cash transactions")
        if self.sourceKind != "cash" and not self.sourceId:
            raise ValueError("sourceId is required for account and card transactions")
        return self


class WealthAccountData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    bankName: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    accountType: str = Field(min_length=1, max_length=40)
    balance: float


class WealthCategoryData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    transactionType: Literal["expense", "income"]
    name: str = Field(min_length=1, max_length=80)


class WealthCreditCardData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    issuer: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    lastFour: str = Field(default="", max_length=4)
    generatedBill: float = Field(default=0, ge=0)
    currentBill: float = Field(default=0, ge=0)
    billDay: int = Field(ge=1, le=31)
    dueDay: int = Field(ge=1, le=31)


class WealthLoanData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    direction: Literal["taken", "given"]
    person: str = Field(min_length=1, max_length=200)
    principal: float = Field(ge=0)
    outstanding: float = Field(ge=0)
    interestRate: float = Field(ge=0)
    expectedReturnDate: date
    note: str = ""


class WealthInvestmentData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    platform: str = ""
    investedAmount: float = Field(ge=0)
    currentValue: float = Field(ge=0)


class WealthSavingGoalData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=200)
    targetAmount: float = Field(gt=0)
    savedAmount: float = Field(ge=0)
    dueDate: date
    note: str = ""


class WealthExpectedIncomeData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    source: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    expectedDate: date
    note: str = ""
    accountId: str = ""


class WealthExpectedBillData(StrictModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=36)
    payee: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    expectedDate: date
    note: str = ""
    accountId: str = ""


class WealthData(StrictModel):
    version: Literal[1] = 1
    currency: Literal["INR", "USD", "EUR", "GBP"] = "INR"
    categories: list[WealthCategoryData] = Field(default_factory=list)
    transactions: list[WealthTransactionData] = Field(default_factory=list)
    accounts: list[WealthAccountData] = Field(default_factory=list)
    cards: list[WealthCreditCardData] = Field(default_factory=list)
    loans: list[WealthLoanData] = Field(default_factory=list)
    investments: list[WealthInvestmentData] = Field(default_factory=list)
    goals: list[WealthSavingGoalData] = Field(default_factory=list)
    incomes: list[WealthExpectedIncomeData] = Field(default_factory=list)
    bills: list[WealthExpectedBillData] = Field(default_factory=list)
