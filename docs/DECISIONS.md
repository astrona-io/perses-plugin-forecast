# Decisions

Choices made where the brief left room, or where following it literally would have been worse.

## Versions and tooling

- Perses v0.55.1, `@perses-dev/*` 0.55.1, `percli` v0.55.1 and CUE v0.17.1: the newest stable
  release and the same pin as the other `astrona-io` plugins at the time of writing.
- Repository layout, lint, Jest, rsbuild, CI and release workflows, `Containerfile` and
  `renovate.json` come from `perses-plugin-oat-results`, so the family stays alike.

## Rendering: SVG, not ECharts

The panel needs a band between two series, a second fainter band over the history, a "now" line,
diamond markers on stems with labels, and a callout joined to a point by a leader line. ECharts can
draw some of this through stacked areas and `markPoint`/`markLine`, but the callout, the leader and
keyboard focus on markers would all be custom anyway. Plain SVG, memoised per data and size, keeps
hover out of the drawing layer (a separate overlay draws the crosshair and tooltip), so moving the
mouse does not re-render the chart. Long series are reduced to a min and max per pixel column.

## The horizon label

A Prometheus range query cannot return future timestamps, so forecasts are read from a `horizon`
label (seconds or a duration): the newest sample of each horizon `h > 0` is drawn at its time plus
`h`, `h = 0` is the expected value over the history, and a series without the label is drawn at its
own time. The label name is the `horizonLabel` option. This keeps the role mapping generic: a future
forecast datasource that returns real future timestamps works without the label.

## Roles are query indices

Perses queries have no stable name, so `roles` maps each role to a 0-based query index, with
defaults in query order (actual, forecast, upper, lower, anomaly). The editor shows them 1-based.
Several `actual` series: the first is drawn and a note says how many were skipped; one forecast per
panel keeps the callout meaningful. Use a variable to pick the series.

## Threshold crossing

`thresholdCrossing` is a pure function in `crossing.ts`, linearly interpolated between samples, with
five outcomes: no forecast, never crosses, already beyond, crosses (with the near and far band edge
times, the far one possibly beyond the horizon), and only the near band edge crosses. Each has a unit
test, and the `below` direction has its own.

## Anomalies

A point is an anomaly when the `anomaly` score is above `anomalyThreshold` (default 0.5, so a 0/1
flag works), or when the actual value is outside the expected band. A band excursion only counts when
it is at least 1.5 half-band-widths from the expected value, and excursions less than an hour apart
are merged: otherwise a model's recoil after a spike shows as a second, tiny anomaly. Markers are
diamonds with a text label, so they do not rely on colour. With a safe `anomalyLink` (http, https or
relative) a marker is a link; otherwise it is a focusable button that shows the tooltip.

## Quick start

Off by default and labelled "estimate" in the "now" line, the legend and every tooltip. Additive
Holt-Winters with a daily season when there are two days of history, Holt's linear trend otherwise.
The textbook Holt prediction interval assumes the smoothing constants are right and grows far too
fast on a fine grid (a 5-minute grid over 21 days is 6000 steps), so the band combines a random-walk
level term from the one-step residuals with the trend's least-squares standard error. It is an
estimate, not a model to page anyone on.

## Dev stack

- `dev/compose.yaml` and `dev/provisioning/` instead of the brief's `docker-compose.yaml` and
  `dev/dashboards/`, matching the other plugins in the family. It works with `podman compose` and
  `docker compose`.
- The history (14 days) is written as OpenMetrics and loaded with `promtool tsdb
create-blocks-from openmetrics`, then the same functions are served live, so the panel has two
  weeks of data a minute after start. Containers wait for marker files rather than `depends_on`,
  because podman-compose waits for one-shot containers to be "running" and hangs.
- Perses listens on port 18081 by default (`PERSES_PORT` changes it), not 8080, so it does not
  clash with other local stacks.

## Not done

- No Grafana migration: the brief names no Grafana equivalent panel.
- `percli plugin start` against the dev stack was not used for the screenshots; they come from the
  built archive mounted into Perses, which is what users install.
