import { Anomaly } from "./data";
import { interpolateAnomalyLink, isSafeHref } from "./links";

const anomaly: Anomaly = {
  key: "1000000",
  t: 1_000_000,
  v: 1,
  reasons: ["score"],
  labels: { namespace: "shop", pod: "web 1" },
  from: 900_000,
  to: 1_100_000,
};

describe("interpolateAnomalyLink", () => {
  it("fills time and labels, URL-encoded", () => {
    expect(
      interpolateAnomalyLink(
        "/logs?from=${__time_from}&to=${__time_to}&at=${__time}&q=${__series.labels.pod}&ns=${__series.labels.namespace}",
        anomaly,
      ),
    ).toBe("/logs?from=600000&to=1400000&at=1000000&q=web%201&ns=shop");
  });

  it("leaves dashboard variables and unknown builtins", () => {
    expect(interpolateAnomalyLink("${env}/${__other}", anomaly)).toBe(
      "${env}/${__other}",
    );
  });

  it("empties a missing label", () => {
    expect(interpolateAnomalyLink("q=${__series.labels.node}", anomaly)).toBe(
      "q=",
    );
  });
});

describe("isSafeHref", () => {
  it.each([
    ["https://example.com", true],
    ["/relative", true],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    ["", false],
  ])("%s is %s", (href, safe) => {
    expect(isSafeHref(href)).toBe(safe);
  });
});
