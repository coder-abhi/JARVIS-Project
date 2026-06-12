"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TransactionModal from "../components/TransactionModal";
import {
  allocationSummary,
  calculateHelpingHandsLedger,
  formatDate,
  formatMoney,
  formatPeriod,
  helpingHandsStartMonth,
  helpingHandsRules,
  ordinal,
  summarizeUnpaidInterest,
  toPeriod,
  uniqueMemberNames,
} from "../ledger";
import type { HelpingHandsTransaction } from "../types";
import { useHelpingHandsData } from "../useHelpingHandsData";
import "./HelpingHandsPage.css";

export default function HelpingHandsPage() {
  const {
    data,
    isLoading,
    warning,
    setWarning,
    saveStartMonth,
    saveTransaction,
    removeTransaction,
  } = useHelpingHandsData();
  const [selectedPeriod, setSelectedPeriod] = useState(() => toPeriod(new Date()));
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<HelpingHandsTransaction | undefined>();
  const [receiptMember, setReceiptMember] = useState("");
  const [notice, setNotice] = useState("");
  const currentPeriod = toPeriod(new Date());
  const startPeriod = helpingHandsStartMonth(data, currentPeriod);

  useEffect(() => {
    if (selectedPeriod < startPeriod) setSelectedPeriod(startPeriod);
  }, [selectedPeriod, startPeriod]);

  const ledger = useMemo(
    () => calculateHelpingHandsLedger(data, selectedPeriod, new Date(), startPeriod),
    [data, selectedPeriod, startPeriod],
  );
  const recentTransactions = useMemo(
    () => ledger.transactions.slice(0, 10),
    [ledger.transactions],
  );
  const memberNames = useMemo(() => uniqueMemberNames(data), [data]);
  const openLoans = ledger.loans.filter((loan) => loan.outstanding > 0);
  const unpaidInterest = useMemo(
    () => summarizeUnpaidInterest(ledger.interestCharges),
    [ledger.interestCharges],
  );
  const totalInvestment = 0;
  const investmentInterestEarned = 0;
  const totalBalanceIncludingLoanAndInterest = ledger.totalMonthlyContribution
    + ledger.interestReceived;

  function openTransaction(transaction?: HelpingHandsTransaction) {
    setReceiptMember("");
    setEditingTransaction(transaction);
    setIsTransactionOpen(true);
  }

  function openMemberReceipt(member: string) {
    setEditingTransaction(undefined);
    setReceiptMember(member);
    setIsTransactionOpen(true);
  }

  async function handleStartMonthChange(startMonth: string) {
    if (!startMonth) return;
    try {
      await saveStartMonth(startMonth);
      if (selectedPeriod < startMonth) setSelectedPeriod(startMonth);
      setNotice(`Helping Hands rules now start from ${formatPeriod(startMonth)}.`);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Could not save start month");
    }
  }

  async function handleSave(transaction: HelpingHandsTransaction) {
    try {
      await saveTransaction(transaction);
      setNotice(`${transaction.direction === "received" ? "Receipt" : "Loan"} registered and ledger recalculated.`);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Could not save transaction");
      throw error;
    }
  }

  async function handleDelete(transactionId: string) {
    if (!window.confirm("Delete this cash transaction? Every derived balance will be recalculated.")) return;
    try {
      await removeTransaction(transactionId);
      setNotice("Transaction deleted and ledger recalculated.");
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Could not delete transaction");
    }
  }

  return (
    <main className="ops-screen helping-screen">
      <section className="ops-header helping-header">
        <div>
          <p className="ops-kicker">JARVIS / COMMUNITY SAVINGS LEDGER</p>
          <h1>Helping Hands</h1>
          <p className="ops-subtitle">Register only cash sent or received. Contributions, interest, and loan repayments are allocated automatically.</p>
        </div>
        <div className="helping-header-actions">
          <label className="helping-period-picker">
            Start month
            <input type="month" max={currentPeriod} value={startPeriod} onChange={(event) => void handleStartMonthChange(event.target.value)} />
          </label>
          <label className="helping-period-picker">
            Working cycle
            <input type="month" min={startPeriod} max={currentPeriod} value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)} />
          </label>
          <button type="button" className="ops-button primary" onClick={() => openTransaction()}>+ Register Transaction</button>
        </div>
      </section>

      {warning ? <p className="ops-alert danger">{warning}</p> : null}
      {notice ? <p className="ops-alert signal">{notice}</p> : null}
      {isLoading ? <p className="ops-alert">Loading Helping Hands ledger...</p> : null}

      <section className="helping-summary-grid">
        <SummaryCard label="Total Remaining Balance" value={formatMoney(ledger.fundBalance)} detail="Cash currently remaining in the common bank" tone={ledger.fundBalance >= 0 ? "signal" : "danger"} />
        <SummaryCard label="Total Loan Repayment Pending" value={formatMoney(ledger.principalOutstanding)} detail={`${openLoans.length} open loans across all members`} tone={ledger.principalOutstanding > 0 ? "danger" : "signal"} />
        <SummaryCard label="Total Interest Received" value={formatMoney(ledger.interestReceived)} detail={`Interest collected through ${formatDate(ledger.asOf)}`} tone="signal" />
        <SummaryCard label="Total Investment" value={formatMoney(totalInvestment)} detail="Future investment tracking placeholder" />
        <SummaryCard label="Total Monthly Contribution" value={formatMoney(ledger.totalMonthlyContribution)} detail={`${ledger.contributionMonths} months x ${formatMoney(helpingHandsRules.monthlyContribution)} x ${ledger.members.length} members`} tone="signal" />
        <SummaryCard label="Investment Interest Earned" value={formatMoney(investmentInterestEarned)} detail="Future investment income placeholder" />
        <SummaryCard label="Total Balance Including Loan & Interest" value={formatMoney(totalBalanceIncludingLoanAndInterest)} detail={`${formatMoney(ledger.totalMonthlyContribution)} monthly contribution + ${formatMoney(ledger.interestReceived)} interest collected`} tone={totalBalanceIncludingLoanAndInterest >= 0 ? "signal" : "danger"} featured />
      </section>

      <section className="ops-grid helping-grid">
        <section className="ops-panel span-12">
          <PanelHeader label="Member Position" detail={`Calculated through ${formatDate(ledger.asOf)}`} />
          <div className="helping-table-wrap">
            <div className="helping-member-table">
              <div className="helping-member-row head">
                <span>Member</span><span>Contribution Curr Month</span><span>Repayment Pending</span><span>Interest Due</span><span>Total Interest Paid</span><span>Status</span>
              </div>
              {ledger.members.map((member) => (
                <div className="helping-member-row" key={member.key}>
                  <strong>{member.name}</strong>
                  <strong>{formatMoney(member.contributionPaid)} / {formatMoney(helpingHandsRules.monthlyContribution)}</strong>
                  <strong>{formatMoney(member.principalOutstanding)}</strong>
                  <strong className={member.interestDue > 0 ? "helping-negative" : "helping-positive"}>{formatMoney(member.interestDue)}</strong>
                  <strong className="helping-positive">{formatMoney(member.totalInterestPaid)}</strong>
                  <button
                    type="button"
                    className={`helping-status ${statusTone(member.status)}`}
                    title={`Record money received from ${member.name}`}
                    onClick={() => openMemberReceipt(member.name)}
                  >
                    {statusLabel(member.status)}
                  </button>
                </div>
              ))}
              {ledger.members.length ? (
                <div className="helping-member-row footer">
                  <strong>Total</strong>
                  <span />
                  <strong>{formatMoney(ledger.principalOutstanding)}</strong>
                  <strong className={ledger.interestDue > 0 ? "helping-negative" : "helping-positive"}>{formatMoney(ledger.interestDue)}</strong>
                  <span />
                  <span />
                </div>
              ) : null}
            </div>
            {!ledger.members.length ? <EmptyState text="Register the first cash transaction to create a member ledger automatically." /> : null}
          </div>
        </section>

        <section className="ops-panel span-12">
          <PanelHeader label="Interest Balance Register" detail={`${unpaidInterest.length} monthly interest payment issues`} />
          <div className="helping-table-wrap">
            <div className="helping-interest-table">
              <div className="helping-interest-row head"><span>Cycle</span><span>Member</span><span>Expected</span><span>Paid</span><span>Due / Extra Paid</span></div>
              {unpaidInterest.map((summary) => (
                <div className="helping-interest-row" key={summary.id}>
                  <span>{formatPeriod(summary.period)}</span>
                  <strong>{summary.member}</strong>
                  <strong>{formatMoney(summary.charge)}</strong>
                  <strong className="helping-positive">{formatMoney(summary.paid)}</strong>
                  <strong className={summary.due > 0 ? "helping-negative" : "helping-positive"}>
                    {summary.due > 0 ? `${formatMoney(summary.due)} due` : `${formatMoney(Math.abs(summary.due))} extra`}
                  </strong>
                </div>
              ))}
            </div>
            {!unpaidInterest.length ? <EmptyState text="All monthly interest payments match through this cycle." /> : null}
          </div>
        </section>

        <section className="ops-panel span-12">
          <PanelHeader
            label="Recent Transactions"
            detail={`${recentTransactions.length} of ${ledger.transactions.length} shown through ${formatDate(ledger.asOf)}`}
            action={<Link className="helping-inline-button" to="/helping-hands/transactions">View all</Link>}
          />
          <div className="helping-recent-table">
            {recentTransactions.map((transaction) => (
              <div className="helping-recent-row" key={transaction.id}>
                <span>{formatDate(transaction.date)}</span>
                <strong>{transaction.member}</strong>
                <span className={`helping-direction ${transaction.direction}`}>{transaction.direction === "received" ? "Received" : "Sent"}</span>
                <strong className={transaction.direction === "received" ? "helping-positive" : "helping-negative"}>
                  {transaction.direction === "received" ? "+" : "-"}{formatMoney(transaction.amount)}
                </strong>
                <small>{allocationSummary(transaction.allocations)}</small>
                <div className="helping-actions">
                  <button type="button" onClick={() => openTransaction(transaction)}>Edit</button>
                  <button type="button" className="danger" onClick={() => void handleDelete(transaction.id)}>Delete</button>
                </div>
              </div>
            ))}
            {!recentTransactions.length ? <EmptyState text="No cash transactions in the selected start month and working cycle timeline." /> : null}
          </div>
        </section>

        <section className="ops-panel span-12">
          <PanelHeader label="Rules Engine" detail="Fixed group policy and receipt allocation" />
          <div className="helping-rule-grid">
            <RuleMetric label="Monthly Contribution" value={formatMoney(helpingHandsRules.monthlyContribution)} detail={`Due before the ${ordinal(helpingHandsRules.dueDay)} of every month`} />
            <RuleMetric label="Loan Interest" value={`${helpingHandsRules.interestRate}% / month`} detail="One monthly charge on each member's total outstanding principal" />
            <RuleMetric label="Loan Taken Day 1-10" value="Interest this month" detail={`First full interest is due on the ${ordinal(helpingHandsRules.dueDay)}`} />
            <RuleMetric label="Loan Taken Day 11+" value="Interest next month" detail={`First interest moves to next month's ${ordinal(helpingHandsRules.dueDay)}`} />
            <RuleMetric label="Missed Contribution" value="Becomes loan" detail={`Unpaid amount converts automatically on the ${ordinal(helpingHandsRules.dueDay)}`} />
            <RuleMetric label="Unpaid Interest" value="Due, never compounded" detail="It stays in the Interest Due Register and is excluded from future interest calculations" />
          </div>
          <div className="helping-rules-divider">
            <span>Automatic Allocation Order</span>
            <small>Applied to every receipt</small>
          </div>
          <div className="helping-allocation-rules">
            <RuleStep number="01" label="Current-cycle interest" detail={`The member can pay this month's total interest on any day through the ${ordinal(helpingHandsRules.dueDay)}.`} />
            <RuleStep number="02" label="Monthly contribution" detail={`Through the ${ordinal(helpingHandsRules.dueDay)}, up to ${formatMoney(helpingHandsRules.monthlyContribution)} is assigned to the current month.`} />
            <RuleStep number="03" label="Older interest" detail="Any remaining money clears interest still due from earlier cycles." />
            <RuleStep number="04" label="Loan repayment" detail="Remaining money clears contribution-default principal first, then cash-loan principal." />
          </div>
        </section>
      </section>

      {isTransactionOpen ? (
        <TransactionModal
          transaction={editingTransaction}
          presetMember={receiptMember}
          memberNames={memberNames}
          onClose={() => {
            setIsTransactionOpen(false);
            setEditingTransaction(undefined);
            setReceiptMember("");
          }}
          onSave={handleSave}
        />
      ) : null}
    </main>
  );
}

function PanelHeader({ label, detail, action }: { label: string; detail: React.ReactNode; action?: React.ReactNode }) {
  return <div className="ops-panel-head helping-panel-head"><h2>{label}</h2><div><span>{detail}</span>{action}</div></div>;
}

function SummaryCard({ label, value, detail, tone = "", featured = false }: { label: string; value: string; detail: string; tone?: string; featured?: boolean }) {
  return <article className={`helping-summary-card ${tone} ${featured ? "featured" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function RuleStep({ number, label, detail }: { number: string; label: string; detail: string }) {
  return <article><span>{number}</span><div><strong>{label}</strong><small>{detail}</small></div></article>;
}

function RuleMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="helping-empty">{text}</p>;
}

function statusLabel(status: "clear" | "contribution_due" | "interest_due" | "converted") {
  if (status === "contribution_due") return "Contribution due";
  if (status === "interest_due") return "Interest due";
  if (status === "converted") return "Converted to loan";
  return "Clear";
}

function statusTone(status: "clear" | "contribution_due" | "interest_due" | "converted") {
  if (status === "clear") return "signal";
  if (status === "converted") return "warning";
  return "danger";
}
