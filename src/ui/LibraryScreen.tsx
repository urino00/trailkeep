// Trail library (PLAN §6.2, §6.3): import, cards with offline status, rename / re-download / delete.
import { useRef, useState } from 'react';
import { getAppState, refreshData, updateSettings, useAppState, useDownloads, type TrailSummary } from '../data/store';
import { deleteTrail, importGpxFile, renameTrail } from '../data/trails';
import { formatKm } from '../domain/format';
import { GpxError } from '../domain/gpx';
import { ActionSheet, PromptSheet, Sheet, Toggle, toast } from './components';
import { DownloadSheet } from './DownloadSheet';
import { isStandalone, useOnline } from './hooks';
import { IconAlert, IconDownload, IconHelp, IconImport, IconMap, IconMore, IconMountain, IconSettings, IconStorage, IconTrash } from './icons';
import { InstallGuide } from './InstallGuide';
import { navigate } from './router';
import { OfflineBadge, offlineStatus } from './status';

// iOS greys out .gpx files in the picker unless the accept list is permissive enough, so the
// list includes the generic XML and binary types too. The content is validated after picking.
const ACCEPT = '.gpx,application/gpx+xml,application/xml,text/xml,application/octet-stream';

type Dialog =
  | { kind: 'menu'; trail: TrailSummary }
  | { kind: 'rename'; trail: TrailSummary }
  | { kind: 'delete'; trail: TrailSummary }
  | { kind: 'download'; trail: TrailSummary; intro?: string }
  | null;

export function LibraryScreen() {
  const app = useAppState();
  const progress = useDownloads();
  const online = useOnline();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [acceptAll, setAcceptAll] = useState(false);

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const trail = await importGpxFile(file);
      await refreshData();
      toast(`Imported "${trail.name}"`);
      const summary = getAppState().trails.find((t) => t.id === trail.id);
      if (summary && navigator.onLine) {
        setDialog({ kind: 'download', trail: summary, intro: 'Download the map for this trail now, so it works with no signal?' });
      }
    } catch (e) {
      toast(e instanceof GpxError ? e.message : 'That file could not be imported.', 'error');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // Always work with the freshest summary for an open dialog (status changes while downloading).
  const current = dialog ? (app.trails.find((t) => t.id === dialog.trail.id) ?? null) : null;

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand">
          <IconMountain />
          TrailKeep
        </div>
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => navigate('#/map')} aria-label="Map and download area">
            <IconMap />
          </button>
          <button className="icon-btn" onClick={() => navigate('#/storage')} aria-label="Storage and trip check">
            <IconStorage />
          </button>
          <button className="icon-btn" onClick={() => navigate('#/settings')} aria-label="Settings">
            <IconSettings />
          </button>
          <button className="icon-btn" onClick={() => navigate('#/help')} aria-label="Help">
            <IconHelp />
          </button>
        </div>
      </header>

      <main className="screen-body">
        {!isStandalone() && <InstallGuide />}

        {app.error && (
          <div className="note danger">
            <IconAlert />
            <span>Storage is not available: {app.error} Private browsing mode blocks it.</span>
          </div>
        )}

        {isStandalone() && !app.settings.onboardingDone && (
          <section className="card stack">
            <h2>Welcome to TrailKeep</h2>
            <ol className="steps">
              <li>Import a GPX file from Files.</li>
              <li>Download the map for it while you are on Wi-Fi.</li>
              <li>On the trail, open the app to see where you are. No signal needed.</li>
            </ol>
            <div className="note warn">
              <IconAlert />
              <span>
                <strong>Deleting the app icon deletes all trails and maps.</strong> Everything is stored on this phone only.
              </span>
            </div>
            <button className="btn secondary compact" onClick={() => void updateSettings({ onboardingDone: true })}>
              Got it
            </button>
          </section>
        )}

        {app.loaded && app.trails.length === 0 ? (
          <div className="empty">
            <IconMountain />
            <h2>No trails yet</h2>
            <p>
              Download a trail&rsquo;s GPX file to the Files app (for example from AllTrails: <em>Download route → GPX track</em>),
              then import it here.
            </p>
          </div>
        ) : (
          app.trails.map((t) => (
            <article key={t.id} className="card trail-card">
              <button className="trail-open" onClick={() => navigate(`#/trail/${encodeURIComponent(t.id)}`)}>
                <svg className="trail-thumb" viewBox="0 0 96 64" aria-hidden="true">
                  <path d={t.thumb} />
                </svg>
                <span className="trail-info">
                  <span className="trail-name">{t.name}</span>
                  <span className="trail-meta">
                    {formatKm(t.stats.distanceM)}
                    {t.elevationSource !== 'none' ? ` · ↑ ${Math.round(t.stats.gainM)} m` : ''}
                    {t.stats.isLoop ? ' · loop' : ''}
                  </span>
                  <span>
                    <OfflineBadge status={offlineStatus(t.regionId, app.regions, progress)} />
                  </span>
                </span>
              </button>
              <button className="icon-btn trail-menu" onClick={() => setDialog({ kind: 'menu', trail: t })} aria-label={`Actions for ${t.name}`}>
                <IconMore />
              </button>
            </article>
          ))
        )}
      </main>

      <div className="bottom-bar">
        <input
          ref={fileInput}
          type="file"
          accept={acceptAll ? undefined : ACCEPT}
          hidden
          data-testid="gpx-input"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <button className="btn primary block" disabled={importing} onClick={() => fileInput.current?.click()}>
          <IconImport />
          {importing ? 'Importing…' : 'Import GPX'}
        </button>
        {!acceptAll && (
          <button className="btn ghost compact block" onClick={() => setAcceptAll(true)}>
            GPX file greyed out? Tap here, then import again
          </button>
        )}
      </div>

      {dialog?.kind === 'menu' && current && (
        <ActionSheet
          title={current.name}
          onClose={() => setDialog(null)}
          items={[
            {
              label: current.regionId ? 'Offline map…' : 'Download map…',
              hint: online ? undefined : 'Needs an internet connection',
              icon: <IconDownload />,
              onSelect: () => setDialog({ kind: 'download', trail: current }),
            },
            { label: 'Rename', icon: <IconImport />, onSelect: () => setDialog({ kind: 'rename', trail: current }) },
            { label: 'Delete trail', icon: <IconTrash />, danger: true, onSelect: () => setDialog({ kind: 'delete', trail: current }) },
          ]}
        />
      )}
      {dialog?.kind === 'rename' && current && (
        <PromptSheet
          title="Rename trail"
          label="Name"
          initial={current.name}
          confirmLabel="Save"
          onClose={() => setDialog(null)}
          onConfirm={(name) => void renameTrail(current.id, name).then(refreshData)}
        />
      )}
      {dialog?.kind === 'delete' && current && <DeleteSheet trail={current} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'download' && current && <DownloadSheet trail={current} intro={dialog.intro} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DeleteSheet({ trail, onClose }: { trail: TrailSummary; onClose: () => void }) {
  const [alsoMap, setAlsoMap] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Delete trail?" onClose={onClose}>
      <p>
        &ldquo;{trail.name}&rdquo; will be removed from this phone. This cannot be undone, but you can import the GPX file again.
      </p>
      {trail.regionId && (
        <Toggle
          label="Also delete its offline map"
          hint="Frees the space. Map tiles shared with other areas are kept."
          checked={alsoMap}
          onChange={setAlsoMap}
        />
      )}
      <div className="btn-row">
        <button className="btn secondary" onClick={onClose}>
          Keep
        </button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void deleteTrail(trail.id, alsoMap)
              .then(refreshData)
              .then(() => {
                toast('Trail deleted');
                onClose();
              });
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}
