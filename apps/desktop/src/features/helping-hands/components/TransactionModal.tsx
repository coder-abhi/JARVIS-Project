import { FormEvent, useEffect, useState } from "react";
import { toDateValue } from "../ledger";
import type { HelpingHandsDirection, HelpingHandsTransaction } from "../types";

export default function TransactionModal({
  transaction,
  presetMember,
  memberNames,
  onClose,
  onSave,
}: {
  transaction?: HelpingHandsTransaction;
  presetMember?: string;
  memberNames: string[];
  onClose: () => void;
  onSave: (transaction: HelpingHandsTransaction) => Promise<void>;
}) {
  const isQuickReceipt = Boolean(presetMember && !transaction);
  const [member, setMember] = useState(transaction?.member ?? presetMember ?? "");
  const [direction, setDirection] = useState<HelpingHandsDirection>(transaction?.direction ?? "received");
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? toDateValue(new Date()));
  const [note, setNote] = useState(transaction?.note ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMember(transaction?.member ?? presetMember ?? "");
    setDirection(transaction?.direction ?? "received");
    setAmount(transaction ? String(transaction.amount) : "");
    setDate(transaction?.date ?? toDateValue(new Date()));
    setNote(transaction?.note ?? "");
  }, [presetMember, transaction]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!member.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    setIsSaving(true);
    setError("");
    try {
      await onSave({
        id: transaction?.id ?? createId(),
        member: member.trim(),
        direction,
        amount: parsedAmount,
        date,
        note: note.trim(),
        createdAt: transaction?.createdAt ?? new Date().toISOString(),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save transaction");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="helping-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="helping-modal helping-transaction-modal" onSubmit={submit}>
        <div className="helping-modal-head">
          <div>
            <p className="ops-kicker">{transaction ? "EDIT CASH MOVEMENT" : "REGISTER CASH MOVEMENT"}</p>
            <h2>Transaction</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error ? <p className="ops-alert danger">{error}</p> : null}

        <div className="helping-direction-switch" role="group" aria-label="Transaction direction">
          <button type="button" disabled={isQuickReceipt} className={direction === "received" ? "active received" : ""} onClick={() => setDirection("received")}>
            Money Received
          </button>
          <button type="button" disabled={isQuickReceipt} className={direction === "sent" ? "active sent" : ""} onClick={() => setDirection("sent")}>
            Money Sent
          </button>
        </div>

        <p className="helping-allocation-preview">
          {direction === "received"
            ? "Automatically pays overdue interest first, then this month's contribution, then oldest loan principal."
            : "The full amount will be registered as a new loan to this member."}
        </p>

        <div className="helping-form-grid">
          <label className="helping-field wide">
            <span>Member Name</span>
            <input required readOnly={isQuickReceipt} list="helping-member-names" value={member} onChange={(event) => setMember(event.target.value)} placeholder="Select or type a new member" />
            <datalist id="helping-member-names">{memberNames.map((name) => <option value={name} key={name} />)}</datalist>
          </label>
          <label className="helping-field">
            <span>Amount</span>
            <input autoFocus={isQuickReceipt} required min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="helping-field">
            <span>Date</span>
            <input required readOnly={isQuickReceipt} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          {!isQuickReceipt ? (
            <label className="helping-field wide">
              <span>Note / Reference (optional)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Receipt number or short context" />
            </label>
          ) : null}
        </div>

        <div className="helping-modal-actions">
          <button type="button" className="ops-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-button primary" disabled={isSaving}>{isSaving ? "Saving..." : isQuickReceipt ? "Record Receipt" : "Register Transaction"}</button>
        </div>
      </form>
    </div>
  );
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
