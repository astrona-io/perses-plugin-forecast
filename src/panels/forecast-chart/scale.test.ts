import { linear, niceTicks, timeTicks, yDomain } from "./scale";

describe("scale", () => {
  it("maps linearly", () => {
    expect(linear([0, 10], [0, 100])(2.5)).toBe(25);
    expect(linear([0, 10], [100, 0])(10)).toBe(0);
  });

  it("makes round ticks", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("includes zero for non-negative data and covers the threshold", () => {
    const [lo, hi] = yDomain([60, 72], [85]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(85);
  });

  it("picks a time step for the span", () => {
    const day = 86_400_000;
    const { step, ticks } = timeTicks(0, 44 * day, 6);
    expect(step).toBe(14 * day);
    expect(ticks[0]).toBe(0);
  });
});
