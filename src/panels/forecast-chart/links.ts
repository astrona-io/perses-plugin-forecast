import type { Anomaly } from "./data";

const FIVE_MINUTES = 5 * 60_000;

/**
 * Fills an anomaly link template: `${__time}`, `${__time_from}`, `${__time_to}` (ms) and
 * `${__series.labels.<name>}`, each URL-encoded. Other `${...}` are left for the dashboard
 * variable step.
 */
export function interpolateAnomalyLink(
  template: string,
  anomaly: Anomaly,
): string {
  return template.replace(
    /\$\{(__[a-zA-Z0-9_.]+)\}/g,
    (match, name: string) => {
      if (name === "__time") return String(Math.round(anomaly.t));
      if (name === "__time_from")
        return String(
          Math.round(Math.min(anomaly.from, anomaly.t) - FIVE_MINUTES),
        );
      if (name === "__time_to")
        return String(
          Math.round(Math.max(anomaly.to, anomaly.t) + FIVE_MINUTES),
        );
      const prefix = "__series.labels.";
      if (name.startsWith(prefix)) {
        return encodeURIComponent(
          anomaly.labels[name.slice(prefix.length)] ?? "",
        );
      }
      return match;
    },
  );
}

/** Only http(s) and relative URLs; a `javascript:` or `data:` link is dropped. */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!scheme) return true;
  const name = scheme[1]!.toLowerCase();
  return name === "http" || name === "https";
}
