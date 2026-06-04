"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  announcePomodoroSessionUpdate,
  getActivePomodoroSessionKey,
  getPendingPomodoroCompletionKey,
  pomodoroSessionCompletedEvent,
  pomodoroSessionUpdatedEvent,
  playPomodoroCompletionSound,
  readActivePomodoroSession,
  readPendingPomodoroCompletion,
  showPomodoroBrowserNotification,
  type PendingPomodoroCompletion,
} from "@/lib/pomodoroSession";

const modeLabels: Record<PendingPomodoroCompletion["mode"], string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

export default function PomodoroCompletionToast() {
  const [completion, setCompletion] = useState<PendingPomodoroCompletion | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const dismissedCompletionIdRef = useRef<string | null>(null);
  const notifiedCompletionIdRef = useRef<string | null>(null);

  useEffect(() => {
    function displayCompletion(nextCompletion: PendingPomodoroCompletion) {
      setCompletion(nextCompletion);
      if (dismissedCompletionIdRef.current !== nextCompletion.id) {
        setIsVisible(true);
      }
    }

    function completeSession() {
      const session = readActivePomodoroSession();
      if (!session || session.state !== "running" || !session.endsAt) return;

      const endsAt = new Date(session.endsAt);
      if (endsAt.getTime() > Date.now()) return;

      const pendingCompletion: PendingPomodoroCompletion = {
        id: session.id,
        mode: session.mode,
        durationSeconds: session.durationSeconds,
        startedAt: session.startedAt,
        completedAt: endsAt.toISOString(),
        note: session.note,
        fixedProjectId: session.fixedProjectId,
        continuousProjectId: session.continuousProjectId,
      };

      window.localStorage.removeItem(getActivePomodoroSessionKey());
      window.localStorage.setItem(getPendingPomodoroCompletionKey(), JSON.stringify(pendingCompletion));
      announcePomodoroSessionUpdate();
      displayCompletion(pendingCompletion);
    }

    function syncCompletion() {
      completeSession();
      const pendingCompletion = readPendingPomodoroCompletion();
      if (pendingCompletion) {
        displayCompletion(pendingCompletion);
      }
    }

    syncCompletion();
    const timer = window.setInterval(syncCompletion, 1000);
    function showCompletion(event: Event) {
      const completionEvent = event as CustomEvent<PendingPomodoroCompletion>;
      displayCompletion(completionEvent.detail);
    }

    window.addEventListener("storage", syncCompletion);
    window.addEventListener(pomodoroSessionCompletedEvent, showCompletion);
    window.addEventListener(pomodoroSessionUpdatedEvent, syncCompletion);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", syncCompletion);
      window.removeEventListener(pomodoroSessionCompletedEvent, showCompletion);
      window.removeEventListener(pomodoroSessionUpdatedEvent, syncCompletion);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const timer = window.setTimeout(() => {
      if (completion) dismissedCompletionIdRef.current = completion.id;
      setIsVisible(false);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [isVisible, completion?.id]);

  useEffect(() => {
    if (!completion || !isVisible) return;
    if (notifiedCompletionIdRef.current === completion.id) return;

    const notificationStorageKey = `${getPendingPomodoroCompletionKey()}:notified:${completion.id}`;
    if (window.localStorage.getItem(notificationStorageKey)) {
      notifiedCompletionIdRef.current = completion.id;
      return;
    }

    notifiedCompletionIdRef.current = completion.id;
    window.localStorage.setItem(notificationStorageKey, new Date().toISOString());
    showPomodoroBrowserNotification(completion);
    playPomodoroCompletionSound();
  }, [completion?.id, isVisible]);

  if (!completion || !isVisible) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[min(25rem,calc(100vw-2.5rem))] overflow-hidden rounded-lg border border-teal-100 bg-white shadow-2xl shadow-stone-950/20">
      <div className="h-1.5 bg-[linear-gradient(90deg,#14b8a6,#fb923c,#f0abfc)]" />
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Session complete</p>
            <h2 className="mt-1 text-xl font-semibold text-stone-950">{modeLabels[completion.mode]} wrapped</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              dismissedCompletionIdRef.current = completion.id;
              setIsVisible(false);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-stone-200 text-lg leading-none text-stone-500 transition hover:bg-stone-50 hover:text-stone-950"
            aria-label="Dismiss Pomodoro notification"
          >
            x
          </button>
        </div>
        <div className="rounded-md bg-[#f4f6f3] px-4 py-3 text-sm leading-6 text-stone-700">
          Nice. {Math.max(1, Math.round(completion.durationSeconds / 60))} minutes are ready to log.
        </div>
        <Link
          href="/pomodoro"
          className="w-fit rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-stone-800"
        >
          Review session
        </Link>
      </div>
    </div>
  );
}
