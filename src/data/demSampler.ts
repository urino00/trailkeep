// Fill in elevations for a GPX that has none, from downloaded DEM tiles (PLAN §6.6).
import { computeTrailDerived } from '../domain/gpx';
import { terrariumToMeters, tileKey, tilePixel } from '../domain/tiles';
import type { LatLonEle, Region } from '../domain/types';
import { DEM_TILE_SIZE } from '../map/sources';
import { getTrail, putTrail } from './db';
import { getTile } from './tileStore';

interface DecodedTile {
  size: number;
  rgba: Uint8ClampedArray;
}

async function decodeDemTile(data: ArrayBuffer): Promise<DecodedTile | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const size = bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { size, rgba: ctx.getImageData(0, 0, size, size).data };
  } catch {
    return null;
  }
}

/**
 * If the trail has no elevation, sample it from the region's stored DEM tiles and save the
 * trail with `elevationSource: 'dem'`. Returns true when the trail was updated.
 */
export async function fillTrailElevationFromDem(trailId: string, region: Region): Promise<boolean> {
  const trail = await getTrail(trailId);
  if (!trail || trail.elevationSource !== 'none') return false;

  const z = region.dem.maxzoom;
  const cache = new Map<string, DecodedTile | null>();
  let filled = 0;

  const sample = async (lat: number, lon: number): Promise<number | null> => {
    const guess = tilePixel(lat, lon, z, DEM_TILE_SIZE);
    const key = tileKey('dem', null, z, guess.x, guess.y);
    let tile = cache.get(key);
    if (tile === undefined) {
      const rec = await getTile(key);
      tile = rec?.data ? await decodeDemTile(rec.data) : null;
      cache.set(key, tile);
    }
    if (!tile) return null;
    const p = tile.size === DEM_TILE_SIZE ? guess : tilePixel(lat, lon, z, tile.size);
    const i = (p.py * tile.size + p.px) * 4;
    const m = terrariumToMeters(tile.rgba[i]!, tile.rgba[i + 1]!, tile.rgba[i + 2]!);
    return Number.isFinite(m) ? Math.round(m * 10) / 10 : null;
  };

  const segments: LatLonEle[][] = [];
  for (const seg of trail.segments) {
    const out: LatLonEle[] = [];
    for (const [lat, lon] of seg) {
      const ele = await sample(lat, lon);
      if (ele !== null) filled++;
      out.push([lat, lon, ele]);
    }
    segments.push(out);
  }
  if (filled === 0) return false;

  // Re-read so concurrent edits (rename, reverse) made during sampling are kept.
  const fresh = await getTrail(trailId);
  if (!fresh || fresh.elevationSource !== 'none') return false;
  const derived = computeTrailDerived(segments);
  await putTrail({ ...fresh, segments, ...derived, elevationSource: 'dem' });
  return true;
}
