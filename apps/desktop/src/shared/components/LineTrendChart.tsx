import { Fragment, type ReactNode } from "react";
import { calculateRangeAverage } from "@/lib/chartAverage";

export type LineTrendMode = "regular" | "cumulative";

type LineTrendChartProps<T> = {
  ariaLabel: string;
  className?: string;
  emptyMessage: ReactNode;
  getLabel: (point: T) => string;
  getShortLabel: (point: T) => string;
  getValue: (point: T) => number;
  hasActivityBeforeRange?: boolean;
  isLoading?: boolean;
  maxLabels?: number;
  minY?: number;
  mode?: LineTrendMode;
  points: T[];
  tickStep?: number;
};

const chartTop = 8;
const chartBottom = 92;
const chartHeight = chartBottom - chartTop;

export function LineTrendChart<T>({
  ariaLabel,
  className = "mt-6",
  emptyMessage,
  getLabel,
  getShortLabel,
  getValue,
  hasActivityBeforeRange = false,
  isLoading = false,
  maxLabels = 10,
  minY = 10,
  mode = "regular",
  points,
  tickStep = 25,
}: LineTrendChartProps<T>) {
  if (isLoading) return <LineTrendChartSkeleton className={className} />;

  let runningTotal = 0;
  const chartPoints = points.map((point) => {
    const rawValue = getValue(point);
    runningTotal += rawValue;

    return {
      label: getLabel(point),
      shortLabel: getShortLabel(point),
      value: mode === "cumulative" ? runningTotal : rawValue,
    };
  });
  const values = chartPoints.map((point) => point.value);
  const averageValue = calculateRangeAverage(values, hasActivityBeforeRange);
  const maxValue = Math.max(0, ...values, averageValue);
  const maxY = Math.max(minY, Math.ceil(maxValue / tickStep) * tickStep);
  const xForIndex = (index: number) => (index / Math.max(1, chartPoints.length - 1)) * 100;
  const yForValue = (value: number) => chartBottom - (value / maxY) * chartHeight;
  const linePoints = chartPoints.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(" ");
  const averageY = yForValue(averageValue);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => Math.round(maxY * ratio));
  const labelIndexes = getLabelIndexes(chartPoints.length, maxLabels);
  const visibleChartPoints = labelIndexes.map((index) => ({ ...chartPoints[index], sourceIndex: index }));
  const hasData = points.some((point) => getValue(point) > 0);

  return (
    <div className={className}>
      <div className="grid grid-cols-[3rem_1fr] gap-3">
        <div className="relative h-64">
          {yTicks.map((value, index) =>
            value === averageValue ? null : (
              <span
                key={`${value}-${index}`}
                className="absolute right-0 -translate-y-1/2 text-xs font-medium text-stone-500"
                style={{ top: `${yForValue(value)}%` }}
              >
                {value}
              </span>
            ),
          )}
          <span
            className="absolute right-0 -translate-y-1/2 text-xs font-semibold leading-tight text-orange-500"
            style={{ top: `${averageY}%` }}
          >
            {averageValue}
          </span>
        </div>

        <div>
          <div className="relative h-64">
            <svg
              className="h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={ariaLabel}
            >
              {yTicks.map((value, index) => {
                const y = yForValue(value);
                return (
                  <polyline
                    key={`${value}-${index}`}
                    points={`0,${y} 100,${y}`}
                    fill="none"
                    stroke="#e7e5e4"
                    strokeWidth="0.45"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              <polyline
                points={`0,${averageY} 100,${averageY}`}
                fill="none"
                stroke="#f97316"
                strokeDasharray="5 5"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={linePoints}
                fill="none"
                stroke="#0d9488"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {visibleChartPoints.map((point) => {
              const x = xForIndex(point.sourceIndex);
              const y = yForValue(point.value);

              return (
                <Fragment key={`${point.label}-${point.sourceIndex}`}>
                  <span
                    className="pointer-events-none absolute h-2 w-2 rounded-full border-2 border-teal-700 bg-white shadow-sm"
                    style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                  />
                  <span
                    className={`pointer-events-none absolute -translate-y-[calc(100%+0.45rem)] rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 shadow-sm ring-1 ring-teal-100 ${
                      point.sourceIndex === 0
                        ? "translate-x-0"
                        : point.sourceIndex === chartPoints.length - 1
                          ? "-translate-x-full"
                          : "-translate-x-1/2"
                    }`}
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    {point.value}
                  </span>
                </Fragment>
              );
            })}
          </div>

          <div
            className="mt-3 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, labelIndexes.length)}, minmax(0, 1fr))` }}
          >
            {visibleChartPoints.map((point) => (
              <p key={`${point.label}-${point.sourceIndex}-label`} className="text-center text-[10px] font-medium text-stone-500">
                {point.shortLabel}
              </p>
            ))}
          </div>
        </div>
      </div>

      {!hasData ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm font-medium text-stone-600">
          {emptyMessage}
        </p>
      ) : null}
    </div>
  );
}

function LineTrendChartSkeleton({ className }: { className: string }) {
  return (
    <div className={`${className} grid grid-cols-[3rem_1fr] gap-3`}>
      <div className="h-64" />
      <div className="h-64 rounded-lg border border-dashed border-stone-300 bg-stone-50" />
    </div>
  );
}

function getLabelIndexes(pointCount: number, maxLabels: number) {
  if (pointCount <= 0) return [];

  const labelCount = Math.min(pointCount, Math.max(1, maxLabels));
  const lastIndex = pointCount - 1;
  const indexes = Array.from(
    { length: labelCount },
    (_, index) => Math.round((index / Math.max(1, labelCount - 1)) * lastIndex),
  );

  return Array.from(new Set(indexes));
}
