import { getScopedStorageKey } from "@/lib/auth";
import type { ProjectType, TaskPriority, TaskStatus } from "@/lib/api";

export type ProjectBehaviorSettings = {
  defaultProjectType: ProjectType;
  defaultTaskPriority: TaskPriority;
  defaultTaskStatus: Exclude<TaskStatus, "done">;
  defaultTaskMinutes: number;
};

export type MissionControlVisibilitySettings = {
  weekOperationsPlan: boolean;
  efficiencyReport: boolean;
  timeAllocation: boolean;
};

export const defaultProjectBehaviorSettings: ProjectBehaviorSettings = {
  defaultProjectType: "fixed",
  defaultTaskPriority: "medium",
  defaultTaskStatus: "todo",
  defaultTaskMinutes: 60,
};

export const defaultMissionControlVisibilitySettings: MissionControlVisibilitySettings = {
  weekOperationsPlan: true,
  efficiencyReport: true,
  timeAllocation: true,
};

const projectBehaviorStorageKey = "jarvis:project-behavior-settings";
const missionControlStorageKey = "jarvis:mission-control-visibility";
export const appSettingsChangedEvent = "jarvis:app-settings-changed";

export function readProjectBehaviorSettings(): ProjectBehaviorSettings {
  if (typeof window === "undefined") return defaultProjectBehaviorSettings;
  const saved = window.localStorage.getItem(getScopedStorageKey(projectBehaviorStorageKey));
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
    getScopedStorageKey(projectBehaviorStorageKey),
    JSON.stringify({ ...settings, defaultTaskMinutes: clampMinutes(settings.defaultTaskMinutes) }),
  );
  announceSettingsChange();
}

export function readMissionControlVisibilitySettings(): MissionControlVisibilitySettings {
  if (typeof window === "undefined") return defaultMissionControlVisibilitySettings;
  const saved = window.localStorage.getItem(getScopedStorageKey(missionControlStorageKey));
  if (!saved) return defaultMissionControlVisibilitySettings;

  try {
    const value = JSON.parse(saved) as Partial<MissionControlVisibilitySettings>;
    return {
      weekOperationsPlan: value.weekOperationsPlan !== false,
      efficiencyReport: value.efficiencyReport !== false,
      timeAllocation: value.timeAllocation !== false,
    };
  } catch {
    return defaultMissionControlVisibilitySettings;
  }
}

export function saveMissionControlVisibilitySettings(settings: MissionControlVisibilitySettings) {
  window.localStorage.setItem(getScopedStorageKey(missionControlStorageKey), JSON.stringify(settings));
  announceSettingsChange();
}

function clampMinutes(value: unknown) {
  const minutes = Math.round(Number(value) || defaultProjectBehaviorSettings.defaultTaskMinutes);
  return Math.min(Math.max(minutes, 5), 480);
}

function announceSettingsChange() {
  window.dispatchEvent(new Event(appSettingsChangedEvent));
}
