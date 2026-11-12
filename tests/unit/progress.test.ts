import { describe, expect, it } from 'vitest';
import { bearingDeg, destinationPoint, haversine } from '../../src/domain/geo';
import { cumulativeDistance } from '../../src/domain/gpx';
import { locateOnTrail, makeGeometry, offTrailLevel, orientedGeometry, pointAtDistance } from '../../src/domain/progress';
import type { LatLonEle } from '../../src/domain/types';
import { exampleTrail } from './helpers';

const trail = exampleTrail();
const geom = orientedGeometry(trail);
const seg = trail.segments[0]!;
const cd = trail.cumDist[0]!;

describe('progress on example.gpx (PLAN §6.6 acceptance criteria)', () => {
  it('a fix on the start point gives Done ≈ 0', () => {
    const m = locateOnTrail(geom, seg[0]![0], seg[0]![1])!;
    expect(m.alongM).toBeLessThan(20);
    expect(m.offM).toBeLessThan(1);
  });

  it("a fix at the highest point gives that point's cumulative distance", () => {
    let hi = 0;
    seg.forEach((p, i) => {
      if (p[2]! > seg[hi]![2]!) hi = i;
    });
    const m = locateOnTrail(geom, seg[hi]![0], seg[hi]![1])!;
    expect(Math.abs(m.alongM - cd[hi]!)).toBeLessThan(5);
    expect(m.offM).toBeLessThan(1);
  });

  it('a fix 100 m perpendicular off a known segment gives off-trail ≈ 100 m ± 5', () => {
    // Pick a piece of trail that is long, straight-ish and far from other parts of the loop.
    const i = 400;
    const a = seg[i]!;
    const b = seg[i + 1]!;
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const heading = bearingDeg(a[0], a[1], b[0], b[1]);
    for (const side of [90, -90]) {
      const [lat, lon] = destinationPoint(mid[0], mid[1], heading + side, 100);
      const m = locateOnTrail(geom, lat, lon, { lastAlongM: (cd[i]! + cd[i + 1]!) / 2 })!;
      expect(m.offM).toBeLessThanOrEqual(105);
      // The trail bends, so another part may be a little closer than the piece we stepped off.
      expect(m.offM).toBeGreaterThan(60);
    }
  });

  it('off-trail distance is exact on a straight synthetic trail', () => {
    const line: LatLonEle[] = [
      [-49.3, -72.9, null],
      [-49.28, -72.9, null],
    ];
    const g = makeGeometry([line], [cumulativeDistance(line)], false);
    const [lat, lon] = destinationPoint(-49.29, -72.9, 90, 100);
    const m = locateOnTrail(g, lat, lon)!;
    expect(Math.abs(m.offM - 100)).toBeLessThan(1);
    expect(m.alongM).toBeCloseTo(haversine(-49.3, -72.9, -49.29, -72.9), 0);
    expect(m.bearingToTrail).toBeGreaterThan(265);
    expect(m.bearingToTrail).toBeLessThan(275);
  });

  it('loop disambiguation keeps a fix near the start/end at about 17.2 km when the last match was 16.8 km', () => {
    const m = locateOnTrail(geom, seg[0]![0], seg[0]![1], { lastAlongM: 16_800 })!;
    expect(m.alongM).toBeGreaterThan(17_000);
    expect(m.alongM / 1000).toBeCloseTo(17.25, 1);
  });

  it('with no history a fix near the start of a loop is assumed to be the start', () => {
    const [lat, lon] = destinationPoint(seg[0]![0], seg[0]![1], 200, 40);
    const m = locateOnTrail(geom, lat, lon)!;
    expect(m.alongM).toBeLessThan(500);
  });

  it('keeps the outbound and return legs apart where the lollipop stem overlaps', () => {
    // The first and last few hundred metres of the file run along the same path.
    const out = locateOnTrail(geom, seg[10]![0], seg[10]![1], { lastAlongM: 0 })!;
    const back = locateOnTrail(geom, seg[10]![0], seg[10]![1], { lastAlongM: 17_000 })!;
    expect(out.alongM).toBeLessThan(1000);
    expect(back.alongM).toBeGreaterThan(geom.totalM - 1000);
  });

  it('prefers moving forward when the last match is far behind', () => {
    // Opened at 2 km, next opened on the overlapping stem: forward means the return leg.
    const m = locateOnTrail(geom, seg[10]![0], seg[10]![1], { lastAlongM: 2000 })!;
    expect(m.alongM).toBeGreaterThan(geom.totalM - 1000);
  });

  it('falls back to the nearest point when history does not help', () => {
    const i = 600;
    const m = locateOnTrail(geom, seg[i]![0], seg[i]![1], { lastAlongM: 16_900 })!;
    expect(Math.abs(m.alongM - cd[i]!)).toBeLessThan(5);
  });
});

describe('direction, segments and helpers', () => {
  it('reversing the trail flips the distance axis', () => {
    const rev = orientedGeometry({ ...trail, reversed: true });
    expect(rev.totalM).toBeCloseTo(geom.totalM, 3);
    const i = 300;
    const fwd = locateOnTrail(geom, seg[i]![0], seg[i]![1], { lastAlongM: cd[i]! })!;
    const bwd = locateOnTrail(rev, seg[i]![0], seg[i]![1], { lastAlongM: geom.totalM - cd[i]! })!;
    expect(fwd.alongM + bwd.alongM).toBeCloseTo(geom.totalM, 0);
    expect(rev.segments[0]![0]).toEqual(seg[seg.length - 1]);
  });

  it('measures along multiple segments without counting the gap', () => {
    const a: LatLonEle[] = [
      [10, 10, null],
      [10.01, 10, null],
    ];
    const b: LatLonEle[] = [
      [10.5, 10, null],
      [10.51, 10, null],
    ];
    const g = makeGeometry([a, b], [cumulativeDistance(a), cumulativeDistance(b)], false);
    const lenA = haversine(10, 10, 10.01, 10);
    const m = locateOnTrail(g, 10.505, 10)!;
    expect(m.segIndex).toBe(1);
    expect(m.alongM).toBeCloseTo(lenA + haversine(10.5, 10, 10.505, 10), 0);
    const p = pointAtDistance(g, lenA + 100)!;
    expect(p.lat).toBeGreaterThan(10.5);
    expect(pointAtDistance(g, -5)).toEqual({ lat: 10, lon: 10 });
    expect(pointAtDistance(g, 1e9)!.lat).toBeCloseTo(10.51, 9);
  });

  it('finds the point at a distance (inverse of matching)', () => {
    for (const d of [0, 1234, 8000, 17_000]) {
      const p = pointAtDistance(geom, d)!;
      const m = locateOnTrail(geom, p.lat, p.lon, { lastAlongM: d })!;
      expect(Math.abs(m.alongM - d)).toBeLessThan(3);
    }
  });

  it('works in the southern and western hemispheres (Argentina)', () => {
    const line: LatLonEle[] = [];
    for (let i = 0; i <= 100; i++) line.push([-49.33 + i * 0.0005, -72.89 - i * 0.0003, 400 + i * 5]);
    const g = makeGeometry([line], [cumulativeDistance(line)], false);
    const mid = line[50]!;
    const m = locateOnTrail(g, mid[0], mid[1])!;
    expect(m.offM).toBeLessThan(1);
    expect(m.alongM).toBeCloseTo(cumulativeDistance(line)[50]!, 0);
  });

  it('walks a spur out and back without jumping', () => {
    // Around 8.0 km the example trail visits a short spur and returns along it,
    // so the same spot exists at two distances roughly 90 m apart.
    const p = pointAtDistance(geom, 8000)!;
    const arriving = locateOnTrail(geom, p.lat, p.lon, { lastAlongM: 7950 })!;
    expect(arriving.alongM).toBeCloseTo(8000, 0);
    const tip = pointAtDistance(geom, 8045)!;
    const atTip = locateOnTrail(geom, tip.lat, tip.lon, { lastAlongM: arriving.alongM })!;
    const leaving = locateOnTrail(geom, p.lat, p.lon, { lastAlongM: atTip.alongM })!;
    expect(leaving.alongM).toBeGreaterThan(atTip.alongM - 31);
    expect(leaving.alongM).toBeGreaterThan(8040);
  });

  it('grades off-trail distance', () => {
    expect(offTrailLevel(10)).toBe('on');
    expect(offTrailLevel(31)).toBe('near');
    expect(offTrailLevel(85)).toBe('amber');
    expect(offTrailLevel(151)).toBe('red');
  });
});
