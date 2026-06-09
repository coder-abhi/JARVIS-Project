import {
  getUserPreferences,
  saveUserPreferences,
  type ProjectType,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/api";

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

export const appSettingsChangedEvent = "jarvis:app-settings-changed";
let projectBehaviorSettings = defaultProjectBehaviorSettings;
let missionControlVisibilitySettings = defaultMissionControlVisibilitySettings;

export function readProjectBehaviorSettings(): ProjectBehaviorSettings {
  return projectBehaviorSettings;
}

export function saveProjectBehaviorSettings(settings: ProjectBehaviorSettings) {
  projectBehaviorSettings = normalizeProjectBehavior(settings);
  announceSettingsChange();
  return persistAppSettings();
}

export function readMissionControlVisibilitySettings(): MissionControlVisibilitySettings {
  return missionControlVisibilitySettings;
}

export function saveMissionControlVisibilitySettings(settings: MissionControlVisibilitySettings) {
  missionControlVisibilitySettings = normalizeMissionControl(settings);
  announceSettingsChange();
  return persistAppSettings();
}

export async function hydrateAppSettings() {
  projectBehaviorSettings = defaultProjectBehaviorSettings;
  missionControlVisibilitySettings = defaultMissionControlVisibilitySettings;
  const settings = await getUserPreferences();
  projectBehaviorSettings = normalizeProjectBehavior({
    defaultProjectType: settings.default_project_type,
    defaultTaskPriority: settings.default_task_priority,
    defaultTaskStatus: settings.default_task_status,
    defaultTaskMinutes: settings.default_task_minutes,
  });
  missionControlVisibilitySettings = normalizeMissionControl({
    weekOperationsPlan: settings.show_week_operations_plan,
    efficiencyReport: settings.show_efficiency_report,
    timeAllocation: settings.show_time_allocation,
  });
  announceSettingsChange();
}

function clampMinutes(value: unknown) {
  const minutes = Math.round(Number(value) || defaultProjectBehaviorSettings.defaultTaskMinutes);
  return Math.min(Math.max(minutes, 5), 480);
}

function announceSettingsChange() {
  window.dispatchEvent(new Event(appSettingsChangedEvent));
}

function persistAppSettings() {
  const behavior = readProjectBehaviorSettings();
  const missionControl = readMissionControlVisibilitySettings();
  return saveUserPreferences({
    default_project_type: behavior.defaultProjectType,
    default_task_priority: behavior.defaultTaskPriority,
    default_task_status: behavior.defaultTaskStatus,
    default_task_minutes: behavior.defaultTaskMinutes,
    show_week_operations_plan: missionControl.weekOperationsPlan,
    show_efficiency_report: missionControl.efficiencyReport,
    show_time_allocation: missionControl.timeAllocation,
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
