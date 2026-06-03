"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { createProject, getProjectSummaries, type ProjectSummary, type ProjectType } from "@/lib/api";

const projectTypes: { value: ProjectType; label: string; description: string }[] = [
  { value: "fixed", label: "Fixed", description: "A scoped project with a clear finish line." },
  { value: "continuous", label: "Continuous", description: "A recurring workflow or ongoing habit." },
];

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("fixed");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setError(null);
    const summaries = await getProjectSummaries();
    setProjects(summaries);
  }

  useEffect(() => {
    loadDashboard()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  const stats = useMemo(
    () => ({
      totalProjects: projects.length,
      totalTasks: projects.reduce((sum, project) => sum + project.total_tasks, 0),
      completedTasks: projects.reduce((sum, project) => sum + project.completed_tasks, 0),
      activeTasks: projects.reduce((sum, project) => sum + project.in_progress_tasks, 0),
      overdueTasks: projects.reduce((sum, project) => sum + project.overdue_tasks, 0),
      fixedRemainingMinutes: Math.round(projects.reduce((sum, project) => (project.type === "fixed" ? sum + project.remaining_hours : sum), 0) * 60),
      spentMinutes: Math.round(projects.reduce((sum, project) => sum + project.time_spent_hours, 0) * 60),
      completedHours: projects.reduce((sum, project) => sum + project.completed_hours, 0),
      remainingHours: projects.reduce((sum, project) => sum + project.remaining_hours, 0),
    }),
    [projects],
  );

  const completionBasis = stats.completedHours + stats.remainingHours;
  const completion = completionBasis === 0 ? 0 : Math.min(Math.round((stats.completedHours / completionBasis) * 100), 100);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isSaving) return;

    try {
      setIsSaving(true);
      setError(null);
      await createProject({ name: name.trim(), type });
      await loadDashboard();
      setName("");
      setType("fixed");
      setIsCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f6f3] text-stone-950">
      <section className="relative border-b border-stone-200">
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_15%_20%,rgba(20,184,166,0.26),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(251,146,60,0.26),transparent_28%),linear-gradient(135deg,#fff8ed_0%,#eefaf7_55%,#f7edf6_100%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-5 pb-8 pt-8 md:grid-cols-[1.2fr_0.8fr] md:px-8 md:pb-12 md:pt-12">
          <div className="flex min-h-[390px] flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/70 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm backdrop-blur">
                Personal Execution Tracker
              </div>
              <h1 className="mt-7 max-w-3xl text-5xl font-semibold leading-tight text-stone-950 md:text-7xl">
                Build momentum across every project.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700">
                A focused command center for deadlines, task load, progress, and the work that needs your attention next.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-stone-900/20 transition hover:-translate-y-0.5 hover:bg-stone-800"
              >
                Add Project
              </button>
              <a
                href="#projects"
                className="rounded-full border border-stone-300 bg-white/70 px-6 py-3 text-sm font-semibold text-stone-800 shadow-sm transition hover:border-stone-400 hover:bg-white"
              >
                View Projects
              </a>
            </div>
          </div>

          <div className="grid content-end gap-4">
            <div className="rounded-lg border border-white/70 bg-white/75 p-5 shadow-xl shadow-stone-900/10 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-stone-500">Execution health</p>
                  <p className="mt-2 text-5xl font-semibold text-stone-950">{completion}%</p>
                </div>
                <span className={stats.overdueTasks > 0 ? "rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800" : "rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800"}>
                  {stats.overdueTasks > 0 ? `${stats.overdueTasks} overdue` : "On track"}
                </span>
              </div>
              <div className="mt-6 h-3 rounded-full bg-stone-100">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-teal-500 via-emerald-500 to-lime-500"
                  style={{ width: `${completion}%` }}
                />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                <HeroMetric label="Projects" value={stats.totalProjects} />
                <HeroMetric label="Tasks" value={stats.totalTasks} />
                <HeroMetric label="Active" value={stats.activeTasks} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-stone-950 p-5 text-white shadow-xl shadow-stone-900/15">
                <p className="text-sm text-stone-300">Fixed Remaining</p>
                <p className="mt-2 text-3xl font-semibold">{stats.fixedRemainingMinutes} min</p>
              </div>
              <div className="rounded-lg bg-teal-600 p-5 text-white shadow-xl shadow-teal-900/15">
                <p className="text-sm text-teal-50">Invested Time</p>
                <p className="mt-2 text-3xl font-semibold">{stats.spentMinutes} min</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="projects" className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Current work</p>
            <h2 className="mt-2 text-3xl font-semibold text-stone-950">Existing projects</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-stone-600">
            Each card rolls up live task data: next active deadline, subtasks, completion, overdue work, and time balance.
          </p>
        </div>

        {error ? <p className="mt-6 rounded-lg bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p> : null}

        {isLoading ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-72 animate-pulse rounded-lg bg-white/70" />
            ))}
          </div>
        ) : null}

        {!isLoading && projects.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-stone-300 bg-white/70 p-10 text-center">
            <h3 className="text-xl font-semibold text-stone-950">No projects yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
              Start with one project. Add tasks and deadlines inside it, then this dashboard becomes your operating view.
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="mt-6 rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
            >
              Add Project
            </button>
          </div>
        ) : null}

        {!isLoading && projects.length > 0 ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : null}
      </section>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 px-5 backdrop-blur-sm">
          <form onSubmit={handleCreateProject} className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl shadow-stone-950/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">New project</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">Add Project</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl leading-none text-stone-500 transition hover:bg-stone-50 hover:text-stone-950"
                aria-label="Close"
              >
                x
              </button>
            </div>

            <label className="mt-6 block text-sm font-medium text-stone-700" htmlFor="project-name">
              Project name
            </label>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              className="mt-2 w-full rounded-md border border-stone-300 px-4 py-3 outline-none ring-teal-600/15 transition focus:border-teal-600 focus:ring-4"
            />

            <div className="mt-5">
              <p className="text-sm font-medium text-stone-700">Project type</p>
              <div className="mt-2 grid gap-3">
                {projectTypes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setType(item.value)}
                    className={`rounded-md border p-4 text-left transition ${
                      type === item.value ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white hover:bg-stone-50"
                    }`}
                  >
                    <span className="font-semibold text-stone-950">{item.label}</span>
                    <span className="mt-1 block text-sm text-stone-600">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                disabled={isSaving || !name.trim()}
                className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {isSaving ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white p-3">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-950">{value}</p>
    </div>
  );
}
