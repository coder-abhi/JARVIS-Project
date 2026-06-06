"use client";

import { type FormEvent } from "react";
import { DateTimePicker } from "@/components/DateTimePicker";
export { toDateTimeLocal } from "@/components/DateTimePicker";
import type { Project } from "@/lib/api";

export type PomodoroTimerMode = "focus" | "short" | "long";

export type PomodoroSessionDraft = {
  id?: string;
  source: "timer" | "manual" | "edit";
  mode: PomodoroTimerMode;
  startAt: string;
  endAt: string;
  projectId: string;
  taskId: string;
  done: string;
  focus: number;
};

export function PomodoroSessionModal({
  continuousProjects,
  draft,
  fixedProjects,
  isLoading,
  modeOptions,
  onChange,
  onClose,
  onDelete,
  onSave,
  onSaveWithoutDetails,
}: {
  continuousProjects: Project[];
  draft: PomodoroSessionDraft;
  fixedProjects: Project[];
  isLoading: boolean;
  modeOptions: Record<PomodoroTimerMode, string>;
  onChange: (draft: PomodoroSessionDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onSaveWithoutDetails?: () => void;
}) {
  const title = draft.source === "manual" ? "Add Session" : draft.source === "edit" ? "Edit Session" : "Session Complete";
  const textFieldClass =
    "mt-2 w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-base font-semibold text-stone-950 outline-none ring-0 transition placeholder:text-stone-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15";
  const selectFieldClass = `${textFieldClass} appearance-none`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/45 px-5 py-8 backdrop-blur-sm">
      <form onSubmit={onSave} className="w-full max-w-4xl rounded-lg bg-white px-7 py-6 shadow-2xl shadow-stone-950/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">{draft.source === "timer" ? "End of sprint" : "Pomodoro log"}</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl leading-none text-stone-500 outline-none ring-0 transition hover:bg-stone-50 hover:text-stone-950 focus:outline-none focus:ring-0"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-medium text-stone-600">
            Type
            <select
              value={draft.mode}
              onChange={(event) => onChange({ ...draft, mode: event.target.value as PomodoroTimerMode })}
              className={selectFieldClass}
            >
              {(Object.keys(modeOptions) as PomodoroTimerMode[]).map((item) => (
                <option key={item} value={item}>
                  {modeOptions[item]}
                </option>
              ))}
            </select>
          </label>

          <DateTimePicker label="Start Time" value={draft.startAt} allowClear={false} onChange={(value) => onChange({ ...draft, startAt: value })} />

          <DateTimePicker label="End Time" value={draft.endAt} allowClear={false} onChange={(value) => onChange({ ...draft, endAt: value })} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-stone-600">
            Fixed Project
            <select
              value={draft.projectId}
              onChange={(event) => onChange({ ...draft, projectId: event.target.value })}
              className={selectFieldClass}
            >
              <option value="">No Fixed Project</option>
              {fixedProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-stone-600">
            Continuous Project
            <select
              value={draft.taskId}
              onChange={(event) => onChange({ ...draft, taskId: event.target.value })}
              disabled={isLoading}
              className={`${selectFieldClass} disabled:text-stone-400`}
            >
              <option value="">No Continuous Project</option>
              {continuousProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-5 block text-sm font-medium text-stone-600">
          What Got Done
          <textarea
            value={draft.done}
            onChange={(event) => onChange({ ...draft, done: event.target.value })}
            rows={4}
            placeholder="Shipped the timeline fix, drafted notes, cleared review comments..."
            className={`${textFieldClass} resize-none leading-7 placeholder:font-medium`}
          />
        </label>

        <div className="mt-5">
          <RangeInput label="Focus" max={100} min={0} step={5} suffix="%" value={draft.focus} onChange={(value) => onChange({ ...draft, focus: value })} />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="mr-auto rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-700 outline-none ring-0 transition hover:bg-red-100 focus:outline-none focus:ring-0"
            >
              Delete
            </button>
          ) : null}
          {onSaveWithoutDetails ? (
            <button
              type="button"
              onClick={onSaveWithoutDetails}
              className="rounded-full border border-stone-300 bg-transparent px-5 py-2.5 text-sm font-semibold text-teal-700 outline-none ring-0 transition hover:bg-stone-50 focus:outline-none focus:ring-0"
            >
              Save Missing Details
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 outline-none ring-0 transition hover:bg-stone-50 focus:outline-none focus:ring-0">
            Cancel
          </button>
          <button className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white outline-none ring-0 transition hover:bg-stone-800 focus:outline-none focus:ring-0">
            Save Session
          </button>
        </div>
      </form>
    </div>
  );
}

function RangeInput({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix = "",
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="block text-sm font-medium text-stone-700">
      <span className="flex items-center justify-between gap-3">
        {label}
        <span className="font-semibold text-stone-950">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="session-range-input mt-4 w-full accent-teal-600"
      />
    </label>
  );
}
