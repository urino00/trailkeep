import { describe, expect, it } from 'vitest';
import {
  bboxSizeKm,
  bearingDeg,
  bufferBbox,
  circleRing,
  closestOnSegmentToOrigin,
  compassLabel,
  destinationPoint,
  haversine,
  localProjector,
} from '../../src/domain/geo';

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversine(42.5, 1.0, 42.5, 1.0)).toBe(0);
  });
  it('measures one degree of latitude as about 111.2 km', () => {
    expect(haversine(0, 0, 1, 0)).toBeGreaterThan(111_100);
    expect(haversine(0, 0, 1, 0)).toBeLessThan(111_300);
  });
  it('matches a known city pair (Paris to London, about 344 km)', () => {
    const d = haversine(48.8566, 2.3522, 51.5074, -0.1278) / 1000;
    expect(d).toBeGreaterThan(342);
    expect(d).toBeLessThan(345);
  });
  it('is symmetric and works across the antimeridian', () => {
    expect(haversine(-49.3, -72.9, -41.1, -71.3)).toBeCloseTo(haversine(-41.1, -71.3, -49.3, -72.9), 6);
    expect(haversine(0, 179.9, 0, -179.9)).toBeLessThan(23_000);
  });
});

describe('bearing, destination and compass', () => {
  it('gives cardinal bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 5);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 5);
  });
  it('round-trips destination and distance in the southern and western hemispheres', () => {
    const [lat, lon] = destinationPoint(-49.33, -72.89, 37, 1234);
    expect(haversine(-49.33, -72.89, lat, lon)).toBeCloseTo(1234, 1);
    expect(bearingDeg(-49.33, -72.89, lat, lon)).toBeCloseTo(37, 1);
  });
  it('labels compass points', () => {
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(44)).toBe('NE');
    expect(compassLabel(181)).toBe('S');
    expect(compassLabel(359)).toBe('N');
    expect(compassLabel(-90)).toBe('W');
  });
});

describe('bbox helpers', () => {
  it('buffers by the requested distance on every side', () => {
    const b = bufferBbox([1.0, 42.5, 1.1, 42.6], 2000);
    expect(haversine(42.5, 1.0, b[1], 1.0)).toBeCloseTo(2000, 0);
    expect(haversine(42.6, 1.1, b[3], 1.1)).toBeCloseTo(2000, 0);
    // Longitude padding is sized for the edge farthest from the equator, so it is at least 2 km everywhere.
    expect(haversine(42.5, 1.0, 42.5, b[0])).toBeGreaterThanOrEqual(1999);
    expect(haversine(42.6, 1.1, 42.6, b[2])).toBeGreaterThanOrEqual(1999);
    expect(haversine(42.5, 1.0, 42.5, b[0])).toBeLessThan(2050);
  });
  it('works with negative latitudes and longitudes and clamps to the world', () => {
    const b = bufferBbox([-72.95, -49.4, -72.85, -49.3], 50_000);
    expect(b[0]).toBeLessThan(-73.5);
    expect(b[1]).toBeLessThan(-49.8);
    expect(b[2]).toBeGreaterThan(-72.2);
    expect(b[3]).toBeGreaterThan(-48.9);
    const w = bufferBbox([-179.9, 84.9, 179.9, 85], 100_000);
    expect(w[0]).toBe(-180);
    expect(w[2]).toBe(180);
    expect(w[3]).toBeLessThanOrEqual(85.0512);
  });
  it('reports width and height', () => {
    const { widthKm, heightKm } = bboxSizeKm([0.97892, 42.57864, 1.04783, 42.59672]);
    expect(widthKm).toBeGreaterThan(5.5);
    expect(widthKm).toBeLessThan(5.8);
    expect(heightKm).toBeGreaterThan(1.9);
    expect(heightKm).toBeLessThan(2.1);
  });
  it('builds a closed accuracy circle', () => {
    const ring = circleRing(-41.1, -71.3, 25, 32);
    expect(ring).toHaveLength(33);
    for (const [lon, lat] of ring) expect(haversine(-41.1, -71.3, lat, lon)).toBeCloseTo(25, 1);
    expect(ring[0]![0]).toBeCloseTo(ring[32]![0], 9);
  });
});

describe('planar projection', () => {
  it('agrees with haversine near the reference point', () => {
    const project = localProjector(-49.33, -72.89);
    const [x, y] = project(-49.325, -72.88);
    expect(Math.hypot(x, y)).toBeCloseTo(haversine(-49.33, -72.89, -49.325, -72.88), 0);
  });
  it('finds the closest point on a segment', () => {
    expect(closestOnSegmentToOrigin(-10, 5, 10, 5)).toEqual({ t: 0.5, d2: 25 });
    expect(closestOnSegmentToOrigin(3, 4, 10, 4).t).toBe(0);
    expect(closestOnSegmentToOrigin(-10, 4, -3, 4).t).toBe(1);
    expect(closestOnSegmentToOrigin(3, 4, 3, 4)).toEqual({ t: 0, d2: 25 });
  });
});
