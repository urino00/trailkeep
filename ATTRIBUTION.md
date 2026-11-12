# Attribution and licenses

Terms were re-checked on **2026-11-12**. Re-check them if you change map sources (all source URLs live in `src/map/sources.ts`). The same credits are shown in the app under **Settings → Map data & credits**, and the map itself carries the attribution control.

## Map data

| What | Source | Terms / license |
|---|---|---|
| Vector basemap tiles | [OpenFreeMap](https://openfreemap.org), `https://tiles.openfreemap.org/planet` | [Terms of Service](https://openfreemap.org/tos/). Offline downloads are allowed when each download is at most 3,000 tiles or 50 MB, uses at most 4 parallel requests, and sends a unique User-Agent identifying the app. |
| Tile schema | [OpenMapTiles](https://www.openmaptiles.org/) | Code BSD 3-Clause, design CC BY 4.0. Attribution "© OpenMapTiles" required. |
| Underlying data | [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | Open Database License (ODbL). Attribution required. |
| Elevation tiles | [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/), Terrarium encoding, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Attribution per [tilezen/joerd attribution.md](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), reproduced below. CORS is open (`Access-Control-Allow-Origin: *`), verified 2026-11-12. |

Required map attribution, shown on the map: **OpenFreeMap © OpenMapTiles Data from OpenStreetMap**.

How the app stays inside OpenFreeMap's offline limits: downloads are split into chunks of at most 2,500 tiles and an estimated 40 MB, run one after another with at most 4 parallel requests. Browsers cannot set the `User-Agent` header, so the app is identified by the `Origin` / `Referer` the browser sends (see DEPLOY.md, open item OPEN-1).

### Terrain data attribution (required text)

* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736;
* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich;
* Canada terrain data contains information licensed under the Open Government Licence – Canada;
* Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;
* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
* Mexico terrain data source: INEGI, Continental relief, 2016;
* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved);
* Norway terrain data © Kartverket;
* United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved;
* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.

## Files bundled with the app

| Files | Origin | License |
|---|---|---|
| `src/map/style.base.json` | OpenFreeMap "Liberty" style (`https://tiles.openfreemap.org/styles/liberty`), a fork of [OSM Liberty](https://github.com/maputnik/osm-liberty), itself a fork of OSM Bright | Code BSD 3-Clause, design CC BY 4.0. OpenFreeMap's own changes: MIT. Modified here into an outdoor style by `src/map/style.ts`. |
| `public/sprites/ofm*.png`, `ofm*.json` | OpenFreeMap sprite sheet `ofm_f384` | Icons from the [Maki](https://github.com/mapbox/maki) set, CC0 1.0. The arrow icon is public domain (Wikimedia Commons). |
| `public/fonts/Noto Sans {Regular,Bold,Italic}/*.pbf` | Glyph ranges of [Noto Sans](https://fonts.google.com/noto), downloaded from OpenFreeMap's `/fonts/` endpoint | SIL Open Font License 1.1 |
| `public/icons/*` | Drawn for this project by `scripts/make-icons.mjs` | Same as this project |

Refresh the style, sprites and fonts with `npm run assets:map`.

## Software

| Package | License |
|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD 3-Clause |
| [maplibre-contour](https://github.com/onthegomap/maplibre-contour) | BSD 3-Clause |
| [React](https://react.dev) | MIT |
| [idb](https://github.com/jakearchibald/idb) | ISC |
| [Workbox](https://github.com/GoogleChrome/workbox), [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa), [Vite](https://vite.dev) | MIT |

## Sources that must not be used

Checked and rejected because their terms forbid saving areas for offline use or bulk downloading: `tile.openstreetmap.org` and the OSMF vector tiles, MapTiler's free plan, Thunderforest (below the paid pre-caching plan), Mapbox GL JS / Mapbox tiles, OpenTopoMap raster tiles.
