import { getScopedStorageKey } from "@/lib/auth";
import { addCalendarDays, getSessionWorkDayDate, getWorkDayDate, isCurrentWorkDay } from "@/lib/workDay";

export type FocusMetricLog = {
  id: string;
  completedAt: string;
  startAt?: string;
  minutes: number;
  mode: "focus" | "short" | "long";
  focus?: number | null;
};

export const pomodoroLogsStorageKey = "personal-project-manager:pomodoro-logs";

export function readStoredPomodoroLogs(): FocusMetricLog[] {
  if (typeof window === "undefined") return [];

  const savedLogs = window.localStorage.getItem(getScopedStorageKey(pomodoroLogsStorageKey));
  if (!savedLogs) return [];

  try {
    return normalizeStoredPomodoroLogs(JSON.parse(savedLogs));
  } catch {
    return [];
  }
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

function normalizeStoredPomodoroLogs(value: unknown): FocusMetricLog[] {
  if (!Array.isArray(value)) return [];

  return value.filter((log): log is FocusMetricLog => (
    Boolean(log)
    && typeof log === "object"
    && "id" in log
    && "completedAt" in log
    && "minutes" in log
    && "mode" in log
  ));
}

function getDefaultFocusPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clamp(value, 0, 100)
    : 80;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
