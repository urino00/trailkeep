// Shown when the app runs in a browser tab instead of from the Home Screen (PLAN §6.1).
import { updateSettings, useAppState } from '../data/store';
import { isIOS } from './hooks';
import { IconAlert, IconShare } from './icons';

export function InstallGuide() {
  const { settings } = useAppState();
  const ios = isIOS();
  if (!ios && settings.installHintDismissed) return null;

  return (
    <section className="card stack" aria-label="Install guide">
      <div className="card-head">
        <h2>Install TrailKeep on your Home Screen</h2>
      </div>
      {ios ? (
        <ol className="steps">
          <li>
            Tap the Share button
            <span className="inline-icon">
              <IconShare />
            </span>
            in Safari.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>Close Safari and open TrailKeep from its new icon.</li>
        </ol>
      ) : (
        <p>
          On iPhone, open this page in Safari, tap Share, then <strong>Add to Home Screen</strong>. In this browser the app works
          too, which is handy for trying it out.
        </p>
      )}
      <div className="note warn">
        <IconAlert />
        <span>
          <strong>Do everything from the Home Screen icon.</strong> Trails and maps saved in this Safari tab are not shared with the
          Home Screen app, so import and download only after installing.
        </span>
      </div>
      {!ios && (
        <button className="btn ghost compact" onClick={() => void updateSettings({ installHintDismissed: true })}>
          Hide this
        </button>
      )}
    </section>
  );
}
