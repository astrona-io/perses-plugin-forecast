# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-13

### Added

- `ForecastChart` panel: the actual series as a solid line, a forecast as a dashed line with a
  shaded confidence band, the expected line and band over the history, and a "now" line. The x-axis
  extends to the end of the forecast horizon.
- Queries play roles (`actual`, `forecast`, `upper`, `lower`, `anomaly`) by index. Forecast series
  with a `horizon` label are drawn ahead of their sample time; `horizon="0"` is the expected value
  over the history.
- Threshold callout: when the forecast crosses `threshold`, the estimated time and the earliest and
  latest times from the band edges, joined to the crossing point by a dashed line; also "stays
  below", "already past" and "only the band edge" cases. `direction: below` for falling values.
- Anomalies as labelled diamond markers ("spike +15 pp"), from a score over `anomalyThreshold` or
  the actual value well outside the band. Tooltip with actual, expected and deviation in units and
  band widths; keyboard focus; `anomalyLink` with `${__time}`, `${__time_from}`, `${__time_to}` and
  `${__series.labels.<name>}`.
- Quick-start mode (`quickStart`, off by default): a Holt-Winters estimate in the browser when only
  `actual` is given, labelled "estimate".
- Panel editor for every option, CUE schema with valid and invalid examples, and a `dev/` stack
  (Perses, Prometheus with 14 days of backfilled history, a fake forecast and anomaly-score
  generator) with a demo dashboard. Screenshots in light and dark in the README.

[Unreleased]: https://github.com/astrona-io/perses-plugin-forecast/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/astrona-io/perses-plugin-forecast/releases/tag/v0.1.0
