// The map screen. With a trail it is the trail screen (map + progress + elevation profile,
// PLAN §6.5-§6.7); without one it is a free map for browsing and downloading custom areas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTrail } from '../data/db';
import { downloads } from '../data/downloader';
import { getAppState, refreshData, updateSettings, useAppState, useDownloads } from '../data/store';
import { resetProgress, saveLastMatch, setTrailReversed } from '../data/trails';
import { buildTimeIndex } from '../domain/eta';
import { buildProfile } from '../domain/profile';
import { HISTORY_MAX_AGE_MS, locateOnTrail, orientedGeometry, pointAtDistance, type TrailMatch } from '../domain/progress';
import type { Trail } from '../domain/types';
import { startCompass } from '../location/compass';
import { accuracyLevel, useLocation } from '../location/useLocation';
import { acquireWakeLock, releaseWakeLock } from '../location/wakeLock';
import { MapController, type Padding } from '../map/controller';
import { BASEMAP_FALLBACK_MAXZOOM, DEM_MAXZOOM } from '../map/sources';
import { AreaTool } from './AreaTool';
import { ActionSheet, Sheet, toast, type ActionItem } from './components';
import { DownloadSheet } from './DownloadSheet';
import { useElementSize, useOnline } from './hooks';
import { IconArea, IconBack, IconCompass, IconDownload, IconFit, IconLocate, IconMinus, IconMore, IconNorth, IconPlus, IconStorage } from './icons';
import { FAR_FROM_TRAIL_M, ProgressPanel } from './ProgressPanel';
import { goBack, navigate } from './router';
import { offlineStatus } from './status';

type FollowMode = 'off' | 'follow' | 'heading';
const SAVE_MATCH_INTERVAL_MS = 15_000;
const WAYPOINT_SNAP_M = 250;

export function MapScreen({ trailId, autoDownload }: { trailId?: string; autoDownload?: boolean }) {
  const app = useAppState();
  const progress = useDownloads();
  const online = useOnline();
  const summary = trailId ? app.trails.find((t) => t.id === trailId) : undefined;

  // ----- trail record (the summary in app state has no geometry) -----
  const [trail, setTrail] = useState<Trail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const summaryKey = summary ? `${summary.reversed}|${summary.elevationSource}|${summary.name}` : '';
  useEffect(() => {
    if (!trailId) return;
    let cancelled = false;
    void getTrail(trailId).then(
      (t) => {
        if (cancelled) return;
        if (t) setTrail(t);
        else setNotFound(true);
      },
      () => !cancelled && setNotFound(true),
    );
    return () => {
      cancelled = true;
    };
  }, [trailId, summaryKey]);

  const geom = useMemo(() => (trail ? orientedGeometry(trail) : null), [trail]);
  const profile = useMemo(() => (geom ? buildProfile(geom.segments, geom.cumDist) : null), [geom]);
  const timeIndex = useMemo(() => (profile ? buildTimeIndex(profile) : null), [profile]);
  const marks = useMemo(() => {
    if (!geom || !trail) return [];
    const out: number[] = [];
    for (const w of trail.waypoints) {
      const m = locateOnTrail(geom, w.lat, w.lon);
      if (m && m.offM <= WAYPOINT_SNAP_M) out.push(m.alongM);
    }
    return out;
  }, [geom, trail]);

  // ----- map -----
  const containerRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<MapController | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const [follow, setFollow] = useState<FollowMode>('off');
  const followRef = useRef<FollowMode>('off');
  followRef.current = follow;
  const [heading, setHeading] = useState<number | null>(null);
  const compassStop = useRef<(() => void) | null>(null);

  const [screenRef, screenSize] = useElementSize<HTMLDivElement>();
  const [topRef, topSize] = useElementSize<HTMLDivElement>();
  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const padding = useCallback(
    (): Padding => ({ top: topSize.height + 28, bottom: panelSize.height + 40, left: 28, right: 78 }),
    [topSize.height, panelSize.height],
  );
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  const stopCompass = useCallback(() => {
    compassStop.current?.();
    compassStop.current = null;
    setHeading(null);
  }, []);

  const canCreateMap = app.loaded && (!trailId || trail !== null);
  useEffect(() => {
    if (!canCreateMap || !containerRef.current) return;
    const st = getAppState();
    const own = trail?.regionId ? st.regions.find((r) => r.id === trail.regionId) : undefined;
    const ref = own ?? st.regions.find((r) => r.status === 'complete') ?? st.regions[0];
    const ctl = new MapController(containerRef.current, {
      basemapVersion: ref?.basemap.version ?? 'live',
      basemapMaxzoom: ref?.basemap.maxzoom ?? BASEMAP_FALLBACK_MAXZOOM,
      demMaxzoom: Math.max(DEM_MAXZOOM, ...st.regions.map((r) => r.dem.maxzoom)),
      bounds: trail ? trail.bbox : ref?.bbox,
    });
    ctlRef.current = ctl;
    let alive = true;
    void ctl.whenReady().then(() => {
      if (!alive) return;
      if (trail) ctl.fitBbox(trail.bbox, paddingRef.current(), false);
      setMapReady(true);
    });
    // Panning by hand means "stop following me".
    ctl.map.on('dragstart', () => {
      if (followRef.current !== 'off') {
        setFollow('off');
        compassStop.current?.();
        compassStop.current = null;
        setHeading(null);
      }
    });
    ctl.map.on('rotateend', () => setMapBearing(ctl.map.getBearing()));
    ctl.map.on('moveend', () => setMapBearing(ctl.map.getBearing()));
    return () => {
      alive = false;
      setMapReady(false);
      ctlRef.current = null;
      ctl.destroy();
    };
    // The map is created once per trail; later trail changes are pushed through the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateMap, trailId]);

  useEffect(() => {
    if (mapReady) ctlRef.current?.setTrail(geom, trail?.waypoints ?? []);
  }, [mapReady, geom, trail]);

  useEffect(() => {
    if (mapReady) ctlRef.current?.setRegions(app.regions.filter((r) => r.status === 'complete'));
  }, [mapReady, app.regions]);

  // A finished download adds tiles: reread them.
  useEffect(
    () =>
      downloads.onComplete(() => {
        const maxDem = Math.max(DEM_MAXZOOM, ...getAppState().regions.map((r) => r.dem.maxzoom));
        ctlRef.current?.reloadTiles(maxDem);
        void refreshData();
      }),
    [],
  );

  // ----- location -----
  const [locCardDismissed, setLocCardDismissed] = useState(false);
  const [showDeniedHelp, setShowDeniedHelp] = useState(false);
  const [areaMode, setAreaMode] = useState(false);
  const loc = useLocation(app.settings.locationExplained && mapReady);
  const fresh = loc.fix !== null && !loc.stale;

  useEffect(() => {
    if (mapReady) ctlRef.current?.setUser(loc.fix, loc.stale, heading);
  }, [mapReady, loc.fix, loc.stale, heading]);

  useEffect(() => {
    if (!mapReady || !fresh || !loc.fix || follow === 'off') return;
    ctlRef.current?.follow(loc.fix.lat, loc.fix.lon, follow === 'heading' ? heading : null, paddingRef.current());
    // Heading changes are handled below; this runs once per fix, and again when the panel
    // changes size so the dot stays in the middle of the visible map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, loc.fix, fresh, follow, panelSize.height]);

  useEffect(() => {
    if (mapReady && follow === 'heading' && heading !== null) ctlRef.current?.map.rotateTo(heading, { duration: 180 });
  }, [mapReady, follow, heading]);

  useEffect(() => stopCompass, [stopCompass]);

  // Opt-in "keep screen on while navigating".
  useEffect(() => {
    if (!trailId || !app.settings.keepScreenOn) return;
    void acquireWakeLock('navigation');
    return () => releaseWakeLock('navigation');
  }, [trailId, app.settings.keepScreenOn]);

  // ----- progress along the trail -----
  const [alongM, setAlongM] = useState<number | null>(null);
  const [match, setMatch] = useState<TrailMatch | null>(null);
  const lastAlong = useRef<number | null>(null);
  const lastSave = useRef({ at: 0, alongM: -1 });
  const trailKey = trail ? `${trail.id}|${trail.reversed}` : '';
  useEffect(() => {
    // Start from where the last session left off, unless that was long ago.
    const lm = trail?.lastMatch;
    const valid = lm && Date.now() - lm.at < HISTORY_MAX_AGE_MS ? lm.alongM : null;
    lastAlong.current = valid;
    setAlongM(valid);
    setMatch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailKey]);

  useEffect(() => {
    if (!geom || !trail || !loc.fix || !fresh) return;
    const m = locateOnTrail(geom, loc.fix.lat, loc.fix.lon, { lastAlongM: lastAlong.current, accuracyM: loc.fix.accuracyM });
    if (!m) return;
    setMatch(m);
    if (m.offM > FAR_FROM_TRAIL_M) return; // not on this trail: leave progress alone
    lastAlong.current = m.alongM;
    setAlongM(m.alongM);
    const now = Date.now();
    if (now - lastSave.current.at > SAVE_MATCH_INTERVAL_MS || Math.abs(m.alongM - lastSave.current.alongM) > 100) {
      lastSave.current = { at: now, alongM: m.alongM };
      void saveLastMatch(trail.id, m.alongM).catch(() => undefined);
    }
    // `trail` identity changes on reload; the id is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, loc.fix, fresh]);

  // ----- UI state -----
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(Boolean(autoDownload));

  const onLocate = async () => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    if (!app.settings.locationExplained) {
      if (trailId) toast('Tap "Turn on" in the panel below to use your location.');
      else setLocCardDismissed(false);
      return;
    }
    if (loc.status === 'denied') {
      setShowDeniedHelp(true);
      return;
    }
    if (follow === 'off') {
      setFollow('follow');
      if (loc.fix) ctl.follow(loc.fix.lat, loc.fix.lon, null, padding());
      else toast('Waiting for a GPS fix…');
    } else if (follow === 'follow') {
      // Must run inside this tap: iOS shows the motion permission prompt only on a user gesture.
      const result = await startCompass(setHeading);
      if (result.ok) {
        compassStop.current = result.stop;
        setFollow('heading');
      } else {
        toast(result.reason === 'denied' ? 'Compass access was not allowed.' : 'This device has no compass.', 'error');
        setFollow('off');
      }
    } else {
      stopCompass();
      setFollow('off');
      ctl.resetNorth();
    }
  };

  const onScrub = useCallback(
    (d: number | null) => {
      ctlRef.current?.setHighlight(d === null || !geom ? null : pointAtDistance(geom, d));
    },
    [geom],
  );
  const onShowOnMap = useCallback(
    (d: number) => {
      const p = geom ? pointAtDistance(geom, d) : null;
      if (p) ctlRef.current?.showPoint(p.lat, p.lon, paddingRef.current());
    },
    [geom],
  );

  if (trailId && notFound) {
    return (
      <div className="center">
        <div className="stack">
          <p>This trail is no longer on this phone.</p>
          <button className="btn primary" onClick={() => navigate('#/', true)}>
            Back to trails
          </button>
        </div>
      </div>
    );
  }

  const status = summary ? offlineStatus(summary.regionId, app.regions, progress) : null;
  const statusText =
    status?.kind === 'ready'
      ? 'Map ready offline'
      : status?.kind === 'downloading'
        ? `Downloading map ${Math.round(status.fraction * 100)}%`
        : status?.kind === 'incomplete'
          ? 'Map incomplete'
          : status
            ? 'Map not downloaded'
            : 'Browse and download areas';

  let chip: { text: string; tone: string } | null = null;
  if (app.settings.locationExplained) {
    if (loc.status === 'active' && loc.fix) {
      chip = { text: `GPS ±${Math.round(loc.fix.accuracyM)} m`, tone: accuracyLevel(loc.fix.accuracyM) };
    } else if (loc.status === 'waiting') chip = { text: 'Locating…', tone: '' };
    else if (loc.status === 'denied') chip = { text: 'Location is off', tone: 'poor' };
    else if (loc.status === 'unavailable') chip = { text: 'No GPS signal', tone: 'poor' };
  }

  const hint = !app.settings.locationExplained
    ? 'Turn on location to see your progress.'
    : loc.status === 'denied'
      ? 'Location is off, so progress cannot be shown.'
      : alongM !== null
        ? 'Last known position. Updating…'
        : loc.status === 'unavailable'
          ? 'No GPS signal yet. Move to open sky.'
          : 'Finding your position…';

  const menuItems: ActionItem[] = [];
  if (summary) {
    menuItems.push({
      label: summary.regionId ? 'Offline map…' : 'Download map…',
      hint: statusText,
      icon: <IconDownload />,
      onSelect: () => setDownloadOpen(true),
    });
  }
  menuItems.push({
    label: 'Download area…',
    hint: 'Pick a rectangle: a whole valley or the road in',
    icon: <IconArea />,
    onSelect: () => {
      setAreaMode(true);
      setFollow('off');
      stopCompass();
    },
  });
  if (summary && trail) {
    menuItems.push({
      label: trail.reversed ? 'Walk it in the recorded direction' : 'Reverse direction',
      hint: trail.reversed ? 'Currently reversed' : 'Flip start and end, progress and profile',
      icon: <IconCompass />,
      onSelect: () => void setTrailReversed(trail.id, !trail.reversed).then(refreshData),
    });
    menuItems.push({
      label: 'Reset progress',
      hint: 'Forget where you were on this trail',
      icon: <IconFit />,
      onSelect: () => {
        void resetProgress(trail.id);
        lastAlong.current = null;
        setAlongM(null);
        setMatch(null);
      },
    });
  }
  menuItems.push({ label: 'Storage and trip check', icon: <IconStorage />, onSelect: () => navigate('#/storage') });

  // On the trail screen the prompt lives inside the panel; the free map has no panel, so it floats.
  const needsLocationPrompt = !app.settings.locationExplained && mapReady && !areaMode;
  const showLocCard = needsLocationPrompt && !trailId && !locCardDismissed;

  // With the panel open on a small phone there is little map left: keep only the locate button.
  const tight = screenSize.height > 0 && screenSize.height - topSize.height - panelSize.height < 330;

  return (
    <div
      className={`map-screen${tight ? ' tight' : ''}${areaMode ? ' area' : ''}`}
      ref={screenRef}
      style={{ ['--panel-h' as string]: `${panelSize.height}px` }}
    >
      <div className="map-canvas" ref={containerRef} data-testid="map" />

      <div className="map-top" ref={topRef}>
        <button className="icon-btn" onClick={areaMode ? () => setAreaMode(false) : goBack} aria-label="Back">
          <IconBack />
        </button>
        <div className="map-title">
          <strong>{areaMode ? 'Download area' : (summary?.name ?? trail?.name ?? 'Map')}</strong>
          <span>{areaMode ? 'Frame the area to save' : statusText}</span>
        </div>
        <span className={`net-pill ${online ? 'online' : 'offline'}`} data-testid="net">
          {online ? (app.settings.offlineOnly ? 'Offline maps' : 'Online') : 'Offline'}
        </span>
        {!areaMode && (
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <IconMore />
          </button>
        )}
      </div>

      {chip && (
        <div className="map-chips">
          <span className={`chip ${chip.tone}`} data-testid="gps-chip">
            {chip.text}
          </span>
        </div>
      )}

      <div className="map-controls">
        {Math.abs(mapBearing) > 1 && (
          <button
            className="map-btn"
            onClick={() => {
              if (follow === 'heading') {
                stopCompass();
                setFollow('follow');
              }
              ctlRef.current?.resetNorth();
            }}
            aria-label="Point map north"
          >
            <IconNorth style={{ transform: `rotate(${-mapBearing}deg)` }} />
          </button>
        )}
        {trail && (
          <button className="map-btn optional" onClick={() => ctlRef.current?.fitBbox(trail.bbox, padding())} aria-label="Show whole trail">
            <IconFit />
          </button>
        )}
        <div className="map-btn-group optional">
          <button className="map-btn" onClick={() => ctlRef.current?.zoomBy(1)} aria-label="Zoom in">
            <IconPlus />
          </button>
          <button className="map-btn" onClick={() => ctlRef.current?.zoomBy(-1)} aria-label="Zoom out">
            <IconMinus />
          </button>
        </div>
        <button
          className={`map-btn${follow !== 'off' ? ' active' : ''}`}
          onClick={() => void onLocate()}
          aria-label={follow === 'off' ? 'Follow my location' : follow === 'follow' ? 'Follow with compass heading' : 'Stop following'}
          aria-pressed={follow !== 'off'}
          data-testid="locate"
        >
          {follow === 'heading' ? <IconCompass /> : <IconLocate filled={follow === 'follow'} />}
        </button>
      </div>

      {showLocCard && (
        <div className="loc-card" role="dialog" aria-label="Location">
          <h3>See yourself on the map?</h3>
          <p>
            TrailKeep uses your location only while the app is open on screen, to show where you are on the trail. It stops the
            moment you lock the phone or switch apps, and nothing leaves your device.
          </p>
          <div className="btn-row">
            <button className="btn secondary compact" onClick={() => setLocCardDismissed(true)}>
              Not now
            </button>
            <button className="btn primary compact" onClick={() => void updateSettings({ locationExplained: true })} data-testid="enable-location">
              Turn on location
            </button>
          </div>
        </div>
      )}

      {showDeniedHelp && (
        <Sheet title="Location is turned off" onClose={() => setShowDeniedHelp(false)}>
          <p>
            To allow it on iPhone, open <strong>Settings → Privacy &amp; Security → Location Services → Safari Websites</strong> and
            choose <strong>While Using the App</strong>. Check that Location Services is switched on at the top of that screen too.
          </p>
          <p className="muted small">Then come back here and tap Try again. If iOS asks, choose Allow.</p>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setShowDeniedHelp(false)}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setShowDeniedHelp(false);
                loc.retry();
              }}
            >
              Try again
            </button>
          </div>
        </Sheet>
      )}

      {areaMode && ctlRef.current ? (
        <AreaTool controller={ctlRef.current} topInset={topSize.height} onClose={() => setAreaMode(false)} panelRef={panelRef} />
      ) : trail && geom ? (
        <ProgressPanel
          stats={trail.stats}
          totalM={geom.totalM}
          profile={profile}
          timeIndex={timeIndex}
          alongM={alongM}
          match={match}
          fix={loc.fix}
          stale={!fresh}
          hint={hint}
          paceFactor={app.settings.paceFactor}
          mapBearing={mapBearing}
          marks={marks}
          onEnableLocation={needsLocationPrompt ? () => void updateSettings({ locationExplained: true }) : undefined}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          onScrub={onScrub}
          onShowOnMap={onShowOnMap}
          panelRef={panelRef}
        />
      ) : null}

      {menuOpen && <ActionSheet title={summary?.name ?? 'Map'} items={menuItems} onClose={() => setMenuOpen(false)} />}
      {downloadOpen && summary && <DownloadSheet trail={summary} onClose={() => setDownloadOpen(false)} />}
    </div>
  );
}
