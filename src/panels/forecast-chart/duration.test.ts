import { humanDuration, humanRange, parseDurationMs } from "./duration";

describe("parseDurationMs", () => {
  it.each([
    ["3600", 3_600_000],
    ["1.5", 1500],
    ["90s", 90_000],
    ["1h30m", 5_400_000],
    ["7d", 7 * 86_400_000],
    ["2w", 14 * 86_400_000],
    ["250ms", 250],
  ])("parses %s", (text, ms) => {
    expect(parseDurationMs(text)).toBe(ms);
  });

  it.each([undefined, "", "abc", "5x", "h1", "1h foo"])(
    "rejects %s",
    (text) => {
      expect(parseDurationMs(text)).toBeUndefined();
    },
  );
});

describe("humanDuration", () => {
  it("picks days, hours or minutes", () => {
    expect(humanDuration(23 * 86_400_000)).toBe("23 days");
    expect(humanDuration(5 * 3_600_000)).toBe("5 hours");
    expect(humanDuration(60_000)).toBe("1 minute");
    expect(humanDuration(40 * 60_000)).toBe("40 minutes");
  });
});

describe("humanRange", () => {
  it("uses the unit of the larger end", () => {
    expect(humanRange(18 * 86_400_000, 31 * 86_400_000)).toBe("18–31 days");
    expect(humanRange(3 * 3_600_000, 3 * 3_600_000)).toBe("3 hours");
  });
});
