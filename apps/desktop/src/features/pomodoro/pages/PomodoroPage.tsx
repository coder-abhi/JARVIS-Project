"use client";

import { type CSSProperties, FormEvent, Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  deleteProjectPomodoroSession,
  getProjectTasks,
  getProjects,
  matchPomodoroAssignment,
  saveProjectPomodoroSession,
  type Project,
  type Task,
} from "@/lib/api";
import { getScopedStorageKey } from "@/lib/auth";
import {
  announcePomodoroCompletion,
  announcePomodoroSessionUpdate,
  getActivePomodoroSessionKey,
  getPendingPomodoroCompletionKey,
  pomodoroSessionUpdatedEvent,
  readActivePomodoroSession,
  readPendingPomodoroCompletion,
  requestPomodoroNotificationPermission,
  type PendingPomodoroCompletion,
  type PersistedPomodoroSession,
} from "@/lib/pomodoroSession";

type TimerMode = "focus" | "short" | "long";
type SessionState = "idle" | "running" | "paused";
type TimingMode = "standard" | "custom" | "auto";
type RecentEntriesFilter = "today" | "last5" | "last10";
type FocusTrendRange = 7 | 30 | 90;
type FocusTrendMode = "regular" | "cumulative";

type DurationSet = Record<TimerMode, number>;

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
  energy?: number | null;
  focus?: number | null;
  investedTaskId?: string;
  investedMinutes?: number;
  savedProjectSessionIds?: string[];
  assignmentConfidence?: number | null;
  isManual?: boolean;
};

type FocusTrendPoint = {
  date: Date;
  label: string;
  minutes: number;
  shortLabel: string;
};

type FocusTrend = {
  averageMinutes: number;
  days: FocusTrendRange;
  maxMinutes: number;
  points: FocusTrendPoint[];
  totalMinutes: number;
};

type SessionDraft = {
  id?: string;
  source: "timer" | "manual" | "edit";
  mode: TimerMode;
  startAt: string;
  endAt: string;
  projectId: string;
  taskId: string;
  done: string;
  energy: number;
  focus: number;
};

const storageKey = "personal-project-manager:pomodoro-logs";
const standardDurations: DurationSet = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};
const defaultAutoDurations: DurationSet = {
  focus: 15 * 60,
  short: 5 * 60,
  long: 15 * 60,
};
const modeLabels: Record<TimerMode, string> = {
  focus: "Focus",
  short: "Short Break",
  long: "Long Break",
};
const customFocusMinutePresets = [5, 10, 15, 30, 45, 50];
const customBreakMinutePresets = [5, 10, 15];
const recentEntriesLabels: Record<RecentEntriesFilter, string> = {
  today: "Today",
  last5: "Last 5",
  last10: "Last 10",
};
const focusTrendLabels: Record<FocusTrendRange, string> = {
  7: "Last 7 Days",
  30: "30 Days",
  90: "90 Days",
};
const focusTrendModeLabels: Record<FocusTrendMode, string> = {
  regular: "Regular",
  cumulative: "Cumulative",
};

export default function PomodoroPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timingMode, setTimingMode] = useState<TimingMode>("auto");
  const [isTimingOpen, setIsTimingOpen] = useState(false);
  const [customFocusMinutes, setCustomFocusMinutes] = useState(25);
  const [customBreakMinutes, setCustomBreakMinutes] = useState(5);
  const [mode, setMode] = useState<TimerMode>("focus");
  const [secondsLeft, setSecondsLeft] = useState(defaultAutoDurations.focus);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [sessionEndsAt, setSessionEndsAt] = useState<string | null>(null);
  const [sessionDurationSeconds, setSessionDurationSeconds] = useState<number | null>(null);
  const [logs, setLogs] = useState<PomodoroLog[]>([]);
  const [hasLoadedLogs, setHasLoadedLogs] = useState(false);
  const [hasSyncedProjectSessions, setHasSyncedProjectSessions] = useState(false);
  const [recentEntriesFilter, setRecentEntriesFilter] = useState<RecentEntriesFilter>("today");
  const [focusTrendRange, setFocusTrendRange] = useState<FocusTrendRange>(7);
  const [focusTrendMode, setFocusTrendMode] = useState<FocusTrendMode>("regular");
  const [hasLoadedActiveSession, setHasLoadedActiveSession] = useState(false);
  const [fixedProjectId, setFixedProjectId] = useState("");
  const [continuousProjectId, setContinuousProjectId] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [draft, setDraft] = useState<SessionDraft | null>(null);

  useEffect(() => {
    async function loadProjectsAndTasks() {
      setError(null);
      const nextProjects = await getProjects();
      const taskGroups = await Promise.all(nextProjects.map((project) => getProjectTasks(project.id)));
      const nextTasksByProject = nextProjects.reduce<Record<string, Task[]>>((acc, project, index) => {
        acc[project.id] = taskGroups[index] ?? [];
        return acc;
      }, {});

      setProjects(nextProjects);
      setTasksByProject(nextTasksByProject);
    }

    loadProjectsAndTasks()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const savedLogs = window.localStorage.getItem(getScopedStorageKey(storageKey));
    if (!savedLogs) {
      setHasLoadedLogs(true);
      return;
    }

    try {
      setLogs(JSON.parse(savedLogs) as PomodoroLog[]);
    } catch {
      setLogs([]);
    } finally {
      setHasLoadedLogs(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedLogs) return;
    window.localStorage.setItem(getScopedStorageKey(storageKey), JSON.stringify(logs));
  }, [hasLoadedLogs, logs]);

  useEffect(() => {
    if (!hasLoadedLogs || isLoading || hasSyncedProjectSessions) return;

    const syncableLogs = logs.filter((log) => log.mode === "focus" && getAttachedProjectIds(log).length > 0 && !log.savedProjectSessionIds?.length);
    if (syncableLogs.length === 0) {
      setHasSyncedProjectSessions(true);
      return;
    }

    let isCancelled = false;

    async function syncExistingProjectSessions() {
      const results = await Promise.allSettled(
        syncableLogs.map(async (log) => ({
          logId: log.id,
          sessionIds: await saveProjectTimeLogs(undefined, log),
        })),
      );

      if (isCancelled) return;

      const sessionIdsByLogId = new Map(
        results
          .filter((result): result is PromiseFulfilledResult<{ logId: string; sessionIds: string[] }> => result.status === "fulfilled")
          .map((result) => [result.value.logId, result.value.sessionIds]),
      );

      if (sessionIdsByLogId.size > 0) {
        setLogs((current) =>
          current.map((log) => {
            const sessionIds = sessionIdsByLogId.get(log.id);
            return sessionIds ? { ...log, savedProjectSessionIds: sessionIds } : log;
          }),
        );
      }

      if (results.some((result) => result.status === "rejected")) {
        setError("Some existing Pomodoro sessions could not be synced to project time.");
      }
      setHasSyncedProjectSessions(true);
    }

    void syncExistingProjectSessions();

    return () => {
      isCancelled = true;
    };
  }, [hasLoadedLogs, hasSyncedProjectSessions, isLoading, logs]);

  const autoPlan = useMemo(() => calculateAutoPlan(logs), [logs]);
  const activeDurations = useMemo<DurationSet>(() => {
    if (timingMode === "standard") return standardDurations;
    if (timingMode === "auto") {
      return {
        focus: autoPlan.focusMinutes * 60,
        short: autoPlan.breakMinutes * 60,
        long: Math.max(autoPlan.breakMinutes * 3, 10) * 60,
      };
    }

    return {
      focus: customFocusMinutes * 60,
      short: customBreakMinutes * 60,
      long: Math.max(customBreakMinutes * 3, 10) * 60,
    };
  }, [autoPlan, customBreakMinutes, customFocusMinutes, timingMode]);

  const currentModeDuration = activeDurations[mode];
  const activeSessionDuration = sessionDurationSeconds ?? currentModeDuration;

  useEffect(() => {
    if (sessionState === "idle") setSecondsLeft(currentModeDuration);
  }, [currentModeDuration, sessionState]);

  useEffect(() => {
    if (sessionState !== "running") return;

    const timer = window.setInterval(() => {
      if (!sessionEndsAt) return;

      const nextSecondsLeft = Math.max(0, Math.ceil((new Date(sessionEndsAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(nextSecondsLeft);

      if (nextSecondsLeft <= 0) {
        window.clearInterval(timer);
        completeTimerSession(new Date(sessionEndsAt));
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionEndsAt, sessionState, sessionStartedAt, sessionDurationSeconds, sessionNote, fixedProjectId, continuousProjectId]);

  useEffect(() => {
    const activeSession = readActivePomodoroSession();
    if (!activeSession) {
      setHasLoadedActiveSession(true);
      return;
    }

    restoreActiveSession(activeSession);
    setHasLoadedActiveSession(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedActiveSession) return;

    if (sessionState === "idle" || !sessionStartedAt || !sessionDurationSeconds) {
      window.localStorage.removeItem(getActivePomodoroSessionKey());
      announcePomodoroSessionUpdate();
      return;
    }

    const activeSession: PersistedPomodoroSession = {
      id: sessionStartedAt,
      mode,
      durationSeconds: sessionDurationSeconds,
      startedAt: sessionStartedAt,
      endsAt: sessionState === "running" ? sessionEndsAt : null,
      state: sessionState,
      pausedRemainingSeconds: sessionState === "paused" ? secondsLeft : null,
      note: sessionNote,
      fixedProjectId,
      continuousProjectId,
    };

    window.localStorage.setItem(getActivePomodoroSessionKey(), JSON.stringify(activeSession));
    announcePomodoroSessionUpdate();
  }, [continuousProjectId, fixedProjectId, hasLoadedActiveSession, mode, secondsLeft, sessionDurationSeconds, sessionEndsAt, sessionStartedAt, sessionState, sessionNote]);

  useEffect(() => {
    function handlePendingCompletion() {
      const pendingCompletion = readPendingPomodoroCompletion();
      if (!pendingCompletion) return;

      window.localStorage.removeItem(getPendingPomodoroCompletionKey());
      announcePomodoroSessionUpdate();
      completePendingSession(pendingCompletion);
    }

    handlePendingCompletion();
    window.addEventListener("storage", handlePendingCompletion);
    window.addEventListener(pomodoroSessionUpdatedEvent, handlePendingCompletion);

    return () => {
      window.removeEventListener("storage", handlePendingCompletion);
      window.removeEventListener(pomodoroSessionUpdatedEvent, handlePendingCompletion);
    };
  }, []);

  const completedToday = logs.filter((log) => isToday(new Date(log.completedAt))).length;
  const totalFocusMinutes = logs.filter((log) => log.mode === "focus").reduce((sum, log) => sum + log.minutes, 0);
  const averageFocus = getAverage(logs.map((log) => log.focus).filter(isNumber));
  const completionPercent = Math.round(((activeSessionDuration - secondsLeft) / activeSessionDuration) * 100);
  const minutesLabel = formatSeconds(secondsLeft);
  const heatmap = useMemo(() => buildHeatmap(logs), [logs]);
  const fixedProjects = projects.filter((project) => project.type === "fixed");
  const continuousProjects = projects.filter((project) => project.type === "continuous");
  const visibleRecentLogs = useMemo(() => getVisibleRecentLogs(logs, recentEntriesFilter), [logs, recentEntriesFilter]);
  const focusTrend = useMemo(() => buildFocusTrend(logs, focusTrendRange), [logs, focusTrendRange]);
  const focusLogs = logs.filter((log) => log.mode === "focus");
  const sevenDayMinutes = getFocusMinutesInLastDays(focusLogs, 7);
  const thirtyDayMinutes = getFocusMinutesInLastDays(focusLogs, 30);
  const sessionIntel = buildSessionIntel(focusLogs);

  function changeMode(nextMode: TimerMode) {
    setMode(nextMode);
    setSecondsLeft(activeDurations[nextMode]);
    setSessionState("idle");
    setSessionStartedAt(null);
    setSessionEndsAt(null);
    setSessionDurationSeconds(null);
  }

  function startOrPauseTimer() {
    if (sessionState === "running") {
      if (sessionEndsAt) {
        setSecondsLeft(Math.max(0, Math.ceil((new Date(sessionEndsAt).getTime() - Date.now()) / 1000)));
      }
      setSessionState("paused");
      setSessionEndsAt(null);
      return;
    }

    void requestPomodoroNotificationPermission();

    const nextSecondsLeft = secondsLeft === 0 ? currentModeDuration : secondsLeft;
    const now = new Date();
    setSecondsLeft(nextSecondsLeft);
    setSessionEndsAt(new Date(now.getTime() + nextSecondsLeft * 1000).toISOString());
    setSessionDurationSeconds(sessionDurationSeconds ?? currentModeDuration);
    if (!sessionStartedAt) setSessionStartedAt(now.toISOString());
    setSessionState("running");
  }

  function resetTimer() {
    setSecondsLeft(currentModeDuration);
    setSessionState("idle");
    setSessionStartedAt(null);
    setSessionEndsAt(null);
    setSessionDurationSeconds(null);
  }

  async function completeTimerSession(completedAt?: Date) {
    const endAt = completedAt ?? new Date();
    const durationSeconds = sessionDurationSeconds ?? currentModeDuration;
    const startAt = sessionStartedAt ? new Date(sessionStartedAt) : new Date(endAt.getTime() - durationSeconds * 1000);
    setSessionState("idle");
    setSessionStartedAt(null);
    setSessionEndsAt(null);
    setSessionDurationSeconds(null);
    window.localStorage.removeItem(getActivePomodoroSessionKey());
    window.localStorage.removeItem(getPendingPomodoroCompletionKey());
    announcePomodoroCompletion({
      id: sessionStartedAt ?? endAt.toISOString(),
      mode,
      durationSeconds,
      startedAt: startAt.toISOString(),
      completedAt: endAt.toISOString(),
      note: sessionNote,
      fixedProjectId,
      continuousProjectId,
    });
    announcePomodoroSessionUpdate();
    const nextDraft = createDraft("timer", {
      startAt: toDateTimeLocal(startAt),
      endAt: toDateTimeLocal(endAt),
      mode,
      projectId: fixedProjectId,
      taskId: continuousProjectId,
    }, sessionNote);

    const note = sessionNote.trim();
    if (note) {
      try {
        const assignment = await matchPomodoroAssignment(note, getSelectedProjectIds(fixedProjectId, continuousProjectId));
        if (assignment.assigned && assignment.project_id) {
          applyAssignedProject(nextDraft, assignment.project_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not assign Pomodoro session");
      }
    }

    setDraft(nextDraft);
    setSessionNote("");
  }

  async function completePendingSession(pendingCompletion: PendingPomodoroCompletion) {
    setMode(pendingCompletion.mode);
    setSecondsLeft(activeDurations[pendingCompletion.mode]);
    setSessionState("idle");
    setSessionStartedAt(null);
    setSessionEndsAt(null);
    setSessionDurationSeconds(null);
    setSessionNote("");
    setFixedProjectId(pendingCompletion.fixedProjectId);
    setContinuousProjectId(pendingCompletion.continuousProjectId);

    const startAt = new Date(pendingCompletion.startedAt);
    const endAt = new Date(pendingCompletion.completedAt);
    const nextDraft = createDraft("timer", {
      startAt: toDateTimeLocal(startAt),
      endAt: toDateTimeLocal(endAt),
      mode: pendingCompletion.mode,
      projectId: pendingCompletion.fixedProjectId,
      taskId: pendingCompletion.continuousProjectId,
    }, pendingCompletion.note);

    const note = pendingCompletion.note.trim();
    if (note) {
      try {
        const assignment = await matchPomodoroAssignment(note, getSelectedProjectIds(pendingCompletion.fixedProjectId, pendingCompletion.continuousProjectId));
        if (assignment.assigned && assignment.project_id) {
          applyAssignedProject(nextDraft, assignment.project_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not assign Pomodoro session");
      }
    }

    setDraft(nextDraft);
  }

  function restoreActiveSession(activeSession: PersistedPomodoroSession) {
    setMode(activeSession.mode);
    setSessionStartedAt(activeSession.startedAt);
    setSessionDurationSeconds(activeSession.durationSeconds);
    setSessionNote(activeSession.note);
    setFixedProjectId(activeSession.fixedProjectId);
    setContinuousProjectId(activeSession.continuousProjectId);

    if (activeSession.state === "paused") {
      setSecondsLeft(activeSession.pausedRemainingSeconds ?? activeSession.durationSeconds);
      setSessionEndsAt(null);
      setSessionState("paused");
      return;
    }

    const endsAt = activeSession.endsAt ? new Date(activeSession.endsAt) : null;
    if (!endsAt || endsAt.getTime() <= Date.now()) {
      const pendingCompletion: PendingPomodoroCompletion = {
        id: activeSession.id,
        mode: activeSession.mode,
        durationSeconds: activeSession.durationSeconds,
        startedAt: activeSession.startedAt,
        completedAt: (endsAt ?? new Date()).toISOString(),
        note: activeSession.note,
        fixedProjectId: activeSession.fixedProjectId,
        continuousProjectId: activeSession.continuousProjectId,
      };

      window.localStorage.removeItem(getActivePomodoroSessionKey());
      window.localStorage.setItem(getPendingPomodoroCompletionKey(), JSON.stringify(pendingCompletion));
      announcePomodoroSessionUpdate();
      setSessionState("idle");
      setSessionStartedAt(null);
      setSessionDurationSeconds(null);
      setSecondsLeft(activeDurations[activeSession.mode]);
      return;
    }

    setSessionEndsAt(endsAt.toISOString());
    setSecondsLeft(Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 1000)));
    setSessionState("running");
  }

  function openManualSession() {
    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - activeDurations.focus * 1000);
    setDraft(createDraft("manual", {
      startAt: toDateTimeLocal(startAt),
      endAt: toDateTimeLocal(endAt),
      mode: "focus",
      projectId: "",
      taskId: "",
    }, sessionNote));
  }

  const openEditSession = useCallback((log: PomodoroLog) => {
    setDraft({
      id: log.id,
      source: "edit",
      mode: log.mode,
      startAt: toDateTimeLocal(new Date(log.startAt ?? log.completedAt)),
      endAt: toDateTimeLocal(new Date(log.endAt ?? log.completedAt)),
      projectId: log.projectId ?? "",
      taskId: log.taskId ?? "",
      done: log.done ?? "",
      energy: log.energy ?? 7,
      focus: log.focus ?? 80,
    });
  }, []);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;

    const nextLog = draftToLog(draft);
    const previousLog = draft.id ? logs.find((log) => log.id === draft.id) : undefined;

    try {
      nextLog.savedProjectSessionIds = await saveProjectTimeLogs(previousLog, nextLog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project session time");
      return;
    }

    setLogs((current) => {
      if (draft.id) return current.map((log) => (log.id === draft.id ? nextLog : log));
      return [nextLog, ...current].slice(0, 80);
    });
    setDraft(null);
    if (draft.source === "timer") resetTimer();
  }

  async function saveDraftWithoutDetails() {
    if (!draft) return;

    const nextLog = draftToLog({ ...draft, done: "", energy: 0, focus: 0 });
    try {
      nextLog.savedProjectSessionIds = await saveProjectTimeLogs(undefined, nextLog);
      setLogs((current) => [nextLog, ...current].slice(0, 80));
      setDraft(null);
      resetTimer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save project session time");
    }
  }

  async function deleteDraft() {
    if (!draft?.id) return;
    const shouldDelete = window.confirm("Delete this Pomodoro session?");
    if (!shouldDelete) return;

    const previousLog = logs.find((log) => log.id === draft.id);
    try {
      await deleteProjectTimeLogs(previousLog);
      setLogs((current) => current.filter((log) => log.id !== draft.id));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project session time");
    }
  }

  function applyAssignedProject(nextDraft: SessionDraft, projectId: string) {
    const assignedProject = projects.find((project) => project.id === projectId);
    if (!assignedProject) return;
    if (assignedProject.type === "fixed" && !nextDraft.projectId) nextDraft.projectId = projectId;
    if (assignedProject.type === "continuous" && !nextDraft.taskId) nextDraft.taskId = projectId;
  }

  function draftToLog(nextDraft: SessionDraft): PomodoroLog {
    const draftProject = projects.find((project) => project.id === nextDraft.projectId);
    const continuousProject = projects.find((project) => project.id === nextDraft.taskId && project.type === "continuous");
    const startAt = new Date(nextDraft.startAt);
    const endAt = new Date(nextDraft.endAt);
    const minutes = Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));

    return {
      id: nextDraft.id ?? crypto.randomUUID(),
      completedAt: endAt.toISOString(),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      minutes,
      mode: nextDraft.mode,
      projectId: nextDraft.projectId || undefined,
      projectName: draftProject?.name ?? "No Fixed Project",
      taskId: nextDraft.taskId || undefined,
      taskTitle: continuousProject?.name ?? "No Continuous Project",
      done: nextDraft.done.trim() || undefined,
      energy: nextDraft.energy || null,
      focus: nextDraft.focus || null,
      isManual: nextDraft.source === "manual",
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

  return (
    <main className="ops-screen">
      <section className="ops-header">
        <div>
          <p className="ops-kicker">FOCUS OPERATIONS</p>
          <h1>Focus Operations</h1>
          <p className="ops-subtitle">Timer control, focus momentum, session intelligence, and heatmap history.</p>
        </div>
        <button type="button" onClick={openManualSession} className="ops-button primary">
          Add Session
        </button>
      </section>

      <section className="focus-command-grid">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Today</h2>
              <span>current duty cycle</span>
            </div>
            <div className="briefing-grid">
              <HeroMetric label="Sessions" value={`${completedToday}`} detail="count" />
              <HeroMetric label="Focus Minutes" value={`${getFocusMinutesToday(focusLogs)}`} detail="today" />
              <HeroMetric label="Average Focus" value={`${averageFocus}%`} detail="rating" />
            </div>
          </div>

          <div className="ops-panel focus-timer-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-full border border-stone-200 bg-stone-100 p-1">
                {(Object.keys(activeDurations) as TimerMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => changeMode(item)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      mode === item ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white hover:text-stone-950"
                    }`}
                  >
                    {modeLabels[item]}
                  </button>
                ))}
              </div>
              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTimingOpen((current) => !current)}
                  className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 bg-white text-lg shadow-sm transition hover:border-teal-200 hover:bg-teal-50"
                  aria-label="Edit Pomodoro Timing"
                  title="Edit Pomodoro Timing"
                >
                  T
                </button>
                {isTimingOpen ? (
                  <div className="absolute right-0 top-12 z-20 w-[min(22rem,calc(100vw-3rem))] rounded-lg border border-stone-200 bg-white p-4 shadow-2xl shadow-stone-900/15">
                    <div className="flex flex-wrap gap-2">
                      {(["standard", "custom", "auto"] as TimingMode[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setTimingMode(item);
                            setSessionState("idle");
                            setSessionStartedAt(null);
                            setSessionEndsAt(null);
                            setSessionDurationSeconds(null);
                          }}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                            timingMode === item ? "bg-stone-950 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-950"
                          }`}
                        >
                          {item === "auto" ? "Auto AI" : titleCase(item)}
                        </button>
                      ))}
                    </div>

                    {timingMode === "custom" ? (
                      <div className="mt-4 grid gap-4">
                        <PresetMinutePicker label="Focus Minutes" options={customFocusMinutePresets} value={customFocusMinutes} onChange={setCustomFocusMinutes} />
                        <PresetMinutePicker label="Break Minutes" options={customBreakMinutePresets} value={customBreakMinutes} onChange={setCustomBreakMinutes} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <NumberField label="Focus Minutes" max={90} min={5} step={5} value={customFocusMinutes} onChange={setCustomFocusMinutes} />
                          <NumberField label="Break Minutes" max={30} min={1} value={customBreakMinutes} onChange={setCustomBreakMinutes} />
                        </div>
                      </div>
                    ) : null}

                    {timingMode === "auto" ? (
                      <div className="mt-4 grid gap-3 text-sm text-stone-600">
                        <TimingMetric label="Recommended" value={`${autoPlan.focusMinutes}/${autoPlan.breakMinutes}`} detail="Focus/Break" />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TimingMetric label="Streak" value={`${autoPlan.streak}`} detail="Days" />
                          <TimingMetric label="Momentum" value={`${autoPlan.momentum}%`} detail={`${autoPlan.effectiveMinutes} Effective Min`} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white/60 px-4 py-3">
              <p className="text-sm font-medium text-stone-600">
                {timingMode === "auto" ? `Auto AI: ${autoPlan.focusMinutes}m Focus / ${autoPlan.breakMinutes}m Break` : timingMode === "custom" ? `Custom: ${customFocusMinutes}m Focus / ${customBreakMinutes}m Break` : "Standard: 25m Focus / 5m Break"}
              </p>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                {timingMode === "auto" ? `${autoPlan.momentum}% Momentum` : titleCase(timingMode)}
              </span>
            </div>

            <div className="mt-8 grid place-items-center">
              <div
                className="relative grid aspect-square w-full max-w-[320px] place-items-center rounded-full bg-[conic-gradient(#14b8a6_var(--progress),#e7e5e4_0)] p-3"
                style={{ "--progress": `${completionPercent}%` } as CSSProperties}
              >
                <div className="grid h-full w-full place-items-center rounded-full bg-white shadow-inner">
                  <div className="text-center">
                    <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">{modeLabels[mode]}</p>
                    <p className="mt-3 text-6xl font-semibold tabular-nums text-stone-950">{minutesLabel}</p>
                    <p className="mt-3 text-sm text-stone-500">{sessionState === "running" ? "Running" : sessionState === "paused" ? "Paused" : "Ready"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-center gap-3">
              <button
                type="button"
                onClick={startOrPauseTimer}
                className="rounded-full bg-stone-950 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-stone-900/15 transition hover:-translate-y-0.5 hover:bg-stone-800"
              >
                {sessionState === "running" ? "Pause" : "Start"}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className="rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-50"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Momentum</h2>
              <span>7 / 30 / streak</span>
            </div>
            <div className="analysis-stack">
              <div><span>7 Day</span><strong>{sevenDayMinutes}m</strong></div>
              <div><span>30 Day</span><strong>{thirtyDayMinutes}m</strong></div>
              <div><span>Streak</span><strong>{autoPlan.streak} days</strong></div>
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Session Intelligence</h2>
              <span>best / worst / average</span>
            </div>
            <div className="analysis-stack">
              <div><span>Best Focus Hour</span><strong>{sessionIntel.bestHour}</strong></div>
              <div><span>Worst Focus Hour</span><strong>{sessionIntel.worstHour}</strong></div>
              <div><span>Average Session</span><strong>{sessionIntel.averageLength}m</strong></div>
            </div>
          </div>
      </section>

      <section className="grid gap-5">
        {sessionState !== "idle" ? (
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <div className="grid gap-4">
                <ProjectSelect
                  label="Fixed Project"
                  projects={fixedProjects}
                  value={fixedProjectId}
                  onChange={setFixedProjectId}
                />
                <ProjectSelect
                  label="Continuous Project"
                  projects={continuousProjects}
                  value={continuousProjectId}
                  onChange={setContinuousProjectId}
                />
              </div>
              <label className="block text-sm font-medium text-stone-700">
                Session Note
                <textarea
                  value={sessionNote}
                  onChange={(event) => setSessionNote(event.target.value)}
                  rows={5}
                  placeholder="Drafted API route, reviewed task card, fixed timer state..."
                  className="mt-2 w-full resize-none rounded-md border border-stone-300 bg-white px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
                />
              </label>
            </div>
          </div>
        ) : null}

        <FocusCalendar heatmap={heatmap} streak={autoPlan.streak} error={error} />

        <RecentWorkEntries
          filter={recentEntriesFilter}
          logs={logs}
          onEditSession={openEditSession}
          onFilterChange={setRecentEntriesFilter}
          visibleLogs={visibleRecentLogs}
        />

        <FocusTrendSection
          hasLoadedLogs={hasLoadedLogs}
          mode={focusTrendMode}
          range={focusTrendRange}
          setMode={setFocusTrendMode}
          setRange={setFocusTrendRange}
          trend={focusTrend}
        />
      </section>

      {draft ? (
        <SessionModal
          draft={draft}
          isLoading={isLoading}
          modeOptions={modeLabels}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
          onDelete={draft.source === "edit" ? deleteDraft : undefined}
          onSaveWithoutDetails={draft.source === "timer" ? saveDraftWithoutDetails : undefined}
          continuousProjects={continuousProjects}
          fixedProjects={fixedProjects}
        />
      ) : null}
    </main>
  );
}

function SessionModal({
  draft,
  isLoading,
  modeOptions,
  onChange,
  onClose,
  onDelete,
  onSave,
  onSaveWithoutDetails,
  continuousProjects,
  fixedProjects,
}: {
  draft: SessionDraft;
  isLoading: boolean;
  modeOptions: Record<TimerMode, string>;
  onChange: (draft: SessionDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onSaveWithoutDetails?: () => void;
  continuousProjects: Project[];
  fixedProjects: Project[];
}) {
  const title = draft.source === "manual" ? "Add Session" : draft.source === "edit" ? "Edit Session" : "Session Complete";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/45 px-5 py-8 backdrop-blur-sm">
      <form onSubmit={onSave} className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl shadow-stone-950/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">{draft.source === "timer" ? "End of sprint" : "Pomodoro log"}</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl leading-none text-stone-500 transition hover:bg-stone-50 hover:text-stone-950"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-medium text-stone-700">
            Type
            <select
              value={draft.mode}
              onChange={(event) => onChange({ ...draft, mode: event.target.value as TimerMode })}
              className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
            >
              {(Object.keys(modeOptions) as TimerMode[]).map((item) => (
                <option key={item} value={item}>
                  {modeOptions[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-stone-700">
            Start Time
            <input
              type="datetime-local"
              value={draft.startAt}
              onChange={(event) => onChange({ ...draft, startAt: event.target.value })}
              className="mt-2 w-full rounded-md border border-stone-300 px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
            />
          </label>

          <label className="block text-sm font-medium text-stone-700">
            End Time
            <input
              type="datetime-local"
              value={draft.endAt}
              onChange={(event) => onChange({ ...draft, endAt: event.target.value })}
              className="mt-2 w-full rounded-md border border-stone-300 px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-stone-700">
            Fixed Project
            <select
              value={draft.projectId}
              onChange={(event) => onChange({ ...draft, projectId: event.target.value })}
              className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
            >
              <option value="">No Fixed Project</option>
              {fixedProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-stone-700">
            Continuous Project
            <select
              value={draft.taskId}
              onChange={(event) => onChange({ ...draft, taskId: event.target.value })}
              disabled={isLoading}
              className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4 disabled:bg-stone-100"
            >
              <option value="">No Continuous Project</option>
              {continuousProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-5 block text-sm font-medium text-stone-700">
          What Got Done
          <textarea
            value={draft.done}
            onChange={(event) => onChange({ ...draft, done: event.target.value })}
            rows={4}
            placeholder="Shipped the timeline fix, drafted notes, cleared review comments..."
            className="mt-2 w-full resize-none rounded-md border border-stone-300 px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
          />
        </label>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <RangeInput label="Energy" max={10} min={1} suffix="/10" value={draft.energy} onChange={(value) => onChange({ ...draft, energy: value })} />
          <RangeInput label="Focus" max={100} min={0} step={5} suffix="%" value={draft.focus} onChange={(value) => onChange({ ...draft, focus: value })} />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="mr-auto rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            >
              Delete
            </button>
          ) : null}
          {onSaveWithoutDetails ? (
            <button
              type="button"
              onClick={onSaveWithoutDetails}
              className="rounded-full border border-orange-200 bg-orange-50 px-5 py-2.5 text-sm font-semibold text-orange-800 transition hover:bg-orange-100"
            >
              Save Missing Details
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
            Cancel
          </button>
          <button className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800">
            Save Session
          </button>
        </div>
      </form>
    </div>
  );
}

function createDraft(source: SessionDraft["source"], seed: Pick<SessionDraft, "mode" | "startAt" | "endAt" | "projectId" | "taskId">, done = ""): SessionDraft {
  return {
    source,
    ...seed,
    done,
    energy: 7,
    focus: 80,
  };
}

function calculateAutoPlan(logs: PomodoroLog[]) {
  const focusLogs = logs.filter((log) => log.mode === "focus");
  const sourceLogs = focusLogs.filter((log) => daysBetween(new Date(log.completedAt), new Date()) <= 6);
  const streak = getCurrentStreak(logs);
  const effectiveMinutes = sourceLogs.reduce((sum, log) => sum + log.minutes * ((log.focus ?? 0) / 100), 0);
  const momentum = clamp(Math.round((effectiveMinutes / 1200) * 100), 0, 100);
  const focusMinutes = clamp(Math.round((15 + momentum * 0.35) / 5) * 5, 15, 50);
  const breakMinutes = focusMinutes >= 45 ? 10 : focusMinutes >= 30 ? 7 : 5;
  const roundedEffectiveMinutes = Math.round(effectiveMinutes);

  if (sourceLogs.length === 0) {
    return {
      breakMinutes: 5,
      focusMinutes: 15,
      effectiveMinutes: 0,
      momentum: 0,
      streak,
    };
  }

  return {
    breakMinutes,
    effectiveMinutes: roundedEffectiveMinutes,
    focusMinutes,
    momentum,
    streak,
  };
}

function getFocusMinutesToday(logs: PomodoroLog[]) {
  return logs.filter((log) => isToday(new Date(log.completedAt))).reduce((sum, log) => sum + log.minutes, 0);
}

function getFocusMinutesInLastDays(logs: PomodoroLog[], days: number) {
  return logs.filter((log) => daysBetween(new Date(log.completedAt), new Date()) <= days - 1).reduce((sum, log) => sum + log.minutes, 0);
}

function buildSessionIntel(logs: PomodoroLog[]) {
  if (logs.length === 0) {
    return { averageLength: 0, bestHour: "No data", worstHour: "No data" };
  }

  const byHour = logs.reduce<Record<number, { minutes: number; focus: number; count: number }>>((acc, log) => {
    const hour = new Date(log.startAt ?? log.completedAt).getHours();
    acc[hour] = acc[hour] ?? { minutes: 0, focus: 0, count: 0 };
    acc[hour].minutes += log.minutes;
    acc[hour].focus += log.focus ?? 0;
    acc[hour].count += 1;
    return acc;
  }, {});
  const ranked = Object.entries(byHour).sort(([, a], [, b]) => b.focus / b.count - a.focus / a.count);
  const averageLength = Math.round(logs.reduce((sum, log) => sum + log.minutes, 0) / logs.length);

  return {
    averageLength,
    bestHour: ranked[0] ? formatHour(Number(ranked[0][0])) : "No data",
    worstHour: ranked[ranked.length - 1] ? formatHour(Number(ranked[ranked.length - 1][0])) : "No data",
  };
}

function formatHour(hour: number) {
  return new Date(2024, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

function buildHeatmap(logs: PomodoroLog[]) {
  const weekCount = 52;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = startOfDay(new Date());
  const end = addDays(today, 6 - today.getDay());
  const start = addDays(end, -(weekCount * 7 - 1));
  const counts = logs.reduce<Record<string, { count: number; minutes: number }>>((acc, log) => {
    if (log.mode !== "focus") return acc;

    const key = dateKey(new Date(log.completedAt));
    acc[key] = acc[key] ?? { count: 0, minutes: 0 };
    acc[key].minutes += log.minutes;
    acc[key].count = Math.floor(acc[key].minutes / 25);
    return acc;
  }, {});

  const weeks = Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(start, weekIndex * 7);

    return {
      isMonthStart: weekIndex === 0 || Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex)).some((date) => date.getDate() === 1),
      monthKey: `${weekStart.getFullYear()}-${weekStart.getMonth()}`,
      days: Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(start, weekIndex * 7 + dayIndex);
      const day = counts[dateKey(date)] ?? { count: 0, minutes: 0 };

      return {
        ...day,
        iso: date.toISOString(),
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      };
    }),
    };
  });
  const monthSpans = weeks.reduce<{ key: string; label: string; length: number; start: number }[]>((spans, week, weekIndex) => {
    const labelDate = new Date(week.days.find((day) => new Date(day.iso).getDate() === 1)?.iso ?? week.days[0].iso);
    const label = labelDate.toLocaleDateString(undefined, { month: "short" });
    const current = spans[spans.length - 1];

    if (current?.key === week.monthKey) {
      current.length += 1;
      return spans;
    }

    return [...spans, { key: week.monthKey, label, length: 1, start: weekIndex }];
  }, []);
  const shiftedMonthSpans = monthSpans.map((month) => {
    const labelOffset = month.length > 1 ? 1 : 0;

    return {
      ...month,
      labelLength: Math.max(1, month.length - labelOffset),
      labelStart: month.start + labelOffset,
    };
  });

  return { monthSpans: shiftedMonthSpans, weekdays, weeks };
}

const FocusCalendar = memo(function FocusCalendar({ error, heatmap, streak }: { error: string | null; heatmap: ReturnType<typeof buildHeatmap>; streak: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Session Density</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">Focus Calendar</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-fit rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">{streak} Day Streak</span>
          <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">Last 52 Weeks | 25 Min Blocks</span>
        </div>
      </div>

      {error ? <p className="mt-5 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p> : null}

      <div className="mt-6 overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `3rem repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
            <div />
            {heatmap.monthSpans.map((month) => (
              <div
                key={`${month.label}-${month.start}`}
                className="h-5 text-left text-xs font-semibold text-stone-400"
                style={{ gridColumn: `${month.labelStart + 2} / span ${month.labelLength}` }}
              >
                <span>{month.label}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-1" style={{ gridTemplateColumns: `3rem repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
            {heatmap.weekdays.map((weekday, dayIndex) => (
              <Fragment key={weekday}>
                <div className="flex items-center text-xs font-medium text-stone-400">{weekday}</div>
                {heatmap.weeks.map((week, weekIndex) => {
                  const day = week.days[dayIndex];

                  return (
                    <div key={day.iso} className={`relative ${week.isMonthStart && weekIndex > 0 ? "before:absolute before:-left-0.5 before:inset-y-0 before:w-px before:bg-stone-400" : ""}`}>
                      <div
                        title={`${day.count} Sessions Logged On ${day.label}`}
                        className={`aspect-square w-full rounded-sm border border-white ${heatClass(day.count)}`}
                      />
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 text-xs text-stone-500">
        <span>Less</span>
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`h-3 w-3 rounded-sm ${heatClass(level)}`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
});

const RecentWorkEntries = memo(function RecentWorkEntries({
  filter,
  logs,
  onEditSession,
  onFilterChange,
  visibleLogs,
}: {
  filter: RecentEntriesFilter;
  logs: PomodoroLog[];
  onEditSession: (log: PomodoroLog) => void;
  onFilterChange: (filter: RecentEntriesFilter) => void;
  visibleLogs: PomodoroLog[];
}) {
  return (
    <aside className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Recent Work</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">Pomodoro Trail</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="recent-entry-filter">Recent Entries</label>
          <select
            id="recent-entry-filter"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value as RecentEntriesFilter)}
            className="h-10 min-w-[7.5rem] rounded-full border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
          >
            {(Object.keys(recentEntriesLabels) as RecentEntriesFilter[]).map((item) => (
              <option key={item} value={item}>
                {recentEntriesLabels[item]}
              </option>
            ))}
          </select>
          <span className="grid h-10 min-w-10 place-items-center rounded-full bg-stone-100 px-3 text-sm font-semibold text-stone-700">{visibleLogs.length}</span>
          <Link href="/pomodoro/history" className="inline-flex h-10 items-center rounded-full bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800">
            View All
          </Link>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {logs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
            <p className="text-sm font-semibold text-stone-950">No Sessions Logged Yet</p>
            <p className="mt-2 text-sm leading-6 text-stone-600">Run A Sprint Or Add One Manually And Your Notes Will Stack Up Here.</p>
          </div>
        ) : null}

        {logs.length > 0 && visibleLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
            <p className="text-sm font-semibold text-stone-950">No Entries For {recentEntriesLabels[filter]}</p>
            <p className="mt-2 text-sm leading-6 text-stone-600">Switch The Filter To See Older Logged Sessions.</p>
          </div>
        ) : null}

        {visibleLogs.map((log) => {
          const missingDetails = isMissingDetails(log);

          return (
            <button
              key={log.id}
              type="button"
              onClick={() => onEditSession(log)}
              className={`grid w-full gap-4 rounded-lg border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm md:grid-cols-[1.2fr_1.6fr_1fr] md:items-center ${
                missingDetails ? "border-orange-200 bg-orange-50/80" : "border-stone-200 bg-stone-50/70 hover:bg-stone-50"
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-stone-950">{log.taskTitle}</p>
                <p className="mt-1 text-xs font-medium text-teal-700">{log.projectName}</p>
                <p className="mt-2 text-xs text-stone-500">
                  {new Date(log.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} | {log.minutes} Min
                </p>
              </div>
              <p className={`text-sm leading-6 ${missingDetails ? "font-medium text-orange-800" : "text-stone-700"}`}>
                {log.done || "Missing Log Details. Click To Add What Got Done."}
              </p>
              <div className="grid grid-cols-2 gap-2 text-center">
                <LogMetric label="Energy" value={isNumber(log.energy) ? `${log.energy}/10` : "Missing"} />
                <LogMetric label="Focus" value={isNumber(log.focus) ? `${log.focus}%` : "Missing"} />
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
});

const FocusTrendSection = memo(function FocusTrendSection({
  hasLoadedLogs,
  mode,
  range,
  setMode,
  setRange,
  trend,
}: {
  hasLoadedLogs: boolean;
  mode: FocusTrendMode;
  range: FocusTrendRange;
  setMode: (mode: FocusTrendMode) => void;
  setRange: (range: FocusTrendRange) => void;
  trend: FocusTrend;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Focus Minutes</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">Daily Focus Trend</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-full border border-stone-200 bg-stone-100 p-1">
            {(["regular", "cumulative"] as FocusTrendMode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`inline-flex h-7 min-w-[5.25rem] items-center justify-center rounded-full px-3 text-xs font-semibold transition ${
                  mode === option ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white hover:text-stone-950"
                }`}
              >
                {focusTrendModeLabels[option]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {([7, 30, 90] as FocusTrendRange[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`inline-flex h-8 min-w-[5.75rem] items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                  range === option ? "border-stone-950 bg-stone-950 text-white shadow-sm" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
                }`}
              >
                {focusTrendLabels[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasLoadedLogs ? <FocusMinutesChart mode={mode} trend={trend} /> : <FocusTrendSkeleton />}
    </section>
  );
});

function getVisibleRecentLogs(logs: PomodoroLog[], filter: RecentEntriesFilter) {
  const orderedLogs = [...logs].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  if (filter === "today") return orderedLogs.filter((log) => isToday(new Date(log.completedAt)));
  if (filter === "last5") return orderedLogs.slice(0, 5);
  return orderedLogs.slice(0, 10);
}

function buildFocusTrend(logs: PomodoroLog[], days: FocusTrendRange): FocusTrend {
  const today = startOfDay(new Date());
  const start = addDays(today, -(days - 1));
  const minutesByDay = logs.reduce<Record<string, number>>((acc, log) => {
    if (log.mode !== "focus") return acc;

    const completedAt = startOfDay(new Date(log.completedAt));
    if (completedAt.getTime() < start.getTime() || completedAt.getTime() > today.getTime()) return acc;

    const key = dateKey(completedAt);
    acc[key] = (acc[key] ?? 0) + log.minutes;
    return acc;
  }, {});
  const points = Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const minutes = minutesByDay[dateKey(date)] ?? 0;

    return {
      date,
      minutes,
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      shortLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  });
  const totalMinutes = points.reduce((sum, point) => sum + point.minutes, 0);
  const averageMinutes = Math.round(totalMinutes / days);
  const maxLoggedMinutes = Math.max(...points.map((point) => point.minutes), averageMinutes);
  const maxMinutes = Math.max(25, Math.ceil(maxLoggedMinutes / 25) * 25);

  return { averageMinutes, days, maxMinutes, points, totalMinutes };
}

function FocusMinutesChart({ mode, trend }: { mode: FocusTrendMode; trend: FocusTrend }) {
  let runningTotal = 0;
  const chartPoints = trend.points.map((point) => {
    runningTotal += point.minutes;
    return {
      ...point,
      value: mode === "cumulative" ? runningTotal : point.minutes,
    };
  });
  const averageValue = Math.round(chartPoints.reduce((sum, point) => sum + point.value, 0) / Math.max(1, chartPoints.length));
  const maxValue = Math.max(...chartPoints.map((point) => point.value), averageValue);
  const maxY = Math.max(25, Math.ceil(maxValue / 25) * 25);
  const xForIndex = (index: number) => (index / Math.max(1, trend.points.length - 1)) * 100;
  const yForValue = (value: number) => 92 - (value / maxY) * 84;
  const linePoints = chartPoints.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(" ");
  const averageY = yForValue(averageValue);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => Math.round(maxY * ratio));
  const labelIndexes = getTrendLabelIndexes(trend.days);
  const labelIndexSet = new Set(labelIndexes);
  const visibleChartPoints = chartPoints.filter((_, index) => labelIndexSet.has(index));
  const hasFocusMinutes = trend.totalMinutes > 0;

  return (
    <div className="mt-6">
      <div className="grid grid-cols-[3rem_1fr] gap-3">
        <div className="relative h-64">
          {yTicks.map((minutes, index) => (
            minutes === averageValue ? null : (
              <span
                key={`${minutes}-${index}`}
                className="absolute right-0 -translate-y-1/2 text-xs font-medium text-stone-500"
                style={{ top: `${yForValue(minutes)}%` }}
              >
                {minutes}
              </span>
            )
          ))}
          <span
            className="absolute right-0 -translate-y-1/2 text-xs font-semibold leading-tight text-orange-500"
            style={{ top: `${averageY}%` }}
          >
            {averageValue}
          </span>
        </div>
        <div>
          <div className="relative h-64">
            <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${focusTrendModeLabels[mode]} Focused Minutes Over The Last ${trend.days} Days`}>
              {yTicks.map((minutes, index) => {
                const y = yForValue(minutes);
                return <polyline key={`${minutes}-${index}`} points={`0,${y} 100,${y}`} fill="none" stroke="#e7e5e4" strokeWidth="0.45" vectorEffect="non-scaling-stroke" />;
              })}
              <polyline
                points={`0,${averageY} 100,${averageY}`}
                fill="none"
                stroke="#f97316"
                strokeDasharray="5 5"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <polyline points={linePoints} fill="none" stroke="#0d9488" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            {visibleChartPoints.map((point, pointIndex) => {
              const sourceIndex = labelIndexes[pointIndex];
              const x = xForIndex(sourceIndex);
              const y = yForValue(point.value);

              return (
                <Fragment key={`${point.label}-point`}>
                  <span
                    className="pointer-events-none absolute h-2 w-2 rounded-full border-2 border-teal-700 bg-white shadow-sm"
                    style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                  />
                  <span
                    className={`pointer-events-none absolute -translate-y-[calc(100%+0.45rem)] rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 shadow-sm ring-1 ring-teal-100 ${
                      sourceIndex === 0 ? "translate-x-0" : sourceIndex === trend.points.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
                    }`}
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    {point.value}
                  </span>
                </Fragment>
              );
            })}
          </div>
          <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${labelIndexes.length}, minmax(0, 1fr))` }}>
            {visibleChartPoints.map((point) => (
              <p key={`${point.label}-label`} className="text-center text-[10px] font-medium text-stone-500">
                {point.shortLabel}
              </p>
            ))}
          </div>
        </div>
      </div>

      {!hasFocusMinutes ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm font-medium text-stone-600">
          No Focused Minutes Logged In This Range Yet.
        </p>
      ) : null}
    </div>
  );
}

function FocusTrendSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-[3rem_1fr] gap-3">
      <div className="h-64" />
      <div className="h-64 rounded-lg border border-dashed border-stone-300 bg-stone-50" />
    </div>
  );
}

function getTrendLabelIndexes(days: FocusTrendRange) {
  const count = days === 7 ? 7 : 10;
  const lastIndex = days - 1;
  const indexes = Array.from({ length: count }, (_, index) => Math.round((index / Math.max(1, count - 1)) * lastIndex));
  return Array.from(new Set(indexes));
}

function HeroMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/80 p-4 shadow-sm backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-stone-950">{value}</p>
      <p className="mt-1 text-sm text-stone-500">{detail}</p>
    </div>
  );
}

function TimingMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-950">{value}</p>
      <p className="text-xs text-stone-500">{detail}</p>
    </div>
  );
}

function ProjectSelect({
  label,
  onChange,
  projects,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  projects: Project[];
  value: string;
}) {
  return (
    <label className="block text-sm font-medium text-stone-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
      >
        <option value="">None</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PresetMinutePicker({ label, onChange, options, value }: { label: string; onChange: (value: number) => void; options: number[]; value: number }) {
  return (
    <div>
      <p className="text-sm font-medium text-stone-700">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={`grid h-11 w-11 place-items-center rounded-full border text-sm font-semibold tabular-nums transition ${
              value === option ? "border-teal-600 bg-teal-600 text-white shadow-sm" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="block text-sm font-medium text-stone-700">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        className="mt-2 w-full rounded-md border border-stone-300 px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
      />
    </label>
  );
}

function RangeInput({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix: string;
  value: number;
}) {
  return (
    <label className="block text-sm font-medium text-stone-700">
      <span className="flex items-center justify-between gap-3">
        {label}
        <span className="font-semibold text-stone-950">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-4 w-full accent-teal-600"
      />
    </label>
  );
}

function LogMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white p-2">
      <p className="text-[11px] font-medium text-stone-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function heatClass(count: number) {
  if (count >= 4) return "bg-teal-700";
  if (count === 3) return "bg-teal-500";
  if (count === 2) return "bg-teal-300";
  if (count === 1) return "bg-teal-100";
  return "bg-stone-100";
}

function isMissingDetails(log: PomodoroLog) {
  return !log.done || !isNumber(log.energy) || !isNumber(log.focus);
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function toDateTimeLocal(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function isToday(date: Date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getAverage(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSelectedProjectIds(fixedProjectId: string, continuousProjectId: string) {
  return [fixedProjectId, continuousProjectId].filter(Boolean);
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

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor(Math.abs(startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

function dateKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function getCurrentStreak(logs: PomodoroLog[]) {
  const activeDays = new Set(logs.map((log) => dateKey(new Date(log.completedAt))));
  let cursor = startOfDay(new Date());
  let streak = 0;

  while (activeDays.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}
