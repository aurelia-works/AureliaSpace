export interface Sample {
  t: number;
  pct: number;
}

export type ForecastState = "unknown" | "safe" | "out" | "full";

export interface Forecast {
  state: ForecastState;
  /** Epoch ms when the window hits 100% at the recent rate; only for "out" and "full". */
  outAt?: number;
  /** Percentage points per hour over the fit window. */
  perHour?: number;
}

export interface ForecastOpts {
  lookbackMs: number;
  minSpanMs: number;
  minSamples?: number;
}

export const FORECAST_5H: ForecastOpts = { lookbackMs: 45 * 60_000, minSpanMs: 10 * 60_000 };
export const FORECAST_7D: ForecastOpts = { lookbackMs: 18 * 3600_000, minSpanMs: 2 * 3600_000 };

/**
 * Least-squares slope over recent samples, projected from the latest value.
 * "safe" = flat/falling or the 100% point lands after the reset; "unknown" = too little data.
 */
export function forecast(samples: Sample[], now: number, resetAt: number | null, opts: ForecastOpts): Forecast {
  const last = samples[samples.length - 1];
  if (!last) return { state: "unknown" };
  if (last.pct >= 100) return { state: "full", outAt: now };
  const recent = samples.filter((s) => s.t >= now - opts.lookbackMs);
  if (recent.length < (opts.minSamples ?? 3) || last.t - recent[0].t < opts.minSpanMs) return { state: "unknown" };
  const n = recent.length;
  const t0 = recent[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of recent) {
    const x = s.t - t0;
    sx += x; sy += s.pct; sxx += x * x; sxy += x * s.pct;
  }
  const den = n * sxx - sx * sx;
  if (den <= 0) return { state: "unknown" };
  const slope = (n * sxy - sx * sy) / den; // pct per ms
  const perHour = slope * 3600_000;
  if (perHour < 0.2) return { state: "safe", perHour };
  const outAt = last.t + (100 - last.pct) / slope;
  if (resetAt !== null && outAt >= resetAt) return { state: "safe", perHour };
  return { state: "out", outAt, perHour };
}

/** Drops history from before a reset: pct fell sharply, or the reset time moved forward. */
export function trimAfterReset(samples: Sample[], next: Sample, prevReset: number | null, nextReset: number | null): Sample[] {
  const prev = samples[samples.length - 1];
  const dropped = prev !== undefined && next.pct < prev.pct - 15;
  const moved = prevReset !== null && nextReset !== null && nextReset - prevReset > 10 * 60_000;
  return dropped || moved ? [next] : [...samples, next];
}
