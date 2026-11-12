// Elevation profile chart (PLAN §6.7): plain SVG, "you are here" marker, completed part shaded,
// and touch scrubbing that updates the DOM directly so it stays smooth on long tracks.
import { useId, useMemo, useRef, useState } from 'react';
import { formatGrade, formatKm } from '../domain/format';
import { chartSeries, elevationAt, gradeAt, type Profile } from '../domain/profile';
import { useElementSize } from './hooks';

interface Props {
  profile: Profile;
  /** True min / max of the recorded elevations, for the labelled guide lines. */
  minEle: number;
  maxEle: number;
  /** Progress along the trail, or null when unknown. */
  alongM: number | null;
  /** Distances of waypoints along the trail. */
  marks: number[];
  /** Called while scrubbing with the distance under the finger; null when cleared. */
  onScrub: (alongM: number | null) => void;
  onShowOnMap: (alongM: number) => void;
}

const HEIGHT = 112;
const M = { left: 44, right: 10, top: 12, bottom: 20 };
const KM_STEPS = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

export function ElevationProfile({ profile, minEle, maxEle, alongM, marks, onScrub, onShowOnMap }: Props) {
  const [setEl, { width }] = useElementSize<HTMLDivElement>();
  const clipId = useId();
  const [selected, setSelected] = useState(false);
  const scrubM = useRef(0);
  const dragging = useRef(false);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;

  const view = useMemo(() => {
    const lo = Math.min(minEle, profile.minEle);
    const hi = Math.max(maxEle, profile.maxEle);
    const pad = Math.max(5, (hi - lo) * 0.1);
    const y0 = lo - pad;
    const y1 = hi + pad;
    const x = (d: number) => M.left + (d / profile.totalM) * plotW;
    const y = (e: number) => M.top + (1 - (e - y0) / (y1 - y0)) * plotH;

    // Draw at most two points per pixel, however long the track is.
    const s = chartSeries(profile, Math.max(64, Math.round(plotW * 2)));
    let line = '';
    for (let i = 0; i < s.dist.length; i++) {
      line += `${i === 0 ? 'M' : 'L'}${x(s.dist[i]!).toFixed(1)} ${y(s.ele[i]!).toFixed(1)}`;
    }
    const base = (M.top + plotH).toFixed(1);
    const area = `${line}L${x(profile.totalM).toFixed(1)} ${base}L${x(0).toFixed(1)} ${base}Z`;

    const totalKm = profile.totalM / 1000;
    const step = KM_STEPS.find((k) => totalKm / k <= 5) ?? 1000;
    const ticks: number[] = [];
    // Leave room for the total-distance label at the right edge.
    for (let k = step; ((totalKm - k) / totalKm) * plotW > 52; k += step) ticks.push(k);
    return { x, y, line, area, ticks };
  }, [profile, minEle, maxEle, plotW, plotH]);

  const scrubTo = (clientX: number, target: Element) => {
    const rect = target.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const d = frac * profile.totalM;
    scrubM.current = d;
    const ele = elevationAt(profile, d);
    const px = view.x(d);
    lineRef.current?.setAttribute('x1', String(px));
    lineRef.current?.setAttribute('x2', String(px));
    dotRef.current?.setAttribute('cx', String(px));
    dotRef.current?.setAttribute('cy', String(view.y(ele)));
    if (tipRef.current) {
      tipRef.current.style.left = `${Math.min(width - 70, Math.max(70, px))}px`;
      tipRef.current.textContent = `${formatKm(d)} · ${Math.round(ele)} m · ${formatGrade(gradeAt(profile, d))}`;
    }
    onScrub(d);
  };

  const clear = () => {
    setSelected(false);
    onScrub(null);
  };

  const hereX = alongM !== null ? view.x(Math.min(profile.totalM, Math.max(0, alongM))) : null;
  const hereY = alongM !== null ? view.y(elevationAt(profile, alongM)) : null;

  return (
    <div>
      <div className="profile" ref={setEl}>
        {width > 0 && (
          <svg height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Elevation profile">
            <defs>
              <clipPath id={clipId}>
                <rect x={M.left} y={0} width={hereX !== null ? Math.max(0, hereX - M.left) : 0} height={HEIGHT} />
              </clipPath>
            </defs>

            {[maxEle, minEle].map((e, i) => (
              <g key={i}>
                <line className="grid" x1={M.left} x2={M.left + plotW} y1={view.y(e)} y2={view.y(e)} />
                <text className="axis-text" x={M.left - 5} y={view.y(e) + 3.5} textAnchor="end">
                  {Math.round(e)} m
                </text>
              </g>
            ))}

            <path className="area" d={view.area} />
            <path className="area-done" d={view.area} clipPath={`url(#${clipId})`} />
            <path className="line" d={view.line} />

            <text className="axis-text" x={M.left} y={HEIGHT - 5} textAnchor="start">
              0
            </text>
            {view.ticks.map((k) => (
              <text key={k} className="axis-text" x={view.x(k * 1000)} y={HEIGHT - 5} textAnchor="middle">
                {k}
              </text>
            ))}
            <text className="axis-text" x={M.left + plotW} y={HEIGHT - 5} textAnchor="end">
              {formatKm(profile.totalM, profile.totalM >= 100_000 ? 0 : 1)}
            </text>

            {marks.map((d, i) => (
              <circle key={i} className="wpt" cx={view.x(d)} cy={view.y(elevationAt(profile, d))} r={4} />
            ))}

            {hereX !== null && hereY !== null && (
              <g>
                <line className="here-line" x1={hereX} x2={hereX} y1={M.top} y2={M.top + plotH} />
                <circle className="here-dot" cx={hereX} cy={hereY} r={5.5} />
              </g>
            )}

            <g style={{ display: selected ? undefined : 'none' }}>
              <line ref={lineRef} className="scrub-line" y1={M.top - 4} y2={M.top + plotH} />
              <circle ref={dotRef} className="scrub-dot" r={6} />
            </g>

            <rect
              x={M.left}
              y={0}
              width={plotW}
              height={HEIGHT}
              fill="transparent"
              data-testid="profile-scrub"
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                if (!selected) setSelected(true);
                scrubTo(e.clientX, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (dragging.current) scrubTo(e.clientX, e.currentTarget);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
            />
          </svg>
        )}
        <div ref={tipRef} className="profile-tip" style={{ display: selected ? undefined : 'none' }} />
      </div>
      {selected && (
        <div className="profile-actions">
          <button className="btn secondary compact" onClick={() => onShowOnMap(scrubM.current)}>
            Show on map
          </button>
          <button className="btn ghost compact" onClick={clear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
