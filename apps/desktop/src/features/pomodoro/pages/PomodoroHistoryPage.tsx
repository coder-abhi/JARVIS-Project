"use client";

import Link from "next/link";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import { PomodoroSessionModal, toDateTimeLocal, type PomodoroSessionDraft } from "../components/PomodoroSessionModal";
import {
  deletePomodoroHistorySession,
  deleteProjectPomodoroSession,
  getProjects,
  savePomodoroHistorySession,
  saveProjectPomodoroSession,
  type Project,
} from "@/lib/api";
import { loadDurablePomodoroLogs } from "@/lib/focusMetrics";
import "./PomodoroPage.css";

type TimerMode = "focus" | "short" | "long";

type PomodoroLog = {
  id: string;
  completedAt: string;
  startAt?: string;
  endAt?: string;
  minutes: number;
  mode: TimerMode;
  projectId?: string;
  projectName: string;
  taskId?: string;
  taskTitle: string;
  done?: string;
  focus?: number | null;
  savedProjectSessionIds?: string[];
};

const modeLabels: Record<TimerMode, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};

export default function PomodoroHistoryPage() {
  const [logs, setLogs] = useState<PomodoroLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [draft, setDraft] = useState<PomodoroSessionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDurablePomodoroLogs(normalizeStoredPomodoroLogs)
      .then(setLogs)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoadingProjects(false));
  }, []);

  const fixedProjects = useMemo(() => projects.filter((project) => project.type === "fixed"), [projects]);
  const continuousProjects = useMemo(() => projects.filter((project) => project.type === "continuous"), [projects]);

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

        {error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}

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
              const missingDetails = !log.done;
              const description = log.done || "Missing Log Details. Click To Add What Got Done.";

              return (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => openEditLog(log)}
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
                    <LogMetric label="Focus" value={`${getDefaultFocusPercent(log.focus)}%`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {draft ? (
        <PomodoroSessionModal
          continuousProjects={continuousProjects}
          draft={draft}
          fixedProjects={fixedProjects}
          isLoading={isLoadingProjects}
          modeOptions={modeLabels}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onDelete={deleteEditedLog}
          onSave={saveEditedLog}
        />
      ) : null}
    </main>
  );

  function openEditLog(log: PomodoroLog) {
    setDraft({
      id: log.id,
      source: "edit",
      mode: log.mode,
      startAt: toDateTimeLocal(new Date(log.startAt ?? log.completedAt)),
      endAt: toDateTimeLocal(new Date(log.endAt ?? log.completedAt)),
      projectId: log.projectId ?? "",
      taskId: log.taskId ?? "",
      done: log.done ?? "",
      focus: getDefaultFocusPercent(log.focus),
    });
  }

  async function saveEditedLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;

    const previousLog = logs.find((log) => log.id === draft.id);
    const nextLog = draftToLog(draft, previousLog);

    try {
      nextLog.savedProjectSessionIds = await saveProjectTimeLogs(previousLog, nextLog);
      const nextLogs = logs.map((log) => (log.id === nextLog.id ? nextLog : log));
      setLogs(nextLogs);
      await savePomodoroHistorySession(nextLog);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project session time");
    }
  }

  async function deleteEditedLog() {
    if (!draft?.id) return;
    const shouldDelete = window.confirm("Delete this Pomodoro session?");
    if (!shouldDelete) return;

    const previousLog = logs.find((log) => log.id === draft.id);
    try {
      await deleteProjectTimeLogs(previousLog);
      await deletePomodoroHistorySession(draft.id);
      const nextLogs = logs.filter((log) => log.id !== draft.id);
      setLogs(nextLogs);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project session time");
    }
  }

  function draftToLog(nextDraft: PomodoroSessionDraft, previousLog: PomodoroLog | undefined): PomodoroLog {
    const fixedProject = projects.find((project) => project.id === nextDraft.projectId);
    const continuousProject = projects.find((project) => project.id === nextDraft.taskId && project.type === "continuous");
    const startAt = new Date(nextDraft.startAt);
    const endAt = new Date(nextDraft.endAt);
    const minutes = Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));

    return {
      ...previousLog,
      id: nextDraft.id ?? crypto.randomUUID(),
      completedAt: endAt.toISOString(),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      minutes,
      mode: nextDraft.mode,
      projectId: nextDraft.projectId || undefined,
      projectName: nextDraft.projectId ? fixedProject?.name ?? previousLog?.projectName ?? "Unknown Project" : "No Fixed Project",
      taskId: nextDraft.taskId || undefined,
      taskTitle: nextDraft.taskId ? continuousProject?.name ?? previousLog?.taskTitle ?? "Unknown Project" : "No Continuous Project",
      done: nextDraft.done.trim() || undefined,
      focus: nextDraft.focus,
    };
  }

  async function saveProjectTimeLogs(previousLog: PomodoroLog | undefined, nextLog: PomodoroLog) {
    const previousSessionIds = getSavedProjectSessionIds(previousLog);
    if (previousSessionIds.length > 0) {
      await Promise.all(previousSessionIds.map((sessionId) => deleteProjectPomodoroSession(sessionId)));
    }

    if (nextLog.mode !== "focus") return [];

    const projectIds = getAttachedProjectIds(nextLog);
    await Promise.all(
      projectIds.map((projectId) =>
        saveProjectPomodoroSession({
          id: getProjectSessionId(nextLog.id, projectId),
          project_id: projectId,
          mode: nextLog.mode,
          minutes: nextLog.minutes,
          description: nextLog.done ?? null,
          started_at: nextLog.startAt ?? nextLog.completedAt,
          completed_at: nextLog.completedAt,
        }),
      ),
    );

    return projectIds.map((projectId) => getProjectSessionId(nextLog.id, projectId));
  }

  async function deleteProjectTimeLogs(log: PomodoroLog | undefined) {
    const sessionIds = getSavedProjectSessionIds(log);
    if (sessionIds.length === 0) return;
    await Promise.all(sessionIds.map((sessionId) => deleteProjectPomodoroSession(sessionId)));
  }
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

function getDefaultFocusPercent(value: unknown) {
  return isNumber(value) ? clamp(value, 0, 100) : 80;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getAttachedProjectIds(log: PomodoroLog) {
  return Array.from(new Set([log.projectId, log.taskId].filter(Boolean))) as string[];
}

function getProjectSessionId(logId: string, projectId: string) {
  return `${logId}:${projectId}`.slice(0, 80);
}

function getSavedProjectSessionIds(log: PomodoroLog | undefined) {
  if (!log) return [];
  if (log.savedProjectSessionIds?.length) return log.savedProjectSessionIds;
  return getAttachedProjectIds(log).map((projectId) => getProjectSessionId(log.id, projectId));
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
