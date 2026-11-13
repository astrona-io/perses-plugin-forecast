import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariableStateMap } from "@perses-dev/plugin-system";
import {
  DAY,
  NOW,
  forecastFixture,
  results,
  series,
  usage,
} from "../../test-utils/fixtures";
import { ForecastChartComponent, calloutText } from "./ForecastChartComponent";
import {
  ForecastChartOptions,
  ForecastChartProps,
} from "./forecast-chart-types";

const MOCK_VARIABLES: VariableStateMap = {
  env: { value: "prod", loading: false },
};

jest.mock("@perses-dev/plugin-system", () => ({
  ...jest.requireActual("@perses-dev/plugin-system"),
  useAllVariableValues: (): VariableStateMap => MOCK_VARIABLES,
}));

const QUOTA: ForecastChartOptions = {
  threshold: { value: 85, label: "quota" },
  format: { unit: "percent" },
  legend: { position: "bottom" },
};

function renderPanel(
  queryResults: ForecastChartProps["queryResults"],
  spec: ForecastChartOptions = QUOTA,
): ReturnType<typeof render> {
  return render(
    <ForecastChartComponent
      spec={spec}
      queryResults={queryResults}
      contentDimensions={{ width: 900, height: 400 }}
    />,
  );
}

describe("ForecastChartComponent", () => {
  it("says there is no data for empty results", () => {
    renderPanel([]);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("explains a missing actual query", () => {
    renderPanel(results([series("x", {}, usage())]), {
      roles: { actual: 3 },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The actual role points at query 4, but the panel has 1 query.",
    );
  });

  it("draws the lines, band, threshold and crossing callout", () => {
    renderPanel(forecastFixture());
    expect(screen.getByTestId("actual-line").getAttribute("d")).not.toBe("");
    expect(screen.getByTestId("forecast-line").getAttribute("d")).not.toBe("");
    expect(screen.getByTestId("forecast-band").getAttribute("d")).toMatch(/Z$/);
    expect(screen.getByText("quota 85%")).toBeInTheDocument();
    expect(screen.getByText("Hits quota in ~15 days")).toBeInTheDocument();
    expect(screen.getByText("80% band: 10–24 days")).toBeInTheDocument();
    expect(screen.getByTestId("crossing-dot")).toBeInTheDocument();
    expect(screen.getByLabelText("Legend")).toHaveTextContent(/forecast/);
  });

  it("hides the callout when turned off", () => {
    renderPanel(forecastFixture(), { ...QUOTA, crossingCallout: false });
    expect(screen.queryByTestId("crossing-callout")).not.toBeInTheDocument();
  });

  it("labels the anomalies and shows details on keyboard focus", async () => {
    renderPanel(forecastFixture());
    const markers = screen.getAllByTestId("anomaly");
    expect(markers).toHaveLength(2);
    expect(screen.getByText("spike +15 pp")).toBeInTheDocument();
    expect(screen.getByText("drop −11 pp")).toBeInTheDocument();
    await userEvent.tab();
    expect(markers[0]).toHaveFocus();
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Expected");
    expect(tip).toHaveTextContent("+3.8 band widths");
    expect(tip).toHaveTextContent("Anomaly score0.90");
    act(() => {
      fireEvent.keyDown(markers[0]!, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("links anomalies with time, labels and variables", () => {
    renderPanel(forecastFixture(), {
      ...QUOTA,
      anomalyLink:
        "/logs/${env}?from=${__time_from}&pod=${__series.labels.pod}",
    });
    const link = screen.getAllByTestId("anomaly")[0]!;
    expect(link.tagName.toLowerCase()).toBe("a");
    expect(link.getAttribute("href")).toBe(
      `/logs/prod?from=${NOW - 8 * DAY - 5 * 60_000}&pod=web-0`,
    );
  });

  it("drops an unsafe anomaly link", () => {
    renderPanel(forecastFixture(), {
      ...QUOTA,
      anomalyLink: "javascript:alert(1)",
    });
    expect(screen.getAllByTestId("anomaly")[0]!.tagName.toLowerCase()).toBe(
      "g",
    );
  });

  it("labels a quick-start forecast as an estimate", () => {
    renderPanel(results([series("used", {}, usage())]), {
      ...QUOTA,
      quickStart: true,
    });
    expect(screen.getByText("now · estimate")).toBeInTheDocument();
    expect(screen.getByLabelText("Legend")).toHaveTextContent(
      "forecast (estimate)",
    );
  });

  it("draws a large series quickly with a bounded path", () => {
    const values: Array<[number, number]> = [];
    for (let i = 0; i < 200_000; i++)
      values.push([NOW - (200_000 - i) * 6000, 50 + (i % 13)]);
    const start = performance.now();
    renderPanel(results([series("big", {}, values)]), {});
    expect(performance.now() - start).toBeLessThan(3000);
    const d = screen.getByTestId("actual-line").getAttribute("d") ?? "";
    expect(d.split("L").length).toBeLessThan(2000);
  });
});

describe("calloutText", () => {
  const threshold = { value: 85, label: "quota" };
  it("covers every crossing kind", () => {
    expect(calloutText({ kind: "none" }, 0, threshold, "80%")).toBeUndefined();
    expect(
      calloutText({ kind: "already", at: 0 }, 0, threshold, "80%")?.title,
    ).toBe("Already past quota");
    expect(
      calloutText({ kind: "never", horizonEnd: 30 * DAY }, 0, threshold, "80%"),
    ).toEqual({ title: "Stays below quota", detail: "for the next 30 days" });
    expect(
      calloutText(
        { kind: "edge", earliest: 10 * DAY, horizonEnd: 30 * DAY },
        0,
        threshold,
        "80%",
      )?.title,
    ).toBe("May reach quota in ~10 days");
    expect(
      calloutText(
        {
          kind: "crosses",
          at: 23 * DAY,
          earliest: 18 * DAY,
          horizonEnd: 30 * DAY,
        },
        0,
        threshold,
        "80%",
      ),
    ).toEqual({
      title: "Hits quota in ~23 days",
      detail: "80% band: 18 days to beyond 30 days",
    });
  });
});
