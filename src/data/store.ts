// App-wide state: the trail and region lists and the settings, kept in sync with IndexedDB.
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, type LatLonEle, type Region, type Settings, type Trail } from '../domain/types';
import { getSetting, listRegions, listTrails, setSetting } from './db';
import { downloads } from './downloader';

/** A trail without its heavy fields, plus a ready-made thumbnail path. */
export type TrailSummary = Omit<Trail, 'gpxText' | 'segments' | 'cumDist'> & { thumb: string };

export interface AppState {
  loaded: boolean;
  error: string | null;
  trails: TrailSummary[];
  regions: Region[];
  settings: Settings;
}

const THUMB_W = 96;
const THUMB_H = 64;
const THUMB_PAD = 6;

/** SVG path for a small static line drawing of the trail: no tiles needed. */
export function thumbnailPath(segments: LatLonEle[][], bbox: Trail['bbox']): string {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const w = Math.max(1e-9, (bbox[2] - bbox[0]) * kx);
  const h = Math.max(1e-9, bbox[3] - bbox[1]);
  const scale = Math.min((THUMB_W - 2 * THUMB_PAD) / w, (THUMB_H - 2 * THUMB_PAD) / h);
  const ox = (THUMB_W - w * scale) / 2;
  const oy = (THUMB_H - h * scale) / 2;
  let d = '';
  for (const seg of segments) {
    const stride = Math.max(1, Math.floor(seg.length / 150));
    for (let i = 0; i < seg.length; i += stride) {
      const p = seg[i]!;
      const x = ox + (p[1] - bbox[0]) * kx * scale;
      const y = oy + (bbox[3] - p[0]) * scale;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    const last = seg[seg.length - 1]!;
    d += `L${(ox + (last[1] - bbox[0]) * kx * scale).toFixed(1)} ${(oy + (bbox[3] - last[0]) * scale).toFixed(1)}`;
  }
  return d;
}

function summarize(t: Trail): TrailSummary {
  const { gpxText: _gpx, segments, cumDist: _cd, ...rest } = t;
  return { ...rest, thumb: thumbnailPath(segments, t.bbox) };
}

let state: AppState = { loaded: false, error: null, trails: [], regions: [], settings: DEFAULT_SETTINGS };
const listeners = new Set<() => void>();
let refreshing: Promise<void> | null = null;
let refreshAgain = false;

function set(next: Partial<AppState>): void {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export async function refreshData(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      do {
        refreshAgain = false;
        const [trails, regions, saved] = await Promise.all([listTrails(), listRegions(), getSetting<Partial<Settings>>('settings')]);
        set({
          loaded: true,
          error: null,
          trails: trails.map(summarize),
          regions,
          settings: { ...DEFAULT_SETTINGS, ...(saved ?? {}) },
        });
      } while (refreshAgain);
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : 'Storage is not available.' });
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function updateSettings(change: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...change };
  set({ settings });
  await setSetting('settings', settings);
}

export function getAppState(): AppState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getAppState);
}

export function useDownloads() {
  return useSyncExternalStore(downloads.subscribe, downloads.getSnapshot);
}

// Region and trail records change as downloads progress.
let pending: number | null = null;
downloads.onDataChange(() => {
  if (pending !== null) return;
  pending = window.setTimeout(() => {
    pending = null;
    void refreshData();
  }, 150);
});
