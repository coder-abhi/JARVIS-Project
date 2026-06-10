import { useEffect, useState } from "react";
import {
  deleteHelpingHandsTransaction,
  getHelpingHandsData,
  saveHelpingHandsTransaction,
} from "@/lib/api";
import { normalizeHelpingHandsData } from "./ledger";
import type { HelpingHandsData, HelpingHandsTransaction } from "./types";

const emptyData: HelpingHandsData = { version: 2, transactions: [] };

export function useHelpingHandsData() {
  const [data, setData] = useState<HelpingHandsData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    let isCancelled = false;
    getHelpingHandsData<unknown>()
      .then((stored) => {
        if (!isCancelled) setData(normalizeHelpingHandsData(stored));
      })
      .catch((error: unknown) => {
        if (!isCancelled) setWarning(`Helping Hands failed to load: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  async function saveTransaction(transaction: HelpingHandsTransaction) {
    const saved = await saveHelpingHandsTransaction<HelpingHandsData>(transaction);
    setData(normalizeHelpingHandsData(saved));
    setWarning("");
  }

  async function removeTransaction(transactionId: string) {
    const saved = await deleteHelpingHandsTransaction<HelpingHandsData>(transactionId);
    setData(normalizeHelpingHandsData(saved));
    setWarning("");
  }

  return { data, isLoading, warning, setWarning, saveTransaction, removeTransaction };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
