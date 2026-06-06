import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAiFeatureSettings,
  updateAiFeatureSetting,
  type AiFeatureSetting,
} from "@/lib/api";
import {
  readMissionControlVisibilitySettings,
  readProjectBehaviorSettings,
  saveMissionControlVisibilitySettings,
  saveProjectBehaviorSettings,
  type MissionControlVisibilitySettings,
  type ProjectBehaviorSettings,
} from "@/lib/appSettings";
import { getStoredUser } from "@/lib/auth";
import "./SettingsPage.css";

export default function SettingsPage() {
  const router = useRouter();
  const user = getStoredUser();
  const [behavior, setBehavior] = useState<ProjectBehaviorSettings>(() => readProjectBehaviorSettings());
  const [missionControl, setMissionControl] = useState<MissionControlVisibilitySettings>(
    () => readMissionControlVisibilitySettings(),
  );
  const [features, setFeatures] = useState<AiFeatureSetting[]>([]);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiFeatureSettings()
      .then(setFeatures)
      .catch((err: Error) => setError(err.message));
  }, []);

  function updateBehavior(changes: Partial<ProjectBehaviorSettings>) {
    const next = { ...behavior, ...changes };
    saveProjectBehaviorSettings(next);
    setBehavior(readProjectBehaviorSettings());
    setMessage("Project behavior saved locally for this user.");
  }

  function updateMissionControl(changes: Partial<MissionControlVisibilitySettings>) {
    const next = { ...missionControl, ...changes };
    setMissionControl(next);
    saveMissionControlVisibilitySettings(next);
    setMessage("Mission Control visibility saved locally for this user.");
  }

  async function updateFeature(feature: AiFeatureSetting, changes: { enabled?: boolean; model?: string }) {
    if (savingFeature) return;
    setSavingFeature(feature.feature);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateAiFeatureSetting(feature.feature, changes);
      setFeatures((current) => current.map((item) => (item.feature === updated.feature ? updated : item)));
      setMessage(`${updated.label} settings saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update AI settings");
    } finally {
      setSavingFeature(null);
    }
  }

  return (
    <main className="ops-screen settings-screen">
      <button type="button" onClick={() => router.back()} className="ops-button">
        Back
      </button>

      <header className="ops-header settings-header">
        <div>
          <p className="ops-kicker">USER CONTROL PLANE</p>
          <h1>Settings</h1>
          <p className="ops-subtitle">
            Behavior defaults and AI routing for {user?.username ?? "this account"}.
          </p>
        </div>
        <span className="settings-user-badge">{user?.username ?? "Local user"}</span>
      </header>

      {error ? <p className="ops-alert danger">{error}</p> : null}
      {message ? <p className="ops-alert signal">{message}</p> : null}

      <section className="ops-panel settings-panel">
        <div className="ops-panel-head">
          <h2>Project Behavior</h2>
          <span>Defaults for new work</span>
        </div>
        <div className="settings-form-grid">
          <SettingSelect
            label="Default project type"
            description="Preselect this mission type when opening New Mission."
            value={behavior.defaultProjectType}
            onChange={(value) => updateBehavior({ defaultProjectType: value as ProjectBehaviorSettings["defaultProjectType"] })}
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "continuous", label: "Continuous" },
            ]}
          />
          <SettingSelect
            label="Default task priority"
            description="Applied when a new objective form opens."
            value={behavior.defaultTaskPriority}
            onChange={(value) => updateBehavior({ defaultTaskPriority: value as ProjectBehaviorSettings["defaultTaskPriority"] })}
            options={[
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <SettingSelect
            label="Default task state"
            description="Choose whether new objectives wait in Todo or begin immediately."
            value={behavior.defaultTaskStatus}
            onChange={(value) => updateBehavior({ defaultTaskStatus: value as ProjectBehaviorSettings["defaultTaskStatus"] })}
            options={[
              { value: "todo", label: "Todo" },
              { value: "in_progress", label: "In progress" },
            ]}
          />
          <label className="settings-field">
            <span>Default task estimate</span>
            <small>Minutes prefilled for a new objective, from 5 to 480.</small>
            <input
              type="number"
              min="5"
              max="480"
              step="5"
              value={behavior.defaultTaskMinutes}
              onChange={(event) => {
                setBehavior((current) => ({ ...current, defaultTaskMinutes: Number(event.target.value) }));
              }}
              onBlur={() => updateBehavior({ defaultTaskMinutes: behavior.defaultTaskMinutes })}
            />
          </label>
        </div>
      </section>

      <section className="ops-panel settings-panel">
        <div className="ops-panel-head">
          <h2>Mission Control Sections</h2>
          <span>Show or hide schedule reports</span>
        </div>
        <div className="settings-visibility-list">
          <VisibilityToggle
            label="Week Operations Plan"
            description="The interactive weekly project and objective schedule."
            enabled={missionControl.weekOperationsPlan}
            onChange={(enabled) => updateMissionControl({ weekOperationsPlan: enabled })}
          />
          <VisibilityToggle
            label="Efficiency Report"
            description="Planned versus actual hours and completion rate."
            enabled={missionControl.efficiencyReport}
            onChange={(enabled) => updateMissionControl({ efficiencyReport: enabled })}
          />
          <VisibilityToggle
            label="Time Allocation"
            description="Minutes and percentages allocated across missions."
            enabled={missionControl.timeAllocation}
            onChange={(enabled) => updateMissionControl({ timeAllocation: enabled })}
          />
        </div>
      </section>

      <section className="ops-panel settings-panel">
        <div className="ops-panel-head">
          <h2>AI Call Routing</h2>
          <span>Per-feature model and availability</span>
        </div>
        <p className="settings-panel-copy">
          Disabling a feature keeps its local fallback. Model changes apply to future calls and create a separate cache.
        </p>
        <div className="settings-ai-list">
          {features.map((feature) => {
            const isSaving = savingFeature === feature.feature;
            return (
              <div className={feature.enabled ? "settings-ai-row enabled" : "settings-ai-row"} key={feature.feature}>
                <div className="settings-ai-copy">
                  <strong>{feature.label}</strong>
                  <p>{feature.description}</p>
                </div>
                <select
                  value={feature.model}
                  disabled={Boolean(savingFeature)}
                  aria-label={`Model for ${feature.label}`}
                  onChange={(event) => void updateFeature(feature, { model: event.target.value })}
                >
                  {feature.available_models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.enabled}
                  className={feature.enabled ? "settings-toggle enabled" : "settings-toggle"}
                  disabled={Boolean(savingFeature)}
                  onClick={() => void updateFeature(feature, { enabled: !feature.enabled })}
                >
                  {isSaving ? "Saving" : feature.enabled ? "On" : "Off"}
                </button>
              </div>
            );
          })}
          {!features.length ? <p className="ops-empty">Loading AI controls...</p> : null}
        </div>
      </section>
    </main>
  );
}

function VisibilityToggle({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className={enabled ? "settings-visibility-row enabled" : "settings-visibility-row"}>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className={enabled ? "settings-toggle enabled" : "settings-toggle"}
        onClick={() => onChange(!enabled)}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}

function SettingSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <small>{description}</small>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
