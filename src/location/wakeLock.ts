// Screen Wake Lock, shared by the downloader ("keep the app open while downloading") and the
// opt-in "Keep screen on while navigating" setting. Never held by default (PLAN §6.5).

type Reason = 'download' | 'navigation';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

const reasons = new Set<Reason>();
let sentinel: WakeLockSentinelLike | null = null;
let listening = false;

export function wakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

async function request(): Promise<void> {
  if (sentinel || reasons.size === 0 || !wakeLockSupported() || document.visibilityState !== 'visible') return;
  try {
    const lock = (await (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock.request(
      'screen',
    )) as WakeLockSentinelLike;
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
    });
    if (reasons.size === 0) void releaseNow();
  } catch {
    // Low battery or unsupported context: carry on without it.
  }
}

async function releaseNow(): Promise<void> {
  const lock = sentinel;
  sentinel = null;
  try {
    await lock?.release();
  } catch {
    // already released
  }
}

export async function acquireWakeLock(reason: Reason): Promise<void> {
  reasons.add(reason);
  if (!listening) {
    listening = true;
    // The OS drops the lock whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void request();
    });
  }
  await request();
}

export function releaseWakeLock(reason: Reason): void {
  reasons.delete(reason);
  if (reasons.size === 0) void releaseNow();
}
