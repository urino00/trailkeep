// Trail download sheet (PLAN §6.4): buffer choice, high-detail toggle, estimate, progress, cancel.
import { useMemo, useState } from 'react';
import { downloads, draftTileSpec } from '../data/downloader';
import { useAppState, useDownloads, type TrailSummary } from '../data/store';
import { formatBytes } from '../domain/format';
import { bufferBbox } from '../domain/geo';
import { BLOCK_TOTAL_BYTES, WARN_TOTAL_BYTES, estimateRegion } from '../domain/tiles';
import { BASEMAP_FALLBACK_MAXZOOM, BUFFER_CHOICES_M, DEFAULT_BUFFER_M, DEM_MAXZOOM_HIGH_DETAIL } from '../map/sources';
import { ProgressBar, Sheet, Toggle } from './components';
import { useOnline } from './hooks';
import { IconAlert, IconCheck, IconDownload, IconWifiOff } from './icons';

export function DownloadSheet({ trail, intro, onClose }: { trail: TrailSummary; intro?: string; onClose: () => void }) {
  const app = useAppState();
  const progress = useDownloads();
  const online = useOnline();
  const region = app.regions.find((r) => r.id === trail.regionId);
  const live = region ? progress.get(region.id) : undefined;

  const [bufferM, setBufferM] = useState(region?.bufferM ?? DEFAULT_BUFFER_M);
  const [highDetail, setHighDetail] = useState(region ? region.dem.maxzoom >= DEM_MAXZOOM_HIGH_DETAIL : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const estimate = useMemo(
    () => estimateRegion(draftTileSpec(bufferBbox(trail.bbox, bufferM), highDetail, BASEMAP_FALLBACK_MAXZOOM)),
    [trail.bbox, bufferM, highDetail],
  );
  const blocked = estimate.bytes > BLOCK_TOTAL_BYTES;
  const downloading = Boolean(live && live.status === 'downloading') || region?.status === 'downloading' || region?.status === 'queued';

  const startNew = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await downloads.createRegion({
        name: trail.name,
        kind: 'trail',
        trailId: trail.id,
        bbox: bufferBbox(trail.bbox, bufferM),
        bufferM,
        highDetail,
      });
      downloads.start(created.id);
    } catch (e) {
      setError(
        navigator.onLine
          ? `Could not start the download: ${e instanceof Error ? e.message : 'unknown error'}.`
          : 'You are offline. Connect to Wi-Fi and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (region && downloading) {
    const done = live?.done ?? region.storedTiles;
    const total = live?.total ?? region.expectedTiles;
    return (
      <Sheet title="Downloading map" onClose={onClose}>
        <ProgressBar fraction={total > 0 ? done / total : 0} />
        <p>
          <strong>
            {done} / {total} tiles
          </strong>{' '}
          <span className="muted">
            · {formatBytes(live?.bytes ?? region.bytes)}
            {live && live.chunks > 1 ? ` · part ${live.chunk} of ${live.chunks}` : ''}
          </span>
        </p>
        <div className="note warn">
          <IconAlert />
          <span>Keep the app open while downloading. If you leave, it picks up where it stopped when you come back.</span>
        </div>
        <div className="btn-row">
          <button className="btn danger" onClick={() => void downloads.cancel(region.id)}>
            Cancel download
          </button>
          <button className="btn secondary" onClick={onClose}>
            Hide
          </button>
        </div>
      </Sheet>
    );
  }

  const complete = region?.status === 'complete';
  const incomplete = region && !complete;

  if (complete && !showOptions) {
    return (
      <Sheet title="Offline map" onClose={onClose}>
        <div className="note info">
          <IconCheck />
          <span>
            <strong>Ready offline.</strong> {region.storedTiles} tiles, {formatBytes(region.bytes)}, within{' '}
            {(region.bufferM ?? DEFAULT_BUFFER_M) / 1000} km of the trail. It works with no signal.
          </span>
        </div>
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
        <button className="btn ghost" onClick={() => setShowOptions(true)}>
          Download again with other settings
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Download map" onClose={onClose}>
      {intro && !region && <p>{intro}</p>}
      {incomplete && (
        <div className="note danger">
          <IconAlert />
          <span>
            <strong>The last download did not finish</strong> ({region.storedTiles} of {region.expectedTiles} tiles).
            {live?.error ? ` ${live.error}` : ''}
          </span>
        </div>
      )}

      <div className="stack">
        <div className="field">
          <span>Area around the trail</span>
          <div className="segmented" role="group" aria-label="Buffer around the trail">
            {BUFFER_CHOICES_M.map((m) => (
              <button key={m} type="button" aria-pressed={bufferM === m} onClick={() => setBufferM(m)}>
                {m / 1000} km
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="High-detail terrain"
          hint="Sharper contours and shading. Roughly doubles the terrain download."
          checked={highDetail}
          onChange={setHighDetail}
        />
        <p className="muted small">
          About <strong>{formatBytes(estimate.bytes)}</strong> ({estimate.tiles} tiles): map detail to street level within{' '}
          {bufferM / 1000} km of the trail, plus an overview of the region 50 km around it.
        </p>
        {estimate.bytes > WARN_TOTAL_BYTES && !blocked && (
          <div className="note warn">
            <IconAlert />
            <span>This is a large download. Use Wi-Fi and make sure the phone has space.</span>
          </div>
        )}
        {blocked && (
          <div className="note danger">
            <IconAlert />
            <span>This area is too large to download (over 1 GB). Choose a smaller buffer.</span>
          </div>
        )}
      </div>

      {!online && (
        <div className="note warn">
          <IconWifiOff />
          <span>You are offline. Connect to Wi-Fi to download the map.</span>
        </div>
      )}
      {error && (
        <div className="note danger">
          <IconAlert />
          <span>{error}</span>
        </div>
      )}

      <div className="btn-row">
        {incomplete && (
          <button className="btn primary" disabled={!online || busy} onClick={() => downloads.start(region.id)}>
            Retry download
          </button>
        )}
        <button
          className={`btn ${incomplete ? 'secondary' : 'primary'}`}
          disabled={!online || busy || blocked}
          onClick={() => {
            setShowOptions(false);
            void startNew();
          }}
        >
          <IconDownload />
          {busy ? 'Starting…' : complete || incomplete ? 'Download again' : 'Download map'}
        </button>
      </div>
      {!region && (
        <button className="btn ghost" onClick={onClose}>
          Not now
        </button>
      )}
    </Sheet>
  );
}
