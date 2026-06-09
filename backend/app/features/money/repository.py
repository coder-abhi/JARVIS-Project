from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import models, schemas


def has_wealth_data(db: Session, *, user_id: str) -> bool:
    return db.get(models.WealthProfile, user_id) is not None


def read_wealth_data(db: Session, *, user_id: str) -> schemas.WealthData:
    profile = db.get(models.WealthProfile, user_id)
    accounts = list(db.scalars(select(models.WealthAccount).where(models.WealthAccount.user_id == user_id)))
    cards = list(db.scalars(select(models.WealthCreditCard).where(models.WealthCreditCard.user_id == user_id)))
    transactions = list(
        db.scalars(
            select(models.WealthTransaction)
            .where(models.WealthTransaction.user_id == user_id)
            .order_by(models.WealthTransaction.date_time.desc())
        )
    )
    transaction_ids = [transaction.id for transaction in transactions]
    tags_by_transaction: dict[str, list[str]] = {}
    if transaction_ids:
        for tag in db.scalars(
            select(models.WealthTransactionTag)
            .where(models.WealthTransactionTag.transaction_id.in_(transaction_ids))
            .order_by(models.WealthTransactionTag.tag.asc())
        ):
            tags_by_transaction.setdefault(tag.transaction_id, []).append(tag.tag)

    loans = list(db.scalars(select(models.WealthLoan).where(models.WealthLoan.user_id == user_id)))
    investments = list(db.scalars(select(models.WealthInvestment).where(models.WealthInvestment.user_id == user_id)))
    goals = list(db.scalars(select(models.WealthSavingGoal).where(models.WealthSavingGoal.user_id == user_id)))
    incomes = list(db.scalars(select(models.WealthExpectedIncome).where(models.WealthExpectedIncome.user_id == user_id)))
    bills = list(db.scalars(select(models.WealthExpectedBill).where(models.WealthExpectedBill.user_id == user_id)))

    return schemas.WealthData(
        currency=profile.currency if profile else "INR",
        accounts=[
            schemas.WealthAccountData(
                id=item.id,
                bankName=item.bank_name,
                name=item.name,
                accountType=item.account_type,
                balance=item.balance,
            )
            for item in accounts
        ],
        cards=[
            schemas.WealthCreditCardData(
                id=item.id,
                issuer=item.issuer,
                name=item.name,
                lastFour=item.last_four,
                generatedBill=item.generated_bill,
                currentBill=item.current_bill,
                billDay=item.bill_day,
                dueDay=item.due_day,
            )
            for item in cards
        ],
        transactions=[
            schemas.WealthTransactionData(
                id=item.id,
                type=item.type,
                amount=item.amount,
                description=item.description,
                category=item.category,
                dateTime=item.date_time,
                sourceKind=item.source_kind,
                sourceId=item.account_id or item.card_id or "",
                tags=tags_by_transaction.get(item.id, []),
            )
            for item in transactions
        ],
        loans=[
            schemas.WealthLoanData(
                id=item.id,
                direction=item.direction,
                person=item.person,
                principal=item.principal,
                outstanding=item.outstanding,
                interestRate=item.interest_rate,
                expectedReturnDate=item.expected_return_date,
                note=item.note or "",
            )
            for item in loans
        ],
        investments=[
            schemas.WealthInvestmentData(
                id=item.id,
                type=item.type,
                name=item.name,
                platform=item.platform or "",
                investedAmount=item.invested_amount,
                currentValue=item.current_value,
            )
            for item in investments
        ],
        goals=[
            schemas.WealthSavingGoalData(
                id=item.id,
                name=item.name,
                targetAmount=item.target_amount,
                savedAmount=item.saved_amount,
                dueDate=item.due_date,
                note=item.note or "",
            )
            for item in goals
        ],
        incomes=[
            schemas.WealthExpectedIncomeData(
                id=item.id,
                source=item.source,
                amount=item.amount,
                expectedDate=item.expected_date,
                note=item.note or "",
                accountId=item.account_id or "",
            )
            for item in incomes
        ],
        bills=[
            schemas.WealthExpectedBillData(
                id=item.id,
                payee=item.payee,
                amount=item.amount,
                expectedDate=item.expected_date,
                note=item.note or "",
                accountId=item.account_id or "",
            )
            for item in bills
        ],
    )


def replace_wealth_data(db: Session, *, user_id: str, data: schemas.WealthData) -> schemas.WealthData:
    transaction_ids = select(models.WealthTransaction.id).where(models.WealthTransaction.user_id == user_id)
    db.execute(delete(models.WealthTransactionTag).where(models.WealthTransactionTag.transaction_id.in_(transaction_ids)))
    for model in (
        models.WealthTransaction,
        models.WealthExpectedIncome,
        models.WealthExpectedBill,
        models.WealthLoan,
        models.WealthInvestment,
        models.WealthSavingGoal,
        models.WealthCreditCard,
        models.WealthAccount,
    ):
        db.execute(delete(model).where(model.user_id == user_id))

    profile = db.get(models.WealthProfile, user_id)
    if profile is None:
        profile = models.WealthProfile(user_id=user_id, currency=data.currency)
        db.add(profile)
    else:
        profile.currency = data.currency

    for item in data.accounts:
        db.add(
            models.WealthAccount(
                id=item.id,
                user_id=user_id,
                bank_name=item.bankName,
                name=item.name,
                account_type=item.accountType,
                balance=item.balance,
            )
        )
    for item in data.cards:
        db.add(
            models.WealthCreditCard(
                id=item.id,
                user_id=user_id,
                issuer=item.issuer,
                name=item.name,
                last_four=item.lastFour,
                generated_bill=item.generatedBill,
                current_bill=item.currentBill,
                bill_day=item.billDay,
                due_day=item.dueDay,
            )
        )
    db.flush()

    account_ids = {item.id for item in data.accounts}
    card_ids = {item.id for item in data.cards}
    for item in data.transactions:
        transaction = models.WealthTransaction(
            id=item.id,
            user_id=user_id,
            type=item.type,
            amount=item.amount,
            description=item.description,
            category=item.category,
            date_time=item.dateTime,
            source_kind=item.sourceKind,
            account_id=item.sourceId if item.sourceKind == "account" and item.sourceId in account_ids else None,
            card_id=item.sourceId if item.sourceKind == "card" and item.sourceId in card_ids else None,
        )
        db.add(transaction)
        for tag in dict.fromkeys(item.tags):
            db.add(models.WealthTransactionTag(transaction_id=item.id, tag=tag))

    for item in data.loans:
        db.add(
            models.WealthLoan(
                id=item.id,
                user_id=user_id,
                direction=item.direction,
                person=item.person,
                principal=item.principal,
                outstanding=item.outstanding,
                interest_rate=item.interestRate,
                expected_return_date=item.expectedReturnDate,
                note=item.note or None,
            )
        )
    for item in data.investments:
        db.add(
            models.WealthInvestment(
                id=item.id,
                user_id=user_id,
                type=item.type,
                name=item.name,
                platform=item.platform or None,
                invested_amount=item.investedAmount,
                current_value=item.currentValue,
            )
        )
    for item in data.goals:
        db.add(
            models.WealthSavingGoal(
                id=item.id,
                user_id=user_id,
                name=item.name,
                target_amount=item.targetAmount,
                saved_amount=item.savedAmount,
                due_date=item.dueDate,
                note=item.note or None,
            )
        )
    for item in data.incomes:
        db.add(
            models.WealthExpectedIncome(
                id=item.id,
                user_id=user_id,
                source=item.source,
                amount=item.amount,
                expected_date=item.expectedDate,
                note=item.note or None,
                account_id=item.accountId if item.accountId in account_ids else None,
            )
        )
    for item in data.bills:
        db.add(
            models.WealthExpectedBill(
                id=item.id,
                user_id=user_id,
                payee=item.payee,
                amount=item.amount,
                expected_date=item.expectedDate,
                note=item.note or None,
                account_id=item.accountId if item.accountId in account_ids else None,
            )
        )

    db.commit()
    return read_wealth_data(db, user_id=user_id)
