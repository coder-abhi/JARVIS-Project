"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";
import { getScopedStorageKey } from "@/lib/auth";
import "./PomodoroPage.css";

type TimerMode = "focus" | "short" | "long";

type PomodoroLog = {
  id: string;
  completedAt: string;
  startAt?: string;
  endAt?: string;
  minutes: number;
  mode: TimerMode;
  projectName: string;
  taskTitle: string;
  done?: string;
  focus?: number | null;
};

const storageKey = "personal-project-manager:pomodoro-logs";

export default function PomodoroHistoryPage() {
  const [logs, setLogs] = useState<PomodoroLog[]>([]);

  useEffect(() => {
    const savedLogs = window.localStorage.getItem(getScopedStorageKey(storageKey));
    if (!savedLogs) return;

    try {
      setLogs(normalizeStoredPomodoroLogs(JSON.parse(savedLogs)));
    } catch {
      setLogs([]);
    }
  }, []);

  return (
    <main className="min-h-screen bg-[#f4f6f3] text-stone-950">
      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Pomodoro history</p>
            <h1 className="mt-2 text-4xl font-semibold text-stone-950">All sessions</h1>
          </div>
          <Link href="/pomodoro" className="w-fit rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800">
            Back to Pomodoro
          </Link>
        </div>

        <div className="mt-8 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-stone-950">Session log</h2>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">{logs.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {logs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
                <p className="text-sm font-semibold text-stone-950">No Pomodoro sessions yet</p>
                <p className="mt-2 text-sm text-stone-600">Sessions you log on the Pomodoro page will appear here.</p>
              </div>
            ) : null}

            {logs.map((log) => {
              const missingDetails = !log.done || !isNumber(log.focus);
              const description = log.done || "Missing Log Details. Click To Add What Got Done.";

              return (
                <article
                  key={log.id}
                  className={`pomodoro-log-row ${missingDetails ? "is-missing" : ""}`}
                >
                  <div className="pomodoro-log-projects">
                    <p className="text-sm font-semibold text-stone-950">{log.taskTitle}</p>
                    <p className="mt-1 text-xs font-medium text-teal-700">{log.projectName}</p>
                    <p className="mt-2 text-xs text-stone-500">{new Date(log.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                  </div>
                  <p
                    className={`pomodoro-log-description ${missingDetails ? "font-medium text-amber-200" : "text-stone-700"}`}
                    style={{ "--pomodoro-log-description-size": `${getDescriptionFontSize(description)}rem` } as CSSProperties}
                  >
                    {description}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <LogMetric label="Minutes" value={`${log.minutes} Min`} />
                    <LogMetric label="Focus" value={isNumber(log.focus) ? `${log.focus}%` : "Missing"} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function LogMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pomodoro-log-metric rounded-md bg-white p-2">
      <p className="text-[11px] font-medium text-stone-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getDescriptionFontSize(description: string) {
  if (description.length > 180) return 0.66;
  if (description.length > 120) return 0.72;
  if (description.length > 80) return 0.78;
  return 0.86;
}

function normalizeStoredPomodoroLogs(value: unknown): PomodoroLog[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((log): log is PomodoroLog => Boolean(log && typeof log === "object" && "id" in log))
    .map((log) => {
      const nextLog = { ...(log as PomodoroLog & { energy?: unknown }) };
      delete nextLog.energy;
      return nextLog;
    });
}
