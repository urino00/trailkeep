// Trail import and edits.
import { GpxError, MAX_GPX_BYTES, buildTrail, parseGpx, type GpxErrorCode, type ParsedGpx } from '../domain/gpx';
import type { Trail } from '../domain/types';
import { deleteTrailRecord, getTrail, putTrail, updateTrail } from './db';
import { downloads } from './downloader';
import type { GpxWorkerReply } from './gpx.worker';

const WORKER_THRESHOLD_BYTES = 1024 * 1024;

function parseInWorker(text: string): Promise<ParsedGpx> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gpx.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // No module workers: parse here instead.
      try {
        resolve(parseGpx(text));
      } catch (e) {
        reject(e);
      }
      return;
    }
    worker.onmessage = (e: MessageEvent<GpxWorkerReply>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.parsed);
      else reject(new GpxError(e.data.code as GpxErrorCode, e.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      try {
        resolve(parseGpx(text));
      } catch (e) {
        reject(e);
      }
    };
    worker.postMessage(text);
  });
}

/** Read, parse and store a GPX file. Throws GpxError with a user-friendly message. */
export async function importGpxFile(file: File): Promise<Trail> {
  if (file.size > MAX_GPX_BYTES) {
    throw new GpxError('too-large', `This file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 25 MB.`);
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new GpxError('not-gpx', 'This file could not be read.');
  }
  const parsed = text.length > WORKER_THRESHOLD_BYTES ? await parseInWorker(text) : parseGpx(text);
  const trail = buildTrail(parsed, {
    id: crypto.randomUUID(),
    fileName: file.name || 'trail.gpx',
    gpxText: text,
    now: Date.now(),
  });
  await putTrail(trail);
  return trail;
}

export async function renameTrail(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await updateTrail(id, (t) => {
    t.name = clean;
  });
}

export async function deleteTrail(id: string, alsoDeleteMap: boolean): Promise<void> {
  const trail = await getTrail(id);
  if (!trail) return;
  if (trail.regionId) {
    if (alsoDeleteMap) await downloads.deleteRegion(trail.regionId);
    // Otherwise the region stays on the Storage screen as a standalone map area.
  }
  await deleteTrailRecord(id);
}

/** Flip the direction of travel. The saved position is mirrored so progress stays where it was. */
export async function setTrailReversed(id: string, reversed: boolean): Promise<void> {
  await updateTrail(id, (t) => {
    if (t.reversed === reversed) return;
    t.reversed = reversed;
    if (t.lastMatch) t.lastMatch = { alongM: Math.max(0, t.stats.distanceM - t.lastMatch.alongM), at: t.lastMatch.at };
  });
}

export async function saveLastMatch(id: string, alongM: number): Promise<void> {
  await updateTrail(id, (t) => {
    t.lastMatch = { alongM, at: Date.now() };
  });
}

export async function resetProgress(id: string): Promise<void> {
  await updateTrail(id, (t) => {
    delete t.lastMatch;
  });
}
