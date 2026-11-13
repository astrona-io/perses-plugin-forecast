/** Linear map from a domain to a range. */
export function linear(
  [d0, d1]: [number, number],
  [r0, r1]: [number, number],
): (x: number) => number {
  const span = d1 - d0 || 1;
  return (x) => r0 + ((x - d0) / span) * (r1 - r0);
}

/** About `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let v = first; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step || 0);
  }
  return ticks;
}

/** A y domain from the values, padded 5% and widened to round ticks; includes 0 for non-negative data. */
export function yDomain(
  values: number[],
  extra: number[] = [],
): [number, number] {
  const all = [...values, ...extra].filter(Number.isFinite);
  if (all.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min >= 0) min = 0;
  if (min === max) max = min + 1;
  const pad = (max - min) * 0.05;
  max += pad;
  if (min < 0) min -= pad;
  const ticks = niceTicks(min, max, 5);
  return [
    Math.min(min, ticks[0] ?? min),
    Math.max(max, ticks[ticks.length - 1] ?? max),
  ];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TIME_STEPS = [
  MIN,
  5 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

/** Time ticks at a round step giving at most `count` ticks; steps of a day or more align to midnight shifted by `offsetMs`. */
export function timeTicks(
  start: number,
  end: number,
  count = 6,
  offsetMs = 0,
): { step: number; ticks: number[] } {
  const span = Math.max(1, end - start);
  const step =
    TIME_STEPS.find((s) => span / s <= count) ??
    TIME_STEPS[TIME_STEPS.length - 1]!;
  const ticks: number[] = [];
  const first = Math.ceil((start + offsetMs) / step) * step - offsetMs;
  for (let t = first; t <= end; t += step) ticks.push(t);
  return { step, ticks };
}
