from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class WealthTransactionData(BaseModel):
    id: str
    type: Literal["expense", "income"]
    amount: float = Field(ge=0)
    description: str
    category: str
    dateTime: datetime
    sourceKind: Literal["account", "card", "cash"]
    sourceId: str = ""
    tags: list[str] = Field(default_factory=list)


class WealthAccountData(BaseModel):
    id: str
    bankName: str
    name: str
    accountType: str
    balance: float


class WealthCreditCardData(BaseModel):
    id: str
    issuer: str
    name: str
    lastFour: str = Field(default="", max_length=4)
    generatedBill: float = Field(default=0, ge=0)
    currentBill: float = Field(default=0, ge=0)
    billDay: int = Field(ge=1, le=31)
    dueDay: int = Field(ge=1, le=31)


class WealthLoanData(BaseModel):
    id: str
    direction: Literal["taken", "given"]
    person: str
    principal: float = Field(ge=0)
    outstanding: float = Field(ge=0)
    interestRate: float = Field(ge=0)
    expectedReturnDate: date
    note: str = ""


class WealthInvestmentData(BaseModel):
    id: str
    type: str
    name: str
    platform: str = ""
    investedAmount: float = Field(ge=0)
    currentValue: float = Field(ge=0)


class WealthSavingGoalData(BaseModel):
    id: str
    name: str
    targetAmount: float = Field(ge=0)
    savedAmount: float = Field(ge=0)
    dueDate: date
    note: str = ""


class WealthExpectedIncomeData(BaseModel):
    id: str
    source: str
    amount: float = Field(ge=0)
    expectedDate: date
    note: str = ""
    accountId: str = ""


class WealthExpectedBillData(BaseModel):
    id: str
    payee: str
    amount: float = Field(ge=0)
    expectedDate: date
    note: str = ""
    accountId: str = ""


class WealthData(BaseModel):
    version: Literal[1] = 1
    currency: Literal["INR", "USD", "EUR", "GBP"] = "INR"
    transactions: list[WealthTransactionData] = Field(default_factory=list)
    accounts: list[WealthAccountData] = Field(default_factory=list)
    cards: list[WealthCreditCardData] = Field(default_factory=list)
    loans: list[WealthLoanData] = Field(default_factory=list)
    investments: list[WealthInvestmentData] = Field(default_factory=list)
    goals: list[WealthSavingGoalData] = Field(default_factory=list)
    incomes: list[WealthExpectedIncomeData] = Field(default_factory=list)
    bills: list[WealthExpectedBillData] = Field(default_factory=list)
