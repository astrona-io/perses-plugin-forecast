const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  y: 365 * 86_400_000,
};

/**
 * Milliseconds in a Prometheus-style duration ("90s", "1h30m", "7d"), or in a plain number of
 * seconds ("3600", "1.5"). Undefined for anything else.
 */
export function parseDurationMs(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const s = text.trim();
  if (s === "") return undefined;
  if (/^[0-9]*\.?[0-9]+$/.test(s)) return Number(s) * 1000;
  const re = /([0-9]+)(ms|s|m|h|d|w|y)/g;
  let total = 0;
  let consumed = 0;
  for (const m of s.matchAll(re)) {
    if (m.index !== consumed) return undefined;
    total += Number(m[1]) * UNIT_MS[m[2]!]!;
    consumed += m[0].length;
  }
  return consumed === s.length && consumed > 0 ? total : undefined;
}

/** "~23 days", "~5 hours", "~40 minutes": a rough distance for the crossing callout. */
export function humanDuration(ms: number): string {
  const abs = Math.abs(ms);
  const days = abs / 86_400_000;
  if (days >= 2) return `${Math.round(days)} days`;
  const hours = abs / 3_600_000;
  if (hours >= 2) return `${Math.round(hours)} hours`;
  const minutes = Math.max(1, Math.round(abs / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** "18–31 days": a range in the unit of the larger end. */
export function humanRange(fromMs: number, toMs: number): string {
  const big = Math.max(Math.abs(fromMs), Math.abs(toMs));
  const unit =
    big / 86_400_000 >= 2
      ? { ms: 86_400_000, name: "days" }
      : big / 3_600_000 >= 2
        ? { ms: 3_600_000, name: "hours" }
        : { ms: 60_000, name: "minutes" };
  const a = Math.round(fromMs / unit.ms);
  const b = Math.round(toMs / unit.ms);
  return a === b ? `${a} ${unit.name}` : `${a}–${b} ${unit.name}`;
}
