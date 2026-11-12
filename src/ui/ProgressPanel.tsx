// Collapsible bottom panel on the trail screen (PLAN §6.6): done / left, off-trail warning,
// elevation now, ascent and descent left, ETA, and the elevation profile.
import { remainingSeconds } from '../domain/eta';
import { formatClock, formatDistance, formatDuration, formatKm, formatMeters, formatPercent } from '../domain/format';
import { compassLabel } from '../domain/geo';
import { elevationAt, gainLossBetween, type Profile } from '../domain/profile';
import { offTrailLevel, type TrailMatch } from '../domain/progress';
import type { Fix, TrailStats } from '../domain/types';
import { ProgressBar } from './components';
import { ElevationProfile } from './ElevationProfile';
import { IconAlert, IconChevronDown, IconChevronUp } from './icons';

/** Beyond this the hiker is not on this trail at all, so progress is not updated. */
export const FAR_FROM_TRAIL_M = 1000;

interface Props {
  stats: TrailStats;
  totalM: number;
  profile: Profile | null;
  timeIndex: Float64Array | null;
  /** Distance done, from a fresh match or from the last session. */
  alongM: number | null;
  /** Fresh match for the current fix, if any. */
  match: TrailMatch | null;
  fix: Fix | null;
  /** True while the numbers come from before the app was last hidden. */
  stale: boolean;
  /** Short status shown when there is no position yet. */
  hint: string;
  paceFactor: number;
  mapBearing: number;
  marks: number[];
  /** Set while location has never been enabled: shows the explanation and the button. */
  onEnableLocation?: () => void;
  expanded: boolean;
  onToggle: () => void;
  onScrub: (alongM: number | null) => void;
  onShowOnMap: (alongM: number) => void;
  panelRef: (el: HTMLDivElement | null) => void;
}

export function ProgressPanel(p: Props) {
  const { stats, totalM, profile, alongM, match } = p;
  const located = alongM !== null;
  const done = located ? Math.min(totalM, Math.max(0, alongM)) : 0;
  const left = totalM - done;
  const rest = profile && located ? gainLossBetween(profile, done, totalM) : null;
  const eta = located ? remainingSeconds(profile, p.timeIndex, done, totalM, p.paceFactor) : null;

  const far = match !== null && match.offM > FAR_FROM_TRAIL_M;
  const level = match && !p.stale ? offTrailLevel(match.offM) : 'on';

  let eleNow: number | null = null;
  let eleSource = '';
  if (p.fix && !p.stale && p.fix.altitudeM !== null && p.fix.altitudeAccuracyM !== null && p.fix.altitudeAccuracyM < 20) {
    eleNow = p.fix.altitudeM;
    eleSource = 'GPS';
  } else if (profile && located) {
    eleNow = elevationAt(profile, done);
    eleSource = 'trail';
  }

  return (
    <section className={`panel${p.stale ? ' stale' : ''}`} ref={p.panelRef} aria-label="Trail progress">
      <button className="panel-handle" onClick={p.onToggle} aria-expanded={p.expanded} aria-label={p.expanded ? 'Collapse panel' : 'Expand panel'}>
        <span className="grab" />
        <span className="panel-handle-label">
          {p.expanded ? <IconChevronDown /> : <IconChevronUp />}
          {p.expanded ? 'Hide details' : 'Profile and details'}
        </span>
      </button>

      {located ? (
        <>
          <div className="panel-summary">
            <span className="big" data-testid="done">
              <small>Done</small>
              {formatKm(done)}
            </span>
            <span className="muted small" data-testid="percent">
              {formatPercent(totalM > 0 ? done / totalM : 0)}
            </span>
            <span className="big" data-testid="left">
              <small>Left</small>
              {formatKm(left)}
            </span>
          </div>
          <ProgressBar fraction={totalM > 0 ? done / totalM : 0} tone="trail" />
          {!p.expanded && eta !== null && (
            <p className="panel-key" data-testid="key-line">
              ≈ {formatDuration(eta)} left
              {rest && (
                <>
                  <span>·</span>↑ {Math.round(rest.gainM)} m<span>·</span>↓ {Math.round(rest.lossM)} m
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <div className="panel-summary">
          <span className="big">{formatKm(totalM)}</span>
          <span className="muted small">
            {profile ? `↑ ${Math.round(stats.gainM)} m  ↓ ${Math.round(stats.lossM)} m` : 'No elevation data'}
          </span>
        </div>
      )}

      {p.onEnableLocation ? (
        <div className="loc-prompt">
          <span>
            <strong>See yourself on the trail.</strong> Location is used only while the app is on screen. Nothing leaves your phone.
          </span>
          <button className="btn primary compact" onClick={p.onEnableLocation} data-testid="enable-location">
            Turn on
          </button>
        </div>
      ) : (
        (p.stale || !located) && p.hint && <p className="panel-note">{p.hint}</p>
      )}

      {match && !p.stale && level !== 'on' && (
        <div className={`offtrail ${level}`} role="status" data-testid="offtrail">
          <IconAlert />
          {far ? (
            <span>You are {formatDistance(match.offM)} from this trail</span>
          ) : (
            <span>Off trail: {formatDistance(match.offM)}</span>
          )}
          <span className="arrow" style={{ transform: `rotate(${match.bearingToTrail - p.mapBearing}deg)` }} aria-hidden="true">
            ↑
          </span>
          <span>{compassLabel(match.bearingToTrail)}</span>
        </div>
      )}

      {p.expanded && (
        <>
          {located && (
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Elevation</div>
                <div className="stat-value">
                  {formatMeters(eleNow)} {eleNow !== null && <small>{eleSource}</small>}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Climb left</div>
                <div className="stat-value">{rest ? `↑ ${Math.round(rest.gainM)} m` : '–'}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Descent left</div>
                <div className="stat-value">{rest ? `↓ ${Math.round(rest.lossM)} m` : '–'}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Time left</div>
                <div className="stat-value" data-testid="eta">
                  {eta !== null ? `≈ ${formatDuration(eta)}` : '–'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Arrival</div>
                <div className="stat-value">{eta !== null && !p.stale ? `≈ ${formatClock(new Date(Date.now() + eta * 1000))}` : '–'}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Off trail</div>
                <div className="stat-value" data-testid="off">
                  {match && !p.stale ? formatDistance(match.offM) : '–'}
                </div>
              </div>
            </div>
          )}

          {profile && stats.minEleM !== null && stats.maxEleM !== null ? (
            <ElevationProfile
              profile={profile}
              minEle={stats.minEleM}
              maxEle={stats.maxEleM}
              alongM={located ? done : null}
              marks={p.marks}
              onScrub={p.onScrub}
              onShowOnMap={p.onShowOnMap}
            />
          ) : (
            <p className="panel-note">
              This GPX file has no elevation. Download the map for this trail and elevations are filled in from the terrain data.
            </p>
          )}
        </>
      )}
    </section>
  );
}
