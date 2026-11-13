import type { ReactElement } from "react";

import type { ForecastChartProps } from "./forecast-chart-types";

export function ForecastChartComponent(
  props: ForecastChartProps,
): ReactElement | null {
  const { queryResults, spec } = props;

  console.log("Panel data", queryResults);
  console.log("Panel spec", spec);

  // TODO: implement your awesome panel component here

  return <div>Panel goes here!</div>;
}
