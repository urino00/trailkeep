// Shared data model (PLAN §7). Pure types: no DOM, no MapLibre.

export type LatLonEle = [lat: number, lon: number, ele: number | null];

/** [minLon, minLat, maxLon, maxLat] */
export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface Waypoint {
  lat: number;
  lon: number;
  ele: number | null;
  name?: string;
  desc?: string;
}

export interface TrailStats {
  distanceM: number;
  gainM: number;
  lossM: number;
  minEleM: number | null;
  maxEleM: number | null;
  isLoop: boolean;
  pointCount: number;
}

export type ElevationSource = 'gpx' | 'dem' | 'none';

export interface Trail {
  id: string;
  name: string;
  importedAt: number;
  fileName: string;
  /** Original file text, kept for future re-parse or export. */
  gpxText: string;
  segments: LatLonEle[][];
  /** Metres from the start of each segment, aligned with `segments`. */
  cumDist: number[][];
  waypoints: Waypoint[];
  bbox: Bbox;
  stats: TrailStats;
  elevationSource: ElevationSource;
  reversed: boolean;
  regionId?: string;
  /** Last matched position, in the current travel direction. */
  lastMatch?: { alongM: number; at: number };
}

export type RegionStatus = 'queued' | 'downloading' | 'complete' | 'incomplete' | 'cancelled';

export interface Region {
  id: string;
  name: string;
  kind: 'trail' | 'custom';
  trailId?: string;
  /** Already buffered. */
  bbox: Bbox;
  contextBbox?: Bbox;
  basemap: {
    tilejsonUrl: string;
    version: string;
    tileUrlTemplate: string;
    minzoom: number;
    maxzoom: number;
    contextMaxzoom: number;
  };
  dem: { tileUrlTemplate: string; maxzoom: number };
  status: RegionStatus;
  expectedTiles: number;
  storedTiles: number;
  bytes: number;
  createdAt: number;
  completedAt?: number;
  /** Buffer the user picked, for showing it again on re-download. */
  bufferM?: number;
  /** A previous region for the same trail that is removed once this one completes. */
  replacesRegionId?: string;
}

export interface Settings {
  paceFactor: number;
  keepScreenOn: boolean;
  /** Never touch the network for map tiles, even when the phone says it is online. */
  offlineOnly: boolean;
  onboardingDone: boolean;
  locationExplained: boolean;
  installHintDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  paceFactor: 1.0,
  keepScreenOn: false,
  offlineOnly: false,
  onboardingDone: false,
  locationExplained: false,
  installHintDismissed: false,
};

export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  altitudeM: number | null;
  altitudeAccuracyM: number | null;
  timestamp: number;
}
