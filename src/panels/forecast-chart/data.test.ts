import {
  DAY,
  HOUR,
  NOW,
  forecastFixture,
  horizonSeries,
  results,
  series,
  usage,
} from "../../test-utils/fixtures";
import {
  anomalyLabel,
  buildModel,
  downsample,
  formatDeviation,
  horizonPaths,
  nearest,
  valueAt,
} from "./data";

describe("valueAt and nearest", () => {
  const pts = [
    { t: 0, v: 0 },
    { t: 10, v: 10 },
  ];
  it("interpolates inside and is undefined outside", () => {
    expect(valueAt(pts, 5)).toBe(5);
    expect(valueAt(pts, 11)).toBeUndefined();
  });
  it("finds the nearest point", () => {
    expect(nearest(pts, 7)).toEqual({ t: 10, v: 10 });
  });
});

describe("horizonPaths", () => {
  it("moves the newest sample of each horizon series ahead", () => {
    const p = horizonPaths(
      horizonSeries("f", (d) => d),
      "horizon",
    );
    expect(p.ahead).toHaveLength(30);
    expect(p.ahead[0]).toEqual({ t: NOW + DAY, v: 1 });
    expect(p.issued).toBe(NOW);
    expect(p.own).toEqual([]);
  });

  it("keeps series without the label at their own time", () => {
    const p = horizonPaths([series("f", {}, [[NOW, 3]])], "horizon");
    expect(p.own).toEqual([{ t: NOW, v: 3 }]);
    expect(p.ahead).toEqual([]);
  });

  it("accepts durations and a custom label", () => {
    const p = horizonPaths([series("f", { ahead: "6h" }, [[NOW, 3]])], "ahead");
    expect(p.ahead).toEqual([{ t: NOW + 6 * HOUR, v: 3 }]);
  });
});

describe("buildModel", () => {
  it("splits history and forecast at the origin", () => {
    const m = buildModel(forecastFixture(), { spec: {} });
    expect(m.origin).toBe(NOW);
    expect(m.actual).toHaveLength(usage().length);
    expect(m.forecast[0]!.t).toBe(NOW);
    expect(m.forecast[m.forecast.length - 1]!.t).toBe(NOW + 30 * DAY);
    expect(m.expected.length).toBeGreaterThan(300);
    expect(m.xDomain[1]).toBe(NOW + 30 * DAY);
    expect(m.estimate).toBe(false);
    expect(m.notes).toEqual([]);
  });

  it("finds the spike and the drop, with the score on the spike", () => {
    const m = buildModel(forecastFixture(), { spec: {} });
    expect(m.anomalies).toHaveLength(2);
    const [spike, drop] = m.anomalies;
    expect(spike!.t).toBe(NOW - 8 * DAY);
    expect(spike!.deviation).toBeCloseTo(15);
    expect(spike!.bandWidths).toBeCloseTo(15 / 4);
    expect(spike!.reasons).toEqual(["band", "score"]);
    expect(spike!.labels.pod).toBe("web-0");
    expect(drop!.t).toBe(NOW - 5 * DAY);
    expect(drop!.deviation).toBeCloseTo(-11);
    expect(anomalyLabel(drop!, { unit: "percent" })).toBe("drop −11 pp");
  });

  it("uses role indices from the spec", () => {
    const [a, f, u, l, s] = forecastFixture();
    const m = buildModel([s!, a!, f!, u!, l!], {
      spec: {
        roles: { anomaly: 0, actual: 1, forecast: 2, upper: 3, lower: 4 },
      },
    });
    expect(m.actual).toHaveLength(usage().length);
    expect(m.anomalies).toHaveLength(2);
  });

  it("notes a role that points at a missing query", () => {
    const m = buildModel(results([series("used", {}, usage())]), {
      spec: { roles: { forecast: 7 } },
    });
    expect(m.notes[0]).toMatch(/forecast role points at query 8/);
    expect(m.forecast).toEqual([]);
  });

  it("notes extra actual series", () => {
    const m = buildModel(
      results([series("a", {}, usage()), series("b", {}, usage())]),
      { spec: {} },
    );
    expect(m.notes[0]).toMatch(/1 of 2/);
  });

  it("estimates in the browser only when quickStart is on", () => {
    const only = results([series("used", {}, usage())]);
    expect(buildModel(only, { spec: {} }).forecast).toEqual([]);
    const m = buildModel(only, { spec: { quickStart: true, horizon: "3d" } });
    expect(m.estimate).toBe(true);
    expect(m.forecast[m.forecast.length - 1]!.t).toBeGreaterThanOrEqual(
      NOW + 3 * DAY - HOUR,
    );
    expect(m.upper.length).toBe(m.forecast.length);
  });

  it("ignores quickStart when a forecast is given", () => {
    const m = buildModel(forecastFixture(), { spec: { quickStart: true } });
    expect(m.estimate).toBe(false);
  });

  it("copes with empty and null data", () => {
    const m = buildModel(results([series("x", {}, [[NOW, null]])]), {
      spec: {},
      now: NOW,
    });
    expect(m.actual).toEqual([]);
    expect(m.anomalies).toEqual([]);
  });
});

describe("formatDeviation", () => {
  it("uses pp for percent units", () => {
    expect(formatDeviation(15.2, { unit: "percent" })).toBe("+15 pp");
    expect(formatDeviation(-0.052, { unit: "percent-decimal" })).toBe(
      "−5.2 pp",
    );
  });
  it("formats other units", () => {
    expect(formatDeviation(2048, { unit: "bytes" })).toMatch(/^\+2/);
  });
});

describe("downsample", () => {
  it("keeps min and max per bucket", () => {
    const pts = Array.from({ length: 100_000 }, (_, i) => ({
      t: i,
      v: i === 5000 ? 1000 : i % 7,
    }));
    const out = downsample(pts, 500);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.some((p) => p.v === 1000)).toBe(true);
  });
});
