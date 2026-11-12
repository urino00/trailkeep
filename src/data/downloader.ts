// Offline region downloader (PLAN §6.4): persistent queue, 4 parallel requests, retry with
// backoff, resume after the app is closed, cancel, and a final completeness check.
import { bufferBbox } from '../domain/geo';
import {
  chunkTiles,
  countRegionTiles,
  fillTileUrl,
  planRegionTiles,
  tileKey,
  type RegionTileSpec,
  type TileLayer,
} from '../domain/tiles';
import type { Bbox, Region, RegionStatus } from '../domain/types';
import { acquireWakeLock, releaseWakeLock } from '../location/wakeLock';
import {
  CONTEXT_BUFFER_M,
  CONTEXT_MAXZOOM,
  DEM_MAXZOOM,
  DEM_MAXZOOM_HIGH_DETAIL,
  DEM_TILE_URL,
  MAX_PARALLEL_REQUESTS,
  fetchBasemapInfo,
} from '../map/sources';
import { getDb, getRegion, listRegions, putRegion, setSetting, updateRegion, updateTrail, type QueueItem } from './db';
import { fillTrailElevationFromDem } from './demSampler';
import {
  claimExistingTile,
  clearQueue,
  enqueue,
  queuedItems,
  regionStoredStats,
  regionTileKeys,
  releaseRegionTiles,
  storeTile,
} from './tileStore';

export interface DownloadProgress {
  regionId: string;
  status: RegionStatus;
  done: number;
  total: number;
  bytes: number;
  failed: number;
  chunk: number;
  chunks: number;
  error?: string;
}

export interface NewRegionSpec {
  name: string;
  kind: 'trail' | 'custom';
  trailId?: string;
  /** Detail area, already buffered. */
  bbox: Bbox;
  bufferM?: number;
  highDetail: boolean;
}

const RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const PAUSE_BETWEEN_CHUNKS_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 12;

export function regionTileSpec(region: Pick<Region, 'bbox' | 'contextBbox' | 'basemap' | 'dem'>): RegionTileSpec {
  return {
    bbox: region.bbox,
    contextBbox: region.contextBbox,
    basemapMinZoom: region.basemap.minzoom,
    basemapMaxZoom: region.basemap.maxzoom,
    contextMaxZoom: region.basemap.contextMaxzoom,
    demMaxZoom: region.dem.maxzoom,
  };
}

/** Tile spec for an area before any server contact, used for the size estimate. */
export function draftTileSpec(bbox: Bbox, highDetail: boolean, basemapMaxZoom: number): RegionTileSpec {
  return {
    bbox,
    contextBbox: bufferBbox(bbox, CONTEXT_BUFFER_M),
    basemapMinZoom: 0,
    basemapMaxZoom,
    contextMaxZoom: Math.min(CONTEXT_MAXZOOM, basemapMaxZoom),
    demMaxZoom: highDetail ? DEM_MAXZOOM_HIGH_DETAIL : DEM_MAXZOOM,
  };
}

function plannedItems(region: Region): QueueItem[] {
  return planRegionTiles(regionTileSpec(region)).map((t, order) => {
    const basemap = t.layer === 'basemap';
    return {
      regionId: region.id,
      key: tileKey(t.layer, basemap ? region.basemap.version : null, t.z, t.x, t.y),
      url: fillTileUrl(basemap ? region.basemap.tileUrlTemplate : region.dem.tileUrlTemplate, t.z, t.x, t.y),
      order,
    };
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class PermanentError extends Error {}

/** Fetch one tile. Resolves to null for a tile the server reports as empty (204/404). */
async function fetchTileBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1), signal); // 1 s, then 3 s
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = window.setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      // The browser adds Origin and Referer, which is how this app identifies itself to
      // OpenFreeMap (browsers cannot set User-Agent; see PLAN OPEN-1).
      const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
      if (res.status === 204 || res.status === 404) return null;
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return buf.byteLength > 0 ? buf : null;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new PermanentError(`Server answered ${res.status}`);
      }
      lastError = new Error(`Server answered ${res.status}`);
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof PermanentError) throw e;
      lastError = e;
    } finally {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Download failed');
}

type Listener = () => void;
type CompleteListener = (region: Region) => void;

class DownloadManager {
  private active = new Map<string, AbortController>();
  private progress = new Map<string, DownloadProgress>();
  private snapshot: ReadonlyMap<string, DownloadProgress> = new Map();
  private listeners = new Set<Listener>();
  private completeListeners = new Set<CompleteListener>();
  private changeListeners = new Set<Listener>();
  private emitTimer: number | null = null;

  /** Live progress of running downloads (for useSyncExternalStore). */
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): ReadonlyMap<string, DownloadProgress> => this.snapshot;

  /** Called when a region finishes, so open maps can reload their tiles. */
  onComplete(fn: CompleteListener): () => void {
    this.completeListeners.add(fn);
    return () => this.completeListeners.delete(fn);
  }

  /** Called whenever region or trail records changed in the database. */
  onDataChange(fn: Listener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  isActive(regionId: string): boolean {
    return this.active.has(regionId);
  }

  private emit(immediate = false): void {
    const flush = () => {
      this.emitTimer = null;
      this.snapshot = new Map(this.progress);
      this.listeners.forEach((fn) => fn());
    };
    if (immediate) {
      if (this.emitTimer !== null) window.clearTimeout(this.emitTimer);
      flush();
    } else if (this.emitTimer === null) {
      this.emitTimer = window.setTimeout(flush, 200);
    }
  }

  private dataChanged(): void {
    this.changeListeners.forEach((fn) => fn());
  }

  /** Resolve the current basemap version, plan the tiles, and persist the region plus its queue. */
  async createRegion(spec: NewRegionSpec): Promise<Region> {
    const info = await fetchBasemapInfo();
    void setSetting('basemapInfo', info);
    const region: Region = {
      id: crypto.randomUUID(),
      name: spec.name,
      kind: spec.kind,
      trailId: spec.trailId,
      bbox: spec.bbox,
      contextBbox: bufferBbox(spec.bbox, CONTEXT_BUFFER_M),
      basemap: {
        tilejsonUrl: info.tilejsonUrl,
        version: info.version,
        tileUrlTemplate: info.tileUrlTemplate,
        minzoom: info.minzoom,
        maxzoom: info.maxzoom,
        contextMaxzoom: Math.min(CONTEXT_MAXZOOM, info.maxzoom),
      },
      dem: { tileUrlTemplate: DEM_TILE_URL, maxzoom: spec.highDetail ? DEM_MAXZOOM_HIGH_DETAIL : DEM_MAXZOOM },
      status: 'queued',
      expectedTiles: 0,
      storedTiles: 0,
      bytes: 0,
      createdAt: Date.now(),
      bufferM: spec.bufferM,
    };
    region.expectedTiles = countRegionTiles(regionTileSpec(region));

    if (spec.trailId) {
      // Point the trail at the new region now; the old one is removed once this one is complete,
      // so a failed re-download never leaves the trail without a map.
      const trail = await updateTrail(spec.trailId, (t) => {
        if (t.regionId) region.replacesRegionId = t.regionId;
        t.regionId = region.id;
      });
      if (!trail) throw new Error('Trail not found');
    }
    await putRegion(region);
    await enqueue(plannedItems(region));
    this.dataChanged();
    return region;
  }

  /** Start or resume a region download. Safe to call twice. */
  start(regionId: string): void {
    if (this.active.has(regionId)) return;
    const ctl = new AbortController();
    this.active.set(regionId, ctl);
    void this.run(regionId, ctl).finally(() => {
      this.active.delete(regionId);
      this.progress.delete(regionId);
      this.emit(true);
      if (this.active.size === 0) releaseWakeLock('download');
      this.dataChanged();
    });
  }

  private async run(regionId: string, ctl: AbortController): Promise<void> {
    const signal = ctl.signal;
    const region = await updateRegion(regionId, (r) => {
      r.status = 'downloading';
    });
    if (!region) return;
    void acquireWakeLock('download');

    const prog: DownloadProgress = {
      regionId,
      status: 'downloading',
      done: 0,
      total: region.expectedTiles,
      bytes: 0,
      failed: 0,
      chunk: 0,
      chunks: 1,
    };
    this.progress.set(regionId, prog);
    this.emit(true);
    this.dataChanged();

    let error: string | undefined;
    try {
      // Rebuild the queue from what is actually missing: covers a lost queue and "retry".
      const have = await regionTileKeys(regionId);
      let items = await queuedItems(regionId);
      const queued = new Set(items.map((i) => i.key));
      const missing = plannedItems(region).filter((i) => !have.has(i.key) && !queued.has(i.key));
      if (missing.length) {
        await enqueue(missing);
        items = await queuedItems(regionId);
      }
      const stats = await regionStoredStats(regionId);
      prog.done = stats.tiles;
      prog.bytes = stats.bytes;

      const chunks = chunkTiles(
        items.map((item) => {
          const parts = item.key.split('/');
          return { item, layer: parts[0] as TileLayer, z: Number(parts[2]) };
        }),
      );
      prog.chunks = Math.max(1, chunks.length);
      this.emit(true);

      let consecutiveFailures = 0;
      let lastPersist = Date.now();
      const persist = async () => {
        lastPersist = Date.now();
        await updateRegion(regionId, (r) => {
          r.storedTiles = prog.done;
          r.bytes = prog.bytes;
        });
      };

      for (let c = 0; c < chunks.length && !signal.aborted && !error; c++) {
        if (c > 0) await sleep(PAUSE_BETWEEN_CHUNKS_MS, signal);
        prog.chunk = c + 1;
        const chunk = chunks[c]!;
        let next = 0;
        const worker = async () => {
          while (!signal.aborted && !error) {
            const entry = chunk[next++];
            if (!entry) return;
            const { item } = entry;
            try {
              let bytes = await claimExistingTile(item.key, regionId);
              if (bytes === null) {
                const data = await fetchTileBytes(item.url, signal);
                bytes = await storeTile(item.key, data, regionId);
              }
              prog.done++;
              prog.bytes += bytes;
              consecutiveFailures = 0;
            } catch (e) {
              if (signal.aborted) return;
              prog.failed++;
              consecutiveFailures++;
              if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                error = 'The phone is out of storage space.';
              } else if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || navigator.onLine === false) {
                error = navigator.onLine === false ? 'No internet connection.' : 'The map server is not responding.';
              }
            }
            this.emit();
            if (Date.now() - lastPersist > 2000) void persist();
          }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, chunk.length) }, worker));
      }
      await persist();
    } catch (e) {
      if (!signal.aborted) error = e instanceof Error ? e.message : 'Download failed';
    }

    if (signal.aborted) return; // cancel() cleans up

    // Final check: every expected tile must be present (empty tiles count).
    const have = await regionTileKeys(regionId);
    const stillMissing = plannedItems(region).filter((i) => !have.has(i.key)).length;
    const stats = await regionStoredStats(regionId);
    const complete = stillMissing === 0;
    const updated = await updateRegion(regionId, (r) => {
      r.status = complete ? 'complete' : 'incomplete';
      r.storedTiles = stats.tiles;
      r.bytes = stats.bytes;
      if (complete) r.completedAt = Date.now();
    });
    prog.status = complete ? 'complete' : 'incomplete';
    prog.error = complete ? undefined : (error ?? `${stillMissing} tiles could not be downloaded.`);
    this.emit(true);

    if (complete && updated) {
      await clearQueue(regionId);
      if (updated.replacesRegionId) {
        const old = updated.replacesRegionId;
        await updateRegion(regionId, (r) => {
          delete r.replacesRegionId;
        });
        await this.removeRegionData(old);
      }
      if (updated.trailId) {
        try {
          await fillTrailElevationFromDem(updated.trailId, updated);
        } catch {
          // Elevation fill is a bonus; the map itself is complete.
        }
      }
      this.completeListeners.forEach((fn) => fn(updated));
    }
  }

  /** Stop a running download and remove what it fetched. */
  async cancel(regionId: string): Promise<void> {
    await this.deleteRegion(regionId);
  }

  /** Delete a region: its queue, its record and every tile no other region needs. */
  async deleteRegion(regionId: string): Promise<void> {
    this.active.get(regionId)?.abort();
    const region = await getRegion(regionId);
    if (region?.trailId) {
      await updateTrail(region.trailId, (t) => {
        if (t.regionId === regionId) {
          if (region.replacesRegionId) t.regionId = region.replacesRegionId;
          else delete t.regionId;
        }
      });
    }
    await this.removeRegionData(regionId);
    this.dataChanged();
  }

  private async removeRegionData(regionId: string): Promise<void> {
    this.active.get(regionId)?.abort();
    await clearQueue(regionId);
    await releaseRegionTiles(regionId);
    await (await getDb()).delete('regions', regionId);
  }

  /** On launch: continue downloads that were cut off when the app was closed or suspended. */
  async resumeInterrupted(): Promise<void> {
    const regions = await listRegions();
    for (const r of regions) {
      if (r.status !== 'downloading' && r.status !== 'queued') continue;
      if (navigator.onLine) this.start(r.id);
      else {
        await updateRegion(r.id, (x) => {
          x.status = 'incomplete';
        });
      }
    }
    this.dataChanged();
  }
}

export const downloads = new DownloadManager();
