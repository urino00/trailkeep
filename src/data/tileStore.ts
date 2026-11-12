// Tile storage with reference counting (PLAN §5.6): a tile may belong to several regions and is
// only deleted when the last of them is removed.
import { getDb, type QueueItem, type TileRecord } from './db';

export async function getTile(key: string): Promise<TileRecord | undefined> {
  return (await getDb()).get('tiles', key);
}

/**
 * Store a downloaded tile for a region. If another region already stored it, the existing bytes
 * are kept and the region is just added as a reference. Also removes the queue entry, in the
 * same transaction, so a crash can never leave a tile both "pending" and "stored".
 * Returns the tile's size in bytes.
 */
export async function storeTile(key: string, data: ArrayBuffer | null, regionId: string): Promise<number> {
  const tx = (await getDb()).transaction(['tiles', 'queue'], 'readwrite');
  const tiles = tx.objectStore('tiles');
  const existing = await tiles.get(key);
  let bytes: number;
  if (existing) {
    bytes = existing.bytes;
    if (!existing.regionIds.includes(regionId)) {
      existing.regionIds.push(regionId);
      await tiles.put(existing, key);
    }
  } else {
    bytes = data ? data.byteLength : 0;
    await tiles.put({ data, bytes, regionIds: [regionId] }, key);
  }
  await tx.objectStore('queue').delete([regionId, key]);
  await tx.done;
  return bytes;
}

/** If the tile is already stored, reference it from this region and drop it from the queue. */
export async function claimExistingTile(key: string, regionId: string): Promise<number | null> {
  const tx = (await getDb()).transaction(['tiles', 'queue'], 'readwrite');
  const tiles = tx.objectStore('tiles');
  const existing = await tiles.get(key);
  if (!existing) {
    await tx.done;
    return null;
  }
  if (!existing.regionIds.includes(regionId)) {
    existing.regionIds.push(regionId);
    await tiles.put(existing, key);
  }
  await tx.objectStore('queue').delete([regionId, key]);
  await tx.done;
  return existing.bytes;
}

/** Keys of every tile a region references. */
export async function regionTileKeys(regionId: string): Promise<Set<string>> {
  const keys = await (await getDb()).getAllKeysFromIndex('tiles', 'byRegion', regionId);
  return new Set(keys);
}

/** Total stored bytes of a region's tiles (shared tiles count for every region that uses them). */
export async function regionStoredStats(regionId: string): Promise<{ tiles: number; bytes: number }> {
  const tx = (await getDb()).transaction('tiles', 'readonly');
  let tiles = 0;
  let bytes = 0;
  let cursor = await tx.store.index('byRegion').openCursor(regionId);
  while (cursor) {
    tiles++;
    bytes += cursor.value.bytes;
    cursor = await cursor.continue();
  }
  await tx.done;
  return { tiles, bytes };
}

/** Drop a region's references; tiles nobody else needs are deleted. Works in batches. */
export async function releaseRegionTiles(regionId: string): Promise<void> {
  const db = await getDb();
  const keys = await db.getAllKeysFromIndex('tiles', 'byRegion', regionId);
  const BATCH = 200;
  for (let i = 0; i < keys.length; i += BATCH) {
    const tx = db.transaction('tiles', 'readwrite');
    for (const key of keys.slice(i, i + BATCH)) {
      const rec = await tx.store.get(key);
      if (!rec) continue;
      const rest = rec.regionIds.filter((id) => id !== regionId);
      if (rest.length === 0) await tx.store.delete(key);
      else if (rest.length !== rec.regionIds.length) await tx.store.put({ ...rec, regionIds: rest }, key);
    }
    await tx.done;
  }
}

// --- download queue --------------------------------------------------------------------------

export async function enqueue(items: QueueItem[]): Promise<void> {
  const db = await getDb();
  const BATCH = 500;
  for (let i = 0; i < items.length; i += BATCH) {
    const tx = db.transaction('queue', 'readwrite');
    for (const item of items.slice(i, i + BATCH)) void tx.store.put(item);
    await tx.done;
  }
}

export async function queuedItems(regionId: string): Promise<QueueItem[]> {
  const items = await (await getDb()).getAllFromIndex('queue', 'byRegion', regionId);
  return items.sort((a, b) => a.order - b.order);
}

export async function clearQueue(regionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  let cursor = await tx.store.index('byRegion').openKeyCursor(regionId);
  while (cursor) {
    void tx.store.delete(cursor.primaryKey);
    cursor = await cursor.continue();
  }
  await tx.done;
}
