"use client";

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TransactionModal from "../components/TransactionModal";
import {
  allocationSummary,
  calculateHelpingHandsLedger,
  formatDate,
  formatMoney,
  toPeriod,
  uniqueMemberNames,
} from "../ledger";
import type { HelpingHandsDirection, HelpingHandsTransaction } from "../types";
import { useHelpingHandsData } from "../useHelpingHandsData";
import "./HelpingHandsPage.css";

type DateSortDirection = "desc" | "asc";

export default function HelpingHandsTransactionsPage() {
  const { data, isLoading, warning, setWarning, saveTransaction, removeTransaction } = useHelpingHandsData();
  const [memberFilter, setMemberFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState<HelpingHandsDirection | "">("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [dateSortDirection, setDateSortDirection] = useState<DateSortDirection>("desc");
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<HelpingHandsTransaction | undefined>();
  const [notice, setNotice] = useState("");
  const memberNames = useMemo(() => uniqueMemberNames(data), [data]);
  const transactions = useMemo(() => {
    const today = new Date();
    const latestDate = data.transactions.reduce(
      (latest, transaction) => transaction.date > latest ? transaction.date : latest,
      `${toPeriod(today)}-${String(today.getDate()).padStart(2, "0")}`,
    );
    const [year, month, day] = latestDate.split("-").map(Number);
    const processed = calculateHelpingHandsLedger(
      data,
      latestDate.slice(0, 7),
      new Date(year, month - 1, day),
    ).transactions;
    return processed
      .filter((transaction) => {
        if (memberFilter && transaction.member.toLocaleLowerCase() !== memberFilter.toLocaleLowerCase()) return false;
        if (directionFilter && transaction.direction !== directionFilter) return false;
        if (periodFilter && !transaction.date.startsWith(periodFilter)) return false;
        return true;
      })
      .sort((a, b) => {
        const comparison = a.date.localeCompare(b.date)
          || a.createdAt.localeCompare(b.createdAt)
          || a.id.localeCompare(b.id);
        return dateSortDirection === "asc" ? comparison : -comparison;
      });
  }, [data, dateSortDirection, directionFilter, memberFilter, periodFilter]);

  async function handleSave(transaction: HelpingHandsTransaction) {
    await saveTransaction(transaction);
    setNotice(editingTransaction ? "Transaction updated and ledger recalculated." : "Transaction registered and ledger recalculated.");
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
          <p className="ops-kicker">HELPING HANDS / CASH REGISTER</p>
          <h1>All Transactions</h1>
          <p className="ops-subtitle">The raw sent-and-received ledger. Edit any row and every derived obligation is recalculated.</p>
        </div>
        <div className="helping-header-actions">
          <Link className="ops-button" to="/helping-hands">Dashboard</Link>
          <button type="button" className="ops-button primary" onClick={() => {
            setEditingTransaction(undefined);
            setIsTransactionOpen(true);
          }}>+ Register Transaction</button>
        </div>
      </section>

      {warning ? <p className="ops-alert danger">{warning}</p> : null}
      {notice ? <p className="ops-alert signal">{notice}</p> : null}
      {isLoading ? <p className="ops-alert">Loading transactions...</p> : null}

      <section className="ops-panel helping-transactions-panel">
        <div className="helping-transaction-toolbar">
          <div><strong>{transactions.length}</strong><span>Transactions shown</span></div>
          <label>Member<select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">All members</option>{memberNames.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Direction<select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as HelpingHandsDirection | "")}><option value="">Sent & received</option><option value="received">Received</option><option value="sent">Sent</option></select></label>
          <label>Month<input type="month" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} /></label>
          <label>Date order<select value={dateSortDirection} onChange={(event) => setDateSortDirection(event.target.value as DateSortDirection)}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
          <button type="button" className="helping-inline-button" onClick={() => {
            setMemberFilter("");
            setDirectionFilter("");
            setPeriodFilter("");
          }}>Clear filters</button>
        </div>

        <div className="helping-table-wrap">
          <div className="helping-all-transactions-table">
            <div className="helping-all-transaction-row head">
              <span>Date</span><span>Member</span><span>Direction</span><span>Amount</span><span>Automatic Allocation</span><span>Actions</span>
            </div>
            {transactions.map((transaction) => (
              <div className="helping-all-transaction-row" key={transaction.id}>
                <span>{formatDate(transaction.date)}</span>
                <strong>{transaction.member}</strong>
                <span className={`helping-direction ${transaction.direction}`}>{transaction.direction === "received" ? "Received" : "Sent"}</span>
                <strong className={transaction.direction === "received" ? "helping-positive" : "helping-negative"}>
                  {transaction.direction === "received" ? "+" : "-"}{formatMoney(transaction.amount)}
                </strong>
                <small>{allocationSummary(transaction.allocations)}</small>
                <div className="helping-actions">
                  <button type="button" aria-label={`Edit transaction for ${transaction.member} on ${transaction.date}`} onClick={() => {
                    setEditingTransaction(transaction);
                    setIsTransactionOpen(true);
                  }}>Edit</button>
                  <button type="button" className="danger" aria-label={`Delete transaction for ${transaction.member} on ${transaction.date}`} onClick={() => void handleDelete(transaction.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
          {!transactions.length ? <p className="helping-empty">No transactions match the selected filters.</p> : null}
        </div>
      </section>

      {isTransactionOpen ? (
        <TransactionModal
          transaction={editingTransaction}
          memberNames={memberNames}
          onClose={() => {
            setIsTransactionOpen(false);
            setEditingTransaction(undefined);
          }}
          onSave={handleSave}
        />
      ) : null}
    </main>
  );
}
