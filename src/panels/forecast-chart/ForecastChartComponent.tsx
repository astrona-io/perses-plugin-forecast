import {
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  memo,
  useMemo,
  useState,
} from "react";
import { Box, Typography, useTheme } from "@mui/material";
import {
  FormatOptions,
  formatValue,
  useTimeZone,
} from "@perses-dev/components";
import {
  replaceVariablesInString,
  useAllVariableValues,
} from "@perses-dev/plugin-system";
import { Crossing, thresholdCrossing } from "./crossing";
import {
  Anomaly,
  Model,
  Point,
  anomalyLabel,
  buildModel,
  downsample,
  formatDeviation,
  nearest,
  valueAt,
} from "./data";
import { humanDuration, humanRange } from "./duration";
import {
  DEFAULT_BAND_LABEL,
  DEFAULT_BAND_OPACITY,
  DEFAULT_FORMAT,
  DEFAULT_THRESHOLD_LABEL,
  ForecastChartProps,
  ThresholdSpec,
  resolveRoles,
} from "./forecast-chart-types";
import { interpolateAnomalyLink, isSafeHref } from "./links";
import { linear, niceTicks, timeTicks, yDomain } from "./scale";

const DAY = 86_400_000;
const LEGEND_HEIGHT = 22;
const NOTE_HEIGHT = 18;
const MARGIN = { top: 12, right: 16, bottom: 22, left: 52 };
const TOOLTIP_WIDTH = 240;
const DIAMOND = 6;

interface Palette {
  actual: string;
  forecast: string;
  band: string;
  threshold: string;
  anomaly: string;
  crossing: string;
  grid: string;
  text: string;
  muted: string;
  background: string;
}

function usePalette(): Palette {
  const theme = useTheme();
  return useMemo(
    () => ({
      actual: theme.palette.info.main,
      forecast: theme.palette.primary.main,
      band: theme.palette.primary.main,
      threshold: theme.palette.error.main,
      anomaly: theme.palette.error.main,
      crossing: theme.palette.warning.main,
      grid: theme.palette.divider,
      text: theme.palette.text.primary,
      muted: theme.palette.text.secondary,
      background: theme.palette.background.paper,
    }),
    [theme],
  );
}

function linePath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  points.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  return d;
}

/** Closed polygon between an upper and a lower edge. */
function bandPath(
  upper: Point[],
  lower: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  if (upper.length < 2 || lower.length < 2) return "";
  const bottom = [...lower]
    .reverse()
    .map((p) => `L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join("");
  return `${linePath(upper, x, y)}${bottom}Z`;
}

/** Text of the crossing callout: a headline and an optional band line. */
export function calloutText(
  crossing: Crossing,
  origin: number,
  threshold: ThresholdSpec,
  bandLabel: string,
): { title: string; detail?: string } | undefined {
  const label = threshold.label || DEFAULT_THRESHOLD_LABEL;
  const below = threshold.direction === "below";
  switch (crossing.kind) {
    case "none":
      return undefined;
    case "already":
      return { title: `Already ${below ? "below" : "past"} ${label}` };
    case "never":
      return {
        title: `Stays ${below ? "above" : "below"} ${label}`,
        detail: `for the next ${humanDuration(crossing.horizonEnd - origin)}`,
      };
    case "edge":
      return {
        title: `May reach ${label} in ~${humanDuration(crossing.earliest - origin)}`,
        detail: `only the ${bandLabel} band edge; forecast does not`,
      };
    case "crosses": {
      const verb = below ? "Falls below" : "Hits";
      const detail =
        crossing.latest !== undefined
          ? `${bandLabel} band: ${humanRange(crossing.earliest - origin, crossing.latest - origin)}`
          : `${bandLabel} band: ${humanDuration(crossing.earliest - origin)} to beyond ${humanDuration(crossing.horizonEnd - origin)}`;
      return {
        title: `${verb} ${label} in ~${humanDuration(crossing.at - origin)}`,
        detail,
      };
    }
  }
}

interface Frame {
  width: number;
  height: number;
  x: (t: number) => number;
  y: (v: number) => number;
  xDomain: [number, number];
  yDomain: [number, number];
}

interface PlotProps {
  model: Model;
  frame: Frame;
  palette: Palette;
  format: FormatOptions;
  threshold?: ThresholdSpec;
  bandOpacity: number;
  crossing: Crossing;
  callout?: { title: string; detail?: string };
  formatTime: (t: number, step: number) => string;
  offsetMs: number;
}

/** Everything that does not change on hover; memoised so moving the mouse only redraws the crosshair. */
const PlotLayer = memo(function PlotLayer(props: PlotProps): ReactElement {
  const {
    model,
    frame,
    palette,
    format,
    threshold,
    bandOpacity,
    crossing,
    callout,
  } = props;
  const { x, y, width, height } = frame;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = height - MARGIN.bottom;
  const yTicks = niceTicks(
    frame.yDomain[0],
    frame.yDomain[1],
    Math.max(2, Math.floor((bottom - top) / 40)),
  );
  const { step, ticks: xTicks } = timeTicks(
    frame.xDomain[0],
    frame.xDomain[1],
    Math.max(2, Math.floor((right - left) / 90)),
    props.offsetMs,
  );
  const actual = downsample(
    model.actual,
    Math.max(50, Math.floor(right - left)),
  );
  const origin = model.origin;

  let calloutBox: ReactElement | null = null;
  if (callout && origin !== undefined) {
    const anchorT =
      crossing.kind === "crosses" || crossing.kind === "already"
        ? crossing.at
        : crossing.kind === "edge"
          ? crossing.earliest
          : undefined;
    const thresholdY = threshold ? y(threshold.value) : top;
    const ax = anchorT !== undefined ? x(anchorT) : right;
    const longest = Math.max(callout.title.length, callout.detail?.length ?? 0);
    const boxW = Math.min(240, Math.max(140, longest * 6.6 + 16));
    const boxH = callout.detail ? 40 : 24;
    const bx = Math.max(left + 4, Math.min(right - boxW - 4, ax - boxW - 24));
    const by =
      thresholdY - boxH - 26 > top
        ? thresholdY - boxH - 26
        : Math.min(bottom - boxH - 4, thresholdY + 26);
    calloutBox = (
      <g data-testid="crossing-callout">
        {anchorT !== undefined ? (
          <>
            <line
              x1={ax}
              y1={thresholdY}
              x2={Math.min(bx + boxW, ax)}
              y2={by + boxH / 2}
              stroke={palette.crossing}
              strokeDasharray="3 3"
            />
            <circle
              cx={ax}
              cy={thresholdY}
              r={5}
              fill={palette.crossing}
              stroke={palette.background}
              strokeWidth={1.5}
              data-testid="crossing-dot"
            />
          </>
        ) : null}
        <rect
          x={bx}
          y={by}
          width={boxW}
          height={boxH}
          rx={4}
          fill={palette.background}
          stroke={palette.crossing}
        />
        <text
          x={bx + 8}
          y={by + 16}
          fontSize={12}
          fontWeight={600}
          fill={palette.text}
        >
          {callout.title}
        </text>
        {callout.detail ? (
          <text x={bx + 8} y={by + 32} fontSize={11} fill={palette.muted}>
            {callout.detail}
          </text>
        ) : null}
      </g>
    );
  }

  return (
    <g>
      <defs>
        <clipPath id="forecast-plot-clip">
          <rect
            x={left}
            y={top}
            width={Math.max(0, right - left)}
            height={Math.max(0, bottom - top)}
          />
        </clipPath>
      </defs>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line
            x1={left}
            x2={right}
            y1={y(v)}
            y2={y(v)}
            stroke={palette.grid}
          />
          <text
            x={left - 6}
            y={y(v) + 4}
            fontSize={11}
            textAnchor="end"
            fill={palette.muted}
          >
            {formatValue(v, format)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text
          key={`x${t}`}
          x={x(t)}
          y={bottom + 15}
          fontSize={11}
          textAnchor="middle"
          fill={palette.muted}
        >
          {props.formatTime(t, step)}
        </text>
      ))}
      <g clipPath="url(#forecast-plot-clip)">
        <path
          d={bandPath(model.expectedUpper, model.expectedLower, x, y)}
          fill={palette.band}
          fillOpacity={bandOpacity * 0.5}
          data-testid="history-band"
        />
        <path
          d={bandPath(model.upper, model.lower, x, y)}
          fill={palette.band}
          fillOpacity={bandOpacity}
          data-testid="forecast-band"
        />
        {model.expected.length > 1 ? (
          <path
            d={linePath(model.expected, x, y)}
            fill="none"
            stroke={palette.forecast}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ) : null}
        <path
          d={linePath(actual, x, y)}
          fill="none"
          stroke={palette.actual}
          strokeWidth={1.75}
          data-testid="actual-line"
        />
        <path
          d={linePath(model.forecast, x, y)}
          fill="none"
          stroke={palette.forecast}
          strokeWidth={2}
          strokeDasharray="6 4"
          data-testid="forecast-line"
        />
      </g>
      {threshold ? (
        <g data-testid="threshold">
          <line
            x1={left}
            x2={right}
            y1={y(threshold.value)}
            y2={y(threshold.value)}
            stroke={palette.threshold}
            strokeDasharray="5 4"
          />
          <text
            x={left + 6}
            y={y(threshold.value) - 5}
            fontSize={11}
            fill={palette.threshold}
          >
            {`${threshold.label || DEFAULT_THRESHOLD_LABEL} ${formatValue(threshold.value, format)}`}
          </text>
        </g>
      ) : null}
      {origin !== undefined &&
      origin > frame.xDomain[0] &&
      origin < frame.xDomain[1] ? (
        <g data-testid="now">
          <line
            x1={x(origin)}
            x2={x(origin)}
            y1={top}
            y2={bottom}
            stroke={palette.muted}
            strokeDasharray="2 2"
          />
          <text
            x={x(origin) + 4}
            y={top + 10}
            fontSize={11}
            fill={palette.muted}
          >
            {model.estimate ? "now · estimate" : "now"}
          </text>
        </g>
      ) : null}
      {calloutBox}
    </g>
  );
});

interface Focus {
  anomaly?: Anomaly;
  t?: number;
  px: number;
  py: number;
}

function Tooltip(props: {
  focus: Focus;
  model: Model;
  format: FormatOptions;
  width: number;
  height: number;
  formatTooltipTime: (t: number) => string;
}): ReactElement | null {
  const { focus, model, format, width, height } = props;
  const t = focus.anomaly?.t ?? focus.t;
  if (t === undefined) return null;
  const isFuture = model.origin !== undefined && t > model.origin;
  const rows: Array<[string, string]> = [];
  const fmt = (v: number | undefined): string =>
    v === undefined ? "–" : formatValue(v, format);
  if (!isFuture) {
    const actual = focus.anomaly?.v ?? nearest(model.actual, t)?.v;
    const expected = valueAt(model.expected, t);
    rows.push(["Actual", fmt(actual)]);
    if (expected !== undefined) {
      rows.push(["Expected", fmt(expected)]);
      if (actual !== undefined) {
        const up = valueAt(model.expectedUpper, t);
        const lo = valueAt(model.expectedLower, t);
        const dev = actual - expected;
        const widths =
          up !== undefined && lo !== undefined && up > lo
            ? dev / (up - lo)
            : undefined;
        const widthText =
          widths !== undefined
            ? ` (${widths >= 0 ? "+" : "−"}${Math.abs(widths).toFixed(1)} band widths)`
            : "";
        rows.push(["Deviation", `${formatDeviation(dev, format)}${widthText}`]);
      }
    }
  } else {
    rows.push(["Forecast", fmt(valueAt(model.forecast, t))]);
    const up = valueAt(model.upper, t);
    const lo = valueAt(model.lower, t);
    if (up !== undefined && lo !== undefined)
      rows.push(["Band", `${fmt(lo)} – ${fmt(up)}`]);
  }
  if (focus.anomaly?.score !== undefined) {
    rows.push(["Anomaly score", focus.anomaly.score.toFixed(2)]);
  }
  const left =
    focus.px + 14 + TOOLTIP_WIDTH > width
      ? Math.max(0, focus.px - TOOLTIP_WIDTH - 14)
      : focus.px + 14;
  const top = Math.min(Math.max(0, focus.py - 20), Math.max(0, height - 130));
  return (
    <Box
      role="tooltip"
      sx={{
        position: "absolute",
        left,
        top,
        width: TOOLTIP_WIDTH,
        pointerEvents: "none",
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        boxShadow: 2,
        p: 1,
        zIndex: 2,
      }}
    >
      <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
        {props.formatTooltipTime(t)}
        {model.estimate && isFuture ? " · estimate" : ""}
      </Typography>
      {focus.anomaly ? (
        <Typography
          variant="caption"
          sx={{ display: "block", color: "error.main" }}
        >
          {anomalyLabel(focus.anomaly, format)}
        </Typography>
      ) : null}
      {rows.map(([k, v]) => (
        <Box
          key={k}
          sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="caption" color="text.secondary">
            {k}
          </Typography>
          <Typography variant="caption">{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function LegendItem(props: {
  color: string;
  label: string;
  kind: "line" | "dashed" | "band" | "diamond";
}): ReactElement {
  const { color, label, kind } = props;
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, mr: 1.5 }}
    >
      <svg width={18} height={10} aria-hidden="true">
        {kind === "band" ? (
          <rect
            x={0}
            y={1}
            width={18}
            height={8}
            fill={color}
            fillOpacity={0.35}
          />
        ) : kind === "diamond" ? (
          <path d="M9,0L14,5L9,10L4,5Z" fill={color} />
        ) : (
          <line
            x1={0}
            x2={18}
            y1={5}
            y2={5}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={kind === "dashed" ? "4 3" : undefined}
          />
        )}
      </svg>
      <Typography variant="caption">{label}</Typography>
    </Box>
  );
}

export function ForecastChartComponent(
  props: ForecastChartProps,
): ReactElement | null {
  const { queryResults, spec, contentDimensions } = props;
  const palette = usePalette();
  const { formatWithUserTimeZone } = useTimeZone();
  const variables = useAllVariableValues();
  const [focus, setFocus] = useState<Focus | undefined>();

  const format = spec.format ?? DEFAULT_FORMAT;
  const bandOpacity = spec.band?.opacity ?? DEFAULT_BAND_OPACITY;
  const bandLabel = spec.band?.label || DEFAULT_BAND_LABEL;
  const threshold =
    spec.threshold && Number.isFinite(spec.threshold.value)
      ? spec.threshold
      : undefined;

  const model = useMemo(
    () => buildModel(queryResults, { spec }),
    [queryResults, spec],
  );
  const crossing = useMemo<Crossing>(
    () =>
      threshold
        ? thresholdCrossing(
            model.forecast,
            model.upper,
            model.lower,
            threshold.value,
            threshold.direction,
          )
        : { kind: "none" },
    [model, threshold],
  );
  const callout =
    threshold && (spec.crossingCallout ?? true) && model.origin !== undefined
      ? calloutText(crossing, model.origin, threshold, bandLabel)
      : undefined;

  const width = contentDimensions?.width ?? 0;
  const height = contentDimensions?.height ?? 0;
  const showLegend = spec.legend !== undefined;
  const notes = model.notes;
  const plotHeight = Math.max(
    0,
    height -
      (showLegend ? LEGEND_HEIGHT : 0) -
      (notes.length ? NOTE_HEIGHT : 0),
  );

  const frame = useMemo<Frame>(() => {
    const values = [
      model.actual,
      model.forecast,
      model.upper,
      model.lower,
      model.expectedUpper,
      model.expectedLower,
    ]
      .flat()
      .map((p) => p.v);
    const yd = yDomain(values, threshold ? [threshold.value] : []);
    return {
      width,
      height: plotHeight,
      xDomain: model.xDomain,
      yDomain: yd,
      x: linear(model.xDomain, [MARGIN.left, width - MARGIN.right]),
      y: linear(yd, [plotHeight - MARGIN.bottom, MARGIN.top]),
    };
  }, [model, threshold, width, plotHeight]);

  const offsetMs = useMemo(() => {
    // Day ticks land on the viewer's midnight: the zone offset at the start of the range.
    const probe = new Date(model.xDomain[0]);
    const local =
      (Number(formatWithUserTimeZone(probe, "H")) * 60 +
        Number(formatWithUserTimeZone(probe, "m"))) *
      60_000;
    const utc = ((probe.getTime() % DAY) + DAY) % DAY;
    let off = local - (utc - (utc % 60_000));
    if (off > DAY / 2) off -= DAY;
    if (off < -DAY / 2) off += DAY;
    return Number.isFinite(off) ? off : 0;
  }, [model.xDomain, formatWithUserTimeZone]);

  const formatTime = useMemo(
    () => (t: number, step: number) =>
      formatWithUserTimeZone(new Date(t), step >= DAY ? "MMM d" : "HH:mm"),
    [formatWithUserTimeZone],
  );
  const formatTooltipTime = (t: number): string =>
    formatWithUserTimeZone(new Date(t), "yyyy-MM-dd HH:mm");

  if (contentDimensions === undefined) return null;

  const roles = resolveRoles(spec.roles);
  if (queryResults.length > 0 && !queryResults[roles.actual]) {
    const count = queryResults.length;
    return (
      <Box sx={{ p: 1 }} role="alert">
        <Typography color="error">
          {`The actual role points at query ${roles.actual + 1}, but the panel has ${count} quer${count === 1 ? "y" : "ies"}.`}
        </Typography>
      </Box>
    );
  }
  if (model.actual.length === 0 && model.forecast.length === 0) {
    return (
      <Box
        sx={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography color="text.secondary">No data</Typography>
      </Box>
    );
  }

  const { x, y } = frame;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const [x0, x1] = model.xDomain;

  const linkFor = (a: Anomaly): string | undefined => {
    if (!spec.anomalyLink) return undefined;
    const href = replaceVariablesInString(
      interpolateAnomalyLink(spec.anomalyLink, a),
      variables,
    );
    return isSafeHref(href) ? href : undefined;
  };

  const onMove = (e: MouseEvent<SVGRectElement>): void => {
    const box = (
      e.currentTarget.ownerSVGElement ?? e.currentTarget
    ).getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const t = x0 + ((px - left) / Math.max(1, right - left)) * (x1 - x0);
    const snapped =
      model.origin !== undefined && t > model.origin
        ? t
        : (nearest(model.actual, t)?.t ?? t);
    setFocus({ t: snapped, px, py });
  };

  const showAnomaly = (a: Anomaly): void =>
    setFocus({ anomaly: a, px: x(a.t), py: y(a.v) });
  const onKey =
    (a: Anomaly) =>
    (e: KeyboardEvent<Element>): void => {
      if (e.key === "Enter" || e.key === " ") {
        // A link opens on Enter by itself; Space and Enter on a plain marker show its details.
        if (!(
          e.currentTarget.tagName.toLowerCase() === "a" && e.key === "Enter"
        )) {
          e.preventDefault();
          showAnomaly(a);
        }
      } else if (e.key === "Escape") setFocus(undefined);
    };

  const hoverT = focus?.anomaly ? undefined : focus?.t;

  return (
    <Box
      sx={{
        position: "relative",
        width,
        height,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {notes.length ? (
        <Typography
          variant="caption"
          color="warning.main"
          noWrap
          title={notes.join(" ")}
          sx={{ height: NOTE_HEIGHT, px: 1 }}
          data-testid="notes"
        >
          {notes.join(" ")}
        </Typography>
      ) : null}
      <Box sx={{ position: "relative", height: plotHeight }}>
        <svg
          width={width}
          height={plotHeight}
          role="img"
          aria-label={`${model.actualName || "Series"} with forecast${callout ? `: ${callout.title}` : ""}`}
          style={{ display: "block", fontFamily: "inherit" }}
        >
          <PlotLayer
            model={model}
            frame={frame}
            palette={palette}
            format={format}
            threshold={threshold}
            bandOpacity={bandOpacity}
            crossing={crossing}
            callout={callout}
            formatTime={formatTime}
            offsetMs={offsetMs}
          />
          <rect
            x={left}
            y={MARGIN.top}
            width={Math.max(0, right - left)}
            height={Math.max(0, plotHeight - MARGIN.top - MARGIN.bottom)}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setFocus(undefined)}
            data-testid="hover-layer"
          />
          {hoverT !== undefined ? (
            <line
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={MARGIN.top}
              y2={plotHeight - MARGIN.bottom}
              stroke={palette.muted}
              strokeOpacity={0.6}
              pointerEvents="none"
            />
          ) : null}
          {model.anomalies.map((a) => {
            const cx = x(a.t);
            const cy = y(a.v);
            const label = anomalyLabel(a, format);
            const href = linkFor(a);
            const below = (a.deviation ?? 0) < 0;
            const body = (
              <>
                <path
                  d={`M${cx},${cy - DIAMOND}L${cx + DIAMOND},${cy}L${cx},${cy + DIAMOND}L${cx - DIAMOND},${cy}Z`}
                  fill={palette.anomaly}
                  stroke={palette.background}
                  strokeWidth={1.5}
                />
                <text
                  x={cx}
                  y={below ? cy + DIAMOND + 13 : cy - DIAMOND - 5}
                  fontSize={11}
                  fontWeight={600}
                  textAnchor="middle"
                  fill={palette.anomaly}
                >
                  {label}
                </text>
              </>
            );
            const common = {
              "data-testid": "anomaly",
              "aria-label": `${label} at ${formatTooltipTime(a.t)}`,
              onMouseEnter: () => showAnomaly(a),
              onMouseLeave: () => setFocus(undefined),
              onFocus: () => showAnomaly(a),
              onBlur: () => setFocus(undefined),
              onKeyDown: onKey(a),
              style: { cursor: href ? "pointer" : "default" },
            };
            return href ? (
              <a
                key={a.key}
                {...common}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {body}
              </a>
            ) : (
              <g key={a.key} {...common} tabIndex={0} role="button">
                {body}
              </g>
            );
          })}
        </svg>
        {focus ? (
          <Tooltip
            focus={focus}
            model={model}
            format={format}
            width={width}
            height={plotHeight}
            formatTooltipTime={formatTooltipTime}
          />
        ) : null}
      </Box>
      {showLegend ? (
        <Box
          aria-label="Legend"
          sx={{
            height: LEGEND_HEIGHT,
            px: 1,
            display: "flex",
            alignItems: "center",
            flexWrap: "nowrap",
            overflow: "hidden",
          }}
        >
          <LegendItem
            color={palette.actual}
            label={model.actualName || "actual"}
            kind="line"
          />
          {model.forecast.length ? (
            <LegendItem
              color={palette.forecast}
              label={model.estimate ? "forecast (estimate)" : "forecast"}
              kind="dashed"
            />
          ) : null}
          {model.upper.length || model.expectedUpper.length ? (
            <LegendItem
              color={palette.band}
              label={`${bandLabel} band`}
              kind="band"
            />
          ) : null}
          {model.anomalies.length ? (
            <LegendItem
              color={palette.anomaly}
              label="anomaly"
              kind="diamond"
            />
          ) : null}
          {threshold ? (
            <LegendItem
              color={palette.threshold}
              label={threshold.label || DEFAULT_THRESHOLD_LABEL}
              kind="dashed"
            />
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
