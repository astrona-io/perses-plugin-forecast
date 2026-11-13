# Plan: ForecastChart

`ForecastChart` is a Perses panel that shows what _should_ happen next to what did: the actual
series as a solid line, a forecast as a dashed line with a shaded confidence band, diamond markers
where reality left the expected range, and a callout for when the forecast crosses a threshold.

This page is the design written before the code. Where the code later differs, `docs/DECISIONS.md`
says why.

## Inputs

The panel reads `TimeSeriesQuery` results (Prometheus, or anything that returns time series). Each
query is given a **role** by its index in the panel's query list (`roles`):

| Role       | Typical query                                                                 | Use                                        |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| `actual`   | `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100` | the solid line                             |
| `forecast` | `forecast_value{persistentvolumeclaim="data-kafka-0"}`                        | the dashed line, and "expected" in history |
| `upper`    | `forecast_upper{...}`                                                         | top of the band                            |
| `lower`    | `forecast_lower{...}`                                                         | bottom of the band                         |
| `anomaly`  | `log_anomaly_score{namespace="data"}`                                         | score or 0/1 flag; markers above a cutoff  |

Default roles: `actual` 0, `forecast` 1, `upper` 2, `lower` 3, `anomaly` 4. A role whose query is
missing is simply off.

### The horizon problem

A Prometheus range query only returns samples inside the dashboard's time range, which ends at
"now". A forecast is about the future, so its points cannot be stored at future timestamps. The
convention this plugin reads instead: the forecasting job writes, at each evaluation time `t`, one
series per **horizon** `h` (a `horizon` label, in seconds, or a duration such as `6h`), whose value
is the prediction for `t + h`.

- For `h > 0` the panel takes the newest sample of each horizon series (at `t0`) and draws it at
  `t0 + h`. Sorted by `h`, those points are the forecast curve, and the band edges likewise.
- `h = 0` (or a series with no horizon label) is the model's expected value for "now", recorded
  over time. Over the history it gives the expected line and band that the actual series is checked
  against: an actual sample outside `[lower, upper]` at the same time is an anomaly.
- A series without the horizon label is drawn at its own timestamps. A datasource that returns real
  future timestamps therefore works with no label at all.

The label name is an option (`horizonLabel`, default `horizon`).

### Quick-start mode (`quickStart`, off by default)

With only `actual` given and `quickStart: true`, the panel fits Holt-Winters in the browser: additive
seasonality of one day when the history holds at least two days of samples, otherwise Holt's linear
trend. It forecasts `horizon` (default `7d`) ahead with an 80% band from the one-step residuals and the
trend's standard error, and
uses the one-step fitted values as the expected band over the history. The legend, the band label and
the tooltip say "estimate". Precomputed `forecast`/`upper`/`lower` win over quick-start.

## Data model

```ts
interface Point {
  t: number;
  v: number;
} // ms, value
interface Model {
  actual: Point[]; // downsampled for drawing
  expected: Point[]; // history (h = 0)
  expectedUpper: Point[];
  expectedLower: Point[];
  forecast: Point[];
  upper: Point[];
  lower: Point[]; // future (h > 0), starting at the origin
  origin?: number; // "now": where history ends and forecast starts
  anomalies: Anomaly[];
  estimate: boolean; // quick-start
  xDomain: [number, number]; // dashboard start .. max(end, last forecast point)
}
interface Anomaly {
  t: number;
  v: number; // on the actual line
  expected?: number;
  deviation?: number; // actual - expected
  bandWidths?: number; // deviation / (upper - lower)
  score?: number;
  reason: "score" | "band";
  labels: Record<string, string>; // from the anomaly series, for the link
}
```

- Anomalies: each run of consecutive samples outside the band, or with a score above
  `anomalyThreshold`, becomes one marker at its largest deviation (or highest score).
- Threshold crossing is a pure function of the forecast and band paths and the threshold
  (`crossing.ts`): `never`, `already` (beyond at the origin), `crosses` (forecast crosses; earliest and
  latest from the band edges, the far edge possibly beyond the horizon), or `edge` (only the near band
  edge crosses).

## Component tree

```
ForecastChart (PanelPlugin)
├─ ForecastChartComponent        builds the model (memoised), owns hover state
│  ├─ PlotLayer (memo)           axes, grid, threshold, band, lines, now line, crossing callout
│  ├─ AnomalyMarkers             diamonds + labels; <a> when anomalyLink is set (keyboard reachable)
│  ├─ HoverLayer                 crosshair and tooltip; the only part that re-renders on hover
│  └─ Legend                     actual / forecast / band / anomaly / threshold, with line styles
└─ ForecastChartSettingsEditor   roles, threshold, anomalies, band, quick-start, format, legend
```

All drawing is SVG, sized from `contentDimensions`, coloured from the MUI theme (`text`, `divider`,
`primary`, `info`, `error`, `warning`) so light and dark both work. Anomalies are diamonds with a text
label, the forecast is dashed, the threshold dashed in another rhythm: nothing depends on colour
alone.

## Schema (CUE)

```cue
kind: "ForecastChart"
spec: close({
  roles?: { actual?: int, forecast?: int, upper?: int, lower?: int, anomaly?: int }  // >= 0
  horizonLabel?: string                     // default "horizon"
  threshold?: { value: number, label?: string, direction?: "above" | "below" }
  anomalyThreshold?: number                 // default 0.5
  band?: { opacity?: number (0..1), label?: string }   // default 0.25, "80%"
  quickStart?: bool                         // default false
  horizon?: duration                        // default "7d", quick-start only
  crossingCallout?: bool                    // default true
  anomalyLink?: string
  format?: common.#format
  legend?: common.#legend
})
```

## Dev stack

`dev/compose.yaml`: a Python generator writes 14 days of history as OpenMetrics, `promtool tsdb
create-blocks-from openmetrics` loads it into Prometheus' data volume, then the generator serves the
same functions live for Prometheus to scrape. Series: `kubelet_volume_stats_used_bytes` /
`_capacity_bytes` for two PVCs, `forecast_value` / `forecast_upper` / `forecast_lower` with
`horizon`, and `log_anomaly_score{namespace,pod}`, with one spike and one drop injected. Perses
v0.55.1 is provisioned with a demo dashboard.

## Open questions

- Several `actual` series in one panel: draw the first and say how many were skipped, or one chart
  per series? (Decided in DECISIONS.md.)
- Should `roles` accept query names? Perses queries have no stable name today, so indices it is.
