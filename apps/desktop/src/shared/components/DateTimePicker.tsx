import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type DateTimePickerProps = {
  label?: string;
  value: string;
  mode?: "date" | "datetime";
  disabled?: boolean;
  allowClear?: boolean;
  onChange: (value: string) => void;
};

export function DateTimePicker({
  label,
  value,
  mode = "datetime",
  disabled = false,
  allowClear = true,
  onChange,
}: DateTimePickerProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const hasValue = Boolean(value);
  const selectedDate = useMemo(() => parsePickerValue(value, mode), [mode, value]);
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => selectedDate);
  const [pendingDate, setPendingDate] = useState(() => selectedDate);
  const days = useMemo(() => getCalendarGrid(viewDate), [viewDate]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, minute) => minute), []);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (!fieldRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setViewDate(selectedDate);
      setPendingDate(selectedDate);
    }
  }, [isOpen, selectedDate.getTime()]);

  function updateDate(nextDate: Date) {
    const nextValue = new Date(pendingDate);
    nextValue.setFullYear(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
    setPendingDate(nextValue);
  }

  function updateTime(part: "hour" | "minute", nextNumber: number) {
    const nextValue = new Date(pendingDate);
    if (part === "hour") nextValue.setHours(nextNumber);
    if (part === "minute") nextValue.setMinutes(nextNumber);
    setPendingDate(nextValue);
  }

  function selectToday() {
    const today = new Date();
    setPendingDate(today);
    setViewDate(today);
  }

  function confirmSelection() {
    onChange(mode === "date" ? toDateInputValue(pendingDate) : toDateTimeLocal(pendingDate));
    setIsOpen(false);
  }

  function shiftMonth(direction: -1 | 1) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  return (
    <div ref={fieldRef} className="relative block text-sm font-medium text-stone-600">
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        className={`${label ? "mt-2 " : ""}block w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left text-base font-semibold text-stone-950 outline-none ring-0 transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:text-stone-400`}
      >
        {hasValue ? formatPickerValue(selectedDate, mode) : mode === "date" ? "Select date" : "Select date and time"}
      </button>

      {isOpen && !disabled ? (
        <div className={`${mode === "date" ? "w-[min(22rem,calc(100vw-3rem))]" : "w-[min(30rem,calc(100vw-3rem))]"} absolute right-0 top-full z-[70] mt-3 overflow-hidden rounded-lg border border-white/10 bg-stone-950 text-stone-100 shadow-2xl shadow-stone-950/40`}>
          <div className={`grid gap-3 p-4 ${mode === "datetime" ? "md:grid-cols-[1fr_4.75rem_4.75rem]" : ""}`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => shiftMonth(-1)} className="grid h-8 w-8 place-items-center rounded-full text-base text-stone-300 outline-none ring-0 transition hover:bg-white/10 hover:text-white" aria-label="Previous month">
                  &lt;
                </button>
                <strong className="text-sm text-white">{viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
                <button type="button" onClick={() => shiftMonth(1)} className="grid h-8 w-8 place-items-center rounded-full text-base text-stone-300 outline-none ring-0 transition hover:bg-white/10 hover:text-white" aria-label="Next month">
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
                  const isSelected = isSameDate(day, pendingDate);
                  const isCurrentMonth = day.getMonth() === viewDate.getMonth();
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => updateDate(day)}
                      className={`grid h-7 place-items-center rounded-md text-xs font-semibold tabular-nums outline-none ring-0 transition ${
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

            {mode === "datetime" ? (
              <>
                <TimeColumn label="Hour (24H)" options={hours} value={pendingDate.getHours()} onChange={(nextHour) => updateTime("hour", nextHour)} />
                <TimeColumn label="Minute" options={minutes} value={pendingDate.getMinutes()} onChange={(nextMinute) => updateTime("minute", nextMinute)} />
              </>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm font-semibold">
            <div className="flex gap-4">
              <button type="button" onClick={selectToday} className="text-teal-300 outline-none ring-0 transition hover:text-teal-100">
                Today
              </button>
              {allowClear && hasValue ? (
                <button type="button" onClick={() => { onChange(""); setIsOpen(false); }} className="text-stone-400 outline-none ring-0 transition hover:text-white">
                  Clear
                </button>
              ) : null}
            </div>
            <button type="button" onClick={confirmSelection} className="rounded-full bg-white px-4 py-2 text-stone-950 outline-none ring-0 transition hover:bg-stone-200">
              OK
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
    if (!scroller || isSyncingScrollRef.current || !hasUserScrolledRef.current) return;
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);

    frameRef.current = window.requestAnimationFrame(() => {
      const nextIndex = clamp(Math.round(scroller.scrollTop / timeOptionHeight), 0, options.length - 1);
      const nextValue = options[nextIndex];
      if (nextValue !== value) onChange(nextValue);
    });
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
          onKeyDown={() => { hasUserScrolledRef.current = true; }}
          onPointerDown={() => { hasUserScrolledRef.current = true; }}
          onScroll={handleScroll}
          onTouchStart={() => { hasUserScrolledRef.current = true; }}
          onWheel={() => { hasUserScrolledRef.current = true; }}
          className="h-full overflow-y-auto scroll-smooth py-[62px] pr-1 [scrollbar-color:#14b8a6_#1c1917]"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`relative z-30 grid h-9 w-full place-items-center rounded-md text-base font-semibold tabular-nums outline-none ring-0 transition ${
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

export function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parsePickerValue(value: string, mode: "date" | "datetime") {
  if (!value) return new Date();
  const date = mode === "date" ? new Date(`${value.slice(0, 10)}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatPickerValue(date: Date, mode: "date" | "datetime") {
  const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (mode === "date") return dateLabel;
  return `${dateLabel} / ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
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
  return firstDate.getFullYear() === secondDate.getFullYear()
    && firstDate.getMonth() === secondDate.getMonth()
    && firstDate.getDate() === secondDate.getDate();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
