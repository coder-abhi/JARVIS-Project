export type HelpingHandsDirection = "sent" | "received";

export type HelpingHandsTransaction = {
  id: string;
  member: string;
  direction: HelpingHandsDirection;
  amount: number;
  date: string;
  note: string;
  createdAt: string;
};

export type HelpingHandsData = {
  version: 2;
  startMonth: string;
  transactions: HelpingHandsTransaction[];
};

export type AllocationKind = "loan" | "interest" | "contribution" | "principal" | "credit";

export type TransactionAllocation = {
  kind: AllocationKind;
  amount: number;
  period?: string;
  loanId?: string;
};

export type ProcessedTransaction = HelpingHandsTransaction & {
  allocations: TransactionAllocation[];
};

export type DerivedLoan = {
  id: string;
  memberKey: string;
  member: string;
  issuedOn: string;
  original: number;
  outstanding: number;
  source: "cash" | "missed_contribution";
  contributionPeriod?: string;
};

export type InterestCharge = {
  id: string;
  loanId: string;
  memberKey: string;
  member: string;
  period: string;
  dueDate: string;
  charge: number;
  paid: number;
  due: number;
};

export type InterestDueSummary = {
  memberKey: string;
  member: string;
  firstDueDate: string;
  charge: number;
  paid: number;
  due: number;
};

export type MemberPosition = {
  key: string;
  name: string;
  firstTransactionDate: string;
  contributionPaid: number;
  contributionDefaulted: number;
  contributionDue: number;
  principalOutstanding: number;
  interestDue: number;
  totalInterestPaid: number;
  credit: number;
  status: "clear" | "contribution_due" | "interest_due" | "converted";
};

export type HelpingHandsLedger = {
  asOf: string;
  transactions: ProcessedTransaction[];
  loans: DerivedLoan[];
  interestCharges: InterestCharge[];
  members: MemberPosition[];
  fundBalance: number;
  principalOutstanding: number;
  interestDue: number;
  interestReceived: number;
  totalContributionReceived: number;
  contributionExpected: number;
  contributionCollected: number;
  contributionDefaulted: number;
  contributionDue: number;
  collectionRate: number;
};
