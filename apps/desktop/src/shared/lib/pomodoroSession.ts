export type PersistedPomodoroSession = {
  id: string;
  mode: "focus" | "short" | "long";
  durationSeconds: number;
  startedAt: string;
  endsAt: string | null;
  state: "running" | "paused";
  pausedRemainingSeconds: number | null;
  note: string;
  fixedProjectId: string;
  continuousProjectId: string;
};

export type PendingPomodoroCompletion = {
  id: string;
  mode: "focus" | "short" | "long";
  durationSeconds: number;
  startedAt: string;
  completedAt: string;
  note: string;
  fixedProjectId: string;
  continuousProjectId: string;
};

export const activePomodoroSessionKey = "personal-project-manager:active-pomodoro-session";
export const pendingPomodoroCompletionKey = "personal-project-manager:pending-pomodoro-completion";
export const pomodoroSessionCompletedEvent = "personal-project-manager:pomodoro-session-completed";
export const pomodoroSessionUpdatedEvent = "personal-project-manager:pomodoro-session-updated";

export function getActivePomodoroSessionKey() {
  return getScopedStorageKey(activePomodoroSessionKey);
}

export function getPendingPomodoroCompletionKey() {
  return getScopedStorageKey(pendingPomodoroCompletionKey);
}

export function readActivePomodoroSession() {
  return readPomodoroValue<PersistedPomodoroSession>(getActivePomodoroSessionKey());
}

export function readPendingPomodoroCompletion() {
  return readPomodoroValue<PendingPomodoroCompletion>(getPendingPomodoroCompletionKey());
}

export function announcePomodoroSessionUpdate() {
  window.dispatchEvent(new Event(pomodoroSessionUpdatedEvent));
}

export function announcePomodoroCompletion(completion: PendingPomodoroCompletion) {
  window.dispatchEvent(new CustomEvent<PendingPomodoroCompletion>(pomodoroSessionCompletedEvent, { detail: completion }));
}

export async function requestPomodoroNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;

  try {
    await Notification.requestPermission();
  } catch {
    // Permission prompts are browser-managed and may be unavailable in some contexts.
  }
}

export function showPomodoroBrowserNotification(completion: PendingPomodoroCompletion) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const minutes = Math.max(1, Math.round(completion.durationSeconds / 60));
  const notification = new Notification("Pomodoro session complete", {
    body: `${minutes} minutes are ready to log.`,
    tag: `pomodoro-session-${completion.id}`,
  });

  notification.onclick = () => {
    window.focus();
    window.location.assign("/pomodoro");
    notification.close();
  };
}

function readPomodoroValue<T>(key: string) {
  const savedValue = window.localStorage.getItem(key);
  if (!savedValue) return null;

  try {
    return JSON.parse(savedValue) as T;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}
import { getScopedStorageKey } from "@/lib/auth";
