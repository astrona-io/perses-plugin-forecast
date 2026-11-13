import { Point, firstCrossing, thresholdCrossing } from "./crossing";

const DAY = 86_400_000;
/** A straight line from `from` at day 0 to `to` at day `days`, one point a day. */
function line(from: number, to: number, days = 30): Point[] {
  return Array.from({ length: days + 1 }, (_, i) => ({
    t: i * DAY,
    v: from + ((to - from) * i) / days,
  }));
}

describe("firstCrossing", () => {
  it("interpolates between samples", () => {
    expect(firstCrossing(line(0, 30), 15.5, "above")).toBeCloseTo(15.5 * DAY);
  });

  it("returns the first time when already beyond", () => {
    expect(firstCrossing(line(90, 95), 85, "above")).toBe(0);
  });

  it("handles a falling series for below", () => {
    expect(firstCrossing(line(30, 0), 10, "below")).toBeCloseTo(20 * DAY);
  });

  it("is undefined when it never crosses", () => {
    expect(firstCrossing(line(0, 10), 85, "above")).toBeUndefined();
  });
});

describe("thresholdCrossing", () => {
  it("is none without a forecast", () => {
    expect(thresholdCrossing([], [], [], 85)).toEqual({ kind: "none" });
  });

  it("never crosses", () => {
    const c = thresholdCrossing(line(50, 60), line(55, 70), line(45, 50), 85);
    expect(c).toEqual({ kind: "never", horizonEnd: 30 * DAY });
  });

  it("is already beyond", () => {
    const c = thresholdCrossing(line(90, 95), line(92, 99), line(88, 91), 85);
    expect(c).toEqual({ kind: "already", at: 0 });
  });

  it("all three cross", () => {
    // forecast 70 -> 100 crosses 85 at day 15; upper 70 -> 130 at day 7.5; lower 70 -> 90 at day 22.5.
    const c = thresholdCrossing(line(70, 100), line(70, 130), line(70, 90), 85);
    expect(c.kind).toBe("crosses");
    if (c.kind !== "crosses") return;
    expect(c.at).toBeCloseTo(15 * DAY);
    expect(c.earliest).toBeCloseTo(7.5 * DAY);
    expect(c.latest).toBeCloseTo(22.5 * DAY);
    expect(c.horizonEnd).toBe(30 * DAY);
  });

  it("only one edge crosses", () => {
    // forecast 70 -> 80 stays below; upper 70 -> 100 crosses at day 15.
    const c = thresholdCrossing(line(70, 80), line(70, 100), line(70, 75), 85);
    expect(c.kind).toBe("edge");
    if (c.kind !== "edge") return;
    expect(c.earliest).toBeCloseTo(15 * DAY);
  });

  it("leaves latest open when the far edge never crosses", () => {
    const c = thresholdCrossing(line(70, 100), line(70, 130), line(70, 80), 85);
    expect(c.kind).toBe("crosses");
    if (c.kind !== "crosses") return;
    expect(c.latest).toBeUndefined();
  });

  it("uses the lower edge as near edge for below", () => {
    const c = thresholdCrossing(
      line(30, 0),
      line(30, 5),
      line(30, -30),
      10,
      "below",
    );
    expect(c.kind).toBe("crosses");
    if (c.kind !== "crosses") return;
    expect(c.at).toBeCloseTo(20 * DAY);
    expect(c.earliest).toBeCloseTo(10 * DAY);
    expect(c.latest).toBeCloseTo(24 * DAY);
  });

  it("falls back to the forecast without a band", () => {
    const c = thresholdCrossing(line(70, 100), [], [], 85);
    expect(c).toMatchObject({
      kind: "crosses",
      earliest: c.kind === "crosses" ? c.at : 0,
    });
  });
});
