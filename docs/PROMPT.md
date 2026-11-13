You are a senior TypeScript/React (and, where needed, Go/CUE) engineer and Perses contributor. Build the Perses plugin described below in this repository (`perses-plugin-forecast`). Work autonomously: plan, build, test, document. Open a PR when it's done.

---

# Part 1: What to build. Forecast / anomaly overlay

**Repo:** `astrona-io/perses-plugin-forecast`
**Plugin kind(s):** Panel: `ForecastChart`
**Focus area:** Forecast
**Concept page:** https://claude.ai/artifact/KcToRbDWESkuMgDtPBrBvE#forecast (a private page; the owner can share it with you. Everything you need from it is in this prompt and in `docs/mockup.png`.)

## What it should look like
See `docs/mockup.png` in the repo. If it isn't there, ask for it. It's a concept sketch: match the idea and information density, not the exact pixels.

## Why
Perses' time-series panel can't draw a band between two series or mark single points. PromQL's `predict_linear` only fits a straight line and gives no uncertainty. This panel shows what *should* happen: a forecast line with a confidence band, markers where reality left the expected range, and a callout for when a threshold will be crossed. It's also the front end for the owner's log anomaly model.

## Data it reads
Queries are assigned **roles**:
- `actual`: any time series, e.g. `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100`
- `forecast`, `upper`, `lower`: series written by a forecasting job (recording rules or remote-write). Later a separate forecast datasource will supply these, so keep the role mapping generic.
- `anomaly`: a score series or a 0/1 flag, e.g. `log_anomaly_score{namespace, pod}`. A point is an anomaly when the score is over `anomalyThreshold`, or when `actual` is outside `[lower, upper]`.
- Optional **quick-start mode**: if only `actual` is given, compute a simple Holt-Winters forecast in the browser. Label it clearly as an estimate in the legend and tooltip.
Forecast series extend past "now". Make sure the x-axis extends to cover the forecast horizon, not just the dashboard's end time.

## Spec (options → CUE schema)
- `roles`: map of role → query index (or ref)
- `threshold`: `{value, label, direction: above|below}` (optional)
- `anomalyThreshold`: number (for score series)
- `band`: `{opacity, label}` (default label "80%")
- `horizon`: duration for quick-start mode (default 7d)
- `crossingCallout`: bool (default true)
- `anomalyLink`: link template with `${__time}`, `${__series.labels.<name>}` variables
- standard `format` / unit, legend

## Behaviour
- Solid line = actual, dashed line = forecast, shaded band between lower and upper.
- A vertical "now" line splits history from forecast.
- Anomalies are drawn as diamond markers (shape, not just colour), with a short label (e.g. "+15 pp").
- Hover shows actual vs expected and the deviation in units and in band widths.
- When the forecast crosses the threshold, a callout shows the estimated date and the earliest/latest date from the band edges ("Hits quota in ~23 days · 80% band: 18–31 days"), linked to the crossing point by a dashed line.
- Clicking an anomaly opens `anomalyLink` (e.g. Loki logs for that pod at that time).

## Acceptance criteria
- Precomputed mode works end to end with Prometheus. The `dev/` fake-data generator writes actual, forecast, upper, lower and anomaly-score series with realistic noise and two injected anomalies.
- Threshold crossing is correct when the band never crosses, always crosses, or crosses only at one edge. Unit-test each case.
- Quick-start mode is clearly labelled as an estimate and is off by default.
- Works in light and dark theme. Anomalies are distinguishable without colour.
- README includes a section "Feeding it from your own anomaly model" with the metric names it expects.

## The plugin family this belongs to
This repo is part of the `astrona-io` Perses plugin set. Already built (read them before you start, and match their structure, tooling, CI and README style):
`perses-plugin-oat-results`, `perses-plugin-sankey`, `perses-plugin-statetimeline`, `perses-plugin-honeycomb`, `perses-plugin-geomap`, `perses-plugin-servicegraph`, all under https://github.com/astrona-io.
Use the same Perses version pin as those repos unless there's a newer stable release, then note it in `docs/DECISIONS.md`.

---

# Part 2: How to build it (Perses plugin guide)

You are building a **Perses plugin** in this repository. Perses is the CNCF
dashboard project (https://github.com/perses/perses). Its core plugins live in
https://github.com/perses/plugins.


## Ground rules

1. **Copy upstream conventions; don't invent your own.** Before writing code, clone
   `perses/plugins` next to this repo and read 2–3 plugins close to this one.
   Panels: `timeserieschart`, `statushistorychart`, `heatmapchart`, `table`.
   Datasources: `prometheus`, `tempo`, `victorialogs`.
   Match their folder layout, `package.json` (including the `perses` section),
   the CUE schema layout, and the rsbuild / module-federation config.
2. **Scaffold with percli. Never hand-build the directory structure.** Install
   `percli` from the Perses GitHub releases (or `brew install perses/tap/percli`).
   Then check the real flags with `percli plugin --help` and
   `percli plugin generate --help`. Flags change between releases, so don't
   trust memory or this file over `--help`.
   - `percli plugin generate …` scaffolds the module or plugin
   - `percli plugin start` runs it against a local Perses dev server
   - `percli plugin test-schemas` validates the CUE schemas and JSON examples
   - `percli plugin build` produces the distributable archive
3. **Use the latest stable Perses release.** Pin `@perses-dev/*` package versions
   to the release you develop against. Write that release in the README.
4. **Use the shared building blocks:**
   - `@perses-dev/plugin-system` for plugin types and hooks (`useDataQueries`,
     time range, variables)
   - `@perses-dev/components` for UI pieces, legends, tooltips and the ECharts wrapper
   - `@perses-dev/core` for value formatting, units and thresholds
   - Reuse the shared CUE types (`common.#format`, `common.#thresholds`, …) in schemas
5. **Theme-aware only.** No hard-coded colours. Use the MUI theme and the Perses
   chart theme so light and dark mode both work.
6. **Accessibility.** Status must never be shown by colour alone. Use icon,
   label or pattern too. Everything clickable must be reachable by keyboard.
7. **Performance.** Stay smooth at the "large" size named in Part 1.
   Memoise transforms. Don't re-render on hover.
8. **Licence.** Apache-2.0, same as Perses. Only add dependencies with
   compatible licences. Prefer libraries already used upstream (ECharts, MUI).
9. **Stay upstreamable.** Write it so it could be offered to `perses/plugins`
   later: same code style, lint config, tests and docs format. Before you start,
   search `perses/plugins` issues and PRs for this plugin. If someone is already
   building it, stop and report that.

## Local dev environment

Add a `dev/` folder with a `docker-compose.yaml` that starts:
- Perses (official image)
- the data backend this plugin needs (usually Prometheus)
- a **fake-data generator** that emits the metrics, logs or API responses in
  Part 1, with realistic labels and some failure cases

Also provision a demo dashboard that uses the plugin (`dev/dashboards/*.json`),
so `docker compose up` followed by `percli plugin start` shows it working.

## Definition of done

- [ ] Scaffolded with `percli`. Layout matches upstream plugins.
- [ ] CUE schema plus at least one JSON example. `percli plugin test-schemas` passes.
- [ ] Grafana migration (`migrate/` CUE) if Part 1 names a Grafana equivalent.
- [ ] Panel options editor for every option in the spec, with sensible defaults.
- [ ] Unit tests (Jest + React Testing Library) for data transforms and rendering.
      Cover the empty state, error state and large-data cases.
- [ ] Works in light and dark theme. Includes screenshots of both in `docs/`.
- [ ] `percli plugin build` produces an archive. CI builds it on every PR.
- [ ] A GitHub Actions release workflow attaches the archive to a GitHub release on `v*` tags.
- [ ] README covers what it does, install, the data it expects, the options, a screenshot,
      and the Perses version it was tested with.
- [ ] Every acceptance criterion in Part 1 is checked off in the PR description.

## Working style

- Plan first. Write `docs/PLAN.md` covering the data model, component tree,
  schema and open questions before writing code.
- Use small commits with conventional messages (`feat:`, `fix:`, `docs:`, `test:`).
- If something in Part 1 is unclear or seems wrong, record your decision in
  `docs/DECISIONS.md` and keep going. Don't stop for the sake of it.
