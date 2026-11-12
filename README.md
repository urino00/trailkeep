# TrailKeep

Offline GPX trail maps for iPhone, as a Home Screen web app. Import a GPX file, download the map around it (roads, paths, water, hillshade, contours, peaks), then open the app on the trail with no signal and see where you are.

- No App Store, no account, no server, nothing that expires. Everything is stored on the phone.
- GPS runs only while the app is on screen. No background tracking, no recording.
- Map: OpenFreeMap vector tiles + AWS terrain tiles, both free and both allowing this use. See [ATTRIBUTION.md](ATTRIBUTION.md).

**To put it on your phone, follow [DEPLOY.md](DEPLOY.md).** The product spec is [PLAN.md](PLAN.md).

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Development server at http://127.0.0.1:5173 (no service worker) |
| `npm test` | Unit tests (Vitest): GPX parsing, geo math, trail progress, profile, tiles, ETA |
| `npm run build` | Type-check and build the production site into `dist/` |
| `npm run preview` | Serve the production build at http://127.0.0.1:4173 (with service worker) |
| `npm run e2e` | End-to-end tests (Playwright, WebKit + Chromium). Needs internet: it downloads real tiles. First run: `npx playwright install webkit chromium` |
| `npm run assets:map` | Re-download the bundled style, sprites and fonts |
| `npm run assets:icons` | Re-render the app icons |

## How it is put together

```
src/
  domain/     pure TypeScript, no DOM: GPX parser, geo math, trail matching, profile, ETA, tile math
  data/       IndexedDB schema, tile store with reference counting, resumable downloader, trail import
  map/        MapLibre setup: sources.ts (the only file that names tile servers), offline:// protocol,
              style builder, on-device contours, overlay layers
  location/   GPS lifecycle tied to page visibility, opt-in compass, wake lock, diagnostics log
  ui/         React screens and components
public/       bundled fonts, sprites and icons (precached by the service worker)
tests/        unit tests, e2e tests, GPX fixtures
```

How offline works: every tile and glyph request goes through one MapLibre protocol, `offline://`. It looks in IndexedDB first, then the network if there is one, and otherwise reports "not found", which makes MapLibre show the nearest lower-zoom tile that is stored. The app shell, fonts and sprites are precached by the service worker, so a cold start in airplane mode works.

## What the tests cover

- **73 unit tests**, including the plan's acceptance numbers for `example.gpx` (17.25 km, 1636–2365 m, loop, smoothed gain 860 m) and the trail-matching rules for loops, out-and-backs and spurs.
- **9 end-to-end tests** in WebKit (iPhone 15 profile) and Chromium: import; rejecting a non-GPX file; downloading a trail map; reloading with no network and checking the map still draws labels and contours with no failed tile requests; mocked GPS progress and the off-trail warning; GPS stopping when the app is hidden; chart scrubbing; custom-area download and the trip check; an interrupted download in Patagonia that resumes, with missing elevations filled from terrain.

Not covered by automated tests, so check them on the phone (list in DEPLOY.md): installing to the Home Screen, picking a file from Files / iCloud Drive, real GPS and compass, battery use, iOS re-prompting for location.

## Differences from PLAN.md

- **MapLibre GL JS 6.18.0** instead of 4.x/5.x: every 5.x release is flagged with a critical XSS advisory (GHSA-jrc7-96c5-q579) that is fixed in 6.x. 6.x also has a built-in way to fall back to lower-zoom tiles where a tile is missing, which the offline map uses.
- **Own XML scanner instead of `DOMParser`**: `DOMParser` does not exist in Web Workers, where large files are parsed.
- **`example.gpx` has 1158 points after dedupe, not 1205**: the file contains 48 consecutive duplicate points, not just the first.
- **Missing tiles answer "not found" instead of an empty tile**, so MapLibre shows the downloaded z0–10 overview outside a downloaded area instead of a blank map.
- **Tiles are stored as `ArrayBuffer`, not `Blob`**: Blobs in IndexedDB have been unreliable in WebKit.
- **Cancelling a download deletes the partial region** rather than leaving a "cancelled" entry.
- Added beyond the plan: a "Use downloaded maps only" setting, a "Reset progress" action, saved positions older than 12 hours are ignored when matching, and fonts for extra scripts are cached on first use while online.

## Known limits

- `npm audit` still reports moderate/low advisories in build-time tooling pulled in by `workbox-build` (`glob`, `minimatch`, `deepmerge`). They are not shipped to the browser.
- Areas that cross the 180° meridian are not supported.
- The ETA uses Tobler's hiking function, which is optimistic for most hikers; adjust the pace factor in Settings.
