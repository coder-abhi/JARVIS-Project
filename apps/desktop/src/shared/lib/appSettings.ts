import { getScopedStorageKey } from "@/lib/auth";
import type { ProjectType, TaskPriority, TaskStatus } from "@/lib/api";

export type ProjectBehaviorSettings = {
  defaultProjectType: ProjectType;
  defaultTaskPriority: TaskPriority;
  defaultTaskStatus: Exclude<TaskStatus, "done">;
  defaultTaskMinutes: number;
};

export const defaultProjectBehaviorSettings: ProjectBehaviorSettings = {
  defaultProjectType: "fixed",
  defaultTaskPriority: "medium",
  defaultTaskStatus: "todo",
  defaultTaskMinutes: 60,
};

const storageKey = "jarvis:project-behavior-settings";

export function readProjectBehaviorSettings(): ProjectBehaviorSettings {
  if (typeof window === "undefined") return defaultProjectBehaviorSettings;
  const saved = window.localStorage.getItem(getScopedStorageKey(storageKey));
  if (!saved) return defaultProjectBehaviorSettings;

  try {
    const value = JSON.parse(saved) as Partial<ProjectBehaviorSettings>;
    return {
      defaultProjectType: value.defaultProjectType === "continuous" ? "continuous" : "fixed",
      defaultTaskPriority:
        value.defaultTaskPriority === "high" || value.defaultTaskPriority === "low"
          ? value.defaultTaskPriority
          : "medium",
      defaultTaskStatus: value.defaultTaskStatus === "in_progress" ? "in_progress" : "todo",
      defaultTaskMinutes: clampMinutes(value.defaultTaskMinutes),
    };
  } catch {
    return defaultProjectBehaviorSettings;
  }
}

export function saveProjectBehaviorSettings(settings: ProjectBehaviorSettings) {
  window.localStorage.setItem(
    getScopedStorageKey(storageKey),
    JSON.stringify({ ...settings, defaultTaskMinutes: clampMinutes(settings.defaultTaskMinutes) }),
  );
}

function clampMinutes(value: unknown) {
  const minutes = Math.round(Number(value) || defaultProjectBehaviorSettings.defaultTaskMinutes);
  return Math.min(Math.max(minutes, 5), 480);
}
