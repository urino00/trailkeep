import { describe, expect, it } from 'vitest';
import { bufferBbox } from '../../src/domain/geo';
import {
  CHUNK_MAX_BYTES,
  CHUNK_MAX_TILES,
  chunkTiles,
  countRegionTiles,
  countTilesAtZoom,
  estimateRegion,
  estimateTileBytes,
  fillTileUrl,
  latToTileY,
  lonToTileX,
  planRegionTiles,
  terrariumToMeters,
  tileKey,
  tilePixel,
  tileRange,
  type RegionTileSpec,
} from '../../src/domain/tiles';
import type { Bbox } from '../../src/domain/types';
import { exampleTrail } from './helpers';

describe('tile math', () => {
  it('maps known coordinates to known tiles', () => {
    expect([lonToTileX(0, 0), latToTileY(0, 0)]).toEqual([0, 0]);
    expect([lonToTileX(-0.1, 1), latToTileY(0.1, 1)]).toEqual([0, 0]);
    expect([lonToTileX(0.1, 1), latToTileY(-0.1, 1)]).toEqual([1, 1]);
    // Estany de Sant Maurici, Pyrenees
    expect([lonToTileX(1.01, 12), latToTileY(42.587, 12)]).toEqual([2059, 1511]);
    // El Chaltén, Argentina: negative latitude and longitude
    expect([lonToTileX(-72.89, 12), latToTileY(-49.33, 12)]).toEqual([1218, 2695]);
  });

  it('clamps to the world', () => {
    expect(lonToTileX(180, 3)).toBe(7);
    expect(lonToTileX(-200, 3)).toBe(0);
    expect(latToTileY(89.9, 3)).toBe(0);
    expect(latToTileY(-89.9, 3)).toBe(7);
  });

  it('counts tiles for known bboxes', () => {
    const world: Bbox = [-180, -85, 180, 85];
    expect(countTilesAtZoom(world, 0)).toBe(1);
    expect(countTilesAtZoom(world, 2)).toBe(16);
    const point: Bbox = [1.01, 42.587, 1.01, 42.587];
    for (let z = 0; z <= 14; z++) expect(countTilesAtZoom(point, z)).toBe(1);
    // North edge maps to the smaller y.
    const r = tileRange([-72.95, -49.4, -72.85, -49.3], 12);
    expect(r.minY).toBeLessThanOrEqual(r.maxY);
    expect(r.minX).toBeLessThanOrEqual(r.maxX);
  });
});

describe('region planning', () => {
  const trail = exampleTrail();
  const bbox = bufferBbox(trail.bbox, 2000);
  const spec: RegionTileSpec = {
    bbox,
    contextBbox: bufferBbox(trail.bbox, 50_000),
    basemapMinZoom: 0,
    basemapMaxZoom: 14,
    contextMaxZoom: 10,
    demMaxZoom: 12,
  };

  it('plans the example trail as a small download (PLAN §5.1)', () => {
    const tiles = planRegionTiles(spec);
    const est = estimateRegion(spec);
    expect(tiles.length).toBe(est.tiles);
    expect(countRegionTiles(spec)).toBe(est.tiles);
    expect(est.basemapTiles).toBeGreaterThan(40);
    expect(est.basemapTiles).toBeLessThan(140);
    expect(est.demTiles).toBeGreaterThanOrEqual(13);
    expect(est.demTiles).toBeLessThan(40);
    expect(est.bytes).toBeLessThan(20 * 1024 * 1024);
  });

  it('covers every zoom, with the detail zooms limited to the buffered bbox', () => {
    const tiles = planRegionTiles(spec);
    for (let z = 0; z <= 14; z++) expect(tiles.some((t) => t.layer === 'basemap' && t.z === z)).toBe(true);
    for (let z = 0; z <= 12; z++) expect(tiles.some((t) => t.layer === 'dem' && t.z === z)).toBe(true);
    expect(tiles.some((t) => t.layer === 'dem' && t.z === 13)).toBe(false);
    const z14 = tiles.filter((t) => t.layer === 'basemap' && t.z === 14);
    const r = tileRange(bbox, 14);
    expect(z14.length).toBe((r.maxX - r.minX + 1) * (r.maxY - r.minY + 1));
    // The 50 km context ring makes z10 wider than the detail area alone.
    const z10 = tiles.filter((t) => t.layer === 'basemap' && t.z === 10).length;
    expect(z10).toBeGreaterThan(countTilesAtZoom(bbox, 10));
    const keys = new Set(tiles.map((t) => tileKey(t.layer, t.layer === 'basemap' ? 'v1' : null, t.z, t.x, t.y)));
    expect(keys.size).toBe(tiles.length);
  });

  it('high-detail terrain adds z13 DEM tiles', () => {
    const hi = planRegionTiles({ ...spec, demMaxZoom: 13 });
    expect(hi.some((t) => t.layer === 'dem' && t.z === 13)).toBe(true);
    expect(hi.length).toBeGreaterThan(planRegionTiles(spec).length);
  });

  it('splits a 30 × 30 km area into chunks under the OpenFreeMap caps', () => {
    const half = 15_000;
    const area = bufferBbox([-71.5, -41.2, -71.5, -41.2], half);
    const big: RegionTileSpec = { ...spec, bbox: area, contextBbox: bufferBbox(area, 50_000) };
    const tiles = planRegionTiles(big);
    expect(tiles.length).toBeGreaterThan(300);
    const chunks = chunkTiles(tiles);
    expect(chunks.flat().length).toBe(tiles.length);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_TILES);
      const bytes = c.reduce((s, t) => s + estimateTileBytes(t.layer, t.z), 0);
      expect(bytes).toBeLessThanOrEqual(CHUNK_MAX_BYTES);
    }
    // Order is preserved.
    expect(chunks.flat()[0]).toBe(tiles[0]);
    expect(chunks.flat()[tiles.length - 1]).toBe(tiles[tiles.length - 1]);
  });

  it('respects explicit chunk limits and never returns an empty chunk', () => {
    const tiles = Array.from({ length: 10 }, (_, i) => ({ layer: 'dem' as const, z: 12, x: i, y: 0 }));
    expect(chunkTiles(tiles, 3).map((c) => c.length)).toEqual([3, 3, 3, 1]);
    expect(chunkTiles(tiles, 100, 250_000).map((c) => c.length)).toEqual([2, 2, 2, 2, 2]);
    expect(chunkTiles(tiles, 100, 1).map((c) => c.length)).toEqual(new Array(10).fill(1));
    expect(chunkTiles([])).toEqual([]);
  });
});

describe('keys, URLs and DEM decoding', () => {
  it('builds storage keys and URLs', () => {
    expect(tileKey('basemap', '20261101_080013_pt', 14, 8237, 6021)).toBe('basemap/20261101_080013_pt/14/8237/6021');
    expect(tileKey('dem', null, 12, 2059, 1505)).toBe('dem/-/12/2059/1505');
    expect(fillTileUrl('https://x/{z}/{x}/{y}.png', 12, 3, 4)).toBe('https://x/12/3/4.png');
  });

  it('decodes Terrarium pixels', () => {
    expect(terrariumToMeters(128, 0, 0)).toBe(0);
    expect(terrariumToMeters(134, 100, 128)).toBeCloseTo(1636.5, 6);
    expect(terrariumToMeters(127, 255, 0)).toBe(-1);
    expect(terrariumToMeters(162, 144, 0)).toBe(8848);
  });

  it('locates a coordinate inside its tile', () => {
    const p = tilePixel(42.587, 1.01, 12, 256);
    expect([p.x, p.y]).toEqual([2059, 1511]);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThan(256);
    const s = tilePixel(-49.33, -72.89, 12, 256);
    expect([s.x, s.y]).toEqual([1218, 2695]);
  });
});
