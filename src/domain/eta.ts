// Walking-time estimate from Tobler's hiking function (PLAN §6.6).
import type { Profile } from './profile';

/** Tobler's hiking function: walking speed in km/h for a slope (rise / run). Peaks at 6 km/h on a 5% descent. */
export function toblerKmh(slope: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

export const FLAT_SPEED_MS = (toblerKmh(0) * 1000) / 3600;
const MAX_SLOPE = 1; // 45°, beyond which the formula is meaningless

/** Cumulative walking time in seconds at each profile sample, at pace factor 1. */
export function buildTimeIndex(p: Profile): Float64Array {
  const t = new Float64Array(p.n);
  for (let i = 1; i < p.n; i++) {
    let slope = (p.ele[i]! - p.ele[i - 1]!) / p.stepM;
    if (slope > MAX_SLOPE) slope = MAX_SLOPE;
    else if (slope < -MAX_SLOPE) slope = -MAX_SLOPE;
    const speedMs = (toblerKmh(slope) * 1000) / 3600;
    t[i] = t[i - 1]! + p.stepM / speedMs;
  }
  return t;
}

/**
 * Seconds needed to walk from `alongM` to the end.
 * `paceFactor` scales speed: 1.0 is Tobler's estimate, 0.7 is slower, 1.5 is faster.
 */
export function remainingSeconds(
  profile: Profile | null,
  timeIndex: Float64Array | null,
  alongM: number,
  totalM: number,
  paceFactor: number,
): number {
  const pace = paceFactor > 0 ? paceFactor : 1;
  const left = Math.max(0, totalM - alongM);
  if (!profile || !timeIndex) return left / FLAT_SPEED_MS / pace;
  const x = Math.min(profile.n - 1, Math.max(0, alongM / profile.stepM));
  const i = Math.min(profile.n - 2, Math.floor(x));
  const at = timeIndex[i]! + (x - i) * (timeIndex[i + 1]! - timeIndex[i]!);
  return Math.max(0, timeIndex[profile.n - 1]! - at) / pace;
}
