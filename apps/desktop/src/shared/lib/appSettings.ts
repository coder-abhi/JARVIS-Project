import { getScopedStorageKey } from "@/lib/auth";
import { getUserDocument, saveUserDocument, type ProjectType, type TaskPriority, type TaskStatus } from "@/lib/api";

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
const databaseDocumentKey = "app-settings";
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
  void persistAppSettings().catch(() => undefined);
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
  void persistAppSettings().catch(() => undefined);
}

export async function hydrateAppSettings() {
  const document = await getUserDocument<{
    projectBehavior?: Partial<ProjectBehaviorSettings>;
    missionControl?: Partial<MissionControlVisibilitySettings>;
  }>(databaseDocumentKey);

  if (document.data) {
    const behavior = normalizeProjectBehavior(document.data.projectBehavior);
    const missionControl = normalizeMissionControl(document.data.missionControl);
    window.localStorage.setItem(getScopedStorageKey(projectBehaviorStorageKey), JSON.stringify(behavior));
    window.localStorage.setItem(getScopedStorageKey(missionControlStorageKey), JSON.stringify(missionControl));
    announceSettingsChange();
    return;
  }

  await persistAppSettings();
}

function clampMinutes(value: unknown) {
  const minutes = Math.round(Number(value) || defaultProjectBehaviorSettings.defaultTaskMinutes);
  return Math.min(Math.max(minutes, 5), 480);
}

function announceSettingsChange() {
  window.dispatchEvent(new Event(appSettingsChangedEvent));
}

function persistAppSettings() {
  return saveUserDocument(databaseDocumentKey, {
    projectBehavior: readProjectBehaviorSettings(),
    missionControl: readMissionControlVisibilitySettings(),
  });
}

function normalizeProjectBehavior(value: Partial<ProjectBehaviorSettings> | undefined): ProjectBehaviorSettings {
  return {
    defaultProjectType: value?.defaultProjectType === "continuous" ? "continuous" : "fixed",
    defaultTaskPriority:
      value?.defaultTaskPriority === "high" || value?.defaultTaskPriority === "low"
        ? value.defaultTaskPriority
        : "medium",
    defaultTaskStatus: value?.defaultTaskStatus === "in_progress" ? "in_progress" : "todo",
    defaultTaskMinutes: clampMinutes(value?.defaultTaskMinutes),
  };
}

function normalizeMissionControl(value: Partial<MissionControlVisibilitySettings> | undefined): MissionControlVisibilitySettings {
  return {
    weekOperationsPlan: value?.weekOperationsPlan !== false,
    efficiencyReport: value?.efficiencyReport !== false,
    timeAllocation: value?.timeAllocation !== false,
  };
}
