// The "offline://" protocol (PLAN §5.5): every map tile and glyph request goes through here.
//
//   offline://basemap/{version}/{z}/{x}/{y}   vector tiles
//   offline://dem/{z}/{x}/{y}                 Terrarium elevation PNGs
//   offline://glyphs/{fontstack}/{range}      label fonts
//
// Lookup order for tiles: IndexedDB → network (only when online and allowed) → "not available".
// "Not available" is reported as a 404, which MapLibre handles quietly by showing the nearest
// lower-zoom tile that does exist (the z0-10 context ring), with no error and no retry loop.
import { addProtocol } from 'maplibre-gl';
import { getDb } from '../data/db';
import { getTile } from '../data/tileStore';
import { fillTileUrl, tileKey } from '../domain/tiles';
import { BUNDLED_GLYPH_RANGES, DEM_TILE_URL, REMOTE_GLYPHS_URL, appUrl, fetchBasemapInfo, type BasemapInfo } from './sources';

const NETWORK_TIMEOUT_MS = 12_000;

interface OfflineConfig {
  /** Basemap versions present in storage, newest first. */
  versions: string[];
  /** Latest known TileJSON info, for fetching tiles that are not stored. */
  info: BasemapInfo | null;
  /** User setting: never use the network for map tiles. */
  offlineOnly: boolean;
}

const config: OfflineConfig = { versions: [], info: null, offlineOnly: false };
let infoRequest: Promise<BasemapInfo | null> | null = null;

export function configureOffline(change: Partial<OfflineConfig>): void {
  Object.assign(config, change);
}

export function networkAllowed(): boolean {
  return !config.offlineOnly && navigator.onLine !== false;
}

function notAvailable(what: string): Error {
  return Object.assign(new Error(`${what} is not available offline`), { status: 404 });
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = window.setTimeout(() => ctl.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength ? buf : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function liveInfo(): Promise<BasemapInfo | null> {
  if (config.info) return config.info;
  infoRequest ??= fetchBasemapInfo()
    .then((info) => {
      config.info = info;
      return info;
    })
    .catch(() => null)
    .finally(() => {
      infoRequest = null;
    });
  return infoRequest;
}

async function loadBasemapTile(version: string, z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  // 1. Stored under the requested version, or any other downloaded version (versions coexist).
  const tried = new Set<string>();
  for (const v of [version, ...config.versions]) {
    if (tried.has(v)) continue;
    tried.add(v);
    const rec = await getTile(tileKey('basemap', v, z, x, y));
    if (rec) return rec.data ?? new ArrayBuffer(0); // null = tile known to be empty
  }
  // 2. Network, when there is one.
  if (networkAllowed()) {
    const info = await liveInfo();
    if (info && !signal.aborted) {
      const buf = await fetchBytes(fillTileUrl(info.tileUrlTemplate, z, x, y), signal);
      if (buf) return buf;
    }
  }
  throw notAvailable('Map tile');
}

/** DEM tile bytes (PNG). Shared by the hillshade source and the contour generator. */
export async function loadDemTile(z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const rec = await getTile(tileKey('dem', null, z, x, y));
  if (rec?.data) return rec.data;
  if (!rec && networkAllowed()) {
    const buf = await fetchBytes(fillTileUrl(DEM_TILE_URL, z, x, y), signal);
    if (buf) return buf;
  }
  throw notAvailable('Elevation tile');
}

const GLYPH_STORE_OWNER = '_glyphs';

async function loadGlyphs(fontstack: string, range: string, signal: AbortSignal): Promise<ArrayBuffer> {
  // Style layers use single-font stacks; if a stack ever lists several, the first one wins.
  const font = fontstack.split(',')[0]!.trim();
  if (BUNDLED_GLYPH_RANGES.has(range)) {
    // Shipped with the app and precached by the service worker.
    const buf = await fetchBytes(appUrl(`fonts/${encodeURIComponent(font)}/${range}.pbf`), signal);
    if (buf) return buf;
  }
  // Other scripts: cached on first use while online, otherwise those characters are skipped.
  const key = `glyph/${font}/${range}`;
  const rec = await getTile(key);
  if (rec?.data) return rec.data;
  if (networkAllowed()) {
    const url = REMOTE_GLYPHS_URL.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', range);
    const buf = await fetchBytes(url, signal);
    if (buf) {
      try {
        await (await getDb()).put('tiles', { data: buf, bytes: buf.byteLength, regionIds: [GLYPH_STORE_OWNER] }, key);
      } catch {
        // caching is best-effort
      }
      return buf;
    }
  }
  return new ArrayBuffer(0); // an empty glyph set: labels render without the missing characters
}

let installed = false;

/** Register the protocol with MapLibre. Idempotent. */
export function installOfflineProtocol(): void {
  if (installed) return;
  installed = true;
  addProtocol('offline', async (params, abortController) => {
    const path = params.url.slice('offline://'.length).split('?')[0]!;
    const parts = path.split('/');
    const signal = abortController.signal;
    if (parts[0] === 'basemap' && parts.length === 5) {
      return { data: await loadBasemapTile(parts[1]!, Number(parts[2]), Number(parts[3]), Number(parts[4]), signal) };
    }
    if (parts[0] === 'dem' && parts.length === 4) {
      return { data: await loadDemTile(Number(parts[1]), Number(parts[2]), Number(parts[3]), signal) };
    }
    if (parts[0] === 'glyphs' && parts.length >= 3) {
      const range = parts[parts.length - 1]!;
      const fontstack = decodeURIComponent(parts.slice(1, -1).join('/'));
      return { data: await loadGlyphs(fontstack, range, signal) };
    }
    throw notAvailable('Resource');
  });
}
