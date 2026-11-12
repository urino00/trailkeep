// Slippy-map tile math: which tiles cover a region, how big the download is, how to chunk it.
import { MAX_MERCATOR_LAT } from './geo';
import type { Bbox } from './types';

export type TileLayer = 'basemap' | 'dem';

export interface PlannedTile {
  layer: TileLayer;
  z: number;
  x: number;
  y: number;
}

export interface TileRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(y)));
}

export function tileRange(bbox: Bbox, z: number): TileRange {
  return {
    minX: lonToTileX(bbox[0], z),
    maxX: lonToTileX(bbox[2], z),
    minY: latToTileY(bbox[3], z), // north edge has the smaller y
    maxY: latToTileY(bbox[1], z),
  };
}

export function countTilesAtZoom(bbox: Bbox, z: number): number {
  const r = tileRange(bbox, z);
  return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
}

function pushTiles(out: PlannedTile[], layer: TileLayer, bbox: Bbox, z: number): void {
  const r = tileRange(bbox, z);
  for (let x = r.minX; x <= r.maxX; x++) {
    for (let y = r.minY; y <= r.maxY; y++) out.push({ layer, z, x, y });
  }
}

export interface RegionTileSpec {
  /** Detail area (already buffered). */
  bbox: Bbox;
  /** Wider area kept at low zoom so zooming out offline still shows the surroundings. */
  contextBbox?: Bbox;
  basemapMinZoom: number;
  basemapMaxZoom: number;
  contextMaxZoom: number;
  demMaxZoom: number;
}

/**
 * Every tile a region needs:
 *  - basemap z ≤ contextMaxZoom inside the context bbox,
 *  - basemap contextMaxZoom < z ≤ basemapMaxZoom inside the detail bbox,
 *  - DEM z0..demMaxZoom inside the detail bbox.
 * Lower zooms come first so an interrupted download still gives a usable overview.
 */
export function planRegionTiles(spec: RegionTileSpec): PlannedTile[] {
  const out: PlannedTile[] = [];
  const context = spec.contextBbox ?? spec.bbox;
  for (let z = spec.basemapMinZoom; z <= spec.basemapMaxZoom; z++) {
    pushTiles(out, 'basemap', z <= spec.contextMaxZoom ? context : spec.bbox, z);
  }
  for (let z = 0; z <= spec.demMaxZoom; z++) pushTiles(out, 'dem', spec.bbox, z);
  return out;
}

export function countRegionTiles(spec: RegionTileSpec): number {
  const context = spec.contextBbox ?? spec.bbox;
  let n = 0;
  for (let z = spec.basemapMinZoom; z <= spec.basemapMaxZoom; z++) {
    n += countTilesAtZoom(z <= spec.contextMaxZoom ? context : spec.bbox, z);
  }
  for (let z = 0; z <= spec.demMaxZoom; z++) n += countTilesAtZoom(spec.bbox, z);
  return n;
}

// Typical stored (uncompressed) tile sizes in bytes, sampled from OpenFreeMap and AWS Terrain Tiles
// on 2026-11-12 in mountain and rural areas. Dense cities run several times larger at z12-14.
const BASEMAP_BYTES_BY_ZOOM = [
  85_000, 210_000, 1_450_000, 600_000, 450_000, 320_000, 180_000, 170_000, 150_000, 140_000, 90_000, 60_000, 50_000,
  35_000, 40_000,
];
const DEM_TILE_BYTES = 110_000;

export function estimateTileBytes(layer: TileLayer, z: number): number {
  if (layer === 'dem') return DEM_TILE_BYTES;
  return BASEMAP_BYTES_BY_ZOOM[Math.min(z, BASEMAP_BYTES_BY_ZOOM.length - 1)]!;
}

export interface RegionEstimate {
  tiles: number;
  basemapTiles: number;
  demTiles: number;
  bytes: number;
}

/** Tile count and size estimate without materialising the tile list (safe for huge areas). */
export function estimateRegion(spec: RegionTileSpec): RegionEstimate {
  const context = spec.contextBbox ?? spec.bbox;
  let basemapTiles = 0;
  let demTiles = 0;
  let bytes = 0;
  for (let z = spec.basemapMinZoom; z <= spec.basemapMaxZoom; z++) {
    const c = countTilesAtZoom(z <= spec.contextMaxZoom ? context : spec.bbox, z);
    basemapTiles += c;
    bytes += c * estimateTileBytes('basemap', z);
  }
  for (let z = 0; z <= spec.demMaxZoom; z++) {
    const c = countTilesAtZoom(spec.bbox, z);
    demTiles += c;
    bytes += c * DEM_TILE_BYTES;
  }
  return { tiles: basemapTiles + demTiles, basemapTiles, demTiles, bytes };
}

// OpenFreeMap allows offline downloads of at most 3,000 tiles or 50 MB each. Stay well under.
export const CHUNK_MAX_TILES = 2500;
export const CHUNK_MAX_BYTES = 40 * 1024 * 1024;
export const WARN_TOTAL_BYTES = 200 * 1024 * 1024;
export const BLOCK_TOTAL_BYTES = 1024 * 1024 * 1024;

/** Split a download into consecutive chunks that each respect the tile-count and size caps. */
export function chunkTiles<T extends { layer: TileLayer; z: number }>(
  tiles: T[],
  maxTiles = CHUNK_MAX_TILES,
  maxBytes = CHUNK_MAX_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let curBytes = 0;
  for (const t of tiles) {
    const b = estimateTileBytes(t.layer, t.z);
    if (cur.length > 0 && (cur.length >= maxTiles || curBytes + b > maxBytes)) {
      chunks.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(t);
    curBytes += b;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** IndexedDB key of a stored tile: `${layer}/${version|'-'}/${z}/${x}/${y}`. */
export function tileKey(layer: TileLayer, version: string | null, z: number, x: number, y: number): string {
  return `${layer}/${version ?? '-'}/${z}/${x}/${y}`;
}

export function fillTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** Decode one Terrarium-encoded pixel to metres above sea level. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Fractional pixel position of a coordinate inside its tile (for sampling DEM tiles). */
export function tilePixel(lat: number, lon: number, z: number, tileSize: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const clamped = Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat));
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan((clamped * Math.PI) / 180)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(fx)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return {
    x,
    y,
    px: Math.min(tileSize - 1, Math.max(0, Math.floor((fx - x) * tileSize))),
    py: Math.min(tileSize - 1, Math.max(0, Math.floor((fy - y) * tileSize))),
  };
}
