// Attribution screen (PLAN M7). Mirrors ATTRIBUTION.md.
import { TopBar } from './components';

export function AboutScreen() {
  return (
    <div className="screen">
      <TopBar title="Map data & credits" />
      <main className="screen-body">
        <section className="card prose">
          <h3>Map</h3>
          <p>
            <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
              OpenFreeMap
            </a>{' '}
            ©{' '}
            <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
              OpenMapTiles
            </a>
            . Data from{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap
            </a>{' '}
            contributors, available under the Open Database License.
          </p>
          <p>
            Map style based on OSM Liberty (a fork of OSM Bright): code BSD 3-Clause, design CC BY 4.0. Icons from the Maki icon set
            (CC0 1.0). Fonts: Noto Sans, SIL Open Font License 1.1.
          </p>
        </section>

        <section className="card prose">
          <h3>Terrain (hillshade, contours, elevations)</h3>
          <p>
            Terrain Tiles hosted on AWS Open Data, produced by Mapzen from these sources (
            <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">
              full attribution
            </a>
            ):
          </p>
          <ul>
            <li>
              ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science
              Foundation awards 1043681, 1559691, and 1542736;
            </li>
            <li>Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;</li>
            <li>Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich;</li>
            <li>Canada terrain data contains information licensed under the Open Government Licence – Canada;</li>
            <li>
              Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;
            </li>
            <li>Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration</li>
            <li>Mexico terrain data source: INEGI, Continental relief, 2016;</li>
            <li>
              New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand
              Government (All rights reserved);
            </li>
            <li>Norway terrain data © Kartverket;</li>
            <li>
              United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved;
            </li>
            <li>
              United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.
            </li>
          </ul>
        </section>

        <section className="card prose">
          <h3>Software</h3>
          <ul>
            <li>MapLibre GL JS (BSD 3-Clause)</li>
            <li>maplibre-contour by Michael Barry (BSD 3-Clause)</li>
            <li>React (MIT), idb (ISC), Workbox (MIT), Vite (MIT)</li>
          </ul>
        </section>

        <section className="card prose">
          <h3>Privacy</h3>
          <p>
            TrailKeep has no accounts, no analytics and no ads. Your trails, maps and position stay on this phone. The only network
            requests are map downloads from OpenFreeMap and AWS.
          </p>
          <p className="muted small">
            Maps and elevation data can be wrong or out of date. Carry a paper map and do not rely on a phone alone in the mountains.
          </p>
        </section>
      </main>
    </div>
  );
}
