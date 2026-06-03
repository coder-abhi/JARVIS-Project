"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  completeGoalTask,
  createGoal,
  getGoalNextActions,
  getGoalsOverview,
  logGoalEntry,
  refreshPersonalityInsight,
  restoreCompletedGoal,
  updateGoal,
  type Goal,
  type GoalCategory,
  type GoalNextAction,
  type GoalTask,
  type GoalsOverview,
  type PersonalityInsight,
} from "@/lib/api";

const categoryLabels: Record<GoalCategory, string> = {
  monthly: "Monthly Mission Plan",
  quarterly: "Quarterly Campaign",
  yearly: "Yearly Theater",
  five_year: "5-Year Doctrine",
};

const categoryOrder: GoalCategory[] = ["monthly", "quarterly", "yearly", "five_year"];
type SortMode = "importance" | "time" | "goal";

export default function GoalsPage() {
  const [overview, setOverview] = useState<GoalsOverview | null>(null);
  const [nextActions, setNextActions] = useState<GoalNextAction[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("importance");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", target: "", current: "", unit: "" });
  const [logText, setLogText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLogging, setIsLogging] = useState(false);
  const [isRefreshingNextActions, setIsRefreshingNextActions] = useState(false);
  const [isRefreshingPersonality, setIsRefreshingPersonality] = useState(false);
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [creatingGoalCategory, setCreatingGoalCategory] = useState<GoalCategory | null>(null);
  const [restoringCompletionId, setRestoringCompletionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadGoals() {
    setError(null);
    const data = await getGoalsOverview();
    setOverview(data);
  }

  async function loadNextActions() {
    const actions = await getGoalNextActions();
    setNextActions(actions);
  }

  useEffect(() => {
    Promise.all([loadGoals(), loadNextActions()])
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  const sortedTasks = useMemo(() => {
    const tasks = [...(overview?.active_tasks ?? [])];
    if (sortMode === "time") {
      return tasks.sort((a, b) => a.time_required_minutes - b.time_required_minutes);
    }
    if (sortMode === "goal") {
      return tasks.sort((a, b) => goalSortLabel(a).localeCompare(goalSortLabel(b)) || b.importance_rating - a.importance_rating);
    }
    return tasks.sort((a, b) => b.importance_rating - a.importance_rating || a.time_required_minutes - b.time_required_minutes);
  }, [overview?.active_tasks, sortMode]);

  const goalsByCategory = useMemo(() => {
    const grouped: Record<GoalCategory, Goal[]> = {
      monthly: [],
      quarterly: [],
      yearly: [],
      five_year: [],
    };
    for (const goal of overview?.goals ?? []) {
      grouped[goal.category].push(goal);
    }
    return grouped;
  }, [overview?.goals]);

  function beginEdit(goal: Goal) {
    setEditingGoalId(goal.id);
    setEditDraft({
      title: goal.title,
      target: goal.target_value == null ? "" : String(goal.target_value),
      current: String(goal.current_value ?? 0),
      unit: goal.unit ?? "",
    });
  }

  async function saveGoal(goalId: string) {
    if (!editDraft.title.trim()) return;
    setSavingGoalId(goalId);
    setError(null);
    try {
      await updateGoal(goalId, {
        title: editDraft.title.trim(),
        target_value: editDraft.target.trim() ? Number(editDraft.target) : null,
        current_value: Number(editDraft.current) || 0,
        unit: editDraft.unit.trim() || null,
      });
      setEditingGoalId(null);
      setMessage("Goal updated.");
      await loadGoals();
      await loadNextActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal");
    } finally {
      setSavingGoalId(null);
    }
  }

  async function handleCreateGoal(category: GoalCategory) {
    setCreatingGoalCategory(category);
    setError(null);
    try {
      const goal = await createGoal({
        category,
        title: `New ${categoryLabels[category].toLowerCase()}`,
        target_value: null,
        current_value: 0,
        unit: null,
      });
      setEditingGoalId(goal.id);
      setEditDraft({ title: goal.title, target: "", current: "0", unit: "" });
      setMessage("Goal added.");
      await loadGoals();
      await loadNextActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add goal");
    } finally {
      setCreatingGoalCategory(null);
    }
  }

  async function handleCompleteTask(task: GoalTask) {
    setCompletingTaskId(task.id);
    setError(null);
    try {
      await completeGoalTask(task.id);
      setMessage("Task logged as complete.");
      await loadGoals();
      await loadNextActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete task");
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleRestoreCompletion(completionId: string) {
    setRestoringCompletionId(completionId);
    setError(null);
    try {
      await restoreCompletedGoal(completionId);
      setMessage("Moved back to the task list.");
      await loadGoals();
      await loadNextActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore completed task");
    } finally {
      setRestoringCompletionId(null);
    }
  }

  async function handleLogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = logText.trim();
    if (!trimmed || isLogging) return;
    if (!trimmed.startsWith("+") && !trimmed.startsWith("-")) {
      setError("Start the log with + for a new task or - for a completed task.");
      return;
    }

    setIsLogging(true);
    setError(null);
    setMessage(null);
    try {
      const response = await logGoalEntry(trimmed);
      setLogText("");
      setMessage(response.mode === "created_task" ? `Added task: ${response.corrected_text}` : `Logged completion: ${response.corrected_text}`);
      await loadGoals();
      await loadNextActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log entry");
    } finally {
      setIsLogging(false);
    }
  }

  async function handleRefreshPersonality() {
    setIsRefreshingPersonality(true);
    setError(null);
    try {
      const insight = await refreshPersonalityInsight();
      setOverview((current) => (current ? { ...current, personality_insight: insight } : current));
      setMessage("Personality insight refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh personality insight");
    } finally {
      setIsRefreshingPersonality(false);
    }
  }

  async function handleRefreshNextActions() {
    setIsRefreshingNextActions(true);
    setError(null);
    try {
      await loadNextActions();
      setMessage("AI next goals refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh AI next goals");
    } finally {
      setIsRefreshingNextActions(false);
    }
  }

  return (
    <main className="ops-screen pb-36">
      <section className="ops-header">
        <div>
          <p className="ops-kicker">MISSION CONTROL</p>
          <h1>Mission Control</h1>
          <p className="ops-subtitle">Mission queue, campaign planning horizons, AI assessment, and execution profile.</p>
        </div>
        <div className="ops-mini-metrics">
          <Metric label="Open Tasks" value={overview?.active_tasks.length ?? 0} />
          <Metric label="Missions" value={overview?.goals.length ?? 0} />
          <Metric label="Completed" value={overview?.recent_completed_tasks.length ?? 0} />
        </div>
      </section>

      <div className="ops-grid">
        {error ? <p className="ops-alert danger span-12">{error}</p> : null}
        {message ? <p className="ops-alert signal span-12">{message}</p> : null}

        <section className="ops-panel span-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="ops-kicker">MISSION QUEUE</p>
              <h2 className="mt-1 text-lg font-semibold">Active Objectives</h2>
            </div>
            <div className="ops-segment">
              <SortButton active={sortMode === "importance"} onClick={() => setSortMode("importance")} label="Importance" />
              <SortButton active={sortMode === "time"} onClick={() => setSortMode("time")} label="Time" />
              <SortButton active={sortMode === "goal"} onClick={() => setSortMode("goal")} label="Mission" />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-md border border-stone-200 bg-white">
            {isLoading ? (
              [0, 1, 2].map((item) => <div key={item} className="h-10 animate-pulse border-b border-stone-100 bg-stone-50 last:border-b-0" />)
            ) : sortedTasks.length ? (
              <>
                <div className="hidden grid-cols-[32px_minmax(0,1fr)_72px_92px_minmax(120px,0.75fr)_minmax(100px,0.7fr)] gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 md:grid">
                  <span />
                  <span>Task</span>
                  <span>Time</span>
                  <span>Importance</span>
                  <span>Mission</span>
                  <span>Project</span>
                </div>
                {sortedTasks.map((task) => (
                  <div key={task.id} className="grid gap-1 border-b border-stone-100 px-3 py-2 text-xs transition last:border-b-0 hover:bg-teal-50/35 md:grid-cols-[32px_minmax(0,1fr)_72px_92px_minmax(120px,0.75fr)_minmax(100px,0.7fr)] md:items-center md:gap-3">
                    <input
                      type="checkbox"
                      disabled={completingTaskId === task.id}
                      onChange={() => handleCompleteTask(task)}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-teal-600"
                      aria-label={`Mark ${task.title} complete`}
                    />
                    <p className="min-w-0 truncate font-semibold text-stone-950">{task.title}</p>
                    <span className="text-stone-600">{task.time_required_minutes || 0} min</span>
                    <span className="font-semibold text-teal-800">{task.importance_rating}/5</span>
                    <span className="min-w-0 truncate text-amber-800">{task.goal_title ?? "General Mission"}</span>
                    <span className="min-w-0 truncate text-stone-500">{task.project_name}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="bg-stone-50 p-5 text-center">
                <h3 className="text-sm font-semibold text-stone-950">No active objectives</h3>
                <p className="mt-1 text-xs text-stone-600">Use the fixed logger below with a + prefix to add one.</p>
              </div>
            )}
          </div>
        </section>

        <section className="span-4 grid gap-4">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>AI Mission Analysis</h2>
              <span>leverage / conflict / risk</span>
            </div>
            <MissionAnalysis actions={nextActions} openTasks={overview?.active_tasks.length ?? 0} overdueTasks={0} />
            <button
              type="button"
              onClick={handleRefreshNextActions}
              disabled={isRefreshingNextActions}
              className="ops-button primary mt-4 w-full"
            >
              {isRefreshingNextActions ? "Refreshing..." : "Refresh Analysis"}
            </button>
          </div>

          <PersonalityPanel
            insight={overview?.personality_insight ?? null}
            isRefreshing={isRefreshingPersonality}
            onRefresh={handleRefreshPersonality}
          />
        </section>

        <section className="span-12 grid gap-4 md:grid-cols-2">
          {categoryOrder.map((category) => (
            <GoalCategorySection
              key={category}
              category={category}
              goals={goalsByCategory[category]}
              editingGoalId={editingGoalId}
              draft={editDraft}
              savingGoalId={savingGoalId}
              isCreating={creatingGoalCategory === category}
              onCreate={() => handleCreateGoal(category)}
              onBeginEdit={beginEdit}
              onDraftChange={setEditDraft}
              onSave={saveGoal}
              onCancel={() => setEditingGoalId(null)}
            />
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr] span-12">
          <div className="ops-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="ops-kicker">RECOMMENDED NEXT ACTIONS</p>
                <h2 className="mt-1 text-lg font-semibold">AI Mission Orders</h2>
              </div>
              <button
                type="button"
                onClick={handleRefreshNextActions}
                disabled={isRefreshingNextActions}
                className="rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:bg-stone-300"
              >
                {isRefreshingNextActions ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {nextActions.length ? (
                nextActions.map((action, index) => (
                  <div key={`${action.title}-${index}`} className="rounded-lg border border-stone-200 bg-white p-3">
                    <p className="text-sm font-semibold leading-5 text-stone-950">{action.title}</p>
                    <p className="mt-1 text-xs text-stone-600">{action.related_goal}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-800">Importance {action.importance}/5</span>
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">Urgency {action.urgency}/5</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">Suggestions will appear after your goals load.</p>
              )}
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <h2>Execution Patterns</h2>
              <span>strengths / weaknesses</span>
            </div>
            <div className="system-metrics">
              <div className="system-metric signal"><span>Strength</span><strong>Prioritization</strong></div>
              <div className="system-metric"><span>Weakness</span><strong>Context Switching</strong></div>
              <div className="system-metric"><span>Pattern</span><strong>{sortedTasks.length ? "Action-biased" : "Planning mode"}</strong></div>
              <div className="system-metric"><span>Next Move</span><strong>{nextActions[0]?.title ?? "Log next objective"}</strong></div>
            </div>
          </div>
        </section>

        <section className="ops-panel span-12">
          <p className="ops-kicker">RECENTLY COMPLETED OBJECTIVES</p>
          <h2 className="mt-1 text-lg font-semibold">Mission Completion Log</h2>
          <div className="mt-4 overflow-hidden rounded-md border border-stone-200 bg-white">
            {(overview?.recent_completed_tasks ?? []).length ? (
              <>
                <div className="hidden grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.65fr)_128px] gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 md:grid">
                  <span />
                  <span>Task</span>
                  <span>Mission</span>
                  <span>Completed</span>
                </div>
                {overview?.recent_completed_tasks.map((item) => (
                  <div key={item.id} className="grid gap-1 border-b border-stone-100 px-3 py-2 text-xs transition last:border-b-0 hover:bg-teal-50/35 md:grid-cols-[32px_minmax(0,1fr)_minmax(120px,0.65fr)_128px] md:items-center md:gap-3">
                    <input
                      type="checkbox"
                      checked={restoringCompletionId !== item.id}
                      disabled={restoringCompletionId === item.id}
                      onChange={(event) => {
                        if (!event.target.checked) handleRestoreCompletion(item.id);
                      }}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-teal-600"
                      aria-label={`Move ${item.title} back to task list`}
                    />
                    <p className="min-w-0 truncate font-semibold text-stone-950">{item.title}</p>
                    <span className="min-w-0 truncate text-amber-800">{item.goal_label}</span>
                    <span className="text-stone-500">{formatDate(item.created_at)}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="bg-stone-50 p-3 text-xs text-stone-600">No completed work logged yet. Use a - prefix below when you finish something.</p>
            )}
          </div>
        </section>
      </div>

      <form onSubmit={handleLogSubmit} className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-[#f4f6f3]/95 px-4 py-2.5 shadow-2xl shadow-stone-950/20 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 shadow-lg shadow-stone-900/10">
          <input
            value={logText}
            onChange={(event) => setLogText(event.target.value)}
            placeholder="+ Add objective or - log completed objective"
            className="min-h-9 flex-1 rounded-full border-0 px-3 text-xs outline-none"
          />
          <button
            type="submit"
            disabled={isLogging || !logText.trim()}
            className="grid h-9 w-9 place-items-center rounded-full bg-teal-600 text-base text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            aria-label="Send log"
            title="Send log"
          >
            Go
          </button>
        </div>
      </form>
    </main>
  );
}

function GoalCategorySection({
  category,
  goals,
  editingGoalId,
  draft,
  savingGoalId,
  isCreating,
  onCreate,
  onBeginEdit,
  onDraftChange,
  onSave,
  onCancel,
}: {
  category: GoalCategory;
  goals: Goal[];
  editingGoalId: string | null;
  draft: { title: string; target: string; current: string; unit: string };
  savingGoalId: string | null;
  isCreating: boolean;
  onCreate: () => void;
  onBeginEdit: (goal: Goal) => void;
  onDraftChange: (draft: { title: string; target: string; current: string; unit: string }) => void;
  onSave: (goalId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="ops-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="ops-kicker">{categoryLabels[category]}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded border border-stone-200 bg-teal-50 text-xs font-semibold text-teal-800">
            {goals.length}
          </span>
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-teal-300 hover:text-teal-800 disabled:cursor-not-allowed disabled:text-stone-300"
          >
            {isCreating ? "Adding..." : "Add Mission"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {goals.length ? (
          goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              isEditing={editingGoalId === goal.id}
              draft={draft}
              isSaving={savingGoalId === goal.id}
              onBeginEdit={() => onBeginEdit(goal)}
              onDraftChange={onDraftChange}
              onSave={() => onSave(goal.id)}
              onCancel={onCancel}
            />
          ))
        ) : (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-left text-xs font-semibold text-stone-600 transition hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-800"
          >
            Initialize first {categoryLabels[category].toLowerCase()}.
          </button>
        )}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  isEditing,
  draft,
  isSaving,
  onBeginEdit,
  onDraftChange,
  onSave,
  onCancel,
}: {
  goal: Goal;
  isEditing: boolean;
  draft: { title: string; target: string; current: string; unit: string };
  isSaving: boolean;
  onBeginEdit: () => void;
  onDraftChange: (draft: { title: string; target: string; current: string; unit: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <div className="rounded-lg border border-teal-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2">
          <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} className="field-input py-2 text-xs" autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" step="0.25" placeholder="Target" value={draft.target} onChange={(event) => onDraftChange({ ...draft, target: event.target.value })} className="field-input py-2 text-xs" />
            <input type="number" min="0" step="0.25" placeholder="Current" value={draft.current} onChange={(event) => onDraftChange({ ...draft, current: event.target.value })} className="field-input py-2 text-xs" />
          </div>
          <input value={draft.unit} placeholder="Unit" onChange={(event) => onDraftChange({ ...draft, unit: event.target.value })} className="field-input py-2 text-xs" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50">
              Cancel
            </button>
            <button type="button" onClick={onSave} disabled={isSaving} className="rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:bg-stone-300">
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={onBeginEdit} className="rounded-lg border border-stone-200 bg-white p-3 text-left transition hover:border-teal-200 hover:bg-teal-50/30">
      <h3 className="text-sm font-semibold leading-5 text-stone-950">{goal.title}</h3>
      {goal.measurable && goal.progress_percentage != null ? (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] font-semibold text-stone-500">
            <span>
              {formatNumber(goal.current_value)} / {formatNumber(goal.target_value ?? 0)} {goal.unit}
            </span>
            <span>{goal.progress_percentage}%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-stone-100">
            <div className="h-1.5 rounded-full bg-gradient-to-r from-teal-500 to-lime-500" style={{ width: `${goal.progress_percentage}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-stone-500">Click to edit or add measurable mission telemetry.</p>
      )}
    </button>
  );
}

function PersonalityPanel({
  insight,
  isRefreshing,
  onRefresh,
}: {
  insight: PersonalityInsight | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="ops-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ops-kicker">PERSONALITY ANALYSIS</p>
          <h2 className="mt-1 text-lg font-semibold">Execution profile</h2>
        </div>
        <button type="button" onClick={onRefresh} disabled={isRefreshing} className="rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:bg-stone-300">
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="mt-4 text-xs leading-5 text-stone-700">
        {insight?.text ?? "No personality analysis yet. Refresh to analyze strengths, weaknesses, and execution patterns from missions and completions."}
      </p>
      {insight?.refreshed_at ? <p className="mt-3 text-[11px] font-semibold text-stone-400">Last refreshed {formatDate(insight.refreshed_at)}</p> : null}
    </div>
  );
}

function SortButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`rounded px-3 py-1.5 transition ${active ? "bg-white text-stone-950 shadow-sm" : "hover:bg-white/70 hover:text-stone-950"}`}>
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="system-metric">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function MissionAnalysis({ actions, openTasks, overdueTasks }: { actions: GoalNextAction[]; openTasks: number; overdueTasks: number }) {
  const topAction = actions[0];
  return (
    <div className="analysis-stack">
      <div>
        <span>Highest Leverage Action</span>
        <strong>{topAction?.title ?? "Define next mission-critical action"}</strong>
      </div>
      <div>
        <span>Goal Conflicts</span>
        <strong>{openTasks > 7 ? "Capacity pressure detected" : "No major conflict detected"}</strong>
      </div>
      <div>
        <span>Risk Assessment</span>
        <strong>{overdueTasks > 0 ? "Schedule risk elevated" : openTasks > 0 ? "Operational" : "Idle risk"}</strong>
      </div>
      <div>
        <span>Recommended Next Action</span>
        <strong>{topAction ? `${topAction.related_goal}: urgency ${topAction.urgency}/5` : "Add or complete one objective"}</strong>
      </div>
    </div>
  );
}

function goalSortLabel(task: GoalTask) {
  return task.goal_category ? categoryLabels[task.goal_category] : "General";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
