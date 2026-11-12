// A small in-memory log of GPS lifecycle events. It exists so that "GPS stops when the app is
// hidden" can be verified: shown in Settings → Diagnostics and read by the e2e tests.

export interface GeoLogEntry {
  at: number;
  event: 'watch' | 'clear' | 'fix' | 'error' | 'compass-on' | 'compass-off';
  detail?: string;
}

const MAX_ENTRIES = 200;
const entries: GeoLogEntry[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly GeoLogEntry[] = [];

export function logGeo(event: GeoLogEntry['event'], detail?: string): void {
  entries.push({ at: Date.now(), event, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  snapshot = entries.slice();
  listeners.forEach((fn) => fn());
}

export function getGeoLog(): readonly GeoLogEntry[] {
  return snapshot;
}

export function subscribeGeoLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

(window as unknown as { __trailkeepGeoLog: () => readonly GeoLogEntry[] }).__trailkeepGeoLog = getGeoLog;
