import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WealthProfile(Base):
    __tablename__ = "wealth_profiles"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class WealthAccount(Base):
    __tablename__ = "wealth_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    bank_name: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    account_type: Mapped[str] = mapped_column(String(40), nullable=False)
    balance: Mapped[float] = mapped_column(Float, default=0, nullable=False)


class WealthCategory(Base):
    __tablename__ = "wealth_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "transaction_type", "name", name="uq_wealth_category_user_type_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    transaction_type: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)


class WealthCreditCard(Base):
    __tablename__ = "wealth_credit_cards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    issuer: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    last_four: Mapped[str] = mapped_column(String(4), nullable=False)
    generated_bill: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    current_bill: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    bill_day: Mapped[int] = mapped_column(Integer, nullable=False)
    due_day: Mapped[int] = mapped_column(Integer, nullable=False)


class WealthTransaction(Base):
    __tablename__ = "wealth_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("wealth_categories.id"), nullable=True, index=True)
    date_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("wealth_accounts.id"), nullable=True, index=True)
    card_id: Mapped[str | None] = mapped_column(ForeignKey("wealth_credit_cards.id"), nullable=True, index=True)


class WealthTransactionTag(Base):
    __tablename__ = "wealth_transaction_tags"
    __table_args__ = (UniqueConstraint("transaction_id", "tag", name="uq_wealth_transaction_tag"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id: Mapped[str] = mapped_column(ForeignKey("wealth_transactions.id"), nullable=False, index=True)
    tag: Mapped[str] = mapped_column(String(80), nullable=False, index=True)


class WealthLoan(Base):
    __tablename__ = "wealth_loans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    person: Mapped[str] = mapped_column(String(200), nullable=False)
    principal: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    outstanding: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    interest_rate: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    expected_return_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class WealthInvestment(Base):
    __tablename__ = "wealth_investments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(160), nullable=True)
    invested_amount: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    current_value: Mapped[float] = mapped_column(Float, default=0, nullable=False)


class WealthSavingGoal(Base):
    __tablename__ = "wealth_saving_goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    target_amount: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    saved_amount: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class WealthExpectedIncome(Base):
    __tablename__ = "wealth_expected_incomes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    expected_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("wealth_accounts.id"), nullable=True, index=True)


class WealthExpectedBill(Base):
    __tablename__ = "wealth_expected_bills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    payee: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    expected_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("wealth_accounts.id"), nullable=True, index=True)
