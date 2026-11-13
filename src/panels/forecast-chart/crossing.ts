import type { ThresholdDirection } from "./forecast-chart-types";

export interface Point {
  /** Unix time in ms. */
  t: number;
  v: number;
}

export type Crossing =
  /** No forecast to check. */
  | { kind: "none" }
  /** Neither the forecast nor either band edge reaches the threshold within the horizon. */
  | { kind: "never"; horizonEnd: number }
  /** The forecast is beyond the threshold at its first point. */
  | { kind: "already"; at: number }
  /**
   * The forecast crosses at `at`. `earliest` is where the near band edge crosses (upper for
   * "above"), `latest` where the far edge does; `latest` is undefined when the far edge stays on
   * the safe side for the whole horizon.
   */
  | {
      kind: "crosses";
      at: number;
      earliest: number;
      latest?: number;
      horizonEnd: number;
    }
  /** Only the near band edge crosses, at `earliest`; the forecast itself stays on the safe side. */
  | { kind: "edge"; earliest: number; horizonEnd: number };

/**
 * When `points` first reaches `threshold` in `direction`, linearly interpolated between samples.
 * The first point's time if it is already there; undefined if it never gets there.
 */
export function firstCrossing(
  points: Point[],
  threshold: number,
  direction: ThresholdDirection,
): number | undefined {
  const beyond = (v: number): boolean =>
    direction === "above" ? v >= threshold : v <= threshold;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!beyond(p.v)) continue;
    if (i === 0) return p.t;
    const q = points[i - 1]!;
    const span = p.v - q.v;
    if (span === 0) return p.t;
    return q.t + ((threshold - q.v) / span) * (p.t - q.t);
  }
  return undefined;
}

/**
 * Where the forecast (and its band) crosses a threshold. `upper` and `lower` may be empty; then
 * `earliest` and `latest` fall back to the forecast's own crossing.
 */
export function thresholdCrossing(
  forecast: Point[],
  upper: Point[],
  lower: Point[],
  threshold: number,
  direction: ThresholdDirection = "above",
): Crossing {
  if (forecast.length === 0) return { kind: "none" };
  const horizonEnd = Math.max(
    forecast[forecast.length - 1]!.t,
    upper[upper.length - 1]?.t ?? -Infinity,
    lower[lower.length - 1]?.t ?? -Infinity,
  );
  const [near, far] = direction === "above" ? [upper, lower] : [lower, upper];
  const at = firstCrossing(forecast, threshold, direction);
  if (at !== undefined && at === forecast[0]!.t) return { kind: "already", at };
  const nearAt =
    near.length > 0 ? firstCrossing(near, threshold, direction) : undefined;
  if (at === undefined) {
    return nearAt === undefined
      ? { kind: "never", horizonEnd }
      : { kind: "edge", earliest: nearAt, horizonEnd };
  }
  const farAt = far.length > 0 ? firstCrossing(far, threshold, direction) : at;
  return {
    kind: "crosses",
    at,
    earliest: Math.min(at, nearAt ?? at),
    latest: farAt === undefined ? undefined : Math.max(at, farAt),
    horizonEnd,
  };
}
