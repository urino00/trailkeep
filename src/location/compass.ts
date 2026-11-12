// Compass heading from DeviceOrientation. Strictly opt-in: only started by the
// "follow with heading" mode and stopped as soon as that mode is left (PLAN §6.5).
import { logGeo } from './geoLog';

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionCapable = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export type CompassResult = { ok: true; stop: () => void } | { ok: false; reason: 'unsupported' | 'denied' };

const MIN_INTERVAL_MS = 200;
const MIN_CHANGE_DEG = 3;

function screenAngle(): number {
  return (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
}

/**
 * Start reporting the heading (degrees clockwise from north). Must be called from a tap,
 * because iOS only shows the motion-permission prompt in response to a user gesture.
 */
export async function startCompass(onHeading: (deg: number) => void): Promise<CompassResult> {
  if (typeof DeviceOrientationEvent === 'undefined') return { ok: false, reason: 'unsupported' };
  const ctor = DeviceOrientationEvent as PermissionCapable;
  if (typeof ctor.requestPermission === 'function') {
    try {
      if ((await ctor.requestPermission()) !== 'granted') return { ok: false, reason: 'denied' };
    } catch {
      return { ok: false, reason: 'denied' };
    }
  }

  let lastAt = 0;
  let lastDeg: number | null = null;
  const handler = (ev: Event) => {
    if (document.visibilityState !== 'visible') return;
    const e = ev as IOSOrientationEvent;
    let heading: number | null = null;
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading; // iOS: already relative to magnetic north
    } else if (e.absolute && typeof e.alpha === 'number') {
      heading = 360 - e.alpha;
    }
    if (heading === null) return;
    heading = (heading + screenAngle() + 360) % 360;
    const now = performance.now();
    if (now - lastAt < MIN_INTERVAL_MS) return;
    if (lastDeg !== null) {
      const diff = Math.abs(((heading - lastDeg + 540) % 360) - 180);
      if (diff < MIN_CHANGE_DEG) return;
    }
    lastAt = now;
    lastDeg = heading;
    onHeading(heading);
  };

  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(eventName, handler);
  logGeo('compass-on');
  return {
    ok: true,
    stop: () => {
      window.removeEventListener(eventName, handler);
      logGeo('compass-off');
    },
  };
}
