export const workDayStartHour = 3;

export function startOfCalendarDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

export function addCalendarDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function getWorkDayDate(date: Date) {
  const shiftedDate = new Date(date);
  shiftedDate.setHours(shiftedDate.getHours() - workDayStartHour);
  return startOfCalendarDay(shiftedDate);
}

export function getSessionWorkDayDate(session: { startAt?: string | null; started_at?: string | null; completedAt?: string | null; completed_at?: string | null }) {
  const anchorDate = session.startAt ?? session.started_at ?? session.completedAt ?? session.completed_at;
  return getWorkDayDate(anchorDate ? new Date(anchorDate) : new Date());
}

export function isCurrentWorkDay(date: Date) {
  return dateKey(getWorkDayDate(date)) === dateKey(getWorkDayDate(new Date()));
}

export function workDaysBetween(a: Date, b: Date) {
  return Math.floor(Math.abs(getWorkDayDate(b).getTime() - getWorkDayDate(a).getTime()) / 86_400_000);
}

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
