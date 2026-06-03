"use client";

import { useEffect, useState } from "react";
import { getAiStatus, type AiStatus } from "@/lib/api";

export function AiStatusBanner() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isApiReachable, setIsApiReachable] = useState(true);

  useEffect(() => {
    getAiStatus()
      .then((nextStatus) => {
        setStatus(nextStatus);
        setIsApiReachable(true);
      })
      .catch(() => {
        setStatus(null);
        setIsApiReachable(false);
      });
  }, []);

  if (isDismissed) return null;
  if (isApiReachable && status?.connected !== false) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-3 text-sm text-amber-950">
        <p className="font-semibold">AI is not connected</p>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="rounded-full border border-amber-300 bg-white/70 px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
