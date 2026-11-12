// Tiny hash router. Hash routes work from any base path and need no server rewrites,
// and iOS swipe-back works because every screen change is a history entry.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'trail'; id: string; download: boolean }
  | { name: 'map' }
  | { name: 'storage' }
  | { name: 'settings' }
  | { name: 'help' }
  | { name: 'about' };

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'trail':
      if (parts[1]) return { name: 'trail', id: decodeURIComponent(parts[1]), download: query.includes('download=1') };
      break;
    case 'map':
    case 'storage':
    case 'settings':
    case 'help':
    case 'about':
      return { name: parts[0] };
  }
  return { name: 'library' };
}

let current: Route = parse(location.hash);
let currentHash = location.hash;
const listeners = new Set<() => void>();

function sync(): void {
  if (location.hash === currentHash) return;
  currentHash = location.hash;
  current = parse(location.hash);
  listeners.forEach((fn) => fn());
}
// Back / forward (including the iOS edge swipe) and hand-edited URLs.
window.addEventListener('popstate', sync);
window.addEventListener('hashchange', sync);

/** How many in-app screens are below the current one in the history stack. */
function depth(): number {
  const d = (history.state as { tk?: number } | null)?.tk;
  return typeof d === 'number' ? d : 0;
}

export function navigate(to: string, replace = false): void {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (replace) history.replaceState({ tk: depth() }, '', hash);
  else history.pushState({ tk: depth() + 1 }, '', hash);
  sync();
}

/** Go back in history when the previous entry is ours, otherwise to the library. */
export function goBack(): void {
  if (depth() > 0) history.back();
  else navigate('#/', true);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
