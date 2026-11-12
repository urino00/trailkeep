// "Check before trip" (PLAN §6.8): everything that must be true for the app to work for weeks
// with no signal and no computer.
import { regionTileSpec } from '../data/downloader';
import type { AppState } from '../data/store';
import { regionTileKeys } from '../data/tileStore';
import { planRegionTiles, tileKey } from '../domain/tiles';
import { locationPermission } from '../location/useLocation';
import { BUNDLED_FONT_STACKS, BUNDLED_GLYPH_RANGES, SPRITE_FILES, appUrl } from '../map/sources';
import { isStandalone } from './hooks';

export interface Check {
  id: string;
  label: string;
  /** true = pass, false = fail, null = cannot be determined here. */
  ok: boolean | null;
  detail: string;
}

async function isCached(path: string): Promise<boolean> {
  if (!('caches' in window)) return false;
  const hit = await caches.match(appUrl(path), { ignoreSearch: true, ignoreVary: true });
  return Boolean(hit);
}

export async function runReadinessChecks(app: AppState): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. Installed
  const standalone = isStandalone();
  checks.push({
    id: 'installed',
    label: 'Opened from the Home Screen icon',
    ok: standalone,
    detail: standalone
      ? 'This is the installed app.'
      : 'You are in a browser tab. Add TrailKeep to the Home Screen and do everything from there.',
  });

  // 2. App shell
  let shell = false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    shell = Boolean(reg?.active) && (await isCached('index.html'));
  } catch {
    shell = false;
  }
  checks.push({
    id: 'shell',
    label: 'App works with no connection',
    ok: shell,
    detail: shell ? 'The app itself is saved on this phone.' : 'The app is not saved for offline use yet. Open it once while online, then check again.',
  });

  // 3. Fonts and sprites
  const assets = [...SPRITE_FILES];
  for (const stack of BUNDLED_FONT_STACKS) for (const range of BUNDLED_GLYPH_RANGES) assets.push(`fonts/${stack}/${range}.pbf`);
  let missingAssets = 0;
  try {
    const hits = await Promise.all(assets.map(isCached));
    missingAssets = hits.filter((h) => !h).length;
  } catch {
    missingAssets = assets.length;
  }
  checks.push({
    id: 'fonts',
    label: 'Map labels and icons saved',
    ok: missingAssets === 0,
    detail:
      missingAssets === 0
        ? `All ${assets.length} font and icon files are saved.`
        : `${missingAssets} of ${assets.length} font and icon files are missing. Open the app once while online.`,
  });

  // 4. Regions complete (verified tile by tile) and every trail has one
  const problems: string[] = [];
  let verified = 0;
  for (const region of app.regions) {
    if (region.status !== 'complete') {
      problems.push(`"${region.name}" is not fully downloaded`);
      continue;
    }
    try {
      const have = await regionTileKeys(region.id);
      const missing = planRegionTiles(regionTileSpec(region)).filter(
        (t) => !have.has(tileKey(t.layer, t.layer === 'basemap' ? region.basemap.version : null, t.z, t.x, t.y)),
      ).length;
      if (missing > 0) problems.push(`"${region.name}" is missing ${missing} tiles`);
      else verified++;
    } catch {
      problems.push(`"${region.name}" could not be checked`);
    }
  }
  const complete = new Set(app.regions.filter((r) => r.status === 'complete').map((r) => r.id));
  const without = app.trails.filter((t) => !t.regionId || !complete.has(t.regionId));
  if (without.length) problems.push(`${without.length} ${without.length === 1 ? 'trail has' : 'trails have'} no offline map`);
  checks.push({
    id: 'regions',
    label: 'Every map is fully downloaded',
    ok: app.regions.length === 0 && app.trails.length === 0 ? null : problems.length === 0,
    detail:
      app.regions.length === 0 && app.trails.length === 0
        ? 'Nothing imported yet.'
        : problems.length === 0
          ? `${verified} map ${verified === 1 ? 'area' : 'areas'} verified, tile by tile.`
          : `${problems.join('; ')}.`,
  });

  // 5. Persistent storage
  let persisted: boolean | null = null;
  try {
    persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    persisted = null;
  }
  checks.push({
    id: 'persist',
    label: 'Storage is protected',
    ok: persisted,
    detail:
      persisted === true
        ? 'iOS will not clear your maps to free up space.'
        : persisted === false
          ? 'Not granted. Tap "Protect storage" below; iOS grants it to apps installed on the Home Screen.'
          : 'This browser cannot report it.',
  });

  // 6. Location permission
  const perm = await locationPermission();
  checks.push({
    id: 'location',
    label: 'Location allowed',
    ok: perm === 'granted' ? true : perm === 'unknown' ? null : false,
    detail:
      perm === 'granted'
        ? 'TrailKeep can show your position.'
        : perm === 'denied'
          ? 'Denied. Allow it in Settings → Privacy & Security → Location Services → Safari Websites.'
          : perm === 'prompt'
            ? 'Not asked yet. Open a trail and tap the location button once before you leave.'
            : 'Cannot be checked here. Open a trail and make sure the blue dot appears.',
  });

  return checks;
}
