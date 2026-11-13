import type { PanelData } from "@perses-dev/plugin-system";
import type { TimeSeries, TimeSeriesData } from "@perses-dev/spec";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** A fixed "now" so tests do not depend on the clock. */
export const NOW = Date.UTC(2026, 0, 15, 12);

export function series(
  name: string,
  labels: Record<string, string>,
  values: Array<[number, number | null]>,
): TimeSeries {
  return { name, labels, values } as TimeSeries;
}

/** One query result per argument, in order. */
export function results(
  ...queries: TimeSeries[][]
): Array<PanelData<TimeSeriesData>> {
  return queries.map(
    (s) =>
      ({
        definition: {
          kind: "TimeSeriesQuery",
          spec: { plugin: { kind: "PrometheusTimeSeriesQuery", spec: {} } },
        },
        data: {
          series: s,
          timeRange: { start: new Date(NOW - 14 * DAY), end: new Date(NOW) },
          stepMs: HOUR,
        },
      }) as unknown as PanelData<TimeSeriesData>,
  );
}

/** Usage rising 60 -> 72 over 14 days, hourly, with a spike at day -8 and a drop at day -5. */
export function usage(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let h = 14 * 24; h >= 0; h--) {
    const t = NOW - h * HOUR;
    const day = 14 - h / 24;
    let v = 60 + (12 * day) / 14;
    if (h === 8 * 24) v += 15;
    if (h === 5 * 24) v -= 11;
    out.push([t, v]);
  }
  return out;
}

/** The expected value over the history (horizon 0), offset from usage() without the anomalies. */
export function expectedHistory(offset = 0): Array<[number, number]> {
  return usage().map(([t]) => {
    const day = 14 - (NOW - t) / DAY;
    return [t, 60 + (12 * day) / 14 + offset];
  });
}

/** Forecast series, one per horizon (every day up to 30 days), each with its newest sample now. */
export function horizonSeries(
  name: string,
  value: (days: number) => number,
): TimeSeries[] {
  const out: TimeSeries[] = [];
  for (let d = 1; d <= 30; d++) {
    out.push(
      series(name, { horizon: String(d * 86_400) }, [
        [NOW - HOUR, value(d) - 0.1],
        [NOW, value(d)],
      ]),
    );
  }
  return out;
}

/** The full five-query fixture: actual, forecast, upper, lower, anomaly. */
export function forecastFixture(): Array<PanelData<TimeSeriesData>> {
  const slope = 12 / 14;
  const f = (d: number): number => 72 + slope * d;
  const width = (d: number): number => 1.5 + 0.25 * d;
  return results(
    [series("used", { persistentvolumeclaim: "data-0" }, usage())],
    [
      series("forecast_value", { horizon: "0" }, expectedHistory()),
      ...horizonSeries("forecast_value", f),
    ],
    [
      series("forecast_upper", { horizon: "0" }, expectedHistory(2)),
      ...horizonSeries("forecast_upper", (d) => f(d) + width(d)),
    ],
    [
      series("forecast_lower", { horizon: "0" }, expectedHistory(-2)),
      ...horizonSeries("forecast_lower", (d) => f(d) - width(d)),
    ],
    [
      series(
        "log_anomaly_score",
        { namespace: "shop", pod: "web-0" },
        usage().map(([t]) => [t, t === NOW - 8 * DAY ? 0.9 : 0.1]),
      ),
    ],
  );
}
