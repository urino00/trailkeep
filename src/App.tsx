import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getSetting, setSetting } from './data/db';
import { downloads } from './data/downloader';
import { refreshData, useAppState, useDownloads } from './data/store';
import { configureOffline } from './map/offlineProtocol';
import { fetchBasemapInfo, type BasemapInfo } from './map/sources';
import { AboutScreen } from './ui/AboutScreen';
import { ProgressBar, ToastHost, toast } from './ui/components';
import { HelpScreen } from './ui/HelpScreen';
import { isStandalone } from './ui/hooks';
import { LibraryScreen } from './ui/LibraryScreen';
import { MapScreen } from './ui/MapScreen';
import { navigate, useRoute } from './ui/router';
import { SettingsScreen } from './ui/SettingsScreen';
import { StorageScreen } from './ui/StorageScreen';

async function boot(): Promise<void> {
  await refreshData();
  try {
    const saved = await getSetting<BasemapInfo>('basemapInfo');
    if (saved) configureOffline({ info: saved });
  } catch {
    // no saved map info yet
  }
  void downloads.resumeInterrupted();

  // Ask iOS not to evict our data. Granted to Home Screen apps; harmless elsewhere.
  if (isStandalone() && navigator.storage?.persist) {
    try {
      const before = await navigator.storage.persisted();
      if (!before && (await navigator.storage.persist())) toast('Storage protected: iOS will keep your maps.');
    } catch {
      // not supported
    }
  }

  // Learn the current map version, so areas that are not downloaded can still be browsed online.
  if (navigator.onLine) {
    fetchBasemapInfo()
      .then((info) => {
        configureOffline({ info });
        return setSetting('basemapInfo', info);
      })
      .catch(() => undefined);
  }
}

function UpdateBanner() {
  // registerType 'prompt': a new version waits until the user chooses to install it (PLAN §10).
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="app-banner" role="status">
      <span>Update available</span>
      <button onClick={() => void updateServiceWorker(true)}>Update</button>
      <button onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
}

function DownloadPill() {
  const progress = useDownloads();
  const route = useRoute();
  const active = [...progress.values()].filter((p) => p.status === 'downloading');
  if (active.length === 0 || route.name === 'storage') return null;
  const done = active.reduce((s, p) => s + p.done, 0);
  const total = active.reduce((s, p) => s + p.total, 0);
  const fraction = total > 0 ? done / total : 0;
  return (
    <button className="download-pill" onClick={() => navigate('#/storage')} aria-label="Download in progress, open storage">
      <span>Downloading {Math.round(fraction * 100)}%</span>
      <ProgressBar fraction={fraction} />
    </button>
  );
}

export function App() {
  const app = useAppState();
  const route = useRoute();

  useEffect(() => {
    void boot();
  }, []);

  // Tell the offline protocol which map versions are stored (newest first) and the network policy.
  useEffect(() => {
    const versions = [...new Set(app.regions.map((r) => r.basemap.version))];
    configureOffline({ versions, offlineOnly: app.settings.offlineOnly });
  }, [app.regions, app.settings.offlineOnly]);

  let screen;
  switch (route.name) {
    case 'trail':
      screen = <MapScreen key={route.id} trailId={route.id} autoDownload={route.download} />;
      break;
    case 'map':
      screen = <MapScreen key="free-map" />;
      break;
    case 'storage':
      screen = <StorageScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'help':
      screen = <HelpScreen />;
      break;
    case 'about':
      screen = <AboutScreen />;
      break;
    default:
      screen = <LibraryScreen />;
  }

  return (
    <>
      {screen}
      <DownloadPill />
      <UpdateBanner />
      <ToastHost />
    </>
  );
}
