import { FormatOptions, formatValue } from "@perses-dev/components";
import type { PanelData } from "@perses-dev/plugin-system";
import type { TimeSeries } from "@perses-dev/spec";
import type { Point } from "./crossing";
import { parseDurationMs } from "./duration";
import {
  DEFAULT_ANOMALY_THRESHOLD,
  DEFAULT_HORIZON_LABEL,
  DEFAULT_QUICKSTART_HORIZON,
  ForecastChartOptions,
  QueryData,
  ROLES,
  Role,
  resolveRoles,
} from "./forecast-chart-types";
import { estimate } from "./holt-winters";

export type { Point };

export interface Anomaly {
  /** Stable id: the time of the marker. */
  key: string;
  /** Where the marker sits: a sample of the actual series. */
  t: number;
  v: number;
  expected?: number;
  /** actual - expected. */
  deviation?: number;
  /** deviation / (upper - lower) at t. */
  bandWidths?: number;
  /** Highest anomaly score of the run, if a score series flagged it. */
  score?: number;
  /** Why it is an anomaly. */
  reasons: Array<"band" | "score">;
  /** Labels of the anomaly-score series (for the link), else of the actual series. */
  labels: Record<string, string>;
  /** First and last sample time of the run. */
  from: number;
  to: number;
}

export interface Model {
  actual: Point[];
  actualName?: string;
  actualLabels: Record<string, string>;
  /** Model's expected value over the history, and its band. */
  expected: Point[];
  expectedUpper: Point[];
  expectedLower: Point[];
  /** From the origin into the future. */
  forecast: Point[];
  upper: Point[];
  lower: Point[];
  /** Where history ends and the forecast starts. */
  origin?: number;
  anomalies: Anomaly[];
  /** The forecast is the in-browser quick-start estimate. */
  estimate: boolean;
  /** Time axis: dashboard start to the later of its end and the last forecast point. */
  xDomain: [number, number];
  /** Things the user should know: missing queries, skipped series, too little data. */
  notes: string[];
}

export interface BuildOptions {
  spec: ForecastChartOptions;
  /** Used for the "now" fallback when no data says otherwise. */
  now?: number;
}

const FIVE_MINUTES = 5 * 60_000;

function pointsOf(series: TimeSeries): Point[] {
  const out: Point[] = [];
  for (const [t, v] of series.values) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n) && Number.isFinite(t)) out.push({ t, v: n });
  }
  return out;
}

/** Linear interpolation of `points` (sorted by t) at `t`; undefined outside their span. */
export function valueAt(points: Point[], t: number): number | undefined {
  if (points.length === 0) return undefined;
  if (t < points[0]!.t || t > points[points.length - 1]!.t) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (a.t === t || b.t === a.t) return a.v;
  if (b.t === t) return b.v;
  return a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v);
}

/** The point of `points` nearest to `t` (binary search). */
export function nearest(points: Point[], t: number): Point | undefined {
  if (points.length === 0) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

interface RolePaths {
  /** Samples at their own time (horizon 0 or no horizon label). */
  own: Point[];
  /** Newest sample of each horizon series, moved to sample time + horizon. */
  ahead: Point[];
  /** Newest sample time of the horizon series: when the forecast was made. */
  issued?: number;
  seriesCount: number;
}

/**
 * Splits a forecast, upper or lower role's series by `horizonLabel`. A series with horizon h > 0
 * gives one point, its newest sample, at sample time + h; horizon 0 or no label keeps every sample
 * at its own time.
 */
export function horizonPaths(
  series: TimeSeries[],
  horizonLabel: string,
): RolePaths {
  const own = new Map<number, number>();
  const ahead = new Map<number, number>();
  let issued: number | undefined;
  for (const s of series) {
    const points = pointsOf(s);
    if (points.length === 0) continue;
    const raw = s.labels?.[horizonLabel];
    const h = raw === undefined ? 0 : (parseDurationMs(raw) ?? 0);
    if (h > 0) {
      const last = points[points.length - 1]!;
      ahead.set(last.t + h, last.v);
      issued = issued === undefined ? last.t : Math.max(issued, last.t);
    } else {
      for (const p of points) own.set(p.t, p.v);
    }
  }
  const sorted = (m: Map<number, number>): Point[] =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  return {
    own: sorted(own),
    ahead: sorted(ahead),
    issued,
    seriesCount: series.length,
  };
}

/** History part (t <= origin) and future part (from the last point at or before origin). */
function splitAt(
  paths: RolePaths,
  origin: number | undefined,
): { past: Point[]; future: Point[] } {
  if (origin === undefined) return { past: paths.own, future: paths.ahead };
  const past = paths.own.filter((p) => p.t <= origin);
  const laterOwn = paths.own.filter((p) => p.t > origin);
  const future = [...laterOwn, ...paths.ahead.filter((p) => p.t > origin)].sort(
    (a, b) => a.t - b.t,
  );
  const anchor = past[past.length - 1];
  if (anchor && future.length > 0 && origin - anchor.t <= FIVE_MINUTES * 3) {
    future.unshift(anchor);
  }
  return { past, future };
}

/** Signed deviation as text: "+15 pp" for percent units, otherwise the formatted value. */
export function formatDeviation(
  deviation: number,
  format: FormatOptions | undefined,
): string {
  const sign = deviation >= 0 ? "+" : "−";
  const abs = Math.abs(deviation);
  const unit = format?.unit;
  if (unit === "percent" || unit === "percent-decimal") {
    const pp = unit === "percent" ? abs : abs * 100;
    const digits = pp >= 10 ? 0 : 1;
    return `${sign}${pp.toFixed(digits)} pp`;
  }
  return `${sign}${formatValue(abs, format)}`;
}

/** Short marker label: "spike +15 pp", "drop −11 pp", or the score. */
export function anomalyLabel(
  a: Anomaly,
  format: FormatOptions | undefined,
): string {
  if (a.deviation !== undefined) {
    return `${a.deviation >= 0 ? "spike" : "drop"} ${formatDeviation(a.deviation, format)}`;
  }
  return a.score !== undefined ? `score ${a.score.toFixed(2)}` : "anomaly";
}

function cleanLabels(
  labels: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(labels ?? {}) };
}

/** Runs of consecutive indices for which `flag` holds. */
function runs<T>(
  items: T[],
  flag: (item: T) => boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  items.forEach((item, i) => {
    if (flag(item)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, items.length - 1]);
  return out;
}

export function findAnomalies(input: {
  actual: Point[];
  actualLabels: Record<string, string>;
  expected: Point[];
  expectedUpper: Point[];
  expectedLower: Point[];
  scores: TimeSeries[];
  scoreThreshold: number;
  until?: number;
}): Anomaly[] {
  const {
    actual,
    expected,
    expectedUpper,
    expectedLower,
    scores,
    scoreThreshold,
  } = input;
  const until = input.until ?? Infinity;
  const history = actual.filter((p) => p.t <= until);

  const context = (
    p: Point,
  ): Omit<Anomaly, "reasons" | "labels" | "from" | "to"> => {
    const exp = valueAt(expected, p.t);
    const up = valueAt(expectedUpper, p.t);
    const lo = valueAt(expectedLower, p.t);
    const deviation = exp !== undefined ? p.v - exp : undefined;
    const width = up !== undefined && lo !== undefined ? up - lo : undefined;
    return {
      key: String(p.t),
      t: p.t,
      v: p.v,
      expected: exp,
      deviation,
      bandWidths:
        deviation !== undefined && width !== undefined && width > 0
          ? deviation / width
          : undefined,
    };
  };

  // Outside the band.
  const outside = (p: Point): boolean => {
    const up = valueAt(expectedUpper, p.t);
    const lo = valueAt(expectedLower, p.t);
    return (up !== undefined && p.v > up) || (lo !== undefined && p.v < lo);
  };
  const result: Anomaly[] = [];
  for (const [a, b] of runs(history, outside)) {
    let best = history[a]!;
    let bestDist = -1;
    for (let i = a; i <= b; i++) {
      const p = history[i]!;
      const exp =
        valueAt(expected, p.t) ??
        ((valueAt(expectedUpper, p.t) ?? p.v) +
          (valueAt(expectedLower, p.t) ?? p.v)) /
          2;
      const d = Math.abs(p.v - exp);
      if (d > bestDist) {
        bestDist = d;
        best = p;
      }
    }
    result.push({
      ...context(best),
      reasons: ["band"],
      labels: cleanLabels(input.actualLabels),
      from: history[a]!.t,
      to: history[b]!.t,
    });
  }

  // Score over the threshold.
  for (const s of scores) {
    const pts = pointsOf(s).filter((p) => p.t <= until);
    for (const [a, b] of runs(pts, (p) => p.v > scoreThreshold)) {
      let peak = pts[a]!;
      for (let i = a; i <= b; i++) if (pts[i]!.v > peak.v) peak = pts[i]!;
      const from = pts[a]!.t;
      const to = pts[b]!.t;
      const slack = FIVE_MINUTES;
      const overlapping = result.find(
        (r) =>
          r.from <= to + slack &&
          r.to >= from - slack &&
          !r.reasons.includes("score"),
      );
      if (overlapping) {
        overlapping.reasons.push("score");
        overlapping.score = peak.v;
        overlapping.labels = cleanLabels(s.labels);
        continue;
      }
      const onLine = nearest(history, peak.t);
      if (!onLine || Math.abs(onLine.t - peak.t) > slack * 3) continue;
      result.push({
        ...context(onLine),
        score: peak.v,
        reasons: ["score"],
        labels: cleanLabels(s.labels),
        from,
        to,
      });
    }
  }
  return result.sort((x, y) => x.t - y.t);
}

/** Builds everything the panel draws from the query results and options. */
export function buildModel(
  queryResults: Array<PanelData<QueryData>>,
  { spec, now = Date.now() }: BuildOptions,
): Model {
  const notes: string[] = [];
  const roles = resolveRoles(spec.roles);
  const seriesOf = (role: Role): TimeSeries[] => {
    const i = roles[role];
    const result = queryResults[i];
    if (!result) {
      if (spec.roles?.[role] !== undefined) {
        notes.push(
          `The ${role} role points at query ${i + 1}, which does not exist.`,
        );
      }
      return [];
    }
    return result.data?.series ?? [];
  };
  const used = new Map<number, Role>();
  for (const role of ROLES) {
    const i = roles[role];
    const other = used.get(i);
    if (
      other !== undefined &&
      queryResults[i] &&
      spec.roles?.[role] !== undefined
    ) {
      notes.push(`The ${role} and ${other} roles both use query ${i + 1}.`);
    }
    used.set(i, role);
  }

  const actualSeries = seriesOf("actual");
  const first =
    actualSeries.find((s) => pointsOf(s).length > 0) ?? actualSeries[0];
  const actual = first ? pointsOf(first) : [];
  if (actualSeries.length > 1) {
    notes.push(
      `Showing 1 of ${actualSeries.length} actual series; narrow the query to one (a variable helps).`,
    );
  }
  const horizonLabel = spec.horizonLabel || DEFAULT_HORIZON_LABEL;
  const f = horizonPaths(seriesOf("forecast"), horizonLabel);
  const u = horizonPaths(seriesOf("upper"), horizonLabel);
  const l = horizonPaths(seriesOf("lower"), horizonLabel);
  const lastActual = actual[actual.length - 1]?.t;
  const issued = [f.issued, u.issued, l.issued].filter(
    (x): x is number => x !== undefined,
  );
  const origin = issued.length > 0 ? Math.max(...issued) : lastActual;

  let fs = splitAt(f, origin);
  let us = splitAt(u, origin);
  let ls = splitAt(l, origin);
  let isEstimate = false;
  const hasPrecomputed =
    f.own.length +
      f.ahead.length +
      u.own.length +
      u.ahead.length +
      l.own.length +
      l.ahead.length >
    0;
  if (!hasPrecomputed && spec.quickStart && actual.length > 0) {
    const horizonMs =
      parseDurationMs(spec.horizon ?? DEFAULT_QUICKSTART_HORIZON) ??
      (parseDurationMs(DEFAULT_QUICKSTART_HORIZON) as number);
    const est = estimate(actual, horizonMs);
    if (est) {
      isEstimate = true;
      fs = { past: est.expected, future: est.forecast };
      us = { past: est.expectedUpper, future: est.upper };
      ls = { past: est.expectedLower, future: est.lower };
    } else {
      notes.push("Too few samples for a quick-start estimate.");
    }
  }

  const timeRange = queryResults.find((r) => r.data?.timeRange)?.data.timeRange;
  const toMs = (d: Date | number | undefined): number | undefined =>
    d === undefined ? undefined : new Date(d).getTime();
  const allTimes = [actual, fs.past, fs.future, us.future, ls.future]
    .flat()
    .map((p) => p.t);
  const dataStart = allTimes.length ? Math.min(...allTimes) : now - 3_600_000;
  const dataEnd = allTimes.length ? Math.max(...allTimes) : now;
  const start = toMs(timeRange?.start) ?? dataStart;
  const end = Math.max(toMs(timeRange?.end) ?? dataEnd, dataEnd);

  const anomalies = findAnomalies({
    actual,
    actualLabels: cleanLabels(first?.labels),
    expected: fs.past,
    expectedUpper: us.past,
    expectedLower: ls.past,
    scores: seriesOf("anomaly"),
    scoreThreshold: spec.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD,
    until: origin,
  });

  return {
    actual,
    actualName: first?.formattedName ?? first?.name,
    actualLabels: cleanLabels(first?.labels),
    expected: fs.past,
    expectedUpper: us.past,
    expectedLower: ls.past,
    forecast: fs.future,
    upper: us.future,
    lower: ls.future,
    origin:
      fs.future.length + us.future.length + ls.future.length > 0
        ? origin
        : undefined,
    anomalies,
    estimate: isEstimate,
    xDomain: [start, end > start ? end : start + 1],
    notes,
  };
}

/**
 * At most two points (min and max) per bucket, so a long series draws as fast as a short one and
 * keeps its spikes.
 */
export function downsample(points: Point[], buckets: number): Point[] {
  if (points.length <= buckets * 2 || buckets < 1) return points;
  const t0 = points[0]!.t;
  const span = points[points.length - 1]!.t - t0 || 1;
  const out: Point[] = [];
  let bucket = -1;
  let lo: Point | undefined;
  let hi: Point | undefined;
  const flush = (): void => {
    if (!lo || !hi) return;
    if (lo === hi) out.push(lo);
    else if (lo.t < hi.t) out.push(lo, hi);
    else out.push(hi, lo);
  };
  for (const p of points) {
    const b = Math.min(buckets - 1, Math.floor(((p.t - t0) / span) * buckets));
    if (b !== bucket) {
      flush();
      bucket = b;
      lo = p;
      hi = p;
    } else {
      if (p.v < lo!.v) lo = p;
      if (p.v > hi!.v) hi = p;
    }
  }
  flush();
  return out;
}
