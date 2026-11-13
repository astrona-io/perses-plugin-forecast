import { fireEvent, render, screen } from "@testing-library/react";
import { ForecastChartSettingsEditor } from "./ForecastChartSettingsEditor";
import {
  ForecastChartOptions,
  createInitialForecastChartOptions,
} from "./forecast-chart-types";

function renderEditor(value: ForecastChartOptions): jest.Mock {
  const onChange = jest.fn();
  render(<ForecastChartSettingsEditor value={value} onChange={onChange} />);
  return onChange;
}

describe("ForecastChartSettingsEditor", () => {
  it("starts with quick start off", () => {
    expect(createInitialForecastChartOptions().quickStart).toBe(false);
  });

  it("sets a threshold value", () => {
    const onChange = renderEditor(createInitialForecastChartOptions());
    fireEvent.change(screen.getByLabelText("threshold value"), {
      target: { value: "85" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: { value: 85 } }),
    );
  });

  it("maps a role to a 1-based query number", () => {
    const onChange = renderEditor(createInitialForecastChartOptions());
    fireEvent.change(screen.getByLabelText("anomaly query"), {
      target: { value: "2" },
    });
    expect(onChange.mock.calls[0][0].roles.anomaly).toBe(1);
  });

  it("turns quick start on", () => {
    const onChange = renderEditor({});
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ quickStart: true }),
    );
  });

  it("flags a bad horizon", () => {
    renderEditor({ horizon: "soon" });
    expect(
      screen.getByText("Use a duration such as 7d or 12h"),
    ).toBeInTheDocument();
  });
});
