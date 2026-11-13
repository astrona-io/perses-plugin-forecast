import type { FormatOptions } from "@perses-dev/components";
import type {
  LegendSpecOptions,
  OptionsEditorProps,
  PanelProps,
} from "@perses-dev/plugin-system";
import type { TimeSeriesData } from "@perses-dev/spec";

export type QueryData = TimeSeriesData;

export type ForecastChartProps = PanelProps<ForecastChartOptions, QueryData>;
export type ForecastChartEditorProps = OptionsEditorProps<ForecastChartOptions>;

export const ROLES = [
  "actual",
  "forecast",
  "upper",
  "lower",
  "anomaly",
] as const;
export type Role = (typeof ROLES)[number];

/** Role to query index (0-based, in the order of the panel's queries). */
export type RoleMap = Partial<Record<Role, number>>;

export type ThresholdDirection = "above" | "below";

export interface ThresholdSpec {
  value: number;
  /** Shown on the line and in the callout ("quota"). Default "threshold". */
  label?: string;
  /** Crossing means going above (default) or below the value. */
  direction?: ThresholdDirection;
}

export interface BandSpec {
  /** Fill opacity, 0 to 1. Default 0.25. */
  opacity?: number;
  /** What the band is ("80%"). Default "80%". */
  label?: string;
}

export interface ForecastChartOptions {
  /** Which query plays which role. Unset roles keep their default index (actual 0 ... anomaly 4). */
  roles?: RoleMap;
  /**
   * Label on forecast, upper and lower series holding how far ahead the value is, in seconds or as
   * a duration ("6h"). Default `horizon`.
   */
  horizonLabel?: string;
  threshold?: ThresholdSpec;
  /** An anomaly-role sample above this is an anomaly. Default 0.5 (works for 0/1 flags). */
  anomalyThreshold?: number;
  band?: BandSpec;
  /** Holt-Winters estimate in the browser when no forecast series is given. Default false. */
  quickStart?: boolean;
  /** How far the quick-start estimate looks ahead. Default `7d`. */
  horizon?: string;
  /** Callout for when the forecast crosses the threshold. Default true. */
  crossingCallout?: boolean;
  /**
   * Opened when an anomaly is clicked. `${__time}` (ms), `${__time_from}` / `${__time_to}` (ms,
   * 5 minutes either side), `${__series.labels.<name>}` and dashboard variables are replaced.
   */
  anomalyLink?: string;
  format?: FormatOptions;
  /** The key under (or beside) the chart. Hidden when unset. */
  legend?: LegendSpecOptions;
}

export const DEFAULT_ROLES: Required<RoleMap> = {
  actual: 0,
  forecast: 1,
  upper: 2,
  lower: 3,
  anomaly: 4,
};
export const DEFAULT_HORIZON_LABEL = "horizon";
export const DEFAULT_ANOMALY_THRESHOLD = 0.5;
export const DEFAULT_BAND_OPACITY = 0.25;
export const DEFAULT_BAND_LABEL = "80%";
export const DEFAULT_QUICKSTART_HORIZON = "7d";
export const DEFAULT_THRESHOLD_LABEL = "threshold";
export const DEFAULT_FORMAT: FormatOptions = { unit: "decimal" };

export function createInitialForecastChartOptions(): ForecastChartOptions {
  return {
    roles: { ...DEFAULT_ROLES },
    anomalyThreshold: DEFAULT_ANOMALY_THRESHOLD,
    band: { opacity: DEFAULT_BAND_OPACITY, label: DEFAULT_BAND_LABEL },
    quickStart: false,
    crossingCallout: true,
    format: { ...DEFAULT_FORMAT },
    legend: { position: "bottom" },
  };
}

/** The roles in effect: unset roles keep their default index. */
export function resolveRoles(roles: RoleMap | undefined): Required<RoleMap> {
  return { ...DEFAULT_ROLES, ...(roles ?? {}) };
}
