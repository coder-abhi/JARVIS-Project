import { getScopedStorageKey } from "@/lib/auth";

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
const completionSoundPath = "/Level_Complete_Theme.mp3";
const completionNotificationIconPath = "/pomodoro-notification.svg";
const completionSoundVolume = 0.65;

let completionSound: HTMLAudioElement | null = null;

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

export function playPomodoroCompletionSound() {
  const audio = getCompletionSound();
  if (!audio) return;

  audio.pause();
  audio.loop = false;
  audio.currentTime = 0;
  audio.volume = completionSoundVolume;
  void audio.play().catch(() => {
    // Browsers may block sound if the page has not had a user gesture yet.
  });
}

export function showPomodoroBrowserNotification(completion: PendingPomodoroCompletion) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const minutes = Math.max(1, Math.round(completion.durationSeconds / 60));
  const modeLabel = completion.mode === "focus" ? "Focus sprint" : completion.mode === "short" ? "Short break" : "Long break";
  const completedAt = new Date(completion.completedAt);
  const timeLabel = completedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const notification = new Notification(`${modeLabel} complete`, {
    body: `${minutes} min wrapped at ${timeLabel}. Open Jarvis to capture the result.`,
    badge: completionNotificationIconPath,
    icon: completionNotificationIconPath,
    tag: `pomodoro-session-${completion.id}`,
    requireInteraction: true,
    silent: true,
  });

  notification.onclick = () => {
    window.focus();
    if (window.location.pathname !== "/pomodoro") {
      window.location.assign("/pomodoro");
    }
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

function getCompletionSound() {
  if (!("Audio" in window)) return null;
  completionSound ??= new Audio(completionSoundPath);
  completionSound.loop = false;
  completionSound.preload = "auto";
  completionSound.volume = completionSoundVolume;
  return completionSound;
}
