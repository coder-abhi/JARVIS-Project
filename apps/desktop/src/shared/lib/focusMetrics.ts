import { getPomodoroHistory, savePomodoroHistorySession } from "@/lib/api";
import { getScopedStorageKey } from "@/lib/auth";
import { addCalendarDays, getSessionWorkDayDate, getWorkDayDate, isCurrentWorkDay } from "@/lib/workDay";

export type FocusMetricLog = {
  id: string;
  completedAt: string;
  startAt?: string;
  endAt?: string;
  minutes: number;
  mode: "focus" | "short" | "long";
  focus?: number | null;
};

export type FocusMarathon = {
  startedAt: string;
  endedAt: string;
  minutes: number;
  sessionCount: number;
};

export type FocusMarathonMetrics = {
  mostRecent: FocusMarathon | null;
  longest: FocusMarathon[];
};

export const pomodoroLogsStorageKey = "personal-project-manager:pomodoro-logs";
const marathonBreakLimitMinutes = 10;

export async function loadDurablePomodoroLogs<T extends { id: string }>(normalize: (value: unknown) => T[]) {
  const localLogs = readLocalPomodoroLogs(normalize);
  const remoteLogs = normalize(await getPomodoroHistory<unknown>());
  const merged = mergeLogs(remoteLogs, localLogs);
  if (localLogs.length) {
    await Promise.all(localLogs.map((log) => savePomodoroHistorySession(log)));
  }
  window.localStorage.removeItem(getScopedStorageKey(pomodoroLogsStorageKey));
  return merged;
}

export function getFocusMinutesToday(logs: FocusMetricLog[]) {
  return logs
    .filter((log) => log.mode === "focus" && isCurrentWorkDay(new Date(log.startAt ?? log.completedAt)))
    .reduce((sum, log) => sum + log.minutes, 0);
}

export function getFocusMomentum(logs: FocusMetricLog[], now = new Date()) {
  const today = getWorkDayDate(now);
  const windowStart = addCalendarDays(today, -6);
  const sourceLogs = logs.filter((log) => {
    if (log.mode !== "focus") return false;
    const workDay = getSessionWorkDayDate(log);
    return workDay >= windowStart && workDay <= today;
  });
  const effectiveMinutes = sourceLogs.reduce(
    (sum, log) => sum + log.minutes * (getDefaultFocusPercent(log.focus) / 100),
    0,
  );

  return {
    effectiveMinutes: Math.round(effectiveMinutes),
    momentum: clamp(Math.round((effectiveMinutes / 1200) * 100), 0, 100),
  };
}

export function getFocusMarathonMetrics(logs: FocusMetricLog[]): FocusMarathonMetrics {
  const sessions = logs
    .filter((log) => log.mode === "focus")
    .map(toMarathonSession)
    .filter((session): session is MarathonSession => session !== null)
    .sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt);

  const marathons: MarathonSession[] = [];
  sessions.forEach((session) => {
    const current = marathons[marathons.length - 1];
    if (!current || session.startedAt - current.endedAt > marathonBreakLimitMinutes * 60_000) {
      marathons.push({ ...session });
      return;
    }

    current.endedAt = Math.max(current.endedAt, session.endedAt);
    current.sessionCount += 1;
  });

  const completedMarathons = marathons
    .map<FocusMarathon>((marathon) => ({
      startedAt: new Date(marathon.startedAt).toISOString(),
      endedAt: new Date(marathon.endedAt).toISOString(),
      minutes: Math.max(1, Math.round((marathon.endedAt - marathon.startedAt) / 60_000)),
      sessionCount: marathon.sessionCount,
    }));

  return {
    mostRecent: [...completedMarathons].sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
    )[0] ?? null,
    longest: [...completedMarathons]
      .sort((a, b) => b.minutes - a.minutes || new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
      .slice(0, 5),
  };
}

function readLocalPomodoroLogs<T>(normalize: (value: unknown) => T[]) {
  const savedLogs = window.localStorage.getItem(getScopedStorageKey(pomodoroLogsStorageKey));
  if (!savedLogs) return [];
  try {
    return normalize(JSON.parse(savedLogs));
  } catch {
    return [];
  }
}

function mergeLogs<T extends { id: string }>(remoteLogs: T[], localLogs: T[]) {
  const merged = new Map(remoteLogs.map((log) => [log.id, log]));
  localLogs.forEach((log) => merged.set(log.id, log));
  return [...merged.values()];
}

type MarathonSession = {
  startedAt: number;
  endedAt: number;
  sessionCount: number;
};

function toMarathonSession(log: FocusMetricLog): MarathonSession | null {
  const completedAt = new Date(log.endAt ?? log.completedAt).getTime();
  if (!Number.isFinite(completedAt) || !Number.isFinite(log.minutes) || log.minutes <= 0) return null;

  const savedStartAt = log.startAt ? new Date(log.startAt).getTime() : Number.NaN;
  const startedAt = Number.isFinite(savedStartAt)
    ? savedStartAt
    : completedAt - log.minutes * 60_000;
  const endedAt = Math.max(completedAt, startedAt + log.minutes * 60_000);

  return {
    startedAt,
    endedAt,
    sessionCount: 1,
  };
}

function getDefaultFocusPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clamp(value, 0, 100)
    : 80;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
