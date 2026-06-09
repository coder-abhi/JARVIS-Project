import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

from app import models as root_models
from app.database import Base
from app.features.money import models, repository, schemas, service


class MoneyStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()
        self.session.add_all(
            [
                root_models.User(id="user-1", username="first", password_hash="hash"),
                root_models.User(id="user-2", username="second", password_hash="hash"),
            ]
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_normalized_wealth_tables_are_created(self) -> None:
        tables = set(inspect(self.engine).get_table_names())
        self.assertTrue(
            {
                "wealth_profiles",
                "wealth_accounts",
                "wealth_categories",
                "wealth_credit_cards",
                "wealth_transactions",
                "wealth_transaction_tags",
                "wealth_loans",
                "wealth_investments",
                "wealth_saving_goals",
                "wealth_expected_incomes",
                "wealth_expected_bills",
            } <= tables
        )

    def test_wealth_data_round_trips_and_is_user_scoped(self) -> None:
        saved = service.save_wealth_data(self.session, user_id="user-1", data=self.sample_data())
        other_user = service.get_wealth_data(self.session, user_id="user-2")

        self.assertEqual(saved.currency, "USD")
        self.assertEqual(saved.accounts[0].bankName, "Main Bank")
        self.assertEqual(saved.transactions[0].sourceId, "account-1")
        self.assertTrue(saved.transactions[0].categoryId)
        self.assertEqual(saved.transactions[0].tags, ["#food", "#work"])
        self.assertEqual(saved.cards[0].generatedBill, 120)
        self.assertEqual(saved.goals[0].note, "Keep this private")
        self.assertEqual(other_user.accounts, [])

        self.assertEqual(
            self.session.scalar(
                select(models.WealthTransactionTag).where(models.WealthTransactionTag.tag == "#work")
            ).transaction_id,
            "transaction-1",
        )

    def test_granular_transaction_write_validates_owned_references(self) -> None:
        repository.upsert_resource(
            self.session,
            user_id="user-1",
            resource="accounts",
            data=schemas.WealthAccountData(
                id="account-1",
                bankName="Main Bank",
                name="Checking",
                accountType="Current",
                balance=100,
            ),
            create_only=True,
        )
        saved = repository.upsert_resource(
            self.session,
            user_id="user-1",
            resource="transactions",
            data=schemas.WealthTransactionData(
                id="transaction-1",
                type="expense",
                amount=25,
                description="Lunch",
                category="Food",
                dateTime=datetime(2026, 6, 9, 12, 30),
                sourceKind="account",
                sourceId="account-1",
                tags=["#food"],
            ),
            create_only=True,
        )

        self.assertEqual(saved.transactions[0].category, "Food")
        food_category = next(category for category in saved.categories if category.name == "Food")
        self.assertEqual(saved.transactions[0].categoryId, food_category.id)

        with self.assertRaises(ValueError):
            repository.upsert_resource(
                self.session,
                user_id="user-2",
                resource="transactions",
                data=schemas.WealthTransactionData(
                    type="expense",
                    amount=10,
                    description="Invalid",
                    category="Food",
                    dateTime=datetime(2026, 6, 9, 13, 0),
                    sourceKind="account",
                    sourceId="account-1",
                ),
                create_only=True,
            )

    def test_legacy_document_migrates_once_to_relational_tables(self) -> None:
        legacy = root_models.UserDocument(
            user_id="user-1",
            key="wealth-command",
            value_json=json.dumps(
                {
                    "version": 1,
                    "currency": "INR",
                    "transactions": [],
                    "accounts": [],
                    "cards": [
                        {
                            "id": "card-legacy",
                            "issuer": "Legacy Bank",
                            "name": "Legacy Card",
                            "lastFour": "1234",
                            "currentBalance": 450,
                            "billDay": 5,
                            "dueDay": 20,
                        }
                    ],
                    "loans": [],
                    "investments": [],
                    "goals": [],
                    "incomes": [],
                    "bills": [],
                }
            ),
        )
        self.session.add(legacy)
        self.session.commit()

        migrated = service.get_wealth_data(self.session, user_id="user-1")

        self.assertEqual(migrated.cards[0].currentBill, 450)
        self.assertIsNotNone(self.session.get(models.WealthProfile, "user-1"))
        self.assertIsNone(
            self.session.scalar(
                select(root_models.UserDocument).where(
                    root_models.UserDocument.user_id == "user-1",
                    root_models.UserDocument.key == "wealth-command",
                )
            )
        )

    def test_invalid_bulk_replace_is_rejected_before_existing_rows_change(self) -> None:
        service.save_wealth_data(self.session, user_id="user-1", data=self.sample_data())
        invalid = schemas.WealthData(
            currency="USD",
            transactions=[
                schemas.WealthTransactionData(
                    type="expense",
                    amount=10,
                    description="Invalid source",
                    category="Food",
                    dateTime=datetime(2026, 6, 10, 12, 0),
                    sourceKind="account",
                    sourceId="missing-account",
                )
            ],
        )

        with self.assertRaises(ValueError):
            service.save_wealth_data(self.session, user_id="user-1", data=invalid)

        saved = service.get_wealth_data(self.session, user_id="user-1")
        self.assertEqual([account.id for account in saved.accounts], ["account-1"])
        self.assertEqual([transaction.id for transaction in saved.transactions], ["transaction-1"])

    def test_dangling_legacy_transaction_source_reads_as_cash(self) -> None:
        self.session.add(
            models.WealthTransaction(
                id="legacy-transaction",
                user_id="user-1",
                type="expense",
                amount=12,
                description="Legacy expense",
                category="Other",
                date_time=datetime(2026, 6, 10, 12, 0),
                source_kind="account",
                account_id=None,
                card_id=None,
            )
        )
        self.session.commit()

        data = repository.read_wealth_data(self.session, user_id="user-1")

        self.assertEqual(data.transactions[0].sourceKind, "cash")
        self.assertEqual(data.transactions[0].sourceId, "")

    @staticmethod
    def sample_data() -> schemas.WealthData:
        return schemas.WealthData(
            currency="USD",
            accounts=[
                schemas.WealthAccountData(
                    id="account-1",
                    bankName="Main Bank",
                    name="Checking",
                    accountType="Current",
                    balance=2500,
                )
            ],
            cards=[
                schemas.WealthCreditCardData(
                    id="card-1",
                    issuer="Card Bank",
                    name="Rewards",
                    lastFour="9876",
                    generatedBill=120,
                    currentBill=80,
                    billDay=10,
                    dueDay=25,
                )
            ],
            transactions=[
                schemas.WealthTransactionData(
                    id="transaction-1",
                    type="expense",
                    amount=20,
                    description="Lunch",
                    category="Food",
                    dateTime=datetime(2026, 6, 9, 12, 30),
                    sourceKind="account",
                    sourceId="account-1",
                    tags=["#food", "#work"],
                )
            ],
            loans=[
                schemas.WealthLoanData(
                    id="loan-1",
                    direction="given",
                    person="Friend",
                    principal=500,
                    outstanding=300,
                    interestRate=0,
                    expectedReturnDate=date(2026, 7, 1),
                )
            ],
            investments=[
                schemas.WealthInvestmentData(
                    id="investment-1",
                    type="Stocks",
                    name="Index Fund",
                    investedAmount=1000,
                    currentValue=1100,
                )
            ],
            goals=[
                schemas.WealthSavingGoalData(
                    id="goal-1",
                    name="Emergency",
                    targetAmount=5000,
                    savedAmount=1000,
                    dueDate=date(2026, 12, 31),
                    note="Keep this private",
                )
            ],
            incomes=[
                schemas.WealthExpectedIncomeData(
                    id="income-1",
                    source="Salary",
                    amount=3000,
                    expectedDate=date(2026, 6, 30),
                    accountId="account-1",
                )
            ],
            bills=[
                schemas.WealthExpectedBillData(
                    id="bill-1",
                    payee="Rent",
                    amount=900,
                    expectedDate=date(2026, 7, 1),
                    accountId="account-1",
                )
            ],
        )


if __name__ == "__main__":
    unittest.main()
