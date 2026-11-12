// Settings (PLAN §6.5, §6.6): pace factor, opt-in screen wake lock, offline-only maps, diagnostics.
import { useState, useSyncExternalStore } from 'react';
import { updateSettings, useAppState } from '../data/store';
import { formatClock } from '../domain/format';
import { getGeoLog, subscribeGeoLog } from '../location/geoLog';
import { wakeLockSupported } from '../location/wakeLock';
import { Toggle, TopBar, toast } from './components';
import { IconChevronRight } from './icons';
import { navigate } from './router';

function paceLabel(f: number): string {
  if (f < 0.95) return 'slower than the estimate';
  if (f > 1.05) return 'faster than the estimate';
  return 'the standard estimate';
}

export function SettingsScreen() {
  const { settings } = useAppState();
  const log = useSyncExternalStore(subscribeGeoLog, getGeoLog);
  const [checking, setChecking] = useState(false);

  const checkForUpdate = async () => {
    setChecking(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) toast('Updates are only available in the installed app.');
      else {
        await reg.update();
        toast(reg.waiting || reg.installing ? 'An update is ready. Use the banner at the top to install it.' : 'You have the latest version.');
      }
    } catch {
      toast('Could not check for updates. Are you online?', 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title="Settings" />
      <main className="screen-body">
        <h2 className="section-title">Walking time</h2>
        <section className="card stack">
          <label className="field">
            <span>
              Pace factor: {settings.paceFactor.toFixed(2)} ({paceLabel(settings.paceFactor)})
            </span>
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={settings.paceFactor}
              onChange={(e) => void updateSettings({ paceFactor: Number(e.target.value) })}
              aria-label="Pace factor"
            />
          </label>
          <p className="muted small">
            Time left is an estimate from Tobler&rsquo;s hiking function, which assumes a fit walker on a good path with no breaks.
            Lower the factor if you take longer than it says (0.7 is about 40% more time), raise it if you are faster.
          </p>
        </section>

        <h2 className="section-title">Battery</h2>
        <section className="card stack">
          <Toggle
            label="Keep screen on while navigating"
            hint={
              wakeLockSupported()
                ? 'Off by default. The screen stays lit on the trail screen, which uses more battery.'
                : 'Not supported by this browser.'
            }
            checked={settings.keepScreenOn}
            disabled={!wakeLockSupported()}
            onChange={(v) => void updateSettings({ keepScreenOn: v })}
          />
          <Toggle
            label="Use downloaded maps only"
            hint="Never use mobile data for map tiles, even with signal. Saves battery and data on the trail."
            checked={settings.offlineOnly}
            onChange={(v) => void updateSettings({ offlineOnly: v })}
          />
          <p className="muted small">
            GPS runs only while a map is on screen. It stops as soon as you lock the phone or switch apps; there is no background
            tracking and no recording.
          </p>
        </section>

        <h2 className="section-title">More</h2>
        <nav className="nav-list">
          <button className="nav-item" onClick={() => navigate('#/storage')}>
            Check before trip & storage <IconChevronRight />
          </button>
          <button className="nav-item" onClick={() => navigate('#/help')}>
            How to use TrailKeep <IconChevronRight />
          </button>
          <button className="nav-item" onClick={() => navigate('#/about')}>
            Map data & credits <IconChevronRight />
          </button>
        </nav>

        <h2 className="section-title">App</h2>
        <section className="card stack">
          <div className="usage-row">
            <span>Version</span>
            <strong>{__APP_VERSION__}</strong>
          </div>
          <button className="btn secondary compact" disabled={checking} onClick={() => void checkForUpdate()}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          <p className="muted small">
            Updates never install by themselves. Your trails and maps are kept when the app updates. Avoid updating right before or
            during a trip.
          </p>
        </section>

        <h2 className="section-title">Diagnostics</h2>
        <section className="card stack">
          <p className="muted small">GPS activity in this session. &ldquo;clear&rdquo; means the GPS was switched off.</p>
          <div className="log" data-testid="geo-log">
            {log.length === 0
              ? 'No GPS activity yet.'
              : log
                  .slice(-40)
                  .map((e) => `${formatClock(new Date(e.at))}:${String(new Date(e.at).getSeconds()).padStart(2, '0')}  ${e.event}${e.detail ? `  ${e.detail}` : ''}`)
                  .join('\n')}
          </div>
        </section>
      </main>
    </div>
  );
}
