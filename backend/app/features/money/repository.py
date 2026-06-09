from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas

DEFAULT_CATEGORIES = {
    "expense": (
        "Food",
        "Housing",
        "Transport",
        "Shopping",
        "Health",
        "Education",
        "Entertainment",
        "Bills",
        "Travel",
        "Other",
    ),
    "income": (
        "Salary",
        "Freelance",
        "Business",
        "Investment",
        "Gift",
        "Refund",
        "Other",
    ),
}


def has_wealth_data(db: Session, *, user_id: str) -> bool:
    return db.get(models.WealthProfile, user_id) is not None


def read_wealth_data(db: Session, *, user_id: str) -> schemas.WealthData:
    profile = db.get(models.WealthProfile, user_id)
    categories = list(
        db.scalars(
            select(models.WealthCategory)
            .where(models.WealthCategory.user_id == user_id)
            .order_by(models.WealthCategory.transaction_type.asc(), models.WealthCategory.name.asc())
        )
    )
    categories_by_id = {category.id: category for category in categories}
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
        categories=[
            schemas.WealthCategoryData(
                id=item.id,
                transactionType=item.transaction_type,
                name=item.name,
            )
            for item in categories
        ],
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
                category=categories_by_id[item.category_id].name if item.category_id in categories_by_id else item.category,
                categoryId=item.category_id or "",
                dateTime=item.date_time,
                sourceKind=_transaction_source_kind(item),
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


def _transaction_source_kind(item: models.WealthTransaction) -> str:
    if item.account_id:
        return "account"
    if item.card_id:
        return "card"
    return "cash"


def replace_wealth_data(db: Session, *, user_id: str, data: schemas.WealthData) -> schemas.WealthData:
    _validate_wealth_data(data)
    _validate_owned_ids(db, user_id=user_id, data=data)
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
        models.WealthCategory,
    ):
        db.execute(delete(model).where(model.user_id == user_id))

    profile = db.get(models.WealthProfile, user_id)
    if profile is None:
        profile = models.WealthProfile(user_id=user_id, currency=data.currency)
        db.add(profile)
    else:
        profile.currency = data.currency

    category_items = data.categories or _categories_from_transactions(data.transactions) or _default_categories()
    for item in category_items:
        db.add(
            models.WealthCategory(
                id=item.id,
                user_id=user_id,
                transaction_type=item.transactionType,
                name=item.name,
            )
        )
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
    category_ids = {item.id for item in category_items}
    categories_by_key = {(item.transactionType, item.name.casefold()): item.id for item in category_items}
    for item in data.transactions:
        category_id = item.categoryId if item.categoryId in category_ids else categories_by_key.get(
            (item.type, item.category.casefold())
        )
        transaction = models.WealthTransaction(
            id=item.id,
            user_id=user_id,
            type=item.type,
            amount=item.amount,
            description=item.description,
            category=item.category,
            category_id=category_id,
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

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Finance data conflicts with an existing record") from exc
    return read_wealth_data(db, user_id=user_id)


def upsert_resource(
    db: Session,
    *,
    user_id: str,
    resource: str,
    data,
    create_only: bool = False,
):
    model = _RESOURCE_MODELS[resource]
    existing = db.get(model, data.id)
    if existing is not None and existing.user_id != user_id:
        raise PermissionError(f"{resource} entry belongs to another user")
    if existing is not None and create_only:
        raise ValueError(f"{resource} entry already exists")
    if existing is None and not create_only:
        raise ValueError(f"{resource} entry not found")
    _, values = _resource_model_and_values(db, resource, user_id=user_id, data=data)
    if existing is None:
        existing = model(id=data.id, **values)
        db.add(existing)
    else:
        for field, value in values.items():
            setattr(existing, field, value)
    if resource == "transactions":
        db.execute(
            delete(models.WealthTransactionTag).where(
                models.WealthTransactionTag.transaction_id == data.id
            )
        )
        for tag in dict.fromkeys(data.tags):
            db.add(models.WealthTransactionTag(transaction_id=data.id, tag=tag))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError(f"{resource} entry conflicts with an existing record") from exc
    return read_wealth_data(db, user_id=user_id)


_RESOURCE_MODELS = {
    "accounts": models.WealthAccount,
    "categories": models.WealthCategory,
    "cards": models.WealthCreditCard,
    "transactions": models.WealthTransaction,
    "loans": models.WealthLoan,
    "investments": models.WealthInvestment,
    "goals": models.WealthSavingGoal,
    "incomes": models.WealthExpectedIncome,
    "bills": models.WealthExpectedBill,
}


def _resource_model_and_values(db: Session, resource: str, *, user_id: str, data):
    if resource == "accounts":
        return models.WealthAccount, {
            "user_id": user_id,
            "bank_name": data.bankName,
            "name": data.name,
            "account_type": data.accountType,
            "balance": data.balance,
        }
    if resource == "categories":
        return models.WealthCategory, {
            "user_id": user_id,
            "transaction_type": data.transactionType,
            "name": data.name,
        }
    if resource == "cards":
        return models.WealthCreditCard, {
            "user_id": user_id,
            "issuer": data.issuer,
            "name": data.name,
            "last_four": data.lastFour,
            "generated_bill": data.generatedBill,
            "current_bill": data.currentBill,
            "bill_day": data.billDay,
            "due_day": data.dueDay,
        }
    if resource == "transactions":
        account_id = None
        card_id = None
        if data.sourceKind == "account":
            account = db.get(models.WealthAccount, data.sourceId)
            if account is None or account.user_id != user_id:
                raise ValueError("Source account not found")
            account_id = account.id
        elif data.sourceKind == "card":
            card = db.get(models.WealthCreditCard, data.sourceId)
            if card is None or card.user_id != user_id:
                raise ValueError("Source card not found")
            card_id = card.id

        category_id = data.categoryId or None
        if category_id:
            category = db.get(models.WealthCategory, category_id)
            if category is None or category.user_id != user_id:
                raise ValueError("Category not found")
            if category.transaction_type != data.type:
                raise ValueError("Category type must match transaction type")
        else:
            category = db.scalar(
                select(models.WealthCategory).where(
                    models.WealthCategory.user_id == user_id,
                    models.WealthCategory.transaction_type == data.type,
                    models.WealthCategory.name == data.category,
                )
            )
            if category is None:
                category = models.WealthCategory(
                    user_id=user_id,
                    transaction_type=data.type,
                    name=data.category,
                )
                db.add(category)
                db.flush()
            category_id = category.id
        return models.WealthTransaction, {
            "user_id": user_id,
            "type": data.type,
            "amount": data.amount,
            "description": data.description,
            "category": data.category,
            "category_id": category_id,
            "date_time": data.dateTime,
            "source_kind": data.sourceKind,
            "account_id": account_id,
            "card_id": card_id,
        }
    if resource == "loans":
        return models.WealthLoan, {
            "user_id": user_id,
            "direction": data.direction,
            "person": data.person,
            "principal": data.principal,
            "outstanding": data.outstanding,
            "interest_rate": data.interestRate,
            "expected_return_date": data.expectedReturnDate,
            "note": data.note or None,
        }
    if resource == "investments":
        return models.WealthInvestment, {
            "user_id": user_id,
            "type": data.type,
            "name": data.name,
            "platform": data.platform or None,
            "invested_amount": data.investedAmount,
            "current_value": data.currentValue,
        }
    if resource == "goals":
        return models.WealthSavingGoal, {
            "user_id": user_id,
            "name": data.name,
            "target_amount": data.targetAmount,
            "saved_amount": data.savedAmount,
            "due_date": data.dueDate,
            "note": data.note or None,
        }
    if resource == "incomes":
        account_id = _owned_account_id(db, user_id=user_id, account_id=data.accountId)
        return models.WealthExpectedIncome, {
            "user_id": user_id,
            "source": data.source,
            "amount": data.amount,
            "expected_date": data.expectedDate,
            "note": data.note or None,
            "account_id": account_id,
        }
    if resource == "bills":
        account_id = _owned_account_id(db, user_id=user_id, account_id=data.accountId)
        return models.WealthExpectedBill, {
            "user_id": user_id,
            "payee": data.payee,
            "amount": data.amount,
            "expected_date": data.expectedDate,
            "note": data.note or None,
            "account_id": account_id,
        }
    raise KeyError(resource)


def _categories_from_transactions(
    transactions: list[schemas.WealthTransactionData],
) -> list[schemas.WealthCategoryData]:
    seen: set[tuple[str, str]] = set()
    categories: list[schemas.WealthCategoryData] = []
    for transaction in transactions:
        key = (transaction.type, transaction.category.casefold())
        if key in seen:
            continue
        seen.add(key)
        categories.append(
            schemas.WealthCategoryData(
                transactionType=transaction.type,
                name=transaction.category,
            )
        )
    return categories


def _default_categories() -> list[schemas.WealthCategoryData]:
    return [
        schemas.WealthCategoryData(transactionType=transaction_type, name=name)
        for transaction_type, names in DEFAULT_CATEGORIES.items()
        for name in names
    ]


def _owned_account_id(db: Session, *, user_id: str, account_id: str) -> str | None:
    if not account_id:
        return None
    account = db.get(models.WealthAccount, account_id)
    if account is None or account.user_id != user_id:
        raise ValueError("Account not found")
    return account.id


def _validate_wealth_data(data: schemas.WealthData) -> None:
    collections = {
        "account": data.accounts,
        "category": data.categories,
        "card": data.cards,
        "transaction": data.transactions,
        "loan": data.loans,
        "investment": data.investments,
        "saving goal": data.goals,
        "expected income": data.incomes,
        "expected bill": data.bills,
    }
    for label, items in collections.items():
        ids = [item.id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate {label} id")

    account_ids = {item.id for item in data.accounts}
    card_ids = {item.id for item in data.cards}
    categories_by_id = {item.id: item for item in data.categories}
    category_keys = [(item.transactionType, item.name.casefold()) for item in data.categories]
    if len(category_keys) != len(set(category_keys)):
        raise ValueError("Duplicate category name for transaction type")
    for transaction in data.transactions:
        if transaction.sourceKind == "account" and transaction.sourceId not in account_ids:
            raise ValueError("Transaction source account not found in payload")
        if transaction.sourceKind == "card" and transaction.sourceId not in card_ids:
            raise ValueError("Transaction source card not found in payload")
        if transaction.categoryId:
            category = categories_by_id.get(transaction.categoryId)
            if category is None:
                raise ValueError("Transaction category not found in payload")
            if category.transactionType != transaction.type:
                raise ValueError("Transaction category type must match transaction type")
            if category.name.casefold() != transaction.category.casefold():
                raise ValueError("Transaction category name must match categoryId")

    for income in data.incomes:
        if income.accountId and income.accountId not in account_ids:
            raise ValueError("Expected income account not found in payload")
    for bill in data.bills:
        if bill.accountId and bill.accountId not in account_ids:
            raise ValueError("Expected bill account not found in payload")


def _validate_owned_ids(db: Session, *, user_id: str, data: schemas.WealthData) -> None:
    resources = (
        (models.WealthAccount, data.accounts),
        (models.WealthCategory, data.categories),
        (models.WealthCreditCard, data.cards),
        (models.WealthTransaction, data.transactions),
        (models.WealthLoan, data.loans),
        (models.WealthInvestment, data.investments),
        (models.WealthSavingGoal, data.goals),
        (models.WealthExpectedIncome, data.incomes),
        (models.WealthExpectedBill, data.bills),
    )
    for model, items in resources:
        for item in items:
            existing = db.get(model, item.id)
            if existing is not None and existing.user_id != user_id:
                raise PermissionError("Finance record id belongs to another user")
