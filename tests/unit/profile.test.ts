import { describe, expect, it } from 'vitest';
import { buildTimeIndex, remainingSeconds, toblerKmh, FLAT_SPEED_MS } from '../../src/domain/eta';
import { cumulativeDistance } from '../../src/domain/gpx';
import { buildProfile, chartSeries, elevationAt, gainLossBetween, gradeAt } from '../../src/domain/profile';
import type { LatLonEle } from '../../src/domain/types';
import { exampleTrail } from './helpers';

/** A straight track heading north with the given elevations every `spacingM` metres. */
function straight(eles: (number | null)[], spacingM = 50): { segs: LatLonEle[][]; cd: number[][] } {
  const seg: LatLonEle[] = eles.map((e, i) => [-49 + (i * spacingM) / 111_195, -72.9, e]);
  return { segs: [seg], cd: [cumulativeDistance(seg)] };
}

describe('profile', () => {
  it('matches the example trail (PLAN §6.7): 1636-2365 m over 17.2 km', () => {
    const t = exampleTrail();
    const p = buildProfile(t.segments, t.cumDist)!;
    expect(p.totalM / 1000).toBeCloseTo(17.25, 1);
    expect(p.stepM).toBeGreaterThan(9.9);
    expect(p.stepM).toBeLessThan(10.1);
    expect(p.minEle).toBeGreaterThan(1635);
    expect(p.minEle).toBeLessThan(1638);
    expect(p.maxEle).toBeGreaterThan(2362);
    expect(p.maxEle).toBeLessThan(2366);
    expect(p.gainM).toBe(t.stats.gainM); // stats and chart share one algorithm
    expect(p.lossM).toBe(t.stats.lossM);
  });

  it('measures a clean climb and descent exactly', () => {
    const { segs, cd } = straight([100, 150, 200, 250, 300, 300, 300, 250, 200, 150, 100, 100, 100], 200);
    const p = buildProfile(segs, cd)!;
    expect(p.gainM).toBeCloseTo(200, 0);
    expect(p.lossM).toBeCloseTo(200, 0);
    expect(elevationAt(p, 0)).toBeCloseTo(100, 0);
    expect(elevationAt(p, 400)).toBeCloseTo(200, 0);
    expect(gradeAt(p, 400)).toBeCloseTo(0.25, 2);
    expect(gradeAt(p, 1600)).toBeCloseTo(-0.25, 2);
  });

  it('smooths GPS-style noise instead of counting it as climbing', () => {
    const noisy: number[] = [];
    for (let i = 0; i <= 200; i++) noisy.push(1000 + (i % 2 === 0 ? 1.5 : -1.5));
    const { segs, cd } = straight(noisy, 10);
    const p = buildProfile(segs, cd)!;
    const raw = 200 * 1.5; // what a naive sum of positive steps would report
    expect(p.gainM).toBeLessThan(raw * 0.5);
  });

  it('reports ascent and descent remaining from any point', () => {
    const { segs, cd } = straight([0, 100, 200, 100, 0], 1000);
    const p = buildProfile(segs, cd)!;
    const rest = gainLossBetween(p, 1000, p.totalM);
    expect(rest.gainM).toBeCloseTo(100, -1);
    expect(rest.lossM).toBeCloseTo(200, -1);
    expect(gainLossBetween(p, 3000, 1000)).toEqual({ gainM: 0, lossM: 0 });
    const whole = gainLossBetween(p, 0, p.totalM);
    expect(whole.gainM).toBeCloseTo(p.gainM, 6);
  });

  it('bridges points with missing elevation and returns null when there is none', () => {
    const some = straight([100, null, null, 400], 100);
    const p = buildProfile(some.segs, some.cd)!;
    expect(elevationAt(p, 150)).toBeCloseTo(250, -1);
    const none = straight([null, null, null]);
    expect(buildProfile(none.segs, none.cd)).toBeNull();
  });

  it('joins multiple segments on one distance axis', () => {
    const a = straight([100, 200], 1000);
    const b = straight([500, 400], 1000);
    const p = buildProfile([a.segs[0]!, b.segs[0]!], [a.cd[0]!, b.cd[0]!])!;
    expect(p.totalM).toBeCloseTo(2000, -1);
    expect(elevationAt(p, 500)).toBeCloseTo(150, -1);
    expect(elevationAt(p, 1500)).toBeCloseTo(450, -1);
  });

  it('downsamples 100k-point tracks for the chart while keeping the extremes', () => {
    const eles: number[] = [];
    for (let i = 0; i < 100_000; i++) eles.push(1000 + 500 * Math.sin(i / 5000) + (i === 61_234 ? 800 : 0));
    const { segs, cd } = straight(eles, 10);
    const p = buildProfile(segs, cd)!;
    const s = chartSeries(p, 800);
    expect(s.dist.length).toBeLessThanOrEqual(802);
    expect(s.dist.length).toBe(s.ele.length);
    expect(Math.max(...s.ele)).toBeCloseTo(p.maxEle, 6);
    expect(Math.min(...s.ele)).toBeCloseTo(p.minEle, 6);
    expect(s.dist[0]).toBe(0);
    expect(s.dist[s.dist.length - 1]).toBeCloseTo(p.totalM, 6);
    for (let i = 1; i < s.dist.length; i++) expect(s.dist[i]!).toBeGreaterThanOrEqual(s.dist[i - 1]!);
  });

  it('returns short profiles untouched', () => {
    const { segs, cd } = straight([10, 20, 30], 10);
    const p = buildProfile(segs, cd)!;
    expect(chartSeries(p, 800).dist.length).toBe(p.n);
  });
});

describe('Tobler ETA', () => {
  it('follows the hiking function', () => {
    expect(toblerKmh(0)).toBeCloseTo(5.04, 2);
    expect(toblerKmh(-0.05)).toBeCloseTo(6, 6);
    expect(toblerKmh(0.25)).toBeCloseTo(6 * Math.exp(-1.05), 6);
    expect(toblerKmh(0.3)).toBeLessThan(toblerKmh(0.1));
    expect(toblerKmh(-0.4)).toBeLessThan(toblerKmh(-0.05));
  });

  it('takes about 1 h 59 min for 10 flat km and scales with the pace factor', () => {
    const { segs, cd } = straight(new Array(201).fill(500), 50);
    const p = buildProfile(segs, cd)!;
    const idx = buildTimeIndex(p);
    const full = remainingSeconds(p, idx, 0, p.totalM, 1);
    expect(full / 60).toBeGreaterThan(117);
    expect(full / 60).toBeLessThan(121);
    expect(remainingSeconds(p, idx, p.totalM / 2, p.totalM, 1)).toBeCloseTo(full / 2, 0);
    expect(remainingSeconds(p, idx, 0, p.totalM, 1.5)).toBeCloseTo(full / 1.5, 3);
    expect(remainingSeconds(p, idx, 0, p.totalM, 0.7)).toBeCloseTo(full / 0.7, 3);
    expect(remainingSeconds(p, idx, p.totalM, p.totalM, 1)).toBe(0);
  });

  it('is slower uphill than on the flat, and falls back to flat pace with no elevation', () => {
    const up = straight([0, 250, 500, 750, 1000], 1000);
    const p = buildProfile(up.segs, up.cd)!;
    const climb = remainingSeconds(p, buildTimeIndex(p), 0, p.totalM, 1);
    const flat = remainingSeconds(null, null, 0, p.totalM, 1);
    expect(climb).toBeGreaterThan(flat * 1.8);
    expect(flat).toBeCloseTo(p.totalM / FLAT_SPEED_MS, 6);
  });

  // Tobler assumes a fit walker on a good path (17 km with 860 m of climbing in about 4.4 h);
  // the pace factor setting is how the user calibrates it.
  it('gives a plausible time for the example loop', () => {
    const t = exampleTrail();
    const p = buildProfile(t.segments, t.cumDist)!;
    const hours = remainingSeconds(p, buildTimeIndex(p), 0, p.totalM, 1) / 3600;
    expect(hours).toBeGreaterThan(3.5);
    expect(hours).toBeLessThan(6);
  });
});
