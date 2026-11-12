// The ONE place that names remote map sources (PLAN §5, §10). To swap providers later
// (for example to a self-hosted Protomaps extract), change this file only.
//
// Terms re-verified 2026-11-12; see ATTRIBUTION.md.

/** OpenFreeMap vector basemap (OpenMapTiles schema). No key, offline downloads allowed within limits. */
export const BASEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
/** Used only for glyph ranges that are not bundled with the app, while online. */
export const REMOTE_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** AWS Terrain Tiles, Terrarium encoding. No account needed, CORS open. */
export const DEM_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_TILE_SIZE = 256;
export const DEM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen, USGS and others</a>';

// OpenFreeMap offline-download limits (https://openfreemap.org/tos/).
export const MAX_PARALLEL_REQUESTS = 4;

// Zoom plan (PLAN §5.1).
export const BASEMAP_FALLBACK_MAXZOOM = 14; // real value is read from the TileJSON at runtime
export const CONTEXT_MAXZOOM = 10;
export const CONTEXT_BUFFER_M = 50_000;
export const DEM_MAXZOOM = 12;
export const DEM_MAXZOOM_HIGH_DETAIL = 13;
export const DEFAULT_BUFFER_M = 2000;
export const BUFFER_CHOICES_M = [1000, 2000, 5000];

// Glyph ranges shipped in public/fonts (keep in sync with scripts/fetch-map-assets.mjs).
// Basic Latin, Latin-1, Latin Extended A/B, IPA, combining marks, Latin Extended Additional,
// general punctuation, letterlike symbols and arrows: covers Spanish, Catalan, Portuguese,
// French, German, Italian, Vietnamese and most other Latin-script names.
export const BUNDLED_GLYPH_RANGES = new Set(['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447', '8448-8703']);
export const BUNDLED_FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
export const SPRITE_FILES = ['sprites/ofm.json', 'sprites/ofm.png', 'sprites/ofm@2x.json', 'sprites/ofm@2x.png'];

export interface BasemapInfo {
  tilejsonUrl: string;
  /** Versioned template, e.g. https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf */
  tileUrlTemplate: string;
  version: string;
  minzoom: number;
  maxzoom: number;
  fetchedAt: number;
}

/** Pull the dated version directory out of a versioned tile URL template. */
export function versionFromTemplate(template: string): string {
  const m = /\/([^/{}]+)\/\{z\}\/\{x\}\/\{y\}/.exec(template);
  const v = m?.[1] ?? '';
  // Keep keys and offline:// URLs simple and unambiguous.
  return v.replace(/[^A-Za-z0-9_.-]/g, '_') || 'unversioned';
}

/** Fetch the TileJSON and resolve the current versioned tile URL (PLAN §5.2). */
export async function fetchBasemapInfo(signal?: AbortSignal): Promise<BasemapInfo> {
  const res = await fetch(BASEMAP_TILEJSON_URL, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Map server answered ${res.status}`);
  const json = (await res.json()) as { tiles?: string[]; minzoom?: number; maxzoom?: number };
  const template = json.tiles?.[0];
  if (!template || !template.includes('{z}')) throw new Error('Map server sent an unexpected reply');
  return {
    tilejsonUrl: BASEMAP_TILEJSON_URL,
    tileUrlTemplate: template,
    version: versionFromTemplate(template),
    minzoom: Number.isFinite(json.minzoom) ? json.minzoom! : 0,
    maxzoom: Number.isFinite(json.maxzoom) ? json.maxzoom! : BASEMAP_FALLBACK_MAXZOOM,
    fetchedAt: Date.now(),
  };
}

/** Absolute URL of a file shipped with the app (works under any base path). */
export function appUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}
