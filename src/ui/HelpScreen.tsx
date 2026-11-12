// In-app user guide (PLAN §12).
import { TopBar } from './components';

export function HelpScreen() {
  return (
    <div className="screen">
      <TopBar title="How to use TrailKeep" />
      <main className="screen-body">
        <section className="card prose">
          <h3>Before the trip (on Wi-Fi)</h3>
          <ol className="steps">
            <li>
              Open TrailKeep&rsquo;s address in Safari, tap Share, then <strong>Add to Home Screen</strong>. From then on, always
              open it from the icon.
            </li>
            <li>
              In AllTrails (the free version is enough) or any other site, download the trail&rsquo;s <strong>GPX</strong> file to
              the Files app.
            </li>
            <li>
              In TrailKeep tap <strong>Import GPX</strong>, then <strong>Download map</strong>. Keep the app open until the trail
              shows <em>Ready offline ✓</em>.
            </li>
            <li>
              Optional: open the map, tap ⋯ and <strong>Download area</strong> to save a whole valley or the road to the trailhead.
            </li>
            <li>
              Open <strong>Storage &amp; trip check</strong> and tap <strong>Check before trip</strong>. Everything should be green.
            </li>
            <li>Test it: switch on Airplane Mode, close the app, open it again and look at your trail.</li>
          </ol>
        </section>

        <section className="card prose">
          <h3>On the trail</h3>
          <ul>
            <li>Open the app to see where you are. No signal is needed; GPS works without it.</li>
            <li>
              The arrow button follows your position. Tap it again to turn the map the way the phone points, and once more to stop.
            </li>
            <li>The panel shows distance done and left, climbing left, and an estimated time. Drag a finger along the elevation chart to see any point on the map.</li>
            <li>
              <strong>Off trail</strong> appears when you are more than 30 m from the line, with the direction back to it.
            </li>
            <li>
              Lock the phone when you are done. GPS stops straight away and saves battery. TrailKeep never tracks in the background
              and does not record your walk.
            </li>
          </ul>
        </section>

        <section className="card prose">
          <h3>Good to know</h3>
          <ul>
            <li>
              <strong>Deleting the app icon deletes all trails and maps.</strong> Everything is stored only on this phone.
            </li>
            <li>Keep a few GB free on the phone so iOS has no reason to clear app data.</li>
            <li>Walking a loop the other way round? Use ⋯ → Reverse direction.</li>
            <li>Progress looks wrong after doing the same trail twice? Use ⋯ → Reset progress.</li>
            <li>
              If the first GPS fix is slow with no signal, give it a minute under open sky. The grey dot is your last known position.
            </li>
            <li>
              If iOS asks for location permission again, choose Allow. If you chose Don&rsquo;t Allow by mistake: Settings → Privacy
              &amp; Security → Location Services → Safari Websites → While Using the App.
            </li>
            <li>In AllTrails: open the trail, tap ⋯ or Share, then Download route / Export as GPX track.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
