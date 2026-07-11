"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getWealthData, saveWealthData } from "@/lib/api";
import { normalizeCurrency, type Currency } from "@/lib/currency";
import { DateTimePicker } from "@/components/DateTimePicker";
import "./MoneyPage.css";

type EntryKind = "transaction" | "account" | "card" | "loan" | "investment" | "goal" | "income" | "bill";
type TransactionType = "expense" | "income";
type SourceKind = "account" | "card" | "cash";
type LedgerPeriod = "week" | "month" | "all";

type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  category: string;
  categoryId: string;
  dateTime: string;
  sourceKind: SourceKind;
  sourceId: string;
  tags: string[];
};

type MoneyCategory = {
  id: string;
  transactionType: TransactionType;
  name: string;
};

type BankAccount = {
  id: string;
  bankName: string;
  name: string;
  accountType: string;
  balance: number;
};

type CreditCard = {
  id: string;
  issuer: string;
  name: string;
  lastFour: string;
  generatedBill: number;
  currentBill: number;
  billDay: number;
  dueDay: number;
};

type Loan = {
  id: string;
  direction: "taken" | "given";
  person: string;
  principal: number;
  outstanding: number;
  interestRate: number;
  expectedReturnDate: string;
  note: string;
};

type Investment = {
  id: string;
  type: string;
  name: string;
  platform: string;
  investedAmount: number;
  currentValue: number;
};

type SavingGoal = {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  dueDate: string;
  note: string;
};

type ExpectedIncome = {
  id: string;
  source: string;
  amount: number;
  expectedDate: string;
  note: string;
  accountId: string;
};

type ExpectedBill = {
  id: string;
  payee: string;
  amount: number;
  expectedDate: string;
  note: string;
  accountId: string;
};

type MoneyData = {
  version: 1;
  currency: Currency;
  categories: MoneyCategory[];
  transactions: Transaction[];
  accounts: BankAccount[];
  cards: CreditCard[];
  loans: Loan[];
  investments: Investment[];
  goals: SavingGoal[];
  incomes: ExpectedIncome[];
  bills: ExpectedBill[];
};

type Entry = Transaction | BankAccount | CreditCard | Loan | Investment | SavingGoal | ExpectedIncome | ExpectedBill;
type Draft = Record<string, string>;

const emptyData: MoneyData = {
  version: 1,
  currency: "INR",
  categories: [],
  transactions: [],
  accounts: [],
  cards: [],
  loans: [],
  investments: [],
  goals: [],
  incomes: [],
  bills: [],
};
const expenseCategories = ["Food", "Housing", "Transport", "Shopping", "Health", "Education", "Entertainment", "Bills", "Travel", "Other"];
const incomeCategories = ["Salary", "Freelance", "Business", "Investment", "Gift", "Refund", "Other"];
const kindLabels: Record<EntryKind, string> = {
  transaction: "Transaction",
  account: "Bank Account",
  card: "Credit Card",
  loan: "Loan",
  investment: "Investment",
  goal: "Saving Goal",
  income: "Expected Income",
  bill: "Expected Bill",
};

export default function MoneyPage() {
  const [data, setData] = useState<MoneyData>(emptyData);
  const [isLoaded, setIsLoaded] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [loadWarning, setLoadWarning] = useState("");
  const [modal, setModal] = useState<{ kind: EntryKind; id?: string } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [tagFilter, setTagFilter] = useState("");
  const [ledgerPeriod, setLedgerPeriod] = useState<LedgerPeriod>("week");

  useEffect(() => {
    let isCancelled = false;

    async function loadMoneyData() {
      try {
        const databaseData = normalizeMoneyData(await getWealthData<unknown>());
        if (isCancelled) return;
        setData(databaseData);
        setCanPersist(true);
      } catch (error) {
        if (isCancelled) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        setLoadWarning(`Wealth Command failed to load: ${message}`);
      } finally {
        if (!isCancelled) setIsLoaded(true);
      }
    }

    void loadMoneyData();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !canPersist) return;
    void saveWealthData(data)
      .then(() => setLoadWarning(""))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        setLoadWarning(`The finance database could not be updated: ${message}. Reload before making more changes.`);
      });
  }, [canPersist, data, isLoaded]);

  const summary = useMemo(() => calculateSummary(data), [data]);
  const monthlyTrend = useMemo(() => buildMonthlyTrend(data.transactions), [data.transactions]);
  const categorySpend = useMemo(() => buildCategorySpend(data.transactions), [data.transactions]);
  const upcoming = useMemo(() => buildUpcoming(data), [data]);
  const existingTags = useMemo(
    () => [...new Set(data.transactions.flatMap((transaction) => transaction.tags))].sort((a, b) => a.localeCompare(b)),
    [data.transactions],
  );
  const matchingTransactions = useMemo(
    () =>
      [...data.transactions]
        .filter((transaction) => isTransactionInPeriod(transaction, ledgerPeriod))
        .filter((transaction) => !tagFilter || transaction.tags.includes(tagFilter))
        .sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
    [data.transactions, ledgerPeriod, tagFilter],
  );
  const filteredTransactions = matchingTransactions;
  const filteredAmountTotal = useMemo(() => sum(matchingTransactions.map((transaction) => transaction.amount)), [matchingTransactions]);
  const formatter = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency: data.currency, maximumFractionDigits: 0 }),
    [data.currency],
  );
  const money = (value: number) => formatter.format(value);

  function openCreate(kind: EntryKind) {
    setModal({ kind });
    setDraft(initialDraft(kind));
  }

  function openEdit(kind: EntryKind, entry: Entry) {
    setModal({ kind, id: entry.id });
    setDraft(entryToDraft(kind, entry));
  }

  function closeModal() {
    setModal(null);
    setDraft({});
  }

  function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    const entry = draftToEntry(modal.kind, draft, modal.id ?? createId());
    if (!entry) return;

    setData((current) => {
      const next = cloneData(current);
      if (modal.kind === "transaction") {
        const transaction = entry as Transaction;
        const old = modal.id ? next.transactions.find((item) => item.id === modal.id) : undefined;
        if (old) applyTransactionToSource(next, old, -1);
        next.transactions = upsert(next.transactions, transaction);
        applyTransactionToSource(next, transaction, 1);
      } else {
        const key = collectionKey(modal.kind);
        (next[key] as Entry[]) = upsert(next[key] as Entry[], entry);
      }
      return next;
    });
    closeModal();
  }

  function deleteEntry(kind: EntryKind, id: string) {
    if (!window.confirm(`Delete this ${kindLabels[kind].toLowerCase()}?`)) return;
    setData((current) => {
      const next = cloneData(current);
      if (kind === "transaction") {
        const transaction = next.transactions.find((item) => item.id === id);
        if (transaction) applyTransactionToSource(next, transaction, -1);
        next.transactions = next.transactions.filter((item) => item.id !== id);
      } else {
        const key = collectionKey(kind);
        (next[key] as Entry[]) = (next[key] as Entry[]).filter((item) => item.id !== id);
        if (kind === "account") {
          next.transactions = next.transactions.map((transaction) =>
            transaction.sourceKind === "account" && transaction.sourceId === id
              ? { ...transaction, sourceKind: "cash", sourceId: "" }
              : transaction,
          );
          next.incomes = next.incomes.map((income) =>
            income.accountId === id ? { ...income, accountId: "" } : income,
          );
          next.bills = next.bills.map((bill) =>
            bill.accountId === id ? { ...bill, accountId: "" } : bill,
          );
        }
        if (kind === "card") {
          next.transactions = next.transactions.map((transaction) =>
            transaction.sourceKind === "card" && transaction.sourceId === id
              ? { ...transaction, sourceKind: "cash", sourceId: "" }
              : transaction,
          );
        }
      }
      return next;
    });
  }

  function completeExpectation(kind: "income" | "bill", id: string) {
    setData((current) => {
      const next = cloneData(current);
      const expectation = kind === "income"
        ? next.incomes.find((item) => item.id === id)
        : next.bills.find((item) => item.id === id);
      if (!expectation) return current;

      const accountId = expectation.accountId && next.accounts.some((account) => account.id === expectation.accountId)
        ? expectation.accountId
        : "";
      const transaction: Transaction = {
        id: createId(),
        type: kind === "income" ? "income" : "expense",
        amount: expectation.amount,
        description: kind === "income" ? (expectation as ExpectedIncome).source : (expectation as ExpectedBill).payee,
        category: kind === "income" ? "Other" : "Bills",
        categoryId: "",
        dateTime: toDateTimeValue(new Date()),
        sourceKind: accountId ? "account" : "cash",
        sourceId: accountId,
        tags: [],
      };

      next.transactions = [...next.transactions, transaction];
      applyTransactionToSource(next, transaction, 1);
      if (kind === "income") next.incomes = next.incomes.filter((item) => item.id !== id);
      if (kind === "bill") next.bills = next.bills.filter((item) => item.id !== id);
      return next;
    });
  }

  function markCardBillPaid(id: string) {
    setData((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === id ? { ...card, generatedBill: 0 } : card),
    }));
  }

  const nextIncome = [...data.incomes]
    .filter((income) => endOfDay(income.expectedDate) >= Date.now())
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0];

  return (
    <main className="ops-screen money-screen">
      <section className="ops-header money-header">
        <div>
          <p className="ops-kicker">JARVIS / PERSONAL FINANCE LEDGER</p>
          <h1>Wealth Command</h1>
          <p className="ops-subtitle">Accounts, obligations, assets, goals, and cash-flow intelligence in one local ledger.</p>
        </div>
        <div className="money-header-actions">
          <label className="money-currency">
            Currency
            <select value={data.currency} onChange={(event) => setData((current) => ({ ...current, currency: event.target.value as Currency }))}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
          <button type="button" className="ops-button primary" onClick={() => openCreate("transaction")}>+ Transaction</button>
          <button type="button" className="ops-button" onClick={() => openCreate("account")}>+ Account</button>
        </div>
      </section>
      {loadWarning ? <p className="ops-alert danger">{loadWarning}</p> : null}

      <section className="money-summary-grid">
        <SummaryCard label="Net Worth" value={money(summary.netWorth)} detail={`${money(summary.assets)} assets - ${money(summary.debt)} debt`} tone={summary.netWorth >= 0 ? "signal" : "danger"} />
        <SummaryCard label="Total Savings" value={money(summary.totalSavings)} detail={`${data.goals.length} active saving goals`} tone="signal" />
        <SummaryCard label="Monthly Cash Flow" value={money(summary.cashFlow)} detail={`${money(summary.monthlyIncome)} in / ${money(summary.monthlyExpense)} out`} tone={summary.cashFlow >= 0 ? "signal" : "danger"} />
        <SummaryCard
          label="Next Expected Income"
          value={nextIncome ? money(nextIncome.amount) : "Not scheduled"}
          detail={nextIncome ? `${nextIncome.source} / ${formatDate(nextIncome.expectedDate)}` : "Add an expected income event"}
        />
      </section>

      <section className="ops-grid money-grid">
        <section className="ops-panel span-8">
          <PanelHeader label="Six-Month Cash Flow" detail="Income versus expense" />
          <CashFlowChart points={monthlyTrend} money={money} />
        </section>

        <section className="ops-panel span-4">
          <PanelHeader label="Spending Analysis" detail="Current month" />
          <CategoryAnalysis rows={categorySpend} total={summary.monthlyExpense} money={money} />
        </section>

        <section className="ops-panel span-4">
          <PanelHeader label="Expected Income" detail={`${money(summary.expectedIncome)} expected`} action={<AddButton onClick={() => openCreate("income")} />} />
          <div className="money-income-list">
            {[...data.incomes].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).map((income) => (
              <article key={income.id}>
                <span>{formatDate(income.expectedDate)}</span>
                <div>
                  <strong>{income.source}</strong>
                  <small>{expectationDetail(income.note || "Expected receipt", income.accountId, data)}</small>
                </div>
                <strong className="money-positive">{money(income.amount)}</strong>
                <ExpectationActions primaryLabel="Received" onPrimary={() => completeExpectation("income", income.id)} onEdit={() => openEdit("income", income)} onDelete={() => deleteEntry("income", income.id)} />
              </article>
            ))}
            {!data.incomes.length ? <EmptyState text="Schedule salary, invoices, dividends, or other expected income." /> : null}
          </div>
        </section>

        <section className="ops-panel span-4">
          <PanelHeader label="Expected Bill" detail={`${money(summary.expectedBills)} expected`} action={<AddButton onClick={() => openCreate("bill")} />} />
          <div className="money-income-list">
            {[...data.bills].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).map((bill) => (
              <article key={bill.id}>
                <span>{formatDate(bill.expectedDate)}</span>
                <div>
                  <strong>{bill.payee}</strong>
                  <small>{expectationDetail(bill.note || "Expected payment", bill.accountId, data)}</small>
                </div>
                <strong className="money-negative">{money(bill.amount)}</strong>
                <ExpectationActions primaryLabel="Paid" onPrimary={() => completeExpectation("bill", bill.id)} onEdit={() => openEdit("bill", bill)} onDelete={() => deleteEntry("bill", bill.id)} />
              </article>
            ))}
            {!data.bills.length ? <EmptyState text="Schedule utilities, subscriptions, invoices, or other expected bills." /> : null}
          </div>
        </section>

        <section className="ops-panel span-4">
          <PanelHeader label="Upcoming Money Radar" detail="Next 45 days" />
          <div className="money-radar">
            {upcoming.length ? upcoming.map((item) => (
              <div className="money-radar-row" key={item.id}>
                <span className={`money-radar-type ${item.tone}`}>{item.type}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                <strong className={item.tone === "signal" ? "money-positive" : item.tone === "danger" ? "money-negative" : ""}>
                  {item.amount == null ? "-" : `${item.tone === "signal" ? "+" : item.tone === "danger" ? "-" : ""}${money(item.amount)}`}
                </strong>
                <span>{formatDate(item.date)}</span>
              </div>
            )) : <EmptyState text="No upcoming bills, returns, goals, or income scheduled." />}
          </div>
        </section>

        <section className="ops-panel span-4">
          <PanelHeader label="Bank Accounts" detail={`${money(summary.accountBalance)} total balance`} action={<AddButton onClick={() => openCreate("account")} />} />
          <div className="money-card-list">
            {data.accounts.length ? data.accounts.map((account) => (
              <article className="money-account-card" key={account.id}>
                <div>
                  <span>{account.bankName} / {account.accountType}</span>
                  <h3>{account.name}</h3>
                </div>
                <strong>{money(account.balance)}</strong>
                <RowActions onEdit={() => openEdit("account", account)} onDelete={() => deleteEntry("account", account.id)} />
              </article>
            )) : <EmptyState text="Add a bank account to begin tracking liquid cash." />}
          </div>
        </section>

        <section className="ops-panel span-8">
          <PanelHeader label="Credit Cards" detail={`${money(summary.cardDebt)} total unpaid`} action={<AddButton onClick={() => openCreate("card")} />} />
          <div className="money-card-list">
            {data.cards.length ? data.cards.map((card) => {
              const payback = getCardPayback(card);
              const generatedDue = getGeneratedBillDueDate(card);
              const isDueThisMonth = card.generatedBill > 0 && isSameMonth(generatedDue, new Date());
              return (
                <article className="money-credit-card" key={card.id}>
                  <div className="money-card-identity">
                    <h3>•••• {card.lastFour || "----"}</h3>
                    <span>{card.issuer} / {card.name}</span>
                  </div>
                  <div className={`money-card-amount ${isDueThisMonth ? "due" : ""}`}>
                    <span>Bill Generated</span>
                    <strong>{money(card.generatedBill)}</strong>
                    <small>{card.generatedBill > 0 ? `Due ${formatDate(toDateValue(generatedDue))}` : "Paid"}</small>
                  </div>
                  <div className="money-card-amount">
                    <span>Current Bill</span>
                    <strong>{money(card.currentBill)}</strong>
                    <small>Next statement {ordinal(card.billDay)}</small>
                  </div>
                  <div className="money-card-amount">
                    <span>Payback Time</span>
                    <strong>{payback.days} days</strong>
                    <small>Spend today / due {formatDate(toDateValue(payback.dueDate))}</small>
                  </div>
                  <div className="money-card-actions">
                    {card.generatedBill > 0 ? <button type="button" className="money-pay-button" onClick={() => markCardBillPaid(card.id)}>Mark Paid</button> : null}
                    <RowActions onEdit={() => openEdit("card", card)} onDelete={() => deleteEntry("card", card.id)} />
                  </div>
                </article>
              );
            }) : <EmptyState text="Add cards to track generated bills, current spending, and payback time." />}
          </div>
        </section>

        <section className="ops-panel span-12">
          <PanelHeader
            label="Transaction Ledger"
            detail={(
              <>
                <span>{filteredTransactions.length} shown / {matchingTransactions.length} matching</span>
                <strong className="money-ledger-total">Total {money(filteredAmountTotal)}</strong>
              </>
            )}
            action={(
              <div className="money-ledger-actions">
                <label>
                  Period
                  <select value={ledgerPeriod} onChange={(event) => setLedgerPeriod(event.target.value as LedgerPeriod)}>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <label>
                  Tag
                  <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                    <option value="">All tags</option>
                    {existingTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                  </select>
                </label>
                <AddButton label="+ Transaction" onClick={() => openCreate("transaction")} />
              </div>
            )}
          />
          <div className="money-table-wrap">
            <div className="money-table transactions-table">
              <div className="money-table-row money-table-head"><span>Date / Time</span><span>Reason</span><span>Category</span><span>Tags</span><span>Source</span><span>Amount</span><span>Actions</span></div>
              {filteredTransactions.map((transaction) => (
                <div className="money-table-row" key={transaction.id}>
                  <span>{formatDateTime(transaction.dateTime)}</span>
                  <strong>{transaction.description}</strong>
                  <span>{transaction.category}</span>
                  <span className="money-transaction-tags">{transaction.tags.join(" ") || "-"}</span>
                  <span>{sourceLabel(transaction, data)}</span>
                  <strong className={transaction.type === "income" ? "money-positive" : "money-negative"}>{transaction.type === "income" ? "+" : "-"}{money(transaction.amount)}</strong>
                  <RowActions onEdit={() => openEdit("transaction", transaction)} onDelete={() => deleteEntry("transaction", transaction.id)} />
                </div>
              ))}
            </div>
            {!data.transactions.length ? <EmptyState text="Your ledger is empty. Add income or an expense with its exact date and time." /> : null}
            {data.transactions.length > 0 && !filteredTransactions.length ? <EmptyState text="No transactions match the selected period and tag." /> : null}
          </div>
        </section>

        <section className="ops-panel span-6">
          <PanelHeader label="Loans & People" detail="Taken and given" action={<AddButton onClick={() => openCreate("loan")} />} />
          <div className="money-table compact-table">
            {data.loans.map((loan) => (
              <div className="money-list-row" key={loan.id}>
                <span className={`money-direction ${loan.direction}`}>{loan.direction}</span>
                <div><strong>{loan.person}</strong><small>{loan.note || `Expected ${formatDate(loan.expectedReturnDate)}`}</small></div>
                <div className="money-list-amount"><strong>{money(loan.outstanding)}</strong><small>{loan.interestRate}% interest</small></div>
                <RowActions onEdit={() => openEdit("loan", loan)} onDelete={() => deleteEntry("loan", loan.id)} />
              </div>
            ))}
            {!data.loans.length ? <EmptyState text="Track money borrowed from or lent to people." /> : null}
          </div>
        </section>

        <section className="ops-panel span-6">
          <PanelHeader label="Investments" detail={`${money(summary.investmentValue)} current value`} action={<AddButton onClick={() => openCreate("investment")} />} />
          <div className="money-table compact-table">
            {data.investments.map((investment) => {
              const gain = investment.currentValue - investment.investedAmount;
              return (
                <div className="money-list-row" key={investment.id}>
                  <span className="money-investment-type">{investment.type}</span>
                  <div><strong>{investment.name}</strong><small>{investment.platform || "Direct holding"}</small></div>
                  <div className="money-list-amount"><strong>{money(investment.currentValue)}</strong><small className={gain >= 0 ? "money-positive" : "money-negative"}>{gain >= 0 ? "+" : ""}{money(gain)}</small></div>
                  <RowActions onEdit={() => openEdit("investment", investment)} onDelete={() => deleteEntry("investment", investment.id)} />
                </div>
              );
            })}
            {!data.investments.length ? <EmptyState text="Add mutual funds, stocks, private businesses, or other assets." /> : null}
          </div>
        </section>

        <section className="ops-panel span-7">
          <PanelHeader label="Saving Goals" detail={`${money(summary.goalSaved)} allocated`} action={<AddButton onClick={() => openCreate("goal")} />} />
          <div className="money-goals">
            {data.goals.map((goal) => {
              const progress = goal.targetAmount ? Math.min((goal.savedAmount / goal.targetAmount) * 100, 100) : 0;
              return (
                <article className="money-goal" key={goal.id}>
                  <div className="money-goal-head"><div><h3>{goal.name}</h3><span>Due {formatDate(goal.dueDate)}</span></div><strong>{Math.round(progress)}%</strong></div>
                  <div className="money-progress"><span style={{ width: `${progress}%` }} /></div>
                  <div className="money-card-meta"><span>{money(goal.savedAmount)} saved</span><span>{money(Math.max(goal.targetAmount - goal.savedAmount, 0))} remaining</span></div>
                  <RowActions onEdit={() => openEdit("goal", goal)} onDelete={() => deleteEntry("goal", goal.id)} />
                </article>
              );
            })}
            {!data.goals.length ? <EmptyState text="Create a goal with a target amount and due date." /> : null}
          </div>
        </section>

        <section className="ops-panel span-5">
          <PanelHeader label="Financial Readiness" detail="Derived signals" />
          <div className="money-intelligence">
            <IntelligenceRow label="Emergency Runway" value={summary.runwayMonths == null ? "No spend data" : `${summary.runwayMonths.toFixed(1)} months`} signal={(summary.runwayMonths ?? 0) >= 3} />
            <IntelligenceRow label="Savings Rate" value={summary.monthlyIncome ? `${Math.round((summary.cashFlow / summary.monthlyIncome) * 100)}%` : "No income data"} signal={summary.cashFlow > 0} />
            <IntelligenceRow label="Unpaid Card Bills" value={money(summary.cardDebt)} signal={summary.cardDebt === 0} />
            <IntelligenceRow label="Investment Return" value={summary.invested ? `${formatSignedPercent(((summary.investmentValue - summary.invested) / summary.invested) * 100)}` : "No investments"} signal={summary.investmentValue >= summary.invested && summary.invested > 0} />
          </div>
        </section>
      </section>

      {modal ? (
        <EntryModal
          kind={modal.kind}
          isEditing={Boolean(modal.id)}
          draft={draft}
          setDraft={setDraft}
          data={data}
          existingTags={existingTags}
          onClose={closeModal}
          onSubmit={saveEntry}
        />
      ) : null}
    </main>
  );
}

function EntryModal({
  kind,
  isEditing,
  draft,
  setDraft,
  data,
  existingTags,
  onClose,
  onSubmit,
}: {
  kind: EntryKind;
  isEditing: boolean;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  data: MoneyData;
  existingTags: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const patch = (key: string, value: string) => setDraft({ ...draft, [key]: value });
  const categories = draft.type === "income" ? incomeCategories : expenseCategories;

  return (
    <div className="money-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="money-modal" onSubmit={onSubmit}>
        <div className="money-modal-head">
          <div><p className="ops-kicker">{isEditing ? "EDIT RECORD" : "NEW RECORD"}</p><h2>{kindLabels[kind]}</h2></div>
          <button type="button" className="money-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="money-form-grid">
          {kind === "transaction" ? (
            <>
              <Field label="Flow Type"><select value={draft.type} onChange={(e) => patch("type", e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></Field>
              <Field label="Amount"><input required min="0.01" step="0.01" type="number" value={draft.amount} onChange={(e) => patch("amount", e.target.value)} /></Field>
              <Field label="Why / Description" wide><input required value={draft.description} onChange={(e) => patch("description", e.target.value)} placeholder="What was this money for?" /></Field>
              <Field label="Category"><select value={draft.category} onChange={(e) => patch("category", e.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></Field>
              <Field label="Date & Time"><DateTimePicker value={draft.dateTime} allowClear={false} onChange={(value) => patch("dateTime", value)} /></Field>
              <Field label="Tags (optional)" wide>
                <TagAutocompleteInput value={draft.tags} existingTags={existingTags} onChange={(value) => patch("tags", value)} />
              </Field>
              <Field label="Paid Via"><select value={draft.sourceKind} onChange={(e) => patch("sourceKind", e.target.value)}>
                <option value="cash">Cash / Untracked</option>
                <option value="account">Bank Account</option>
                {draft.type !== "income" ? <option value="card">Credit Card</option> : null}
              </select></Field>
              <Field label="Linked Source"><select value={draft.sourceId} disabled={draft.sourceKind === "cash"} onChange={(e) => patch("sourceId", e.target.value)}>
                <option value="">Select source</option>
                {(draft.sourceKind === "account" ? data.accounts : data.cards).map((item) => <option value={item.id} key={item.id}>{"bankName" in item ? `${item.bankName} / ${item.name}` : `${item.issuer} / ${item.name}`}</option>)}
              </select></Field>
            </>
          ) : null}
          {kind === "account" ? (
            <>
              <Field label="Bank / Institution"><input required value={draft.bankName} onChange={(e) => patch("bankName", e.target.value)} /></Field>
              <Field label="Account Name"><input required value={draft.name} onChange={(e) => patch("name", e.target.value)} placeholder="Primary, Emergency..." /></Field>
              <Field label="Account Type"><select value={draft.accountType} onChange={(e) => patch("accountType", e.target.value)}><option>Savings</option><option>Current</option><option>Salary</option><option>Cash</option><option>Other</option></select></Field>
              <Field label="Current Balance"><input required type="number" step="0.01" value={draft.balance} onChange={(e) => patch("balance", e.target.value)} /></Field>
            </>
          ) : null}
          {kind === "card" ? (
            <>
              <Field label="Issuer / Bank"><input required value={draft.issuer} onChange={(e) => patch("issuer", e.target.value)} /></Field>
              <Field label="Card Name"><input required value={draft.name} onChange={(e) => patch("name", e.target.value)} /></Field>
              <Field label="Last 4 Digits"><input required maxLength={4} inputMode="numeric" pattern="\d{4}" value={draft.lastFour} onChange={(e) => patch("lastFour", e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label="Bill Generated Amount"><input required min="0" type="number" step="0.01" value={draft.generatedBill} onChange={(e) => patch("generatedBill", e.target.value)} /></Field>
              <Field label="Current Bill"><input required min="0" type="number" step="0.01" value={draft.currentBill} onChange={(e) => patch("currentBill", e.target.value)} /></Field>
              <Field label="Statement Day"><input required min="1" max="31" type="number" value={draft.billDay} onChange={(e) => patch("billDay", e.target.value)} /></Field>
              <Field label="Payment Due Day"><input required min="1" max="31" type="number" value={draft.dueDay} onChange={(e) => patch("dueDay", e.target.value)} /></Field>
            </>
          ) : null}
          {kind === "loan" ? (
            <>
              <Field label="Direction"><select value={draft.direction} onChange={(e) => patch("direction", e.target.value)}><option value="taken">Loan Taken</option><option value="given">Loan Given</option></select></Field>
              <Field label="Person / Lender"><input required value={draft.person} onChange={(e) => patch("person", e.target.value)} /></Field>
              <Field label="Original Amount"><input required min="0" type="number" step="0.01" value={draft.principal} onChange={(e) => patch("principal", e.target.value)} /></Field>
              <Field label="Outstanding"><input required min="0" type="number" step="0.01" value={draft.outstanding} onChange={(e) => patch("outstanding", e.target.value)} /></Field>
              <Field label="Interest %"><input min="0" type="number" step="0.01" value={draft.interestRate} onChange={(e) => patch("interestRate", e.target.value)} /></Field>
              <Field label="Expected Return / Repay Date"><DateTimePicker mode="date" value={draft.expectedReturnDate} allowClear={false} onChange={(value) => patch("expectedReturnDate", value)} /></Field>
              <Field label="Notes" wide><textarea value={draft.note} onChange={(e) => patch("note", e.target.value)} placeholder="Terms, purpose, repayment plan..." /></Field>
            </>
          ) : null}
          {kind === "investment" ? (
            <>
              <Field label="Investment Type"><select value={draft.type} onChange={(e) => patch("type", e.target.value)}><option>Mutual Fund</option><option>Stocks</option><option>Private Business</option><option>Fixed Deposit</option><option>Retirement</option><option>Crypto</option><option>Real Estate</option><option>Other</option></select></Field>
              <Field label="Asset / Account Name"><input required value={draft.name} onChange={(e) => patch("name", e.target.value)} /></Field>
              <Field label="Platform / Institution"><input value={draft.platform} onChange={(e) => patch("platform", e.target.value)} /></Field>
              <Field label="Amount Invested"><input required min="0" type="number" step="0.01" value={draft.investedAmount} onChange={(e) => patch("investedAmount", e.target.value)} /></Field>
              <Field label="Current Value"><input required min="0" type="number" step="0.01" value={draft.currentValue} onChange={(e) => patch("currentValue", e.target.value)} /></Field>
            </>
          ) : null}
          {kind === "goal" ? (
            <>
              <Field label="Goal Name" wide><input required value={draft.name} onChange={(e) => patch("name", e.target.value)} placeholder="Emergency fund, trip, laptop..." /></Field>
              <Field label="Target Amount"><input required min="0" type="number" step="0.01" value={draft.targetAmount} onChange={(e) => patch("targetAmount", e.target.value)} /></Field>
              <Field label="Already Saved"><input required min="0" type="number" step="0.01" value={draft.savedAmount} onChange={(e) => patch("savedAmount", e.target.value)} /></Field>
              <Field label="Due Date"><DateTimePicker mode="date" value={draft.dueDate} allowClear={false} onChange={(value) => patch("dueDate", value)} /></Field>
              <Field label="Short Note" wide><textarea value={draft.note} onChange={(e) => patch("note", e.target.value)} placeholder="Optional context for this saving goal..." /></Field>
            </>
          ) : null}
          {kind === "income" ? (
            <>
              <Field label="Income Source" wide><input required value={draft.source} onChange={(e) => patch("source", e.target.value)} placeholder="Salary, client invoice, dividend..." /></Field>
              <Field label="Expected Amount"><input required min="0" type="number" step="0.01" value={draft.amount} onChange={(e) => patch("amount", e.target.value)} /></Field>
              <Field label="Expected Date"><DateTimePicker mode="date" value={draft.expectedDate} allowClear={false} onChange={(value) => patch("expectedDate", value)} /></Field>
              <Field label="Receiving Account (optional)" wide><select value={draft.accountId} onChange={(e) => patch("accountId", e.target.value)}>
                <option value="">Cash / Choose when received</option>
                {data.accounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} / {account.name}</option>)}
              </select></Field>
              <Field label="Notes" wide><textarea value={draft.note} onChange={(e) => patch("note", e.target.value)} /></Field>
            </>
          ) : null}
          {kind === "bill" ? (
            <>
              <Field label="Bill / Payee" wide><input required value={draft.payee} onChange={(e) => patch("payee", e.target.value)} placeholder="Rent, electricity, subscription..." /></Field>
              <Field label="Expected Amount"><input required min="0" type="number" step="0.01" value={draft.amount} onChange={(e) => patch("amount", e.target.value)} /></Field>
              <Field label="Expected Date"><DateTimePicker mode="date" value={draft.expectedDate} allowClear={false} onChange={(value) => patch("expectedDate", value)} /></Field>
              <Field label="Paying Account (optional)" wide><select value={draft.accountId} onChange={(e) => patch("accountId", e.target.value)}>
                <option value="">Cash / Choose when paid</option>
                {data.accounts.map((account) => <option value={account.id} key={account.id}>{account.bankName} / {account.name}</option>)}
              </select></Field>
              <Field label="Notes" wide><textarea value={draft.note} onChange={(e) => patch("note", e.target.value)} /></Field>
            </>
          ) : null}
        </div>
        <div className="money-modal-actions">
          <button type="button" className="ops-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-button primary">{isEditing ? "Save Changes" : `Add ${kindLabels[kind]}`}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? "money-field wide" : "money-field"}><span>{label}</span>{children}</label>;
}

function TagAutocompleteInput({ value, existingTags, onChange }: { value: string; existingTags: string[]; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState(value.length);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTag = getActiveTag(value, cursor);
  const suggestions = activeTag
    ? existingTags.filter((tag) => tag.slice(1).startsWith(activeTag.query)).slice(0, 8)
    : [];
  const isOpen = isFocused && suggestions.length > 0;
  const selectedSuggestionIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));

  useEffect(() => {
    setActiveIndex(0);
  }, [activeTag?.query]);

  function syncCursor() {
    setCursor(inputRef.current?.selectionStart ?? value.length);
    setIsFocused(true);
  }

  function selectSuggestion(tag: string) {
    const match = getActiveTag(value, cursor);
    if (!match) return;
    const nextValue = `${value.slice(0, match.start)}${tag} ${value.slice(match.end)}`;
    const nextCursor = match.start + tag.length + 1;
    onChange(nextValue);
    setCursor(nextCursor);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectSuggestion(suggestions[selectedSuggestionIndex]);
    } else if (event.key === "Escape") {
      setIsFocused(false);
    }
  }

  return (
    <div className="money-tag-input">
      <input
        ref={inputRef}
        value={value}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart ?? event.target.value.length);
          setIsFocused(true);
        }}
        onClick={syncCursor}
        onFocus={syncCursor}
        onKeyDown={handleKeyDown}
        onSelect={syncCursor}
        placeholder="#recurring #work or recurring, work"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
      />
      {isOpen ? (
        <div className="money-tag-suggestions" role="listbox">
          {suggestions.map((tag, index) => (
            <button
              key={tag}
              type="button"
              className={index === selectedSuggestionIndex ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(tag)}
              role="option"
              aria-selected={index === selectedSuggestionIndex}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader({ label, detail, action }: { label: string; detail: ReactNode; action?: ReactNode }) {
  return <div className="ops-panel-head money-panel-head"><h2>{label}</h2><div>{typeof detail === "string" ? <span>{detail}</span> : detail}{action}</div></div>;
}

function SummaryCard({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={`money-summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AddButton({ onClick, label = "+ Add" }: { onClick: () => void; label?: string }) {
  return <button type="button" className="money-add-button" onClick={onClick}>{label}</button>;
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="money-row-actions"><button type="button" onClick={onEdit}>Edit</button><button type="button" className="danger" onClick={onDelete}>Delete</button></div>;
}

function ExpectationActions({ primaryLabel, onPrimary, onEdit, onDelete }: { primaryLabel: string; onPrimary: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="money-expectation-actions">
      <button type="button" className="primary" onClick={onPrimary}>{primaryLabel}</button>
      <button type="button" onClick={onEdit}>Edit</button>
      <button type="button" className="danger" onClick={onDelete}>Delete</button>
    </div>
  );
}

function IntelligenceRow({ label, value, signal }: { label: string; value: string; signal: boolean }) {
  return <div><span>{label}</span><strong className={signal ? "money-positive" : ""}>{value}</strong></div>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="money-empty">{text}</p>;
}

function CategoryAnalysis({ rows, total, money }: { rows: { category: string; amount: number }[]; total: number; money: (value: number) => string }) {
  const max = rows[0]?.amount ?? 0;
  return <div className="money-category-list">
    {rows.length ? rows.slice(0, 6).map((row) => (
      <div key={row.category}>
        <div><span>{row.category}</span><strong>{money(row.amount)}</strong></div>
        <div className="money-category-bar"><span style={{ width: `${max ? (row.amount / max) * 100 : 0}%` }} /></div>
        <small>{total ? Math.round((row.amount / total) * 100) : 0}% of monthly spend</small>
      </div>
    )) : <EmptyState text="Add expenses to reveal category concentration." />}
  </div>;
}

function CashFlowChart({ points, money }: { points: { label: string; income: number; expense: number }[]; money: (value: number) => string }) {
  const max = Math.max(...points.flatMap((point) => [point.income, point.expense]), 1);
  const chartHeight = 150;
  const baseline = 180;
  return <div className="money-chart">
    <div className="money-chart-legend"><span><i className="income" />Income</span><span><i className="expense" />Expense</span></div>
    <svg viewBox="0 0 720 220" role="img" aria-label="Income and expense for the last six months">
      {[0, 1, 2, 3].map((line) => <line key={line} x1="42" x2="700" y1={30 + line * 50} y2={30 + line * 50} className="money-chart-gridline" />)}
      {points.map((point, index) => {
        const groupX = 72 + index * 105;
        const incomeHeight = (point.income / max) * chartHeight;
        const expenseHeight = (point.expense / max) * chartHeight;
        return <g key={point.label}>
          <rect x={groupX} y={baseline - incomeHeight} width="30" height={incomeHeight} className="money-chart-income"><title>{point.label} income: {money(point.income)}</title></rect>
          <rect x={groupX + 34} y={baseline - expenseHeight} width="30" height={expenseHeight} className="money-chart-expense"><title>{point.label} expense: {money(point.expense)}</title></rect>
          <text x={groupX + 31} y="204" textAnchor="middle">{point.label}</text>
        </g>;
      })}
    </svg>
  </div>;
}

function calculateSummary(data: MoneyData) {
  const monthKey = toMonthKey(new Date());
  const current = data.transactions.filter((transaction) => transaction.dateTime.startsWith(monthKey));
  const monthlyIncome = sum(current.filter((item) => item.type === "income").map((item) => item.amount));
  const monthlyExpense = sum(current.filter((item) => item.type === "expense").map((item) => item.amount));
  const cash = sum(data.accounts.map((account) => account.balance));
  const investmentValue = sum(data.investments.map((investment) => investment.currentValue));
  const invested = sum(data.investments.map((investment) => investment.investedAmount));
  const receivables = sum(data.loans.filter((loan) => loan.direction === "given").map((loan) => loan.outstanding));
  const loanDebt = sum(data.loans.filter((loan) => loan.direction === "taken").map((loan) => loan.outstanding));
  const cardDebt = sum(data.cards.map((card) => card.generatedBill + card.currentBill));
  const goalSaved = sum(data.goals.map((goal) => goal.savedAmount));
  const expectedIncome = sum(data.incomes.map((income) => income.amount));
  const expectedBills = sum(data.bills.map((bill) => bill.amount));
  const totalSavings = sum(data.accounts.filter((account) => account.accountType === "Savings").map((account) => account.balance)) + goalSaved;
  const assets = cash + investmentValue + receivables;
  const debt = loanDebt + cardDebt;
  return {
    monthlyIncome,
    monthlyExpense,
    cashFlow: monthlyIncome - monthlyExpense,
    assets,
    debt,
    netWorth: assets - debt,
    totalSavings,
    accountBalance: cash,
    investmentValue,
    invested,
    cardDebt,
    goalSaved,
    expectedIncome,
    expectedBills,
    runwayMonths: monthlyExpense > 0 ? Math.max(cash, 0) / monthlyExpense : null,
  };
}

function buildMonthlyTrend(transactions: Transaction[]) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const key = toMonthKey(date);
    const monthTransactions = transactions.filter((transaction) => transaction.dateTime.startsWith(key));
    return {
      label: date.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
      income: sum(monthTransactions.filter((item) => item.type === "income").map((item) => item.amount)),
      expense: sum(monthTransactions.filter((item) => item.type === "expense").map((item) => item.amount)),
    };
  });
}

function buildCategorySpend(transactions: Transaction[]) {
  const key = toMonthKey(new Date());
  const totals = new Map<string, number>();
  transactions.filter((item) => item.type === "expense" && item.dateTime.startsWith(key)).forEach((item) => {
    totals.set(item.category, (totals.get(item.category) ?? 0) + item.amount);
  });
  return [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

function buildUpcoming(data: MoneyData) {
  const today = startOfDay(new Date());
  const horizon = today.getTime() + 45 * 86_400_000;
  const rows: { id: string; type: string; label: string; detail: string; date: string; tone: string; amount: number | null }[] = [];
  data.cards.forEach((card) => {
    if (card.generatedBill <= 0) return;
    const due = getGeneratedBillDueDate(card);
    if (due.getTime() <= horizon) rows.push({ id: `card-${card.id}`, type: "Card", label: `${card.name} payment due`, detail: `${card.issuer} / •••• ${card.lastFour || "----"}`, date: toDateValue(due), tone: "danger", amount: card.generatedBill });
  });
  data.loans.forEach((loan) => rows.push({ id: `loan-${loan.id}`, type: "Loan", label: `${loan.direction === "given" ? "Expected from" : "Repay"} ${loan.person}`, detail: loan.note || `${loan.direction} loan`, date: loan.expectedReturnDate, tone: loan.direction === "given" ? "signal" : "danger", amount: loan.outstanding }));
  data.goals.forEach((goal) => rows.push({ id: `goal-${goal.id}`, type: "Goal", label: goal.name, detail: "Savings target deadline", date: goal.dueDate, tone: "neutral", amount: goal.targetAmount }));
  data.incomes.forEach((income) => rows.push({ id: `income-${income.id}`, type: "Income", label: income.source, detail: income.note || "Expected receipt", date: income.expectedDate, tone: "signal", amount: income.amount }));
  data.bills.forEach((bill) => rows.push({ id: `bill-${bill.id}`, type: "Bill", label: bill.payee, detail: bill.note || "Expected payment", date: bill.expectedDate, tone: "danger", amount: bill.amount }));
  return rows.filter((row) => {
    const time = endOfDay(row.date);
    return time >= today.getTime() && time <= horizon;
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

function applyTransactionToSource(data: MoneyData, transaction: Transaction, direction: 1 | -1) {
  if (!transaction.sourceId || transaction.sourceKind === "cash") return;
  if (transaction.sourceKind === "account") {
    const delta = (transaction.type === "income" ? transaction.amount : -transaction.amount) * direction;
    data.accounts = data.accounts.map((account) => account.id === transaction.sourceId ? { ...account, balance: account.balance + delta } : account);
  }
  if (transaction.sourceKind === "card" && transaction.type === "expense") {
    data.cards = data.cards.map((card) => card.id === transaction.sourceId ? { ...card, currentBill: Math.max(card.currentBill + transaction.amount * direction, 0) } : card);
  }
}

function initialDraft(kind: EntryKind): Draft {
  const today = toDateValue(new Date());
  const now = toDateTimeValue(new Date());
  const drafts: Record<EntryKind, Draft> = {
    transaction: { type: "expense", amount: "", description: "", category: "Food", dateTime: now, sourceKind: "cash", sourceId: "", tags: "" },
    account: { bankName: "", name: "", accountType: "Savings", balance: "" },
    card: { issuer: "", name: "", lastFour: "", generatedBill: "0", currentBill: "0", billDay: "1", dueDay: "15" },
    loan: { direction: "taken", person: "", principal: "", outstanding: "", interestRate: "0", expectedReturnDate: today, note: "" },
    investment: { type: "Mutual Fund", name: "", platform: "", investedAmount: "", currentValue: "" },
    goal: { name: "", targetAmount: "", savedAmount: "0", dueDate: today, note: "" },
    income: { source: "", amount: "", expectedDate: today, note: "", accountId: "" },
    bill: { payee: "", amount: "", expectedDate: today, note: "", accountId: "" },
  };
  return drafts[kind];
}

function entryToDraft(kind: EntryKind, entry: Entry): Draft {
  if (kind === "transaction") {
    const item = entry as Transaction;
    return {
      ...stringifyValues(item),
      tags: item.tags.join(" "),
      dateTime: item.dateTime.endsWith("Z") ? toDateTimeValue(new Date(item.dateTime)) : item.dateTime.slice(0, 16),
    };
  }
  return stringifyValues(entry);
}

function draftToEntry(kind: EntryKind, draft: Draft, id: string): Entry | null {
  const number = (key: string) => Number(draft[key]) || 0;
  if (kind === "transaction") {
    if (!draft.description?.trim() || number("amount") <= 0) return null;
    const type = draft.type as TransactionType;
    const sourceKind = type === "income" && draft.sourceKind === "card" ? "cash" : draft.sourceKind as SourceKind;
    return {
      id,
      type,
      amount: number("amount"),
      description: draft.description.trim(),
      category: draft.category,
      categoryId: "",
      dateTime: draft.dateTime,
      sourceKind,
      sourceId: sourceKind === "cash" ? "" : draft.sourceId,
      tags: normalizeTags(draft.tags),
    };
  }
  if (kind === "account") return { id, bankName: draft.bankName.trim(), name: draft.name.trim(), accountType: draft.accountType, balance: number("balance") };
  if (kind === "card") return { id, issuer: draft.issuer.trim(), name: draft.name.trim(), lastFour: draft.lastFour, generatedBill: number("generatedBill"), currentBill: number("currentBill"), billDay: clampDay(number("billDay")), dueDay: clampDay(number("dueDay")) };
  if (kind === "loan") return { id, direction: draft.direction as Loan["direction"], person: draft.person.trim(), principal: number("principal"), outstanding: number("outstanding"), interestRate: number("interestRate"), expectedReturnDate: draft.expectedReturnDate, note: draft.note.trim() };
  if (kind === "investment") return { id, type: draft.type, name: draft.name.trim(), platform: draft.platform.trim(), investedAmount: number("investedAmount"), currentValue: number("currentValue") };
  if (kind === "goal") return { id, name: draft.name.trim(), targetAmount: number("targetAmount"), savedAmount: number("savedAmount"), dueDate: draft.dueDate, note: draft.note.trim() };
  if (kind === "income") return { id, source: draft.source.trim(), amount: number("amount"), expectedDate: draft.expectedDate, note: draft.note.trim(), accountId: draft.accountId };
  return { id, payee: draft.payee.trim(), amount: number("amount"), expectedDate: draft.expectedDate, note: draft.note.trim(), accountId: draft.accountId };
}

function collectionKey(kind: Exclude<EntryKind, "transaction">): "accounts" | "cards" | "loans" | "investments" | "goals" | "incomes" | "bills" {
  return ({ account: "accounts", card: "cards", loan: "loans", investment: "investments", goal: "goals", income: "incomes", bill: "bills" } as const)[kind];
}

function upsert<T extends { id: string }>(items: T[], entry: T) {
  return items.some((item) => item.id === entry.id) ? items.map((item) => item.id === entry.id ? entry : item) : [...items, entry];
}

function cloneData(data: MoneyData): MoneyData {
  return {
    ...data,
    categories: [...data.categories],
    transactions: [...data.transactions],
    accounts: [...data.accounts],
    cards: [...data.cards],
    loans: [...data.loans],
    investments: [...data.investments],
    goals: [...data.goals],
    incomes: [...data.incomes],
    bills: [...data.bills],
  };
}

function sourceLabel(transaction: Transaction, data: MoneyData) {
  if (transaction.sourceKind === "cash") return "Cash / Untracked";
  if (transaction.sourceKind === "account") {
    const account = data.accounts.find((item) => item.id === transaction.sourceId);
    return account ? `${account.bankName} / ${account.name}` : "Deleted account";
  }
  const card = data.cards.find((item) => item.id === transaction.sourceId);
  return card ? `${card.issuer} / ${card.name}` : "Deleted card";
}

function stringifyValues(entry: Entry): Draft {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "id").map(([key, value]) => [key, String(value ?? "")]));
}

function normalizeTags(value: string | string[]) {
  const parts = Array.isArray(value) ? value : value.split(/[\s,]+/);
  return [...new Set(
    parts
      .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
      .filter(Boolean)
      .map((tag) => `#${tag}`),
  )];
}

function normalizeMoneyData(value: unknown): MoneyData {
  const parsed = asRecord(value);
  const today = toDateValue(new Date());
  const now = toDateTimeValue(new Date());
  return {
    version: 1,
    currency: normalizeCurrency(parsed.currency),
    categories: recordList(parsed.categories).map((item) => ({
      id: stringValue(item.id) || createId(),
      transactionType: item.transactionType === "income" ? "income" : "expense",
      name: stringValue(item.name) || "Other",
    })),
    transactions: recordList(parsed.transactions).map((item) => ({
      id: stringValue(item.id) || createId(),
      type: item.type === "income" ? "income" : "expense",
      amount: numberValue(item.amount),
      description: stringValue(item.description),
      category: stringValue(item.category) || "Other",
      categoryId: stringValue(item.categoryId),
      dateTime: stringValue(item.dateTime) || now,
      sourceKind: item.sourceKind === "account" || item.sourceKind === "card" ? item.sourceKind : "cash",
      sourceId: stringValue(item.sourceId),
      tags: normalizeTags(Array.isArray(item.tags) || typeof item.tags === "string" ? item.tags as string | string[] : []),
    })),
    accounts: recordList(parsed.accounts).map((item) => ({
      id: stringValue(item.id) || createId(),
      bankName: stringValue(item.bankName),
      name: stringValue(item.name),
      accountType: stringValue(item.accountType) || "Savings",
      balance: numberValue(item.balance),
    })),
    cards: recordList(parsed.cards).map(normalizeCard),
    loans: recordList(parsed.loans).map((item) => ({
      id: stringValue(item.id) || createId(),
      direction: item.direction === "given" ? "given" : "taken",
      person: stringValue(item.person),
      principal: numberValue(item.principal),
      outstanding: numberValue(item.outstanding),
      interestRate: numberValue(item.interestRate),
      expectedReturnDate: stringValue(item.expectedReturnDate) || today,
      note: stringValue(item.note),
    })),
    investments: recordList(parsed.investments).map((item) => ({
      id: stringValue(item.id) || createId(),
      type: stringValue(item.type) || "Other",
      name: stringValue(item.name),
      platform: stringValue(item.platform),
      investedAmount: numberValue(item.investedAmount),
      currentValue: numberValue(item.currentValue),
    })),
    goals: recordList(parsed.goals).map((item) => ({
      id: stringValue(item.id) || createId(),
      name: stringValue(item.name),
      targetAmount: numberValue(item.targetAmount),
      savedAmount: numberValue(item.savedAmount),
      dueDate: stringValue(item.dueDate) || today,
      note: stringValue(item.note),
    })),
    incomes: recordList(parsed.incomes).map((item) => ({
      id: stringValue(item.id) || createId(),
      source: stringValue(item.source),
      amount: numberValue(item.amount),
      expectedDate: stringValue(item.expectedDate) || today,
      note: stringValue(item.note),
      accountId: stringValue(item.accountId),
    })),
    bills: recordList(parsed.bills).map((item) => ({
      id: stringValue(item.id) || createId(),
      payee: stringValue(item.payee),
      amount: numberValue(item.amount),
      expectedDate: stringValue(item.expectedDate) || today,
      note: stringValue(item.note),
      accountId: stringValue(item.accountId),
    })),
  };
}

function normalizeCard(value: Record<string, unknown>): CreditCard {
  const card = asRecord(value);
  return {
    id: stringValue(card.id) || createId(),
    issuer: stringValue(card.issuer),
    name: stringValue(card.name),
    lastFour: stringValue(card.lastFour),
    generatedBill: numberValue(card.generatedBill),
    currentBill: numberValue(card.currentBill ?? card.currentBalance),
    billDay: clampDay(numberValue(card.billDay) || 1),
    dueDay: clampDay(numberValue(card.dueDay) || 15),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isTransactionInPeriod(transaction: Transaction, period: LedgerPeriod) {
  if (period === "all") return true;
  const transactionDate = startOfDay(new Date(transaction.dateTime));
  const today = startOfDay(new Date());
  if (period === "month") {
    return transactionDate.getFullYear() === today.getFullYear() && transactionDate.getMonth() === today.getMonth();
  }
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  return transactionDate >= weekStart && transactionDate < nextWeek;
}

function getActiveTag(value: string, cursor: number) {
  let start = cursor;
  while (start > 0 && !/[\s,]/.test(value[start - 1])) start -= 1;
  if (value[start] !== "#") return null;

  let end = cursor;
  while (end < value.length && !/[\s,]/.test(value[end])) end += 1;
  return { start, end, query: value.slice(start + 1, cursor).toLowerCase() };
}

function expectationDetail(note: string, accountId: string, data: MoneyData) {
  if (!accountId) return note;
  const account = data.accounts.find((item) => item.id === accountId);
  return `${note} / ${account ? `${account.bankName} / ${account.name}` : "Deleted account"}`;
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTimeValue(date: Date) {
  return `${toDateValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  if (!value) return "No date";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(value: string) {
  return new Date(`${value.slice(0, 10)}T23:59:59`).getTime();
}

function getCardPayback(card: CreditCard) {
  const today = startOfDay(new Date());
  const statementMonthOffset = today.getDate() <= Math.min(card.billDay, daysInMonth(today.getFullYear(), today.getMonth())) ? 0 : 1;
  const statementDate = dateForMonthOffset(today, statementMonthOffset, card.billDay);
  const dueMonthOffset = card.dueDay > card.billDay ? statementMonthOffset : statementMonthOffset + 1;
  const dueDate = dateForMonthOffset(today, dueMonthOffset, card.dueDay);
  return {
    statementDate,
    dueDate,
    days: Math.max(Math.round((dueDate.getTime() - today.getTime()) / 86_400_000), 0),
  };
}

function getGeneratedBillDueDate(card: CreditCard) {
  const today = startOfDay(new Date());
  const statementMonthOffset = today.getDate() >= Math.min(card.billDay, daysInMonth(today.getFullYear(), today.getMonth())) ? 0 : -1;
  const dueMonthOffset = card.dueDay > card.billDay ? statementMonthOffset : statementMonthOffset + 1;
  return dateForMonthOffset(today, dueMonthOffset, card.dueDay);
}

function dateForMonthOffset(base: Date, offset: number, day: number) {
  const monthStart = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, daysInMonth(monthStart.getFullYear(), monthStart.getMonth())));
}

function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function clampDay(value: number) {
  return Math.max(1, Math.min(31, value));
}

function ordinal(value: number) {
  const suffix = value % 10 === 1 && value % 100 !== 11 ? "st" : value % 10 === 2 && value % 100 !== 12 ? "nd" : value % 10 === 3 && value % 100 !== 13 ? "rd" : "th";
  return `${value}${suffix}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
