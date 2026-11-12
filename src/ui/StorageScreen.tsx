// Storage management and the pre-trip readiness check (PLAN §6.8).
import { useCallback, useEffect, useState } from 'react';
import { downloads } from '../data/downloader';
import { useAppState, useDownloads } from '../data/store';
import { formatBytes, formatDate } from '../domain/format';
import type { Region } from '../domain/types';
import { ProgressBar, Sheet, TopBar, toast } from './components';
import { useOnline } from './hooks';
import { IconAlert, IconCheck, IconClose, IconTrash } from './icons';
import { runReadinessChecks, type Check } from './readiness';

function RegionRow({ region }: { region: Region }) {
  const progress = useDownloads();
  const online = useOnline();
  const [confirm, setConfirm] = useState(false);
  const live = progress.get(region.id);
  const active = Boolean(live && live.status === 'downloading') || region.status === 'downloading' || region.status === 'queued';
  const done = live?.done ?? region.storedTiles;
  const total = live?.total ?? region.expectedTiles;

  return (
    <article className="card region-row">
      <div className="region-head">
        <div>
          <div className="region-name">{region.name}</div>
          <div className="muted small">
            {region.kind === 'trail' ? 'Trail map' : 'Custom area'} · {formatBytes(live?.bytes ?? region.bytes)} ·{' '}
            {formatDate(region.completedAt ?? region.createdAt)}
          </div>
          <div className="muted small">Map data version {region.basemap.version}</div>
        </div>
        {region.status === 'complete' ? (
          <span className="badge ok">
            Ready <IconCheck />
          </span>
        ) : active ? (
          <span className="badge busy">{total > 0 ? Math.round((done / total) * 100) : 0}%</span>
        ) : (
          <span className="badge warn">
            <IconAlert /> Incomplete
          </span>
        )}
      </div>
      {active && (
        <>
          <ProgressBar fraction={total > 0 ? done / total : 0} />
          <p className="muted small">
            {done} / {total} tiles{live && live.chunks > 1 ? ` · part ${live.chunk} of ${live.chunks}` : ''}. Keep the app open.
          </p>
        </>
      )}
      {!active && region.status !== 'complete' && (
        <p className="muted small">
          {region.storedTiles} of {region.expectedTiles} tiles saved.{live?.error ? ` ${live.error}` : ''}
        </p>
      )}
      <div className="btn-row">
        {!active && region.status !== 'complete' && (
          <button className="btn primary compact" disabled={!online} onClick={() => downloads.start(region.id)}>
            Retry
          </button>
        )}
        <button className="btn danger compact" onClick={() => setConfirm(true)}>
          <IconTrash /> {active ? 'Cancel and delete' : 'Delete'}
        </button>
      </div>
      {confirm && (
        <Sheet title="Delete this map?" onClose={() => setConfirm(false)}>
          <p>
            &ldquo;{region.name}&rdquo; will no longer be available offline. Tiles shared with other areas are kept. You can download
            it again when you have a connection.
          </p>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setConfirm(false);
                void downloads.deleteRegion(region.id).then(() => toast('Map deleted'));
              }}
            >
              Delete
            </button>
          </div>
        </Sheet>
      )}
    </article>
  );
}

export function StorageScreen() {
  const app = useAppState();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);

  const refreshUsage = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) setUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
    } catch {
      // not available
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage, app.regions]);

  const requestPersist = async () => {
    try {
      const ok = navigator.storage?.persist ? await navigator.storage.persist() : false;
      setPersisted(ok);
      toast(ok ? 'Storage is now protected.' : 'Not granted. Install the app on the Home Screen first, then try again.', ok ? 'info' : 'error');
    } catch {
      toast('This browser does not support protected storage.', 'error');
    }
  };

  const runChecks = async () => {
    setChecking(true);
    try {
      setChecks(await runReadinessChecks(app));
    } finally {
      setChecking(false);
    }
  };

  const total = app.regions.reduce((s, r) => s + r.bytes, 0);
  const failed = checks?.filter((c) => c.ok === false).length ?? 0;

  return (
    <div className="screen">
      <TopBar title="Storage & trip check" />
      <main className="screen-body">
        <section className="card stack" aria-label="Check before trip">
          <div className="card-head">
            <h2>Check before trip</h2>
          </div>
          <p className="muted small">Run this at home, on Wi-Fi, before you leave. Everything should be green.</p>
          <button className="btn primary" disabled={checking} onClick={() => void runChecks()} data-testid="run-checks">
            {checking ? 'Checking…' : checks ? 'Check again' : 'Check before trip'}
          </button>
          {checks && (
            <>
              <p className={`verdict ${failed === 0 ? 'ok' : 'fail'}`} data-testid="verdict">
                {failed === 0 ? 'Ready for the trail.' : `${failed} ${failed === 1 ? 'thing needs' : 'things need'} attention.`}
              </p>
              <ul className="checklist">
                {checks.map((c) => (
                  <li key={c.id} className={`check ${c.ok === true ? 'ok' : c.ok === false ? 'fail' : 'unknown'}`} data-check={c.id}>
                    <span className="check-mark">{c.ok === true ? <IconCheck /> : c.ok === false ? <IconClose /> : '?'}</span>
                    <span className="check-text">
                      <span>{c.label}</span>
                      <small>{c.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
              {failed === 0 && (
                <p className="muted small">Last step: switch on Airplane Mode, close the app, open it again and look at your trail.</p>
              )}
            </>
          )}
        </section>

        <h2 className="section-title">This phone</h2>
        <section className="card stack">
          <div className="usage-row">
            <span>Offline maps</span>
            <strong>{formatBytes(total)}</strong>
          </div>
          {usage && (
            <div className="usage-row">
              <span>All TrailKeep data</span>
              <strong>
                {formatBytes(usage.usage)}
                {usage.quota > 0 ? ` of ${formatBytes(usage.quota)} allowed` : ''}
              </strong>
            </div>
          )}
          <div className="usage-row">
            <span>Protected from automatic clean-up</span>
            <strong>{persisted === null ? 'Unknown' : persisted ? 'Yes' : 'No'}</strong>
          </div>
          {persisted === false && (
            <button className="btn secondary compact" onClick={() => void requestPersist()}>
              Protect storage
            </button>
          )}
          <div className="note warn">
            <IconAlert />
            <span>
              <strong>Deleting the app icon deletes all trails and maps.</strong> Keep a few GB free on the phone, and keep your GPX
              files in Files so they can be imported again.
            </span>
          </div>
        </section>

        <h2 className="section-title">Downloaded maps</h2>
        {app.regions.length === 0 ? (
          <p className="muted">No maps downloaded yet. Open a trail and choose Download map.</p>
        ) : (
          app.regions.map((r) => <RegionRow key={r.id} region={r} />)
        )}
      </main>
    </div>
  );
}
