// IndexedDB schema (PLAN §7). Database "trailkeep", version 1.
//
// RULES FOR FUTURE CHANGES (PLAN §5.6, §10):
//  - Migrations must be additive: add stores / indexes / optional fields, never drop or rewrite.
//  - Nothing here is ever cleared when the app shell or service worker updates.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Region, Trail } from '../domain/types';

export interface TileRecord {
  /** Tile bytes, or null for a tile the server says is empty (204/404). ArrayBuffer rather than
   *  Blob because Blobs in IndexedDB have a history of going missing in WebKit. */
  data: ArrayBuffer | null;
  bytes: number;
  /** Regions that need this tile; it is deleted only when the last one lets go. */
  regionIds: string[];
}

export interface QueueItem {
  regionId: string;
  /** Tile store key. */
  key: string;
  url: string;
  /** Position in the download order (lower zooms first). */
  order: number;
}

export interface TrailKeepDB extends DBSchema {
  trails: { key: string; value: Trail };
  regions: { key: string; value: Region };
  tiles: { key: string; value: TileRecord; indexes: { byRegion: string } };
  queue: { key: [string, string]; value: QueueItem; indexes: { byRegion: string } };
  settings: { key: string; value: unknown };
}

export const DB_NAME = 'trailkeep';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TrailKeepDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<TrailKeepDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TrailKeepDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('trails', { keyPath: 'id' });
          db.createObjectStore('regions', { keyPath: 'id' });
          const tiles = db.createObjectStore('tiles');
          tiles.createIndex('byRegion', 'regionIds', { multiEntry: true });
          const queue = db.createObjectStore('queue', { keyPath: ['regionId', 'key'] });
          queue.createIndex('byRegion', 'regionId');
          db.createObjectStore('settings');
        }
        // Version 2 and later: add new stores/indexes here, guarded by `if (oldVersion < N)`.
      },
      terminated() {
        dbPromise = null; // reopen on next use (iOS can kill the connection in the background)
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

// --- trails ----------------------------------------------------------------------------------

export async function listTrails(): Promise<Trail[]> {
  const all = await (await getDb()).getAll('trails');
  return all.sort((a, b) => b.importedAt - a.importedAt);
}

export async function getTrail(id: string): Promise<Trail | undefined> {
  return (await getDb()).get('trails', id);
}

export async function putTrail(trail: Trail): Promise<void> {
  await (await getDb()).put('trails', trail);
}

/** Read-modify-write inside one transaction so concurrent updates cannot clobber each other. */
export async function updateTrail(id: string, change: (t: Trail) => void): Promise<Trail | undefined> {
  const tx = (await getDb()).transaction('trails', 'readwrite');
  const trail = await tx.store.get(id);
  if (trail) {
    change(trail);
    await tx.store.put(trail);
  }
  await tx.done;
  return trail;
}

export async function deleteTrailRecord(id: string): Promise<void> {
  await (await getDb()).delete('trails', id);
}

// --- regions ---------------------------------------------------------------------------------

export async function listRegions(): Promise<Region[]> {
  const all = await (await getDb()).getAll('regions');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRegion(id: string): Promise<Region | undefined> {
  return (await getDb()).get('regions', id);
}

export async function putRegion(region: Region): Promise<void> {
  await (await getDb()).put('regions', region);
}

export async function updateRegion(id: string, change: (r: Region) => void): Promise<Region | undefined> {
  const tx = (await getDb()).transaction('regions', 'readwrite');
  const region = await tx.store.get(id);
  if (region) {
    change(region);
    await tx.store.put(region);
  }
  await tx.done;
  return region;
}

// --- settings (small key/value store) --------------------------------------------------------

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('settings', value, key);
}
