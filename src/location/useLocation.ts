// Location lifecycle (PLAN §6.5, battery-critical):
//  - GPS runs only while the page is visible AND a screen asked for it;
//  - it is stopped the instant the page is hidden (visibilitychange / pagehide);
//  - on return, the last fix is shown greyed out until a fresh one arrives;
//  - updates are throttled to one per second (the newest fix always gets through) and moves
//    under 3 m are ignored;
//  - no timers or loops run while idle.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../data/db';
import { haversine } from '../domain/geo';
import type { Fix } from '../domain/types';
import { logGeo } from './geoLog';

export type LocationStatus =
  | 'off' // not requested
  | 'waiting' // watching, no fresh fix yet
  | 'active' // fresh fixes arriving
  | 'denied'
  | 'unavailable' // no geolocation API, or the device cannot get a position
  | 'paused'; // page hidden

export interface LocationState {
  status: LocationStatus;
  /** Latest fix, possibly from before the app was hidden. */
  fix: Fix | null;
  /** True when `fix` is not from the current watch session. */
  stale: boolean;
}

export interface LocationHandle extends LocationState {
  /** Ask again, e.g. after the user re-enabled location in Settings. */
  retry: () => void;
}

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
const MIN_INTERVAL_MS = 1000;
const MIN_MOVE_M = 3;
const SAVE_INTERVAL_MS = 30_000;

let lastKnown: Fix | null = null;
let lastSavedAt = 0;

export function accuracyLevel(accuracyM: number): 'good' | 'fair' | 'poor' {
  return accuracyM < 15 ? 'good' : accuracyM < 50 ? 'fair' : 'poor';
}

/**
 * @param enabled whether the current screen wants location at all. The watch additionally
 *                requires the page to be visible.
 */
export function useLocation(enabled: boolean): LocationHandle {
  const [state, setState] = useState<LocationState>({ status: 'off', fix: lastKnown, stale: lastKnown !== null });
  const watchId = useRef<number | null>(null);
  const lastEmit = useRef(0);
  const fresh = useRef(false);
  // A fix that arrived inside the 1 s throttle window, delivered when the window ends.
  const pending = useRef<Fix | null>(null);
  const pendingTimer = useRef<number | null>(null);

  const stop = useCallback((reason: string) => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      logGeo('clear', reason);
    }
    if (pendingTimer.current !== null) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    pending.current = null;
    fresh.current = false;
  }, []);

  /** Show a fix, unless it is a sub-3 m wobble of the one already shown. */
  const deliver = useCallback((fix: Fix) => {
    const now = Date.now();
    const prev = lastKnown;
    const firstFresh = !fresh.current;
    if (!firstFresh && prev) {
      const moved = haversine(prev.lat, prev.lon, fix.lat, fix.lon);
      if (moved < MIN_MOVE_M && accuracyLevel(prev.accuracyM) === accuracyLevel(fix.accuracyM)) return;
    }
    fresh.current = true;
    lastEmit.current = now;
    lastKnown = fix;
    if (firstFresh) logGeo('fix', `±${Math.round(fix.accuracyM)} m`);
    if (now - lastSavedAt > SAVE_INTERVAL_MS) {
      lastSavedAt = now;
      void setSetting('lastFix', fix).catch(() => undefined);
    }
    setState({ status: 'active', fix, stale: false });
  }, []);

  const start = useCallback(() => {
    if (watchId.current !== null) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'unavailable' }));
      return;
    }
    fresh.current = false;
    setState((s) => ({ status: 'waiting', fix: s.fix, stale: s.fix !== null }));
    logGeo('watch');
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const c = pos.coords;
        const fix: Fix = {
          lat: c.latitude,
          lon: c.longitude,
          accuracyM: c.accuracy,
          altitudeM: c.altitude,
          altitudeAccuracyM: c.altitudeAccuracy,
          timestamp: pos.timestamp || now,
        };
        const wait = MIN_INTERVAL_MS - (now - lastEmit.current);
        if (!fresh.current || wait <= 0) {
          deliver(fix);
          return;
        }
        // Too soon after the last update: keep only the newest fix and show it when the second
        // is up. The timer exists only while a fix is waiting, never while idle.
        pending.current = fix;
        if (pendingTimer.current === null) {
          pendingTimer.current = window.setTimeout(() => {
            pendingTimer.current = null;
            const waiting = pending.current;
            pending.current = null;
            if (waiting && watchId.current !== null) deliver(waiting);
          }, wait);
        }
      },
      (err) => {
        logGeo('error', `${err.code}: ${err.message}`);
        if (err.code === err.PERMISSION_DENIED) {
          stop('denied');
          setState((s) => ({ ...s, status: 'denied', stale: s.fix !== null }));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setState((s) => ({ ...s, status: fresh.current ? s.status : 'unavailable' }));
        }
        // TIMEOUT: keep watching; the next fix will arrive when the sky allows.
      },
      WATCH_OPTIONS,
    );
  }, [deliver, stop]);

  useEffect(() => {
    if (!enabled) {
      stop('disabled');
      setState((s) => ({ status: 'off', fix: s.fix, stale: s.fix !== null }));
      return;
    }
    // Show where we were last time while waiting for the first fix after a cold start.
    if (!lastKnown) {
      void getSetting<Fix>('lastFix')
        .then((saved) => {
          if (saved && !lastKnown) {
            lastKnown = saved;
            setState((s) => (s.fix ? s : { ...s, fix: saved, stale: true }));
          }
        })
        .catch(() => undefined);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else {
        stop('hidden');
        setState((s) => ({ status: 'paused', fix: s.fix, stale: s.fix !== null }));
      }
    };
    const onPageHide = () => {
      stop('pagehide');
      setState((s) => ({ status: 'paused', fix: s.fix, stale: s.fix !== null }));
    };
    const onPageShow = () => {
      if (document.visibilityState === 'visible') start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    if (document.visibilityState === 'visible') start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      stop('unmount');
    };
  }, [enabled, start, stop]);

  const retry = useCallback(() => {
    if (!enabled || document.visibilityState !== 'visible') return;
    stop('retry');
    start();
  }, [enabled, start, stop]);

  return { ...state, retry };
}

/** Current permission state where the browser can tell us, else 'unknown'. */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}
