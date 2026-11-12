import { describe, expect, it } from 'vitest';
import { GpxError, decodeEntities, fileBaseName, parseGpx } from '../../src/domain/gpx';
import { exampleGpxText, exampleTrail, gpx11, trailFromText } from './helpers';

describe('example.gpx (PLAN §6.2 acceptance criteria)', () => {
  const trail = exampleTrail();

  it('takes the name from trk/name inside CDATA', () => {
    expect(trail.name).toBe('Estany de Sant Maurici - Amitges - Obagues de Ratera');
  });

  // The file has 1206 <trkpt>, 48 of which repeat the point before them (the plan counted only
  // the duplicated first point and expected 1205). Removing every consecutive duplicate leaves 1158.
  it('has 1 segment and 1158 points after removing consecutive duplicates', () => {
    expect(trail.segments).toHaveLength(1);
    expect(trail.segments[0]).toHaveLength(1158);
    expect(trail.stats.pointCount).toBe(1158);
    const seg = trail.segments[0]!;
    for (let i = 1; i < seg.length; i++) {
      expect(seg[i]![0] === seg[i - 1]![0] && seg[i]![1] === seg[i - 1]![1]).toBe(false);
    }
  });

  it('measures 17.25 km ± 0.1', () => {
    expect(trail.stats.distanceM / 1000).toBeGreaterThan(17.15);
    expect(trail.stats.distanceM / 1000).toBeLessThan(17.35);
  });

  it('has min elevation 1636 m and max 2365 m (± 1)', () => {
    expect(Math.abs(trail.stats.minEleM! - 1636)).toBeLessThanOrEqual(1);
    expect(Math.abs(trail.stats.maxEleM! - 2365)).toBeLessThanOrEqual(1);
  });

  it('is a loop', () => {
    expect(trail.stats.isLoop).toBe(true);
  });

  it('has a smoothed gain between 800 and 970 m, and matching loss on a loop', () => {
    expect(trail.stats.gainM).toBeGreaterThan(800);
    expect(trail.stats.gainM).toBeLessThan(970);
    expect(Math.abs(trail.stats.gainM - trail.stats.lossM)).toBeLessThan(5);
  });

  it('keeps the original text, the bbox and no waypoints', () => {
    expect(trail.gpxText).toBe(exampleGpxText);
    expect(trail.waypoints).toHaveLength(0);
    expect(trail.elevationSource).toBe('gpx');
    expect(trail.bbox[0]).toBeCloseTo(0.97892, 4);
    expect(trail.bbox[1]).toBeCloseTo(42.57864, 4);
    expect(trail.bbox[2]).toBeCloseTo(1.04783, 4);
    expect(trail.bbox[3]).toBeCloseTo(42.59672, 4);
  });

  it('has cumulative distances aligned with the points', () => {
    expect(trail.cumDist[0]).toHaveLength(1158);
    expect(trail.cumDist[0]![0]).toBe(0);
    expect(trail.cumDist[0]![1157]).toBeCloseTo(trail.stats.distanceM, 6);
  });
});

describe('other GPX shapes', () => {
  it('converts <rte>/<rtept> routes to a line and uses the route name', () => {
    const t = trailFromText(
      gpx11(`<rte><name>My route</name>
        <rtept lat="-49.33" lon="-72.89"><ele>400</ele></rtept>
        <rtept lat="-49.32" lon="-72.90"><ele>500</ele></rtept>
        <rtept lat="-49.31" lon="-72.91"><ele>650</ele></rtept></rte>`),
    );
    expect(t.name).toBe('My route');
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0]).toHaveLength(3);
    expect(t.segments[0]![0]).toEqual([-49.33, -72.89, 400]);
    expect(t.stats.distanceM).toBeGreaterThan(2000);
  });

  it('keeps multiple tracks and segments separate', () => {
    const t = trailFromText(
      gpx11(`<trk><name>A</name>
        <trkseg><trkpt lat="10" lon="10"/><trkpt lat="10.001" lon="10"/></trkseg>
        <trkseg><trkpt lat="10.1" lon="10"/><trkpt lat="10.101" lon="10"/><trkpt lat="10.102" lon="10"/></trkseg></trk>
        <trk><name>B</name><trkseg><trkpt lat="11" lon="10"/><trkpt lat="11.001" lon="10"/></trkseg></trk>`),
    );
    expect(t.name).toBe('A');
    expect(t.segments.map((s) => s.length)).toEqual([2, 3, 2]);
    // Gaps between segments add no distance: ~111 m + ~222 m + ~111 m.
    expect(t.stats.distanceM).toBeGreaterThan(430);
    expect(t.stats.distanceM).toBeLessThan(460);
    expect(t.stats.isLoop).toBe(false);
  });

  it('reads waypoints with name, description and elevation', () => {
    const t = trailFromText(
      gpx11(`<wpt lat="42.5" lon="1.0"><ele>2100.5</ele><name>Refugi &amp; font</name><desc>Water here</desc></wpt>
        <wpt lat="42.6" lon="1.1"><name><![CDATA[Coll <alt>]]></name></wpt>
        <trk><trkseg><trkpt lat="42.5" lon="1.0"/><trkpt lat="42.6" lon="1.1"/></trkseg></trk>`),
    );
    expect(t.waypoints).toEqual([
      { lat: 42.5, lon: 1.0, ele: 2100.5, name: 'Refugi & font', desc: 'Water here' },
      { lat: 42.6, lon: 1.1, ele: null, name: 'Coll <alt>' },
    ]);
  });

  it('handles tracks with no elevation', () => {
    const t = trailFromText(gpx11(`<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.01" lon="1"/></trkseg></trk>`));
    expect(t.elevationSource).toBe('none');
    expect(t.stats.minEleM).toBeNull();
    expect(t.stats.maxEleM).toBeNull();
    expect(t.stats.gainM).toBe(0);
    expect(t.segments[0]![0]![2]).toBeNull();
  });

  it('ignores <time> and extensions', () => {
    const t = trailFromText(
      gpx11(`<trk><trkseg>
        <trkpt lat="1" lon="1"><ele>10</ele><time>2026-01-01T10:00:00Z</time><extensions><x:hr xmlns:x="u">120</x:hr></extensions></trkpt>
        <trkpt lat="1.01" lon="1"><ele>20</ele><time>2026-01-01T10:10:00Z</time></trkpt></trkseg></trk>`),
    );
    expect(t.segments[0]).toEqual([
      [1, 1, 10],
      [1.01, 1, 20],
    ]);
  });

  it('parses the GPX 1.0 namespace, where <name> sits directly under <gpx>', () => {
    const text = `<?xml version="1.0"?><gpx version="1.0" creator="old" xmlns="http://www.topografix.com/GPX/1/0">
      <name>Old style</name><trk><trkseg><trkpt lat="-41.1" lon="-71.3"><ele>800</ele></trkpt><trkpt lat="-41.2" lon="-71.4"><ele>900</ele></trkpt></trkseg></trk></gpx>`;
    const t = trailFromText(text);
    expect(t.name).toBe('Old style');
    expect(t.segments[0]).toHaveLength(2);
  });

  it('tolerates a BOM, leading whitespace, prefixes and single-quoted attributes', () => {
    const text = `﻿  \n<?xml version='1.0'?><g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>
      <g:trkpt lon='2' lat='1'/><g:trkpt lat="1.5" lon="2.5"></g:trkpt></g:trkseg></g:trk></g:gpx>`;
    const t = trailFromText(text, 'My Hike.GPX');
    expect(t.segments[0]).toEqual([
      [1, 2, null],
      [1.5, 2.5, null],
    ]);
    expect(t.name).toBe('My Hike');
  });

  it('falls back from trk/name to metadata/name to the file name', () => {
    const pts = `<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`;
    expect(trailFromText(gpx11(`<metadata><name>Meta</name></metadata>${pts}`)).name).toBe('Meta');
    expect(trailFromText(gpx11(pts), 'folder/cerro-torre.gpx').name).toBe('cerro-torre');
    expect(fileBaseName('.gpx')).toBe('Imported trail');
  });

  it('skips points with invalid coordinates', () => {
    const t = trailFromText(
      gpx11(`<trk><trkseg><trkpt lat="abc" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="91" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk>`),
    );
    expect(t.segments[0]).toHaveLength(2);
  });
});

describe('malformed input never crashes', () => {
  const code = (text: string) => {
    try {
      parseGpx(text);
    } catch (e) {
      return e instanceof GpxError ? e.code : `unexpected: ${String(e)}`;
    }
    return 'ok';
  };

  it('rejects non-GPX files', () => {
    expect(code('')).toBe('not-gpx');
    expect(code('hello world')).toBe('not-gpx');
    expect(code('{"type":"FeatureCollection"}')).toBe('not-gpx');
    expect(code('<?xml version="1.0"?><kml><Document/></kml>')).toBe('not-gpx');
    expect(code('%PDF-1.7 \u0000\u0001\u0002')).toBe('not-gpx');
  });

  it('rejects GPX with no usable track', () => {
    expect(code(gpx11(''))).toBe('empty');
    expect(code(gpx11('<trk><trkseg></trkseg></trk>'))).toBe('empty');
    expect(code(gpx11('<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>'))).toBe('empty');
    expect(code(gpx11('<wpt lat="1" lon="1"/>'))).toBe('empty');
  });

  it('survives truncated and mismatched markup', () => {
    expect(code(gpx11('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/>').replace('</gpx>', ''))).toBe('ok');
    expect(code('<gpx><trk><trkseg><trkpt lat="1" lon="1"><ele>5</trkpt><trkpt lat="2" lon="2"/></trk></gpx>')).toBe('ok');
    expect(code('<gpx><trk><trkseg><trkpt lat="1" lon="1"')).toBe('empty');
  });

  it('decodes XML entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#233; &#xE9; &quot;q&quot; &unknown;')).toBe('a & b <c> é é "q" &unknown;');
  });

  it('parses a 100k-point track quickly', () => {
    const pts: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      pts.push(`<trkpt lat="${(-49 + i * 0.00001).toFixed(6)}" lon="${(-72 - i * 0.00001).toFixed(6)}"><ele>${500 + (i % 300)}</ele></trkpt>`);
    }
    const start = performance.now();
    const t = trailFromText(gpx11(`<trk><name>Big</name><trkseg>${pts.join('\n')}</trkseg></trk>`));
    expect(t.stats.pointCount).toBe(100_000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
