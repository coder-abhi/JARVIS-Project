"use client";

import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

          <DateTimeField label="Start Time" value={draft.startAt} onChange={(value) => onChange({ ...draft, startAt: value })} />

          <DateTimeField label="End Time" value={draft.endAt} onChange={(value) => onChange({ ...draft, endAt: value })} />
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

function DateTimeField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseDateTimeLocal(value);
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => selectedDate);
  const days = useMemo(() => getCalendarGrid(viewDate), [viewDate]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, minute) => minute), []);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setViewDate(selectedDate);
  }, [isOpen, selectedDate.getTime()]);

  function updateDate(nextDate: Date) {
    const nextValue = new Date(selectedDate);
    nextValue.setFullYear(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
    onChange(toDateTimeLocal(nextValue));
  }

  function updateTime(part: "hour" | "minute", nextNumber: number) {
    const nextValue = new Date(selectedDate);
    if (part === "hour") nextValue.setHours(nextNumber);
    if (part === "minute") nextValue.setMinutes(nextNumber);
    onChange(toDateTimeLocal(nextValue));
  }

  function shiftMonth(direction: -1 | 1) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  return (
    <div ref={fieldRef} className="relative block text-sm font-medium text-stone-600">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="mt-2 block w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left text-base font-semibold text-stone-950 outline-none ring-0 transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
      >
        {formatDateTimeField(selectedDate)}
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-full z-[70] mt-3 w-[min(30rem,calc(100vw-3rem))] overflow-hidden rounded-lg border border-white/10 bg-stone-950 text-stone-100 shadow-2xl shadow-stone-950/40">
          <div className="grid gap-3 p-4 md:grid-cols-[1fr_4.75rem_4.75rem]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => shiftMonth(-1)} className="grid h-8 w-8 place-items-center rounded-full text-base text-stone-300 outline-none ring-0 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-0" aria-label="Previous month">
                  &lt;
                </button>
                <strong className="text-sm text-white">{viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
                <button type="button" onClick={() => shiftMonth(1)} className="grid h-8 w-8 place-items-center rounded-full text-base text-stone-300 outline-none ring-0 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-0" aria-label="Next month">
                  &gt;
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const isSelected = isSameDate(day, selectedDate);
                  const isCurrentMonth = day.getMonth() === viewDate.getMonth();
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => updateDate(day)}
                      className={`grid h-7 place-items-center rounded-md text-xs font-semibold tabular-nums outline-none ring-0 transition focus:outline-none focus:ring-0 ${
                        isSelected
                          ? "bg-teal-500 text-white shadow-lg shadow-teal-950/30"
                          : isCurrentMonth
                            ? "text-stone-100 hover:bg-white/10"
                            : "text-stone-600 hover:bg-white/5 hover:text-stone-300"
                      }`}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <TimeColumn label="Hour" options={hours} value={selectedDate.getHours()} onChange={(nextHour) => updateTime("hour", nextHour)} />
            <TimeColumn label="Minute" options={minutes} value={selectedDate.getMinutes()} onChange={(nextMinute) => updateTime("minute", nextMinute)} />
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm font-semibold">
            <button type="button" onClick={() => onChange(toDateTimeLocal(new Date()))} className="text-teal-300 outline-none ring-0 transition hover:text-teal-100 focus:outline-none focus:ring-0">
              Today
            </button>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-full bg-white px-4 py-2 text-stone-950 outline-none ring-0 transition hover:bg-stone-200 focus:outline-none focus:ring-0">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const timeOptionHeight = 36;

function TimeColumn({ label, onChange, options, value }: { label: string; onChange: (value: number) => void; options: number[]; value: number }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const isSyncingScrollRef = useRef(false);
  const hasUserScrolledRef = useRef(false);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const nextTop = options.indexOf(value) * timeOptionHeight;
    if (Math.abs(scroller.scrollTop - nextTop) < 1) {
      isSyncingScrollRef.current = false;
      return;
    }

    isSyncingScrollRef.current = true;
    scroller.scrollTop = nextTop;
    if (syncFrameRef.current) window.cancelAnimationFrame(syncFrameRef.current);
    syncFrameRef.current = window.requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });

    return () => {
      if (syncFrameRef.current) window.cancelAnimationFrame(syncFrameRef.current);
      isSyncingScrollRef.current = false;
    };
  }, [options, value]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (isSyncingScrollRef.current || !hasUserScrolledRef.current) return;
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);

    frameRef.current = window.requestAnimationFrame(() => {
      const nextIndex = clamp(Math.round(scroller.scrollTop / timeOptionHeight), 0, options.length - 1);
      const nextValue = options[nextIndex];
      if (nextValue !== value) onChange(nextValue);
    });
  }

  function markUserScrollIntent() {
    hasUserScrolledRef.current = true;
  }

  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <div className="relative h-40 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-9 -translate-y-1/2 rounded-md bg-blue-600 shadow-lg shadow-blue-950/30" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-10 bg-gradient-to-b from-stone-950 to-stone-950/0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-10 bg-gradient-to-t from-stone-950 to-stone-950/0" />
        <div
          ref={scrollerRef}
          onKeyDown={markUserScrollIntent}
          onPointerDown={markUserScrollIntent}
          onScroll={handleScroll}
          onTouchStart={markUserScrollIntent}
          onWheel={markUserScrollIntent}
          className="h-full overflow-y-auto scroll-smooth py-[62px] pr-1 [scrollbar-color:#14b8a6_#1c1917]"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`relative z-30 grid h-9 w-full place-items-center rounded-md text-base font-semibold tabular-nums outline-none ring-0 transition focus:outline-none focus:ring-0 ${
                option === value ? "text-white" : "text-stone-500 hover:text-stone-200"
              }`}
            >
              {option.toString().padStart(2, "0")}
            </button>
          ))}
          <div className="h-px" />
        </div>
      </div>
    </div>
  );
}

export function toDateTimeLocal(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function parseDateTimeLocal(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDateTimeField(date: Date) {
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} / ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function getCalendarGrid(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function isSameDate(firstDate: Date, secondDate: Date) {
  return firstDate.getFullYear() === secondDate.getFullYear() && firstDate.getMonth() === secondDate.getMonth() && firstDate.getDate() === secondDate.getDate();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
