import type { PanelPlugin } from "@perses-dev/plugin-system";

import {
  type ForecastChartOptions,
  type ForecastChartProps,
  createInitialForecastChartOptions,
} from "./forecast-chart-types";
import { ForecastChartComponent } from "./ForecastChartComponent";
import { ForecastChartSettingsEditor } from "./ForecastChartSettingsEditor";

export const ForecastChart: PanelPlugin<
  ForecastChartOptions,
  ForecastChartProps
> = {
  PanelComponent: ForecastChartComponent,
  panelOptionsEditorComponents: [
    { label: "Settings", content: ForecastChartSettingsEditor },
  ],
  supportedQueryTypes: ["TimeSeriesQuery"],
  createInitialOptions: createInitialForecastChartOptions,
};
