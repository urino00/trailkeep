// "Download area" mode (PLAN §6.4): a rectangle with drag handles over the map, a live size
// estimate, a required name, and chunked download. Works with or without a trail.
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloads, draftTileSpec } from '../data/downloader';
import { formatBytes } from '../domain/format';
import { bboxSizeKm } from '../domain/geo';
import { BLOCK_TOTAL_BYTES, CHUNK_MAX_BYTES, CHUNK_MAX_TILES, WARN_TOTAL_BYTES, estimateRegion, type RegionEstimate } from '../domain/tiles';
import type { Bbox } from '../domain/types';
import type { MapController } from '../map/controller';
import { BASEMAP_FALLBACK_MAXZOOM } from '../map/sources';
import { Toggle, toast } from './components';
import { useElementSize, useOnline } from './hooks';
import { IconAlert, IconDownload, IconWifiOff } from './icons';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const MIN_SIZE = 70;

interface Props {
  controller: MapController;
  /** Pixels at the top of the map covered by the title bar. */
  topInset: number;
  onClose: () => void;
  panelRef: (el: HTMLDivElement | null) => void;
}

export function AreaTool({ controller, topInset, onClose, panelRef }: Props) {
  const online = useOnline();
  const layerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [name, setName] = useState('');
  const [highDetail, setHighDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ bbox: Bbox; est: RegionEstimate } | null>(null);
  const drag = useRef<{ corner: Corner; pointerId: number } | null>(null);
  const [formRef, formSize] = useElementSize<HTMLDivElement>();
  const setPanel = useCallback(
    (el: HTMLDivElement | null) => {
      formRef(el);
      panelRef(el);
    },
    [formRef, panelRef],
  );

  // Start with a rectangle inset from the part of the map that is actually visible
  // (between the title bar and this form).
  useEffect(() => {
    const el = layerRef.current;
    if (!el || rect || formSize.height === 0) return;
    const w = el.clientWidth;
    const visible = Math.max(MIN_SIZE + 40, el.clientHeight - topInset - formSize.height);
    setRect({ left: w * 0.14, right: w * 0.86, top: topInset + visible * 0.2, bottom: topInset + visible * 0.84 });
  }, [rect, topInset, formSize.height]);

  const recompute = useCallback(() => {
    if (!rect) return;
    const bbox = controller.screenRectToBbox(rect.left, rect.top, rect.right, rect.bottom);
    setInfo({ bbox, est: estimateRegion(draftTileSpec(bbox, highDetail, BASEMAP_FALLBACK_MAXZOOM)) });
  }, [controller, rect, highDetail]);

  // Live estimate: when the rectangle changes and whenever the map moves under it.
  useEffect(() => {
    recompute();
    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    };
    controller.map.on('move', onMove);
    return () => {
      controller.map.off('move', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [controller, recompute]);

  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = layerRef.current;
    if (!d || d.pointerId !== e.pointerId || !el || !rect) return;
    const box = el.getBoundingClientRect();
    const x = Math.min(box.width - 8, Math.max(8, e.clientX - box.left));
    const y = Math.min(box.height - formSize.height - 8, Math.max(topInset + 8, e.clientY - box.top));
    const next = { ...rect };
    if (d.corner === 'tl' || d.corner === 'bl') next.left = Math.min(x, rect.right - MIN_SIZE);
    else next.right = Math.max(x, rect.left + MIN_SIZE);
    if (d.corner === 'tl' || d.corner === 'tr') next.top = Math.min(y, rect.bottom - MIN_SIZE);
    else next.bottom = Math.max(y, rect.top + MIN_SIZE);
    setRect(next);
  };

  const handle = (corner: Corner, left: number, top: number) => (
    <button
      key={corner}
      className="area-handle"
      style={{ left, top }}
      aria-label={`Resize area (${corner})`}
      onPointerDown={(e) => {
        drag.current = { corner, pointerId: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onHandleMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );

  const est = info?.est;
  const size = info ? bboxSizeKm(info.bbox) : null;
  const blocked = est ? est.bytes > BLOCK_TOTAL_BYTES : false;
  const parts = est ? Math.max(Math.ceil(est.tiles / CHUNK_MAX_TILES), Math.ceil(est.bytes / CHUNK_MAX_BYTES)) : 1;
  const canDownload = Boolean(info) && name.trim().length > 0 && online && !blocked && !busy;

  const download = async () => {
    if (!info || !canDownload) return;
    setBusy(true);
    try {
      const region = await downloads.createRegion({ name: name.trim(), kind: 'custom', bbox: info.bbox, highDetail });
      downloads.start(region.id);
      toast(`Downloading "${region.name}". Keep the app open.`);
      onClose();
    } catch (e) {
      toast(
        navigator.onLine ? `Could not start the download: ${e instanceof Error ? e.message : 'unknown error'}` : 'You are offline.',
        'error',
      );
      setBusy(false);
    }
  };

  return (
    <>
      <div className="area-layer" ref={layerRef}>
        {rect && (
          <>
            <div
              className="area-rect"
              style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }}
            />
            {size && (
              <div className="area-size" style={{ left: (rect.left + rect.right) / 2, top: rect.top }}>
                {size.widthKm.toFixed(size.widthKm < 10 ? 1 : 0)} × {size.heightKm.toFixed(size.heightKm < 10 ? 1 : 0)} km
              </div>
            )}
            {handle('tl', rect.left, rect.top)}
            {handle('tr', rect.right, rect.top)}
            {handle('bl', rect.left, rect.bottom)}
            {handle('br', rect.right, rect.bottom)}
          </>
        )}
      </div>

      <section className="panel" ref={setPanel} aria-label="Download area">
        <div className="area-form">
          <p className="small muted">Move the map and drag the corners to frame the area, for example a whole valley or the road in.</p>
          <label className="field">
            <span>Name (required)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fitz Roy valley"
              maxLength={80}
              enterKeyHint="done"
              data-testid="area-name"
            />
          </label>
          <Toggle label="High-detail terrain" checked={highDetail} onChange={setHighDetail} />
          {est && (
            <p className="estimate" data-testid="area-estimate">
              About {formatBytes(est.bytes)} · {est.tiles.toLocaleString('en')} tiles
              {parts > 1 ? ` · downloads in ${parts} parts` : ''}
            </p>
          )}
          {est && est.bytes > WARN_TOTAL_BYTES && !blocked && (
            <div className="note warn">
              <IconAlert />
              <span>This is a large download. Use Wi-Fi and keep the app open until it finishes.</span>
            </div>
          )}
          {blocked && (
            <div className="note danger">
              <IconAlert />
              <span>Too large (over 1 GB). Zoom in or make the rectangle smaller.</span>
            </div>
          )}
          {!online && (
            <div className="note warn">
              <IconWifiOff />
              <span>You are offline. Connect to Wi-Fi to download.</span>
            </div>
          )}
          <div className="btn-row">
            <button className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={!canDownload} onClick={() => void download()}>
              <IconDownload />
              {busy ? 'Starting…' : 'Download'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
