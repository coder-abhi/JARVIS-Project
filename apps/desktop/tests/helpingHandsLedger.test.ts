import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateHelpingHandsLedger,
  periodAsOfDate,
  summarizeUnpaidInterest,
} from "../src/features/helping-hands/ledger.ts";
import type { HelpingHandsData } from "../src/features/helping-hands/types.ts";

test("unpaid interest remains due without compounding into later interest", () => {
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-01",
    transactions: [
      {
        id: "jan-contribution",
        member: "Asha",
        direction: "received",
        amount: 3000,
        date: "2026-01-01",
        note: "",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "cash-loan",
        member: "Asha",
        direction: "sent",
        amount: 10000,
        date: "2026-01-10",
        note: "",
        createdAt: "2026-01-10T00:00:00Z",
      },
    ],
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-03",
    new Date(2026, 3, 1),
    "2026-01",
  );
  assert.deepEqual(
    ledger.interestCharges.map((charge) => ({ period: charge.period, charge: charge.charge })),
    [
      { period: "2026-01", charge: 200 },
      { period: "2026-02", charge: 200 },
      { period: "2026-03", charge: 260 },
    ],
  );
  assert.equal(ledger.interestDue, 660);
  assert.equal(ledger.loans.find((loan) => loan.id === "cash-cash-loan")?.outstanding, 10000);
});

test("DJ can pay February interest on February 1 and day-15 receipts stay in February", () => {
  const transaction = (
    id: string,
    date: string,
    direction: "sent" | "received",
    amount: number,
  ) => ({
    id,
    member: "DJ",
    direction,
    amount,
    date,
    note: "",
    createdAt: `${date}T00:00:00Z`,
  });
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2025-12",
    transactions: [
      transaction("loan-5000", "2025-12-15", "sent", 5000),
      transaction("loan-13000", "2026-01-10", "sent", 13000),
      transaction("jan-receipt", "2026-01-15", "received", 160),
      transaction("feb-1-receipt", "2026-02-01", "received", 3480),
      transaction("feb-15-receipt", "2026-02-15", "received", 6000),
    ],
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-02",
    new Date(2026, 2, 1),
    "2025-12",
  );
  const februaryFirst = ledger.transactions.find((item) => item.id === "feb-1-receipt");
  const februaryFifteenth = ledger.transactions.find((item) => item.id === "feb-15-receipt");

  assert.deepEqual(februaryFirst?.allocations, [
    { kind: "interest", amount: 480, period: "2026-02" },
    { kind: "contribution", amount: 3000, period: "2026-02" },
  ]);
  assert.deepEqual(februaryFifteenth?.allocations, [
    { kind: "interest", amount: 260, period: "2026-01" },
    { kind: "principal", amount: 3000, loanId: "contribution-dhananjay jagtap-2025-12" },
    { kind: "principal", amount: 2700, loanId: "contribution-dhananjay jagtap-2026-01" },
    { kind: "interest", amount: 40, period: "2026-02" },
  ]);
  assert.deepEqual(
    ledger.interestCharges.map((charge) => ({
      period: charge.period,
      charge: charge.charge,
      paid: charge.paid,
      due: charge.due,
    })),
    [
      { period: "2026-01", charge: 420, paid: 420, due: 0 },
      { period: "2026-02", charge: 480, paid: 520, due: -40 },
    ],
  );
  assert.equal(ledger.members.find((member) => member.name === "Dhananjay Jagtap")?.principalOutstanding, 18300);
});

test("working cycles close on the 15th and include day-15 transactions", () => {
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-02",
    transactions: [
      {
        id: "day-15",
        member: "Asha",
        direction: "sent",
        amount: 5000,
        date: "2026-02-15",
        note: "",
        createdAt: "2026-02-15T00:00:00Z",
      },
      {
        id: "day-16",
        member: "Asha",
        direction: "sent",
        amount: 7000,
        date: "2026-02-16",
        note: "",
        createdAt: "2026-02-16T00:00:00Z",
      },
    ],
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-02",
    new Date(2026, 5, 12),
    "2026-02",
  );

  assert.equal(ledger.asOf, "2026-02-15");
  assert.deepEqual(ledger.transactions.map((transaction) => transaction.id), ["day-15"]);
  assert.equal(ledger.principalOutstanding, 8000);
  assert.equal(ledger.loans.some((loan) => loan.id === "cash-day-16"), false);
});

test("the active cycle uses today before the 15th and freezes on the 15th afterward", () => {
  assert.equal(periodAsOfDate("2026-06", new Date(2026, 5, 10)), "2026-06-10");
  assert.equal(periodAsOfDate("2026-06", new Date(2026, 5, 20)), "2026-06-15");
  assert.equal(periodAsOfDate("2026-02", new Date(2026, 5, 12)), "2026-02-15");
});

test("extra interest stays in the register and never creates random principal movement", () => {
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-03",
    transactions: [
      {
        id: "contribution",
        member: "Mangesh",
        direction: "received",
        amount: 3000,
        date: "2026-03-01",
        note: "",
        createdAt: "2026-03-01T00:00:00Z",
      },
      {
        id: "loan",
        member: "Mangesh Gawali",
        direction: "sent",
        amount: 6000,
        date: "2026-03-10",
        note: "",
        createdAt: "2026-03-10T00:00:00Z",
      },
      {
        id: "interest-payment",
        member: "Mangesh",
        direction: "received",
        amount: 180,
        date: "2026-03-15",
        note: "",
        createdAt: "2026-03-15T00:00:00Z",
      },
    ],
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-03",
    new Date(2026, 4, 1),
    "2026-03",
  );
  const payment = ledger.transactions.find((transaction) => transaction.id === "interest-payment");
  const interest = ledger.interestCharges.find((charge) => charge.member === "Mangesh Gawali");

  assert.deepEqual(payment?.allocations, [
    { kind: "interest", amount: 120, period: "2026-03" },
    { kind: "interest", amount: 60, period: "2026-03" },
  ]);
  assert.deepEqual(
    { charge: interest?.charge, paid: interest?.paid, due: interest?.due },
    { charge: 120, paid: 180, due: -60 },
  );
  assert.equal(ledger.principalOutstanding, 6000);
});

test("interest balance register keeps each monthly underpayment or overpayment visible", () => {
  const issues = summarizeUnpaidInterest([
    {
      id: "interest-asha-2026-01",
      memberKey: "asha",
      member: "Asha",
      period: "2026-01",
      dueDate: "2026-01-15",
      charge: 200,
      paid: 0,
      due: 200,
    },
    {
      id: "interest-asha-2026-02",
      memberKey: "asha",
      member: "Asha",
      period: "2026-02",
      dueDate: "2026-02-15",
      charge: 200,
      paid: 400,
      due: -200,
    },
    {
      id: "interest-ravi-2026-02",
      memberKey: "ravi",
      member: "Ravi",
      period: "2026-02",
      dueDate: "2026-02-15",
      charge: 100,
      paid: 100,
      due: 0,
    },
  ]);

  assert.deepEqual(
    issues.map(({ id, period, due }) => ({ id, period, due })),
    [
      { id: "interest-asha-2026-01", period: "2026-01", due: 200 },
      { id: "interest-asha-2026-02", period: "2026-02", due: -200 },
    ],
  );
});

test("total monthly contribution uses months times contribution times member count", () => {
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-01",
    transactions: ["Asha", "Ravi"].map((member, index) => ({
      id: `member-${index}`,
      member,
      direction: "received",
      amount: 3000,
      date: "2026-01-01",
      note: "",
      createdAt: `2026-01-01T00:00:0${index}Z`,
    })),
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-03",
    new Date(2026, 3, 1),
    "2026-01",
  );

  assert.equal(ledger.contributionMonths, 3);
  assert.equal(ledger.members.length, 2);
  assert.equal(ledger.totalMonthlyContribution, 18000);
});

test("total monthly contribution excludes the active month until its cycle closes", () => {
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-01",
    transactions: ["Asha", "Ravi"].map((member, index) => ({
      id: `member-${index}`,
      member,
      direction: "received",
      amount: 3000,
      date: "2026-01-01",
      note: "",
      createdAt: `2026-01-01T00:00:0${index}Z`,
    })),
  };

  const openCycle = calculateHelpingHandsLedger(
    data,
    "2026-06",
    new Date(2026, 5, 10),
    "2026-01",
  );
  const completedCycle = calculateHelpingHandsLedger(
    data,
    "2026-06",
    new Date(2026, 5, 15),
    "2026-01",
  );

  assert.equal(openCycle.contributionMonths, 5);
  assert.equal(openCycle.totalMonthlyContribution, 30000);
  assert.equal(completedCycle.contributionMonths, 6);
  assert.equal(completedCycle.totalMonthlyContribution, 36000);
});

test("member aliases merge into the fixed member-position order", () => {
  const aliases = [
    "Kuldeep",
    "Chape D",
    "Mangesh",
    "Bande",
    "Nitin",
    "Sanket",
    "Fais Pathan",
    "Abhi K",
    "DJ",
    "Dhananjay Jagtap",
  ];
  const data: HelpingHandsData = {
    version: 2,
    startMonth: "2026-01",
    transactions: aliases.map((member, index) => ({
      id: `member-${index}`,
      member,
      direction: "received",
      amount: 3000,
      date: "2026-01-01",
      note: "",
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
    })),
  };

  const ledger = calculateHelpingHandsLedger(
    data,
    "2026-01",
    new Date(2026, 1, 1),
    "2026-01",
  );

  assert.deepEqual(ledger.members.map((member) => member.name), [
    "Dhananjay Jagtap",
    "Abhishek Kamble",
    "Faisal Pathan",
    "Sanket Kute",
    "Nitin Hegadkar",
    "Abhijeet Bande",
    "Mangesh Gawali",
    "D Chape",
    "Kuldeep N",
  ]);
  assert.equal(ledger.members.filter((member) => member.name === "Dhananjay Jagtap").length, 1);
});
