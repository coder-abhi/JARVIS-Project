import { dateKey, getSessionWorkDayDate, getWorkDayDate } from "../../shared/lib/workDay.ts";

export type AutoTimingLog = {
  completedAt: string;
  startAt?: string;
  mode: "focus" | "short" | "long";
  isManual?: boolean;
};

const dailyOpeningFocusMinutes = [15, 20] as const;

export function getAutoFocusMinutes(
  logs: AutoTimingLog[],
  momentumFocusMinutes: number,
  now = new Date(),
) {
  const currentWorkDay = dateKey(getWorkDayDate(now));
  const completedFocusTimersToday = logs.filter(
    (log) =>
      log.mode === "focus"
      && !log.isManual
      && dateKey(getSessionWorkDayDate(log)) === currentWorkDay,
  ).length;

  return dailyOpeningFocusMinutes[completedFocusTimersToday] ?? momentumFocusMinutes;
}
