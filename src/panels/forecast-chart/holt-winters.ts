import type { Point } from "./crossing";

/** z for a central 80% interval of a normal distribution. */
export const Z80 = 1.2816;

const DAY_MS = 86_400_000;
/** Fit on at most this many grid points; longer histories are averaged into wider steps. */
const MAX_FIT_POINTS = 2000;
/** Draw at most this many forecast points. */
const MAX_FORECAST_POINTS = 400;

export interface Estimate {
  /** Model's one-step-ahead value over the history (the expected line). */
  expected: Point[];
  expectedUpper: Point[];
  expectedLower: Point[];
  /** From the last sample to `horizonMs` ahead, starting with the last fitted level. */
  forecast: Point[];
  upper: Point[];
  lower: Point[];
  /** "holt-winters" when a daily season was fitted, otherwise "holt". */
  method: "holt-winters" | "holt";
}

/** The regular grid a series is fitted on: the median sample spacing, made coarser if needed. */
export function resample(points: Point[]): {
  start: number;
  step: number;
  values: number[];
} {
  const pts = points.filter((p) => Number.isFinite(p.v));
  if (pts.length < 2)
    return { start: pts[0]?.t ?? 0, step: 0, values: pts.map((p) => p.v) };
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) gaps.push(pts[i]!.t - pts[i - 1]!.t);
  gaps.sort((a, b) => a - b);
  const start = pts[0]!.t;
  const span = pts[pts.length - 1]!.t - start;
  let step = Math.max(1, gaps[Math.floor(gaps.length / 2)]!);
  if (span / step + 1 > MAX_FIT_POINTS)
    step = Math.ceil(span / (MAX_FIT_POINTS - 1));
  const n = Math.floor(span / step) + 1;
  const sum = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  for (const p of pts) {
    const i = Math.min(n - 1, Math.round((p.t - start) / step));
    sum[i]! += p.v;
    count[i]! += 1;
  }
  // Average each bucket; carry the previous value through empty ones.
  const values: number[] = [];
  let last = pts[0]!.v;
  for (let i = 0; i < n; i++) {
    if (count[i]! > 0) last = sum[i]! / count[i]!;
    values.push(last);
  }
  return { start, step, values };
}

interface Fit {
  fitted: Array<number | undefined>;
  level: number;
  trend: number;
  season: number[];
  /** Index of the next step after the last observation, for the season lookup. */
  next: number;
}

function holt(y: number[], alpha: number, beta: number): Fit {
  let level = y[0]!;
  let trend = y.length > 1 ? y[1]! - y[0]! : 0;
  const fitted: Array<number | undefined> = [undefined];
  for (let t = 1; t < y.length; t++) {
    const f = level + trend;
    fitted.push(f);
    const prev = level;
    level = alpha * y[t]! + (1 - alpha) * f;
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return { fitted, level, trend, season: [], next: y.length };
}

function holtWinters(
  y: number[],
  m: number,
  alpha: number,
  beta: number,
  gamma: number,
): Fit {
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  const first = y.slice(0, m);
  const second = y.slice(m, 2 * m);
  let level = mean(first);
  let trend = (mean(second) - level) / m;
  const season = first.map((v) => v - level);
  const fitted: Array<number | undefined> = new Array(m).fill(undefined);
  for (let t = m; t < y.length; t++) {
    const s = season[t % m]!;
    const f = level + trend + s;
    fitted.push(f);
    const prev = level;
    level = alpha * (y[t]! - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
    season[t % m] = gamma * (y[t]! - level) + (1 - gamma) * s;
  }
  return { fitted, level, trend, season, next: y.length };
}

/** Standard error of an ordinary least-squares slope through `y` (per grid step). */
export function trendStandardError(y: number[]): number {
  const n = y.length;
  if (n < 3) return 0;
  const tMean = (n - 1) / 2;
  let yMean = 0;
  for (const v of y) yMean += v / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - tMean) ** 2;
    sxy += (i - tMean) * (y[i]! - yMean);
  }
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++)
    sse += (y[i]! - (yMean + slope * (i - tMean))) ** 2;
  return Math.sqrt(sse / (n - 2) / sxx);
}

/**
 * A quick in-browser forecast of `points` for `horizonMs` ahead: additive Holt-Winters with a
 * daily season when the history holds at least two days on a grid fine enough for it, otherwise
 * Holt's linear trend. The 80% band comes from the one-step residuals and the trend's standard
 * error, widened with the horizon. Undefined when there are fewer than 3 usable samples.
 */
export function estimate(
  points: Point[],
  horizonMs: number,
): Estimate | undefined {
  const { start, step, values } = resample(points);
  if (values.length < 3 || step <= 0) return undefined;
  const m = Math.round(DAY_MS / step);
  const seasonal = m >= 2 && values.length >= 2 * m;
  const alpha = seasonal ? 0.3 : 0.5;
  const beta = seasonal ? 0.02 : 0.05;
  const fit = seasonal
    ? holtWinters(values, m, alpha, beta, 0.1)
    : holt(values, alpha, beta);

  let sq = 0;
  let k = 0;
  fit.fitted.forEach((f, i) => {
    if (f === undefined) return;
    sq += (values[i]! - f) ** 2;
    k += 1;
  });
  const sigma = k > 0 ? Math.sqrt(sq / k) : 0;

  const expected: Point[] = [];
  const expectedUpper: Point[] = [];
  const expectedLower: Point[] = [];
  fit.fitted.forEach((f, i) => {
    if (f === undefined) return;
    const t = start + i * step;
    expected.push({ t, v: f });
    expectedUpper.push({ t, v: f + Z80 * sigma });
    expectedLower.push({ t, v: f - Z80 * sigma });
  });

  const last = start + (values.length - 1) * step;
  const steps = Math.max(1, Math.ceil(horizonMs / step));
  const every = Math.max(1, Math.ceil(steps / MAX_FORECAST_POINTS));
  const lastLevel =
    fit.level + (fit.season.length ? fit.season[(fit.next - 1) % m]! : 0);
  const forecast: Point[] = [{ t: last, v: lastLevel }];
  const upper: Point[] = [{ t: last, v: lastLevel }];
  const lower: Point[] = [{ t: last, v: lastLevel }];
  // Two sources of error, added as variances: the level wanders like a random walk driven by the
  // one-step residuals (sigma^2 * (1 + alpha^2 * h)), and the trend is only known to within its
  // standard error, which grows linearly with the horizon. The textbook Holt variance assumes the
  // smoothing constants are right and explodes on fine grids, which is worse than this for a
  // quick estimate.
  const slopeSe = trendStandardError(values);
  for (let h = 1; h <= steps; h++) {
    if (h % every !== 0 && h !== steps) continue;
    const s = fit.season.length ? fit.season[(fit.next + h - 1) % m]! : 0;
    const v = fit.level + h * fit.trend + s;
    const w =
      Z80 * Math.sqrt(sigma ** 2 * (1 + alpha ** 2 * h) + (h * slopeSe) ** 2);
    const t = last + h * step;
    forecast.push({ t, v });
    upper.push({ t, v: v + w });
    lower.push({ t, v: v - w });
  }
  return {
    expected,
    expectedUpper,
    expectedLower,
    forecast,
    upper,
    lower,
    method: seasonal ? "holt-winters" : "holt",
  };
}
