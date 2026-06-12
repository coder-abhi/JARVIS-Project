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
  principalPaymentUnit: 100,
} as const;

const canonicalMembers = [
  { name: "Dhananjay Jagtap", aliases: ["dhananjay jagtap", "dhananjay", "dj"] },
  { name: "Abhishek Kamble", aliases: ["abhishek kamble", "abhishek", "abhi k"] },
  { name: "Faisal Pathan", aliases: ["faisal pathan", "fais pathan", "faisal", "fais"] },
  { name: "Sanket Kute", aliases: ["sanket kute", "sanket"] },
  { name: "Nitin Hegadkar", aliases: ["nitin hegadkar", "nitin"] },
  { name: "Abhijeet Bande", aliases: ["abhijeet bande", "abhijeet", "bande"] },
  { name: "Mangesh Gawali", aliases: ["mangesh gawali", "mangesh"] },
  { name: "D Chape", aliases: ["d chape", "chape d", "chape"] },
  { name: "Kuldeep N", aliases: ["kuldeep n", "kuldeep"] },
] as const;

const canonicalMemberByAlias = new Map(
  canonicalMembers.flatMap((member) =>
    member.aliases.map((alias) => [normalizeMemberName(alias), member.name] as const),
  ),
);
const canonicalMemberOrder = new Map(
  canonicalMembers.map((member, index) => [normalizeMemberName(member.name), index]),
);

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
  | { date: string; order: 0; kind: "interest"; period: string }
  | { date: string; order: 1; transaction: HelpingHandsTransaction }
  | { date: string; order: 2; kind: "due"; period: string };

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
    rawTransactions.map((transaction) => [
      transaction.id,
      { ...transaction, member: canonicalMemberName(transaction.member), allocations: [] },
    ]),
  );

  if (memberStates.size) {
    const events: LedgerEvent[] = [
      ...periodRange(startPeriod, asOf.slice(0, 7)).map((period) => ({
        date: `${period}-01`,
        order: 0 as const,
        kind: "interest" as const,
        period,
      })),
      ...rawTransactions.map((transaction) => ({
        date: transaction.date,
        order: 1 as const,
        transaction,
      })),
      ...periodRange(startPeriod, asOf.slice(0, 7)).map((period) => ({
        date: `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`,
        order: 2 as const,
        kind: "due" as const,
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
      if ("transaction" in event) {
        applyCashTransaction(event.transaction, memberStates, loans, charges, processed);
      } else if (event.kind === "interest") {
        applyMonthlyInterestEvent(event.period, memberStates, loans, charges);
      } else {
        applyMonthlyDueEvent(event.period, memberStates, loans);
      }
    }
  }

  const selectedMembers = buildMemberPositions(memberStates, loans, charges, selectedPeriod, asOf);
  const selectedCycleClose = `${selectedPeriod}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;
  const completedContributionPeriod = asOf >= selectedCycleClose
    ? selectedPeriod
    : addMonths(selectedPeriod, -1);
  const contributionMonths = completedContributionPeriod >= startPeriod
    ? periodRange(startPeriod, completedContributionPeriod).length
    : 0;
  const totalMonthlyContribution = roundMoney(
    contributionMonths
    * helpingHandsRules.monthlyContribution
    * selectedMembers.length,
  );
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
    interestDue: roundMoney(sum(charges.map((charge) => Math.max(charge.due, 0)))),
    interestReceived: roundMoney(interestReceived),
    totalContributionReceived: roundMoney(totalContributionReceived),
    totalMonthlyContribution,
    contributionMonths,
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
        name: canonicalMemberName(transaction.member),
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
) {
  const dueDate = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;

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

function applyMonthlyInterestEvent(
  period: string,
  members: Map<string, MemberState>,
  loans: MutableLoan[],
  charges: MutableCharge[],
) {
  for (const member of members.values()) {
    const principal = sum(
      loans
        .filter((loan) =>
          loan.memberKey === member.key
          && loan.outstanding > 0
          && firstInterestPeriod(loan.issuedOn) <= period,
        )
        .map((loan) => loan.outstanding),
    );
    addInterestCharge(charges, member, period, principal);
  }
}

function addInterestCharge(
  charges: MutableCharge[],
  member: MemberState,
  period: string,
  principal: number,
) {
  const amount = roundMoney(principal * (helpingHandsRules.interestRate / 100));
  if (amount <= 0) return;
  const existing = charges.find(
    (charge) => charge.memberKey === member.key && charge.period === period,
  );
  if (existing) {
    existing.charge = roundMoney(existing.charge + amount);
    existing.due = roundMoney(existing.due + amount);
    return;
  }
  charges.push({
    id: `interest-${member.key}-${period}`,
    memberKey: member.key,
    member: member.name,
    period,
    dueDate: `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`,
    charge: amount,
    paid: 0,
    due: amount,
  });
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
    if (firstInterestPeriod(transaction.date) === transaction.date.slice(0, 7)) {
      addInterestCharge(charges, member, transaction.date.slice(0, 7), transaction.amount);
    }
    return;
  }

  let remaining = transaction.amount;
  const period = transaction.date.slice(0, 7);
  const currentCharges = charges
    .filter((charge) => charge.memberKey === key && charge.period === period && charge.due > 0);
  remaining = applyInterestPayments(currentCharges, remaining, record);

  const dueDate = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;
  if (remaining > 0 && transaction.date <= dueDate) {
    const alreadyPaid = member.contributionPaid.get(period) ?? 0;
    const contributionDue = Math.max(helpingHandsRules.monthlyContribution - alreadyPaid, 0);
    if (contributionDue > 0 && remaining >= contributionDue) {
      member.contributionPaid.set(period, roundMoney(alreadyPaid + contributionDue));
      remaining = roundMoney(remaining - contributionDue);
      record.allocations.push({ kind: "contribution", amount: contributionDue, period });
    }
  }

  const overdueCharges = charges
    .filter((charge) => charge.memberKey === key && charge.period < period && charge.due > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  remaining = applyInterestPayments(overdueCharges, remaining, record);

  const memberLoans = loans
    .filter((loan) => loan.memberKey === key && loan.outstanding > 0)
    .sort((a, b) => {
      const sourceOrder = Number(a.source === "cash") - Number(b.source === "cash");
      return sourceOrder || a.issuedOn.localeCompare(b.issuedOn) || a.id.localeCompare(b.id);
    });
  let principalPayment = roundMoney(
    Math.floor(remaining / helpingHandsRules.principalPaymentUnit)
    * helpingHandsRules.principalPaymentUnit,
  );
  for (const loan of memberLoans) {
    if (principalPayment <= 0) break;
    const amount = roundMoney(Math.min(principalPayment, loan.outstanding));
    const roundedAmount = roundMoney(
      Math.floor(amount / helpingHandsRules.principalPaymentUnit)
      * helpingHandsRules.principalPaymentUnit,
    );
    if (roundedAmount <= 0) continue;
    loan.outstanding = roundMoney(loan.outstanding - roundedAmount);
    principalPayment = roundMoney(principalPayment - roundedAmount);
    remaining = roundMoney(remaining - roundedAmount);
    record.allocations.push({ kind: "principal", amount: roundedAmount, loanId: loan.id });
  }

  if (remaining > 0) {
    addInterestCredit(charges, member, period, remaining);
    record.allocations.push({ kind: "interest", amount: remaining, period });
  }
}

function addInterestCredit(
  charges: MutableCharge[],
  member: MemberState,
  period: string,
  amount: number,
) {
  const existing = charges.find(
    (charge) => charge.memberKey === member.key && charge.period === period,
  );
  if (existing) {
    existing.paid = roundMoney(existing.paid + amount);
    existing.due = roundMoney(existing.due - amount);
    return;
  }
  charges.push({
    id: `interest-${member.key}-${period}`,
    memberKey: member.key,
    member: member.name,
    period,
    dueDate: `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`,
    charge: 0,
    paid: amount,
    due: roundMoney(-amount),
  });
}

function applyInterestPayments(
  charges: MutableCharge[],
  available: number,
  record: ProcessedTransaction,
) {
  let remaining = available;
  for (const charge of charges) {
    if (remaining <= 0) break;
    const amount = roundMoney(Math.min(remaining, charge.due));
    charge.paid = roundMoney(charge.paid + amount);
    charge.due = roundMoney(charge.due - amount);
    remaining = roundMoney(remaining - amount);
    record.allocations.push({
      kind: "interest",
      amount,
      period: charge.period,
    });
  }
  return remaining;
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
        charges
          .filter((charge) => charge.memberKey === member.key)
          .map((charge) => Math.max(charge.due, 0)),
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
    .sort((a, b) => memberOrder(a.key) - memberOrder(b.key));
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
  return charges
    .filter((charge) => charge.due !== 0)
    .map((charge) => ({
      id: charge.id,
      memberKey: charge.memberKey,
      member: charge.member,
      period: charge.period,
      dueDate: charge.dueDate,
      charge: charge.charge,
      paid: charge.paid,
      due: charge.due,
    }))
    .sort((a, b) =>
      a.period.localeCompare(b.period)
      || memberOrder(a.memberKey) - memberOrder(b.memberKey)
      || a.member.localeCompare(b.member),
    );
}

export function uniqueMemberNames(data: HelpingHandsData) {
  const names = new Map<string, string>();
  for (const transaction of data.transactions) {
    const key = memberKey(transaction.member);
    if (!names.has(key)) names.set(key, canonicalMemberName(transaction.member));
  }
  return [...names.entries()]
    .sort(([a], [b]) => memberOrder(a) - memberOrder(b))
    .map(([, name]) => name);
}

export function periodAsOfDate(period: string, now = new Date()) {
  const currentPeriod = toPeriod(now);
  const cycleClose = `${period}-${String(helpingHandsRules.dueDay).padStart(2, "0")}`;
  if (period === currentPeriod) {
    return toDateValue(now) < cycleClose ? toDateValue(now) : cycleClose;
  }
  return cycleClose;
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
  return normalizeMemberName(canonicalMemberName(name));
}

function canonicalMemberName(name: string) {
  const normalized = normalizeMemberName(name);
  return canonicalMemberByAlias.get(normalized) ?? name.trim();
}

function normalizeMemberName(name: string) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function memberOrder(key: string) {
  return canonicalMemberOrder.get(key) ?? canonicalMembers.length;
}

function validPeriod(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
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
