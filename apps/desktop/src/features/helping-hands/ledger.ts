import type {
  DerivedLoan,
  HelpingHandsData,
  HelpingHandsLedger,
  HelpingHandsTransaction,
  InterestCharge,
  InterestDueSummary,
  MemberPosition,
  ProcessedTransaction,
  TransactionAllocation,
} from "./types";

export const helpingHandsRules = {
  monthlyContribution: 3000,
  interestRate: 2,
  dueDay: 15,
  fullMonthCutoffDay: 10,
} as const;

type MemberState = {
  key: string;
  name: string;
  firstTransactionDate: string;
  contributionPaid: Map<string, number>;
  contributionDefaulted: Map<string, number>;
  credit: number;
};

type MutableLoan = DerivedLoan;
type MutableCharge = InterestCharge;
type LedgerEvent =
  | { date: string; order: 0; period: string }
  | { date: string; order: 1; transaction: HelpingHandsTransaction };

export function calculateHelpingHandsLedger(
  data: HelpingHandsData,
  selectedPeriod = toPeriod(new Date()),
  now = new Date(),
  startPeriod = helpingHandsStartMonth(data),
): HelpingHandsLedger {
  const asOf = periodAsOfDate(selectedPeriod, now);
  const startDate = `${startPeriod}-01`;
  const rawTransactions = [...data.transactions]
    .filter((transaction) => transaction.date >= startDate && transaction.date <= asOf)
    .sort(compareTransactions);
  const memberStates = buildMemberStates(rawTransactions);
  const loans: MutableLoan[] = [];
  const charges: MutableCharge[] = [];
  const processed = new Map<string, ProcessedTransaction>(
    rawTransactions.map((transaction) => [transaction.id, { ...transaction, allocations: [] }]),
  );

  if (memberStates.size) {
    const events: LedgerEvent[] = [
      ...rawTransactions.map((transaction) => ({
        date: transaction.date,
        order: 1 as const,
        transaction,
      })),
      ...periodRange(startPeriod, asOf.slice(0, 7)).map((period) => ({
        date: `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`,
        order: 0 as const,
        period,
      })),
    ]
      .filter((event) => event.date <= asOf)
      .sort((a, b) => {
        const baseOrder = a.date.localeCompare(b.date) || a.order - b.order;
        if (baseOrder || !("transaction" in a) || !("transaction" in b)) return baseOrder;
        return compareTransactions(a.transaction, b.transaction);
      });

    for (const event of events) {
      if ("period" in event) {
        applyMonthlyDueEvent(event.period, memberStates, loans, charges);
      } else {
        applyCashTransaction(event.transaction, memberStates, loans, charges, processed);
      }
    }
  }

  const selectedMembers = buildMemberPositions(memberStates, loans, charges, selectedPeriod, asOf);
  const contributionExpected = selectedMembers.length * helpingHandsRules.monthlyContribution;
  const contributionCollected = sum(selectedMembers.map((member) => member.contributionPaid));
  const contributionDefaulted = sum(selectedMembers.map((member) => member.contributionDefaulted));
  const contributionDue = sum(selectedMembers.map((member) => member.contributionDue));
  const receives = sum(rawTransactions.filter((transaction) => transaction.direction === "received").map((transaction) => transaction.amount));
  const sends = sum(rawTransactions.filter((transaction) => transaction.direction === "sent").map((transaction) => transaction.amount));
  const interestReceived = sum(
    [...processed.values()].flatMap((transaction) =>
      transaction.allocations
        .filter((allocation) => allocation.kind === "interest")
        .map((allocation) => allocation.amount),
    ),
  );
  const contributionLoanIds = new Set(
    loans
      .filter((loan) => loan.source === "missed_contribution")
      .map((loan) => loan.id),
  );
  const totalContributionReceived = sum(
    [...processed.values()].flatMap((transaction) =>
      transaction.allocations
        .filter((allocation) =>
          allocation.kind === "contribution"
          || (
            allocation.kind === "principal"
            && allocation.loanId
            && contributionLoanIds.has(allocation.loanId)
          ),
        )
        .map((allocation) => allocation.amount),
    ),
  );

  return {
    asOf,
    transactions: [...processed.values()].sort((a, b) => compareTransactions(b, a)),
    loans: [...loans].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.id.localeCompare(a.id)),
    interestCharges: [...charges].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.member.localeCompare(b.member)),
    members: selectedMembers,
    fundBalance: roundMoney(receives - sends),
    principalOutstanding: roundMoney(sum(loans.map((loan) => loan.outstanding))),
    interestDue: roundMoney(sum(charges.map((charge) => charge.due))),
    interestReceived: roundMoney(interestReceived),
    totalContributionReceived: roundMoney(totalContributionReceived),
    contributionExpected,
    contributionCollected,
    contributionDefaulted,
    contributionDue,
    collectionRate: contributionExpected
      ? Math.min(Math.round((contributionCollected / contributionExpected) * 100), 100)
      : 100,
  };
}

function buildMemberStates(transactions: HelpingHandsTransaction[]) {
  const states = new Map<string, MemberState>();
  for (const transaction of transactions) {
    const key = memberKey(transaction.member);
    const existing = states.get(key);
    if (!existing) {
      states.set(key, {
        key,
        name: transaction.member.trim(),
        firstTransactionDate: transaction.date,
        contributionPaid: new Map(),
        contributionDefaulted: new Map(),
        credit: 0,
      });
    } else if (transaction.date < existing.firstTransactionDate) {
      existing.firstTransactionDate = transaction.date;
    }
  }
  return states;
}

function applyMonthlyDueEvent(
  period: string,
  members: Map<string, MemberState>,
  loans: MutableLoan[],
  charges: MutableCharge[],
) {
  const dueDate = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;

  for (const loan of loans) {
    if (loan.outstanding <= 0 || firstInterestPeriod(loan.issuedOn) > period) continue;
    const charge = roundMoney(loan.outstanding * (helpingHandsRules.interestRate / 100));
    if (charge <= 0) continue;
    charges.push({
      id: `interest-${loan.id}-${period}`,
      loanId: loan.id,
      memberKey: loan.memberKey,
      member: loan.member,
      period,
      dueDate,
      charge,
      paid: 0,
      due: charge,
    });
  }

  for (const member of members.values()) {
    const paid = member.contributionPaid.get(period) ?? 0;
    const shortfall = roundMoney(Math.max(helpingHandsRules.monthlyContribution - paid, 0));
    if (shortfall <= 0) continue;
    member.contributionDefaulted.set(period, shortfall);
    loans.push({
      id: `contribution-${member.key}-${period}`,
      memberKey: member.key,
      member: member.name,
      issuedOn: dueDate,
      original: shortfall,
      outstanding: shortfall,
      source: "missed_contribution",
      contributionPeriod: period,
    });
  }
}

function applyCashTransaction(
  transaction: HelpingHandsTransaction,
  members: Map<string, MemberState>,
  loans: MutableLoan[],
  charges: MutableCharge[],
  processed: Map<string, ProcessedTransaction>,
) {
  const key = memberKey(transaction.member);
  const member = members.get(key);
  const record = processed.get(transaction.id);
  if (!member || !record) return;

  if (transaction.direction === "sent") {
    loans.push({
      id: `cash-${transaction.id}`,
      memberKey: key,
      member: member.name,
      issuedOn: transaction.date,
      original: transaction.amount,
      outstanding: transaction.amount,
      source: "cash",
    });
    record.allocations.push({ kind: "loan", amount: transaction.amount, loanId: `cash-${transaction.id}` });
    return;
  }

  let remaining = transaction.amount;
  const memberCharges = charges
    .filter((charge) => charge.memberKey === key && charge.due > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const charge of memberCharges) {
    if (remaining <= 0) break;
    const amount = roundMoney(Math.min(remaining, charge.due));
    charge.paid = roundMoney(charge.paid + amount);
    charge.due = roundMoney(charge.due - amount);
    remaining = roundMoney(remaining - amount);
    record.allocations.push({
      kind: "interest",
      amount,
      period: charge.period,
      loanId: charge.loanId,
    });
  }

  const period = transaction.date.slice(0, 7);
  const dueDate = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;
  if (remaining > 0 && transaction.date < dueDate) {
    const alreadyPaid = member.contributionPaid.get(period) ?? 0;
    const contributionDue = Math.max(helpingHandsRules.monthlyContribution - alreadyPaid, 0);
    const amount = roundMoney(Math.min(remaining, contributionDue));
    if (amount > 0) {
      member.contributionPaid.set(period, roundMoney(alreadyPaid + amount));
      remaining = roundMoney(remaining - amount);
      record.allocations.push({ kind: "contribution", amount, period });
    }
  }

  const memberLoans = loans
    .filter((loan) => loan.memberKey === key && loan.outstanding > 0)
    .sort((a, b) => {
      const sourceOrder = Number(a.source === "cash") - Number(b.source === "cash");
      return sourceOrder || a.issuedOn.localeCompare(b.issuedOn) || a.id.localeCompare(b.id);
    });
  for (const loan of memberLoans) {
    if (remaining <= 0) break;
    const amount = roundMoney(Math.min(remaining, loan.outstanding));
    loan.outstanding = roundMoney(loan.outstanding - amount);
    remaining = roundMoney(remaining - amount);
    record.allocations.push({ kind: "principal", amount, loanId: loan.id });
  }

  if (remaining > 0) {
    member.credit = roundMoney(member.credit + remaining);
    record.allocations.push({ kind: "credit", amount: remaining });
  }
}

function buildMemberPositions(
  members: Map<string, MemberState>,
  loans: DerivedLoan[],
  charges: InterestCharge[],
  period: string,
  asOf: string,
): MemberPosition[] {
  const dueDate = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;
  return [...members.values()]
    .filter((member) => member.firstTransactionDate.slice(0, 7) <= period)
    .map((member) => {
      const contributionPaid = member.contributionPaid.get(period) ?? 0;
      const contributionDefaulted = member.contributionDefaulted.get(period) ?? 0;
      const contributionDue = asOf < dueDate
        ? roundMoney(Math.max(helpingHandsRules.monthlyContribution - contributionPaid, 0))
        : 0;
      const principalOutstanding = roundMoney(sum(
        loans.filter((loan) => loan.memberKey === member.key).map((loan) => loan.outstanding),
      ));
      const interestDue = roundMoney(sum(
        charges.filter((charge) => charge.memberKey === member.key).map((charge) => charge.due),
      ));
      const totalInterestPaid = roundMoney(sum(
        charges.filter((charge) => charge.memberKey === member.key).map((charge) => charge.paid),
      ));
      const status: MemberPosition["status"] = interestDue > 0
        ? "interest_due"
        : contributionDue > 0
          ? "contribution_due"
          : contributionDefaulted > 0
            ? "converted"
            : "clear";
      return {
        key: member.key,
        name: member.name,
        firstTransactionDate: member.firstTransactionDate,
        contributionPaid,
        contributionDefaulted,
        contributionDue,
        principalOutstanding,
        interestDue,
        totalInterestPaid,
        credit: member.credit,
        status,
      };
    })
    .sort((a, b) => statusWeight(b.status) - statusWeight(a.status) || a.name.localeCompare(b.name));
}

export function allocationSummary(allocations: TransactionAllocation[]) {
  if (!allocations.length) return "No allocation";
  return allocations
    .map((allocation) => {
      const label = allocation.kind === "loan"
        ? "Loan issued"
        : allocation.kind === "interest"
          ? `Interest ${formatPeriod(allocation.period ?? "")}`
          : allocation.kind === "contribution"
            ? `Contribution ${formatPeriod(allocation.period ?? "")}`
            : allocation.kind === "principal"
              ? "Loan principal"
              : "Member credit";
      return `${label}: ${formatMoney(allocation.amount)}`;
    })
    .join(" / ");
}

export function normalizeHelpingHandsData(value: unknown): HelpingHandsData {
  if (!value || typeof value !== "object") {
    return { version: 2, startMonth: "", transactions: [] };
  }
  const raw = value as Partial<HelpingHandsData>;
  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions
      .filter((transaction): transaction is HelpingHandsTransaction => Boolean(
        transaction
        && typeof transaction.id === "string"
        && typeof transaction.member === "string"
        && (transaction.direction === "sent" || transaction.direction === "received"),
      ))
      .map((transaction) => ({
        ...transaction,
        amount: Number(transaction.amount) || 0,
        note: transaction.note ?? "",
        createdAt: transaction.createdAt ?? "",
      }))
    : [];
  return {
    version: 2,
    startMonth: validPeriod(raw.startMonth) ? raw.startMonth : "",
    transactions,
  };
}

export function helpingHandsStartMonth(
  data: HelpingHandsData,
  fallback = toPeriod(new Date()),
) {
  if (validPeriod(data.startMonth)) return data.startMonth;
  return data.transactions
    .map((transaction) => transaction.date.slice(0, 7))
    .filter(validPeriod)
    .sort()[0] ?? fallback;
}

export function summarizeUnpaidInterest(charges: InterestCharge[]): InterestDueSummary[] {
  const summaries = new Map<string, InterestDueSummary>();
  for (const charge of charges) {
    if (charge.due <= 0) continue;
    const existing = summaries.get(charge.memberKey);
    if (existing) {
      existing.firstDueDate = existing.firstDueDate < charge.dueDate
        ? existing.firstDueDate
        : charge.dueDate;
      existing.charge = roundMoney(existing.charge + charge.charge);
      existing.paid = roundMoney(existing.paid + charge.paid);
      existing.due = roundMoney(existing.due + charge.due);
      continue;
    }
    summaries.set(charge.memberKey, {
      memberKey: charge.memberKey,
      member: charge.member,
      firstDueDate: charge.dueDate,
      charge: charge.charge,
      paid: charge.paid,
      due: charge.due,
    });
  }
  return [...summaries.values()].sort(
    (a, b) => a.firstDueDate.localeCompare(b.firstDueDate) || a.member.localeCompare(b.member),
  );
}

export function uniqueMemberNames(data: HelpingHandsData) {
  const names = new Map<string, string>();
  for (const transaction of data.transactions) {
    const key = memberKey(transaction.member);
    if (!names.has(key)) names.set(key, transaction.member.trim());
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function periodAsOfDate(period: string, now = new Date()) {
  const currentPeriod = toPeriod(now);
  if (period >= currentPeriod) return toDateValue(now);
  const [year, month] = period.split("-").map(Number);
  return toDateValue(new Date(year, month, 0));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatPeriod(value: string) {
  if (!value) return "-";
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

export function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toPeriod(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function firstInterestPeriod(issuedOn: string) {
  const day = Number(issuedOn.slice(8, 10));
  const period = issuedOn.slice(0, 7);
  return day <= helpingHandsRules.fullMonthCutoffDay ? period : addMonths(period, 1);
}

function compareTransactions(a: HelpingHandsTransaction, b: HelpingHandsTransaction) {
  return a.date.localeCompare(b.date)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

function memberKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

function validPeriod(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

function statusWeight(status: MemberPosition["status"]) {
  if (status === "interest_due") return 3;
  if (status === "contribution_due") return 2;
  if (status === "converted") return 1;
  return 0;
}

function periodRange(start: string, end: string) {
  const periods: string[] = [];
  let cursor = start;
  while (cursor <= end && periods.length < 600) {
    periods.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return periods;
}

function addMonths(period: string, count: number) {
  const [year, month] = period.split("-").map(Number);
  return toPeriod(new Date(year, month - 1 + count, 1));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
