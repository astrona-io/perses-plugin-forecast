import type { ThresholdOptions } from "@perses-dev/components";
import type { PanelProps, LegendSpecOptions } from "@perses-dev/plugin-system";
import type { TimeSeriesData } from "@perses-dev/spec";

export type QueryData = TimeSeriesData; // Type of data returned by a query plugin and supported by this plugin

export type ForecastChartProps = PanelProps<ForecastChartOptions, QueryData>;

export interface QuerySettingsOptions {
  queryIndex: number;
  colorMode: "fixed" | "fixed-single";
  colorValue: string;
}

export interface ForecastChartOptions {
  legend?: LegendSpecOptions;
  thresholds?: ThresholdOptions;
  querySettings?: QuerySettingsOptions;
}
