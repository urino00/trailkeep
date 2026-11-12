// Owns the MapLibre map instance. The React screens talk to the map only through this class.
import {
  AttributionControl,
  Map as MlMap,
  ScaleControl,
  setWorkerUrl,
  type LngLatBoundsLike,
  type RasterDEMTileSource,
  type VectorTileSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { TrailGeometry } from '../domain/progress';
import type { Bbox, Fix, Region, Waypoint } from '../domain/types';
import { resetContourCache } from './contours';
import { addOverlayLayers, setHighlight, setRegionOutlines, setTrailData, setUserLocation } from './layers';
import { installOfflineProtocol } from './offlineProtocol';
import { buildStyle, type StyleOptions } from './style';

setWorkerUrl(workerUrl);

export interface MapInit extends StyleOptions {
  bounds?: Bbox;
  center?: [lon: number, lat: number];
  zoom?: number;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export class MapController {
  readonly map: MlMap;
  private ready: Promise<void>;
  private destroyed = false;
  private attributionTimer: number | null = null;

  constructor(container: HTMLElement, init: MapInit) {
    installOfflineProtocol();
    resetContourCache(init.demMaxzoom);
    this.map = new MlMap({
      container,
      style: buildStyle(init),
      bounds: init.bounds as LngLatBoundsLike | undefined,
      fitBoundsOptions: { padding: 48, maxZoom: 15 },
      center: init.bounds ? undefined : (init.center ?? [0, 20]),
      zoom: init.bounds ? undefined : (init.zoom ?? 1.5),
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false,
      // Flat map only: no pitch, no 3D terrain (battery, PLAN §5.4).
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      // Lets the e2e tests check that the canvas actually has a map on it.
      canvasContextAttributes: { preserveDrawingBuffer: import.meta.env.MODE !== 'production' || isTestRun() },
    });
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');
    // Tiles that are not stored are an expected condition offline, not something to report.
    this.map.on('error', () => undefined);
    // Handle for debugging and the e2e tests; not present in normal production use.
    if (import.meta.env.DEV || isTestRun()) (window as unknown as { __trailkeepMap?: MlMap }).__trailkeepMap = this.map;

    this.ready = new Promise((resolve) => {
      this.map.once('load', () => {
        if (this.destroyed) return;
        addOverlayLayers(this.map);
        resolve();
        // Show the credits in full on load, then fold them into the "i" button so they do not
        // cover the map. (MapLibre only folds them when the map is dragged by hand.)
        this.attributionTimer = window.setTimeout(() => {
          const el = container.querySelector('.maplibregl-ctrl-attrib');
          el?.classList.remove('maplibregl-compact-show');
          el?.removeAttribute('open');
        }, 5000);
      });
    });
  }

  /** Resolves when overlays can be set. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  setTrail(geom: TrailGeometry | null, waypoints: Waypoint[]): void {
    if (!this.destroyed) setTrailData(this.map, geom, waypoints);
  }

  setUser(fix: Fix | null, stale: boolean, heading: number | null): void {
    if (!this.destroyed) setUserLocation(this.map, fix, stale, heading);
  }

  setHighlight(point: { lat: number; lon: number } | null): void {
    if (!this.destroyed) setHighlight(this.map, point);
  }

  setRegions(regions: Region[]): void {
    if (!this.destroyed) setRegionOutlines(this.map, regions);
  }

  fitBbox(bbox: Bbox, padding: Padding, animate = true): void {
    this.map.fitBounds(bbox as LngLatBoundsLike, { padding, maxZoom: 15, duration: animate ? 600 : 0 });
  }

  /** Move to a position (used by follow mode). One short ease per fix, no continuous animation. */
  follow(lat: number, lon: number, bearing: number | null, padding: Padding): void {
    this.map.easeTo({
      center: [lon, lat],
      bearing: bearing ?? this.map.getBearing(),
      zoom: Math.max(this.map.getZoom(), 14),
      padding,
      duration: 350,
    });
  }

  showPoint(lat: number, lon: number, padding: Padding): void {
    this.map.easeTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 14), padding, duration: 500 });
  }

  zoomBy(delta: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 250 });
  }

  resetNorth(): void {
    this.map.easeTo({ bearing: 0, duration: 300 });
  }

  /** After a download: drop cached tiles and read everything again from storage. */
  reloadTiles(demMaxzoom?: number): void {
    if (this.destroyed) return;
    resetContourCache(demMaxzoom);
    for (const id of ['openmaptiles', 'dem', 'contours']) {
      const src = this.map.getSource(id) as VectorTileSource | RasterDEMTileSource | undefined;
      if (src?.tiles) src.setTiles([...src.tiles]);
    }
  }

  /** Geographic bbox of a rectangle given in container pixels. */
  screenRectToBbox(left: number, top: number, right: number, bottom: number): Bbox {
    const a = this.map.unproject([left, top]);
    const b = this.map.unproject([right, bottom]);
    const c = this.map.unproject([right, top]);
    const d = this.map.unproject([left, bottom]);
    const lons = [a.lng, b.lng, c.lng, d.lng];
    const lats = [a.lat, b.lat, c.lat, d.lat];
    return [
      Math.max(-180, Math.min(...lons)),
      Math.max(-85, Math.min(...lats)),
      Math.min(180, Math.max(...lons)),
      Math.min(85, Math.max(...lats)),
    ];
  }

  destroy(): void {
    this.destroyed = true;
    if (this.attributionTimer !== null) window.clearTimeout(this.attributionTimer);
    this.map.remove();
  }
}

function isTestRun(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}
