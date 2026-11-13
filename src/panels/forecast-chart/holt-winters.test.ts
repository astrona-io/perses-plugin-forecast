import { estimate, resample } from "./holt-winters";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("resample", () => {
  it("carries the last value through gaps", () => {
    const r = resample([
      { t: 0, v: 1 },
      { t: 1000, v: 2 },
      { t: 2000, v: 3 },
      { t: 5000, v: 5 },
    ]);
    expect(r.step).toBe(1000);
    expect(r.values).toEqual([1, 2, 3, 3, 3, 5]);
  });

  it("caps the grid size", () => {
    const pts = Array.from({ length: 10_000 }, (_, i) => ({
      t: i * 1000,
      v: i,
    }));
    expect(resample(pts).values.length).toBeLessThanOrEqual(2000);
  });
});

describe("estimate", () => {
  it("needs at least three samples", () => {
    expect(estimate([{ t: 0, v: 1 }], DAY)).toBeUndefined();
  });

  it("follows a linear trend with Holt", () => {
    const pts = Array.from({ length: 24 }, (_, i) => ({
      t: i * HOUR,
      v: 10 + i,
    }));
    const e = estimate(pts, 10 * HOUR)!;
    expect(e.method).toBe("holt");
    const last = e.forecast[e.forecast.length - 1]!;
    expect(last.t).toBe(33 * HOUR);
    expect(last.v).toBeCloseTo(43, 0);
  });

  it("fits a daily season and widens the band with the horizon", () => {
    const pts = Array.from({ length: 24 * 6 }, (_, i) => ({
      t: i * HOUR,
      v:
        50 +
        0.1 * i +
        10 * Math.sin((2 * Math.PI * i) / 24) +
        ((i * 7919) % 5) / 5,
    }));
    const e = estimate(pts, 2 * DAY)!;
    expect(e.method).toBe("holt-winters");
    const w = (k: number): number => e.upper[k]!.v - e.lower[k]!.v;
    expect(w(e.upper.length - 1)).toBeGreaterThan(w(1));
    // The season comes back: 12 hours ahead differs from 24 hours ahead by about the amplitude.
    const at = (h: number): number =>
      e.forecast.find((p) => p.t === pts[pts.length - 1]!.t + h * HOUR)!.v;
    expect(Math.abs(at(6) - at(18))).toBeGreaterThan(10);
    expect(e.expected.length).toBeGreaterThan(0);
  });
});
