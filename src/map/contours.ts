// Contour lines generated on the device from DEM tiles with maplibre-contour (PLAN §5.4, §5.5).
// The library normally fetches DEM tiles itself over HTTP; here its tile reader is replaced so
// it goes through the same offline lookup as everything else, and contours work in airplane mode.
import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { loadDemTile } from './offlineProtocol';
import { DEM_MAXZOOM, DEM_MAXZOOM_HIGH_DETAIL } from './sources';

type DemSource = InstanceType<typeof mlcontour.DemSource>;
type HeightTile = InstanceType<typeof mlcontour.HeightTile>;
type LocalDemManager = InstanceType<typeof mlcontour.LocalDemManager>;
type FetchDemArgs = Parameters<LocalDemManager['fetchDem']>;

const DEM_URL_PATTERN = 'offline://dem/{z}/{x}/{y}';
/** How many zoom levels to step down when a DEM tile is missing (z13 → z12 → z11). */
const PARENT_FALLBACK_LEVELS = 2;

class OfflineDemManager extends mlcontour.LocalDemManager {
  /**
   * Like the library's version, but tolerant of gaps: if the wanted DEM tile is not stored,
   * use its parent, and if nothing is there return "no data" instead of failing the whole
   * contour tile. That keeps contours drawing right up to the edge of a downloaded area.
   */
  override async fetchDem(...args: FetchDemArgs): Promise<HeightTile> {
    const [z, x, y, options, abortController, timer] = args;
    const top = Math.max(0, Math.min(z - (options.overzoom || 0), this.maxzoom));
    for (let zoom = top; zoom >= Math.max(0, top - PARENT_FALLBACK_LEVELS); zoom--) {
      const subZ = z - zoom;
      const div = 1 << subZ;
      try {
        const tile = await this.fetchAndParseTile(zoom, Math.floor(x / div), Math.floor(y / div), abortController, timer);
        return mlcontour.HeightTile.fromRawDem(tile).split(subZ, x % div, y % div);
      } catch (e) {
        if (abortController.signal.aborted) throw e;
      }
    }
    return undefined as unknown as HeightTile; // combineNeighbors() treats undefined as "no neighbour"
  }
}

let demMaxzoom = DEM_MAXZOOM;

function makeManager(): OfflineDemManager {
  return new OfflineDemManager({
    demUrlPattern: DEM_URL_PATTERN,
    cacheSize: 80,
    encoding: 'terrarium',
    maxzoom: demMaxzoom,
    timeoutMs: 20_000,
    getTile: async (url, abortController) => {
      const [z, x, y] = url.slice('offline://dem/'.length).split('/').map(Number);
      const data = await loadDemTile(z!, x!, y!, abortController.signal);
      return { data: new Blob([data], { type: 'image/png' }) };
    },
  });
}

let demSource: DemSource | null = null;

function getDemSource(): DemSource {
  if (!demSource) {
    // worker: false keeps the DEM reads on this thread, where the offline lookup lives.
    demSource = new mlcontour.DemSource({
      url: DEM_URL_PATTERN,
      encoding: 'terrarium',
      maxzoom: DEM_MAXZOOM_HIGH_DETAIL,
      worker: false,
    });
    demSource.manager = makeManager();
    demSource.setupMaplibre(maplibregl);
  }
  return demSource;
}

/** Minor / major contour intervals in metres by zoom (PLAN §5.4). */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  11: [100, 500],
  12: [50, 250],
  13: [20, 100],
  14: [10, 50],
};

/** Tile URL template for the contour vector source. */
export function contourTilesUrl(): string {
  return getDemSource().contourProtocolUrl({
    thresholds: CONTOUR_THRESHOLDS,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
    overzoom: 1,
  });
}

/**
 * Forget cached DEM and contour tiles, e.g. after a download adds new terrain.
 * `maxzoom` is the most detailed DEM zoom worth asking for (13 once a high-detail region exists).
 */
export function resetContourCache(maxzoom?: number): void {
  if (maxzoom !== undefined) demMaxzoom = Math.min(DEM_MAXZOOM_HIGH_DETAIL, Math.max(0, maxzoom));
  if (demSource) demSource.manager = makeManager();
}
