# TrailKeep: offline GPX trail maps for iPhone (build plan)

> Audience: the builder agent that will implement this app. Read the whole document before you write any code.
> Status: product decisions are final unless a section is marked **OPEN**. Date: 2026-11-12.

---

## 1. Why this exists

The user is leaving AllTrails and doesn't want to pay for AllTrails Premium just to get offline maps. They need to:

1. Import a `.gpx` file (exported from AllTrails or anywhere else) onto their iPhone.
2. Download the **map itself** for the trail's area: roads, paths, water, terrain shading, contour lines, peaks.
3. Open the app on the trail with **no signal** and see where they are relative to the trail.

The first real use is a **multi-week trip to Argentina with no laptop**. Everything must work for weeks without a computer, without internet, and without anything expiring.

### Hard constraints from the user

| Constraint | Consequence for the build |
|---|---|
| Won't pay Apple ($99/yr) | No App Store or TestFlight. Free Xcode installs expire every 7 days, which is unacceptable with no laptop on the trip. **We build a Home Screen web app (PWA), not a native app.** |
| Free-tier map accounts are fine, but $0 | Use open, free tile sources whose terms explicitly allow offline area downloads (see §5). |
| **Minimal battery use** | **No background location, no tracking while locked, no recording.** The user carries a Garmin for that. GPS runs only while the app is on screen. |
| "Update state only when opened" | When the app opens or comes back to the foreground, get a fix right away and recompute progress. Stop GPS the moment the app is hidden. |
| Navigate *on the trail* | Show position against the trail line, with progress, distance left and an elevation profile. **No turn-by-turn driving directions, no routing.** |
| Has a Mac | Only used for development. The app must never need the Mac after install. |

---

## 2. Product scope

### In scope (v1)
1. **GPX import** from the Files app, through an in-app button.
2. **Trail library**: a list of imported trails with stats, an offline-ready badge, rename and delete.
3. **Map view** (vector basemap, hillshade and contours) with the trail line, start and end markers, and waypoints.
4. **Offline download**:
   - a) one tap downloads the trail's area with a buffer (default 2 km);
   - b) the user can draw a custom rectangle and download it, for example a whole valley or the road to the trailhead.
5. **Live location while the app is open**: blue dot, accuracy circle, optional compass heading.
6. **Trail progress**: distance done and distance left along the trail, distance off the trail, elevation now, ascent remaining, and an ETA.
7. **Elevation profile**: a chart of the whole trail with a "you are here" marker. Scrubbing the chart highlights the point on the map.
8. **Storage management**: per-region size, total usage, delete a region, and a check that everything needed offline is present.

### Explicitly out of scope (do not build)
- Background or locked-screen location, track recording, GPX export of a recorded track.
- Off-route alerts with sound or vibration. These need background GPS, which the user rejected for battery reasons.
- Live Activities, Apple Watch, notifications.
- Turn-by-turn routing, driving directions, offline search or geocoding.
- Accounts, cloud sync, sharing, analytics, ads. **No data leaves the device**, except tile downloads.
- A native iOS app. The design should stay portable, for example by keeping pure logic in framework-free modules, but don't build one.

### Defaults chosen by the PM (change only if the user asks)
- UI language: English. Units: metric (km, m). Time: 24h.
- Supported platform: iOS 17+ Safari, installed to the Home Screen. Desktop Chrome and Safari must also work, for development.

---

## 3. The example file (`example.gpx`) is the primary test fixture

Analysis of `/example.gpx`:

- Creator: `AllTrails.com`. Name: *Estany de Sant Maurici - Amitges - Obagues de Ratera* (Pyrenees, Spain).
- Names and descriptions are wrapped in `<![CDATA[...]]>`, and `<desc>` is empty.
- `<metadata><bounds minlat="42.57864" minlon="0.97892" maxlat="42.59672" maxlon="1.04783"/>`.
- Exactly **1 `<trk>`, 1 `<trkseg>`, 1206 `<trkpt>`**, each with `<ele>`. There is **no `<time>`**, no `<wpt>`, and no `<rte>`.
- The first point is duplicated (two identical consecutive points). It is a **loop**: start = end = `42.58466, 1.04783`.
- The computed haversine length is **≈ 17.25 km**. Elevation ranges from **1635.9 m to 2365.2 m**. The raw summed ascent is ≈ 966 m, and the smoothed value will be lower.

The parser must not assume the AllTrails shape. It must also handle:
- `<rte>/<rtept>` routes (convert them to a line);
- multiple `<trk>` and `<trkseg>` (keep segments separate, and don't draw a line across gaps);
- `<wpt>` waypoints (with name and description);
- missing `<ele>` (fill it from the DEM after download; see §6.6);
- `<time>` (ignore it in v1);
- the GPX 1.0 namespace;
- BOMs and whitespace;
- files up to about 10 MB or 100k points.

---

## 4. Architecture

```
┌──────────────────────── iPhone: Home Screen web app (standalone) ────────────────────────┐
│ UI (React + TS)                                                                           │
│  ├─ LibraryScreen   ├─ TrailScreen (Map + ProgressPanel + ElevationProfile)               │
│  ├─ DownloadSheet   └─ StorageScreen / ReadinessCheck                                     │
│ Map: MapLibre GL JS  ── custom protocol "offline://" ──► TileStore (IndexedDB)            │
│                                        │ miss & online ──► network (OpenFreeMap / AWS DEM)│
│ Domain (pure TS, no DOM): gpx parser, geo math, progress, profile, tile math, ETA         │
│ Service Worker (Workbox): precaches app shell + style + fonts + sprites                   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
Hosting: static site on GitHub Pages (HTTPS, required for geolocation and service workers).
```

### Stack (fixed)
- **Vite + React 18 + TypeScript (strict)**. **vite-plugin-pwa** (Workbox) handles the manifest and service worker.
- **MapLibre GL JS** (pin an exact current 4.x/5.x version) and **maplibre-contour**, which generates contours on the device from DEM tiles.
- **idb** (a small IndexedDB wrapper) for persistence. Don't use localStorage for anything important.
- The elevation chart is plain **SVG or canvas**, without a chart library, to keep the bundle small.
- **Vitest** for unit tests. **Playwright with the WebKit project** for e2e, using offline mode and geolocation mocking.
- **No backend.** All data stays on the device.

### Code layout
```
src/
  domain/          # pure, unit-tested, no DOM/MapLibre imports
    gpx.ts         # parse → Trail
    geo.ts         # haversine, bbox, buffer, point-to-segment projection
    progress.ts    # locate user on trail, along-track distance, off-track distance
    profile.ts     # elevation smoothing, gain/loss, profile sampling
    eta.ts         # Tobler/Naismith time estimate
    tiles.ts       # bbox → tile list per zoom, size estimate, chunking
  data/
    db.ts          # IndexedDB schema + migrations
    tileStore.ts   # get/put/refcount tiles
    downloader.ts  # queue, concurrency=4, retry, resume, progress events
  map/
    style.ts       # builds the offline style JSON (local glyphs/sprites, offline:// sources)
    offlineProtocol.ts  # maplibregl.addProtocol('offline', ...)
    layers.ts      # trail, waypoints, user location, highlight
  location/
    useLocation.ts # watchPosition lifecycle tied to page visibility
    compass.ts     # DeviceOrientation (opt-in)
  ui/ ...          # screens + components
public/
  fonts/ sprites/  # bundled glyph PBFs + sprite sheets (see §5.3)
  icons/           # PWA icons, apple-touch-icon
tests/fixtures/example.gpx
```

---

## 5. Map data: sources, terms and the offline strategy

The terms were checked on 2026-11-12. **Re-verify them before shipping**, and record the URLs in `ATTRIBUTION.md`.

| Layer | Source | Why | Terms that matter |
|---|---|---|---|
| Vector basemap (roads, paths, tracks, water, landcover, buildings, POIs, peaks, place names) | **OpenFreeMap** (`https://tiles.openfreemap.org/planet`, OpenMapTiles schema) | It's the only free source whose terms explicitly **allow downloading areas for offline use**. It needs no key and no signup. | Each download can be at most **3,000 tiles or 50 MB**. Use **at most 4 parallel requests**. Identify your app. Attribution is required: "© OpenMapTiles Data from OpenStreetMap" (MapLibre's attribution control shows it automatically if it's in the source). |
| Elevation (hillshade, contours, missing GPX elevations) | **AWS Terrain Tiles, Terrarium encoding** (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`) | Free AWS Open Data with no account. maplibre-contour supports Terrarium natively. | Attribution per [tilezen/joerd attribution.md](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). The builder must read it and copy the required text. |

**Rejected sources, and why. Do not use them:**
- `tile.openstreetmap.org` and the OSMF vector tiles prohibit "save area for offline".
- MapTiler's free plan prohibits batch downloads.
- Thunderforest only allows pre-caching on the $255/mo plan.
- Mapbox GL JS terms restrict web caching.
- OpenTopoMap raster tiles prohibit bulk download.
- Protomaps daily builds discourage hotlinking and are limited to z15. They're a possible future fallback, but not for v1.

### 5.1 Zoom levels and download sizes
- The OpenFreeMap vector tiles go up to **z14**, and MapLibre over-zooms them sharply up to about z18. Read `maxzoom` from the TileJSON at runtime rather than hardcoding it.
- **Trail region:** basemap **z0–14** inside `bbox + buffer`. Add a **context ring** at **z0–10** inside `bbox + 50 km`, so zooming out offline still shows the surrounding region and towns.
- **DEM:** **z0–12** inside `bbox + buffer`. A z12 tile is about 7 km wide at 42° latitude, roughly 28 m per pixel, which is enough for 20 m contours and hillshade. Offer an optional "High-detail terrain" setting (z13) that is off by default.
- For the example trail with a 2 km buffer, the area is about 10 × 6 km, so expect roughly 40–80 basemap tiles plus about 10 DEM tiles: **a few MB in total**. Always compute and show the estimate before downloading.
- **Custom areas:** compute the tile list, then **split it into chunks of 2,500 tiles or less and an estimated 40 MB or less**, so you stay safely under the OpenFreeMap cap. Run the chunks one after another. Warn the user above 200 MB total, and block above 1 GB.

### 5.2 Tile versioning
The OpenFreeMap TileJSON points to **versioned tile URLs** (for example `/planet/2025MMDD_.../{z}/{x}/{y}.pbf`). When you download:
1. Fetch the TileJSON and store it with the region.
2. Download tiles from that exact versioned URL.
3. Store the tiles under the key `basemap/{version}/{z}/{x}/{y}`.

The offline style always uses the region's stored version. A later download that picks up a newer version must not break older regions: the tiles of each version coexist.

### 5.3 Fonts and sprites must be bundled, or labels vanish offline
This is the most common offline bug in MapLibre. The style's `glyphs` and `sprite` URLs must point to **files that ship with the app**, which the service worker precaches:
- Download the glyph PBFs for the font stacks the style uses (from OpenFreeMap's `/fonts/...`). Ship the ranges **0-255, 256-511 and 8192-8447** at least. They cover Spanish, Catalan, Portuguese and the common punctuation. Put them in `public/fonts/{fontstack}/{range}.pbf`.
- Copy the style's sprite (`sprite.json`, `sprite.png`, `@2x` variants) into `public/sprites/`.
- Check the license of each bundled font and sprite (OpenFreeMap styles are BSD/OFL-licensed). Keep the notices in `ATTRIBUTION.md`.

### 5.4 Style
Start from **OpenFreeMap "Liberty"**, vendored into `src/map/style.base.json`, and adapt it into an outdoor style:
- Paths and tracks (`transportation` layer, classes `path` and `track`) should be clearly visible from z12 as dashed brown or red lines.
- Show peaks from the `mountain_peak` layer with name and elevation.
- Draw the **hillshade** layer from the DEM below roads and labels, at about 0.3–0.5 opacity.
- Draw **contours** from maplibre-contour: thresholds `{11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [10, 50]}` (minor and major), with labels on the major lines and a thin brown color.
- Draw the **trail overlay** on top: a 5 px line with a white halo, a contrasting color (for example `#E5007D`), and direction arrows from z14.
- Leave 3D terrain **off**, because it costs too much GPU and battery.

### 5.5 Offline protocol
- Rewrite the sources in the generated style to `offline://basemap/{version}/{z}/{x}/{y}` and `offline://dem/{z}/{x}/{y}`.
- `maplibregl.addProtocol('offline', handler)` serves a tile like this:
  1. Look it up in the IndexedDB `tiles` store and return it if found.
  2. If it isn't stored and `navigator.onLine` is true, fetch it from the network and return it. Write-through is optional; only download jobs persist tiles.
  3. Otherwise return an empty tile: no error, and no endless retry spinners.
- maplibre-contour reads the DEM through its own fetcher. Configure its `DemSource` to read through the same offline lookup, using a custom URL or `getTile` hook. Verify that contours render in airplane mode.

### 5.6 Storage
- IndexedDB, with the tile Blob stored by key. On first launch in standalone mode, call `navigator.storage.persist()` and show the result. Also show `navigator.storage.estimate()` on the Storage screen.
- **Reference counting:** a tile can belong to several regions. Deleting a region only removes the tiles that no other region still references.
- Never clear the IndexedDB stores when the service worker or app shell updates. Migrations must be additive.

---

## 6. Feature specs and acceptance criteria

### 6.1 Install and first run
- A visitor in Safari (not standalone) sees an **install guide**: Share → Add to Home Screen. It explains that **trails and maps saved in the Safari tab are not shared with the Home Screen app**, so they should do everything from the Home Screen icon.
- The manifest uses `display: standalone`. Provide icons at 180/192/512, an `apple-touch-icon`, and a theme color. The app shell, style, fonts, sprites and JS must all be precached, so a cold launch in airplane mode works.
- A one-time warning in the onboarding and Storage screens: **"Deleting the app icon deletes all trails and maps."**
- **AC:** install on an iPhone, turn on airplane mode, force-quit the app, relaunch it. The library and a downloaded trail map render with labels, hillshade and contours.

### 6.2 GPX import
- An "Import GPX" button opens `<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml">`. **On iOS, test that `.gpx` files from Files and iCloud Drive aren't greyed out.** If they are, fall back to accepting all files and validate the content.
- Parse with `DOMParser` in a Web Worker if the file is over 1 MB. Keep the **original GPX text** with the trail record.
- Remove consecutive duplicate points. Keep segments separate.
- Compute and store: distance, cumulative distance per point, bbox, smoothed gain and loss, min and max elevation, whether it's a loop (start and end less than 100 m apart), and the point count.
- Name priority: `trk/name`, then `metadata/name`, then the file name.
- Errors: show a friendly message for a non-GPX file, an empty track, or an over-size file. Never crash.
- Offer "Download map for this trail now?" right after import, if online.
- **AC (example.gpx):** the name matches; 1 segment and 1205 points after dedupe; distance 17.25 km ± 0.1; min elevation 1636 m and max 2365 m (± 1); loop = true; smoothed gain between 800 and 970 m.

### 6.3 Library screen
- Each trail is a card: name, distance, gain, a small static line thumbnail (SVG from the geometry, no tiles needed), and an **offline status badge**: *Not downloaded*, *Downloading x%*, *Ready offline ✓*, or *Incomplete — retry*.
- Swipe or menu actions: rename, re-download map, delete trail (with an option to delete its map region too).
- Empty state: an explanation and the import button.

### 6.4 Download
- **Trail download sheet:** buffer choice (1 / **2** / 5 km), a "High-detail terrain" toggle, an estimate of tiles and MB, and a Download button.
- **Custom area:** in map view, a "Download area" mode where the user drags a rectangle with handles. It shows the live estimate and requires a name. It's usable without any trail.
- The downloader:
  - processes a persistent queue in IndexedDB, with at most **4 concurrent requests** and exponential-backoff retry (3 tries);
  - **resumes** after the app is closed or reopened (iOS suspends hidden PWAs, so tell the user to "Keep the app open while downloading", and use the Wake Lock API while a download runs, if available);
  - shows progress and bytes;
  - can be cancelled;
  - verifies the result at the end (every expected key is present). It records tiles that return 204/404 as "empty" so they count as complete.
- Identify the app to OpenFreeMap. Browsers can't set `User-Agent`, so see **OPEN-1**.
- **AC:** download the example trail, then turn on airplane mode. Panning and zooming anywhere inside bbox + 2 km at z10–18 shows basemap, hillshade, contours and labels with no blank tiles. Outside the area the map degrades gracefully: the z0–10 context still shows.

### 6.5 Trail screen: map and location
- On open, fit the map to the trail. Controls: **locate/follow** button (cycles off → follow → follow with heading), zoom, north reset, scale bar, attribution.
- **Location lifecycle (battery-critical):**
  - When the page is visible and the trail screen is mounted, call `navigator.geolocation.watchPosition(cb, err, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })`.
  - On `visibilitychange → hidden` and `pagehide`, call `clearWatch` right away. On visible again, restart and show the last-known fix greyed out until a fresh one arrives.
  - Throttle UI and progress updates to at most once per second, and ignore moves under 3 m.
  - **No Wake Lock by default.** Settings has an opt-in "Keep screen on while navigating", off by default.
  - The compass heading (`DeviceOrientationEvent.requestPermission()` on tap, `webkitCompassHeading`) is opt-in through the follow-with-heading mode, and stops when that mode is left.
  - Don't use timers or animation loops while idle. Don't use 3D terrain.
- Location permission UX: explain before the first prompt. If permission is denied, show how to enable it (Settings → Privacy → Location Services → Safari Websites → *While Using*). Expect iOS to re-prompt in standalone mode, and handle it gracefully.
- Show a GPS accuracy indicator (good below 15 m, fair below 50 m, poor otherwise).
- Show a small **offline/online indicator**.

### 6.6 Progress along the trail (`domain/progress.ts`)
- Project the fix onto the nearest trail segment and compute the **off-trail distance** and the **along-trail distance**.
- **Disambiguation for loops, out-and-backs and overlapping sections:**
  - Keep the last matched along-track distance (persisted per trail with a timestamp).
  - Prefer candidates within ±1 km of the last match, then the nearest overall.
  - On a first fix with no history, take the nearest point. If the trail is a loop and the fix is within 200 m of the start/end, assume the start.
- Add a **"Reverse direction"** toggle per trail, which flips the progress math and the profile.
- **Progress panel** (collapsible bottom sheet):
  - *Done* km, *Left* km and a % bar;
  - *Off trail: 85 m*, shown only when more than 30 m off; turns amber above 50 m and red above 150 m; shows the bearing to the nearest trail point;
  - *Elevation now*, from the GPS altitude if its accuracy is under 20 m, otherwise from the trail profile at the matched point;
  - *Ascent left / descent left* (smoothed);
  - *ETA*: Tobler's hiking function over the remaining profile, calibrated with a "pace factor" setting (0.7–1.5, default 1.0). Label it as an estimate.
- **AC:** unit tests with synthetic fixes on example.gpx:
  - a fix on the start point gives Done ≈ 0;
  - a fix at the highest point gives along ≈ that point's cumulative distance;
  - a fix 100 m perpendicular off a known segment gives off-trail ≈ 100 m ± 5;
  - loop disambiguation keeps a fix near the start/end at about 17.2 km when the last match was 16.8 km.
- If a GPX file has no elevation, sample the DEM tiles (Terrarium decode: `(R*256 + G + B/256) − 32768`) after the map is downloaded, and store the result as `elevationSource: 'dem'`.

### 6.7 Elevation profile (`domain/profile.ts` and the UI)
- The X axis is distance (km) and the Y axis elevation (m), auto-scaled with about 10% padding. Show labelled min/max lines, the start and end, and waypoints if present.
- Smoothing: resample to a fixed spacing of 10 m, then apply a moving average (window about 5) **or** a hysteresis threshold of about 5 m for gain and loss. Use the same algorithm for the stats and the chart.
- Show a **"You are here"** marker that matches the progress, with the completed portion shaded.
- **Scrubbing:** touch-dragging on the chart shows the distance, elevation and grade at that point, and puts a highlight dot on the map. The map doesn't move unless the user taps "Show on map".
- It must render 100k-point tracks smoothly: downsample to the screen width × 2.
- **AC:** the chart for example.gpx shows a 1636 to 2365 m range and a 17.2 km axis. Scrubbing at 60 fps feels responsive on an iPhone.

### 6.8 Storage and readiness
- The **Storage screen** lists regions with their name, type (trail or custom), size, date and basemap version, plus a delete action. It shows total usage and the persisted status.
- A **readiness check** button ("Check before trip") verifies:
  - the app shell is cached;
  - fonts and sprites are cached;
  - every region is complete;
  - storage is persisted;
  - location permission is granted.

  It shows a green or red checklist. This is the user's pre-departure ritual.

---

## 7. Data model (IndexedDB `trailkeep`, version 1)

```ts
type LatLonEle = [lat: number, lon: number, ele: number | null];

interface Trail {
  id: string;                 // uuid
  name: string;
  importedAt: number;
  fileName: string;
  gpxText: string;            // original, for future re-parse/export
  segments: LatLonEle[][];
  cumDist: number[][];        // meters, per segment, aligned with segments
  waypoints: { lat: number; lon: number; ele: number | null; name?: string; desc?: string }[];
  bbox: [minLon, minLat, maxLon, maxLat];
  stats: { distanceM: number; gainM: number; lossM: number; minEleM: number | null; maxEleM: number | null; isLoop: boolean; pointCount: number };
  elevationSource: 'gpx' | 'dem' | 'none';
  reversed: boolean;
  regionId?: string;
  lastMatch?: { alongM: number; at: number };
}

interface Region {
  id: string;
  name: string;
  kind: 'trail' | 'custom';
  trailId?: string;
  bbox: [number, number, number, number];   // already buffered
  contextBbox?: [number, number, number, number];
  basemap: { tilejsonUrl: string; version: string; tileUrlTemplate: string; minzoom: number; maxzoom: number; contextMaxzoom: number };
  dem: { tileUrlTemplate: string; maxzoom: number };
  status: 'queued' | 'downloading' | 'complete' | 'incomplete' | 'cancelled';
  expectedTiles: number; storedTiles: number; bytes: number;
  createdAt: number; completedAt?: number;
}

// store "tiles": key `${layer}/${version|'-'}/${z}/${x}/${y}` → { blob: Blob | null /* empty tile */, bytes: number, regionIds: string[] }
// store "queue": pending tile keys per region (for resume)
// store "settings": units, paceFactor, keepScreenOn, onboardingDone, ...
```

---

## 8. Milestones (build them in order; each one ends demoable and tested)

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Vite/React/TS scaffold, PWA manifest and service worker, GitHub Pages deploy through GitHub Actions, install guide screen | The deployed URL installs to the Home Screen and the shell opens in airplane mode |
| **M1** | `domain/gpx.ts`, `geo.ts`, `profile.ts` with unit tests; import UI; library screen; trail thumbnail | example.gpx passes the §6.2 AC |
| **M2** | Online map: vendored outdoor style, local fonts and sprites, OpenFreeMap basemap, AWS DEM hillshade and contours, trail overlay | The map looks like a topo map online |
| **M3** | `tiles.ts`, tileStore, downloader with resume, `offline://` protocol, trail download sheet, region status badges | §6.4 AC passes in airplane mode, including contours and labels |
| **M4** | Location lifecycle, `progress.ts` with tests, progress panel, follow and compass modes, reverse direction | §6.6 AC passes; GPS stops when the app is hidden (verify with a log and Playwright) |
| **M5** | Elevation profile with the you-are-here marker and scrubbing | §6.7 AC passes |
| **M6** | Custom-area download (rectangle tool and chunking), storage screen, readiness check, settings | Can download a 30 × 30 km custom area in chunks; the readiness check is all green |
| **M7** | Polish: dark mode, safe areas and notch, large tap targets (glove-friendly, 44 pt or more), sunlight-readable contrast, error states, attribution screen, an iPhone field test with the checklist in §9 | The user signs off |

---

## 9. Testing

- **Unit (Vitest):** GPX parsing (example.gpx, plus synthetic fixtures for rte, wpt, multi-segment, no-elevation, GPX 1.0, malformed); haversine and projection; progress disambiguation; profile gain and loss; tile enumeration and chunking (tile counts for known bboxes); Terrarium decode; the Tobler ETA.
- **E2E (Playwright, WebKit):**
  1. Import example.gpx and see the stats.
  2. Download the region; set `context.setOffline(true)` and reload; verify there are no failed tile requests and the canvas isn't blank.
  3. Mock the geolocation to a point on the trail and see the progress numbers.
  4. Fire `visibilitychange` and assert that `clearWatch` was called.
- **Manual iPhone checklist (before the user leaves):** install from the Home Screen, import from Files, download a trail, airplane mode with force-quit and relaunch, a walk outside with the app open (watch the dot and progress), lock the phone and confirm the location arrow in the status bar disappears, a 30-minute open-screen battery drain spot check, rotation, dark mode.
- Test with at least one **Argentine trail GPX**, for example in the El Chaltén or Bariloche area, to confirm the Southern and Western Hemisphere coordinate math and coverage (negative latitude and longitude).

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS evicts the PWA's data when storage is low | Request `persist()`; the readiness check shows its status; tell the user to keep a few GB free; GPX originals are kept, so a re-import is easy. |
| The user deletes the Home Screen icon, which wipes the data | A clear warning in onboarding and on the Storage screen. |
| Geolocation is re-prompted or flaky in standalone PWAs | Explanatory UI, the last-known fix shown, and a tested Settings deep explanation. |
| The fonts and sprites aren't cached, so labels are missing offline | Bundle them in the app shell (§5.3); the readiness check verifies them; an e2e offline test. |
| OpenFreeMap terms or URLs change, or the service goes down | Read the TileJSON at runtime; regions already downloaded don't depend on the server; keep source configuration in one file so it can be swapped for a Protomaps extract later. |
| iOS suspends a download when the app is hidden | Resumable queue, Wake Lock while downloading, and a "keep app open" banner. |
| GPS altitude is noisy | Prefer the trail profile elevation unless the GPS accuracy is good. |
| A service worker update breaks a working offline setup mid-trip | Only update on user confirmation ("Update available"); never touch IndexedDB on update; keep the shell backward compatible with DB v1. |

---

## 11. Open items (non-blocking; the builder should raise them with the user)

- **OPEN-1:** OpenFreeMap asks offline downloaders to send a unique `User-Agent`, which browsers can't set. Email `info@openfreemap.org` describing the personal PWA and ask how to identify it, for example with a custom header or query parameter, or whether the Referer/Origin header is enough. Until they answer, rely on the Origin header, and keep within 4 parallel requests and the per-download caps.
- **OPEN-2:** Confirm the AWS Terrain Tiles attribution text from tilezen/joerd, and that the CORS headers allow browser fetches from GitHub Pages.
- **OPEN-3:** The user needs a free GitHub account for Pages hosting, or Cloudflare Pages as an alternative. Ask which they prefer.
- **OPEN-4:** The app name "TrailKeep" is a placeholder. Ask the user.

---

## 12. User guide (ship it as an in-app Help page)

1. Open the app's URL in Safari, then Share → **Add to Home Screen**. From then on, always open it from the icon.
2. In AllTrails (free) or another site, download the trail's GPX to Files.
3. In the app, **Import GPX**, then **Download map** while you're on Wi-Fi. Wait for *Ready offline ✓*.
4. Optional: in map view, **Download area** to cover the drive in or the whole valley.
5. Before leaving: **Settings → Check before trip** should be all green. Then test it in airplane mode.
6. On the trail: open the app to see where you are. Lock the phone when you're done; GPS stops and saves battery.
