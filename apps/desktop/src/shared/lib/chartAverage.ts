export function getAverage(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateRangeAverage(values: number[], hasActivityBeforeRange: boolean) {
  if (values.length === 0) return 0;

  const firstActivityIndex = hasActivityBeforeRange ? 0 : values.findIndex((value) => value > 0);
  const averageValues = firstActivityIndex > 0 ? values.slice(firstActivityIndex) : values;

  return getAverage(averageValues);
}
