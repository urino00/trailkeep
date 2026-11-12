// GPX parsing. Pure TypeScript with its own small XML scanner, so the same code runs on the main
// thread, in a Web Worker (where DOMParser does not exist) and in Node unit tests.
import { emptyBbox, extendBbox, haversine } from './geo';
import { buildProfile } from './profile';
import type { LatLonEle, Trail, Waypoint } from './types';

export const MAX_GPX_BYTES = 25 * 1024 * 1024;
export const MAX_GPX_POINTS = 400_000;

export type GpxErrorCode = 'not-gpx' | 'empty' | 'too-large';

export class GpxError extends Error {
  code: GpxErrorCode;
  constructor(code: GpxErrorCode, message: string) {
    super(message);
    this.name = 'GpxError';
    this.code = code;
  }
}

export interface ParsedGpx {
  trackName: string | null;
  routeName: string | null;
  metadataName: string | null;
  segments: LatLonEle[][];
  waypoints: Waypoint[];
}

// ---------------------------------------------------------------------------------------------
// Minimal, forgiving XML scanner: elements, attributes, text, CDATA, comments, PIs, entities.
// ---------------------------------------------------------------------------------------------

interface XmlHandler {
  open(name: string, attrs: (name: string) => string | undefined): void;
  close(name: string): void;
  text(text: string): void;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return (i === -1 ? qname : qname.slice(i + 1)).toLowerCase();
}

const ATTR_RE = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function scanXml(src: string, h: XmlHandler): void {
  const n = src.length;
  let pos = 0;
  while (pos < n) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) {
      h.text(src.slice(pos));
      break;
    }
    if (lt > pos) h.text(src.slice(pos, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      pos = end === -1 ? n : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      h.text('\u0000' + src.slice(lt + 9, end === -1 ? n : end)); // \u0000 marks "already literal"
      pos = end === -1 ? n : end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      pos = end === -1 ? n : end + 2;
    } else if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      pos = end === -1 ? n : end + 1;
    } else if (src.charCodeAt(lt + 1) === 47 /* / */) {
      const end = src.indexOf('>', lt + 2);
      if (end === -1) break;
      h.close(localName(src.slice(lt + 2, end).trim()));
      pos = end + 1;
    } else {
      // Opening tag: find the closing '>' that is not inside a quoted attribute value.
      let i = lt + 1;
      let quote = 0;
      for (; i < n; i++) {
        const c = src.charCodeAt(i);
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === 34 || c === 39) {
          quote = c;
        } else if (c === 62) {
          break;
        }
      }
      if (i >= n) break;
      let body = src.slice(lt + 1, i);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const nameEnd = body.search(/[\s/]/);
      const name = localName(nameEnd === -1 ? body : body.slice(0, nameEnd));
      const attrText = nameEnd === -1 ? '' : body.slice(nameEnd);
      if (name) {
        h.open(name, (wanted) => {
          ATTR_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = ATTR_RE.exec(attrText))) {
            if (localName(m[1]!) === wanted) return decodeEntities(m[2] ?? m[3] ?? '');
          }
          return undefined;
        });
        if (selfClosing) h.close(name);
      }
      pos = i + 1;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// GPX → segments + waypoints
// ---------------------------------------------------------------------------------------------

function parseCoord(v: string | undefined, limit: number): number | null {
  if (v === undefined) return null;
  const x = Number(v.trim());
  return Number.isFinite(x) && Math.abs(x) <= limit ? x : null;
}

const TEXT_ELEMENTS = new Set(['name', 'desc', 'cmt', 'ele']);

/** Parse GPX 1.0 / 1.1 text. Throws {@link GpxError} for anything that is not a usable GPX file. */
export function parseGpx(input: string): ParsedGpx {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > MAX_GPX_BYTES) throw new GpxError('too-large', 'This file is too large to import.');
  if (!/<([a-zA-Z0-9_]+:)?gpx[\s>]/i.test(text.slice(0, 4096))) {
    throw new GpxError('not-gpx', 'This does not look like a GPX file.');
  }

  const out: ParsedGpx = { trackName: null, routeName: null, metadataName: null, segments: [], waypoints: [] };
  const stack: string[] = [];
  let curSeg: LatLonEle[] | null = null;
  let curPt: LatLonEle | null = null;
  let curWpt: Waypoint | null = null;
  let capture: string | null = null;
  let pointCount = 0;

  const flushSeg = () => {
    if (curSeg && curSeg.length) out.segments.push(curSeg);
    curSeg = null;
  };

  scanXml(text, {
    open(name, attr) {
      stack.push(name);
      if (name === 'trkseg' || name === 'rte') {
        flushSeg();
        curSeg = [];
      } else if (name === 'trkpt' || name === 'rtept') {
        const lat = parseCoord(attr('lat'), 90);
        const lon = parseCoord(attr('lon'), 180);
        curPt = lat !== null && lon !== null ? [lat, lon, null] : null;
        if (!curSeg) curSeg = []; // <trkpt> outside <trkseg> in sloppy files
      } else if (name === 'wpt') {
        const lat = parseCoord(attr('lat'), 90);
        const lon = parseCoord(attr('lon'), 180);
        curWpt = lat !== null && lon !== null ? { lat, lon, ele: null } : null;
      } else if (name === 'trk') {
        flushSeg();
      }
      capture = TEXT_ELEMENTS.has(name) ? '' : null;
    },
    text(t) {
      if (capture === null) return;
      capture += t.charCodeAt(0) === 0 ? t.slice(1) : decodeEntities(t);
    },
    close(name) {
      // Tolerate mismatched tags: unwind to the nearest matching open element.
      const idx = stack.lastIndexOf(name);
      if (idx === -1) return;
      stack.length = idx;
      const parent = stack[stack.length - 1];
      const value = capture === null ? '' : capture.trim();
      capture = null;

      if (name === 'ele') {
        const ele = value === '' ? NaN : Number(value);
        if (Number.isFinite(ele)) {
          if ((parent === 'trkpt' || parent === 'rtept') && curPt) curPt[2] = ele;
          else if (parent === 'wpt' && curWpt) curWpt.ele = ele;
        }
      } else if (name === 'name') {
        if (!value) return;
        if (parent === 'trk') out.trackName ??= value;
        else if (parent === 'rte') out.routeName ??= value;
        else if (parent === 'metadata' || parent === 'gpx') out.metadataName ??= value;
        else if (parent === 'wpt' && curWpt) curWpt.name = value;
      } else if (name === 'desc' || name === 'cmt') {
        if (value && parent === 'wpt' && curWpt && !curWpt.desc) curWpt.desc = value;
      } else if (name === 'trkpt' || name === 'rtept') {
        if (curPt && curSeg) {
          const prev = curSeg[curSeg.length - 1];
          // Drop consecutive duplicates (AllTrails repeats the first point).
          if (!prev || prev[0] !== curPt[0] || prev[1] !== curPt[1]) {
            curSeg.push(curPt);
            if (++pointCount > MAX_GPX_POINTS) throw new GpxError('too-large', 'This track has too many points to import.');
          } else if (prev[2] === null && curPt[2] !== null) {
            prev[2] = curPt[2];
          }
        }
        curPt = null;
      } else if (name === 'trkseg' || name === 'rte') {
        flushSeg();
      } else if (name === 'wpt') {
        if (curWpt) out.waypoints.push(curWpt);
        curWpt = null;
      }
    },
  });
  flushSeg();

  // A one-point "line" cannot be drawn or measured.
  out.segments = out.segments.filter((s) => s.length >= 2);
  if (out.segments.length === 0) {
    throw new GpxError('empty', 'This GPX file has no track or route to show.');
  }
  return out;
}

export function fileBaseName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(gpx|xml)$/i, '').trim();
  return base || 'Imported trail';
}

/** Cumulative distance in metres along one segment. */
export function cumulativeDistance(seg: LatLonEle[]): number[] {
  const out = new Array<number>(seg.length);
  out[0] = 0;
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1]!;
    const b = seg[i]!;
    out[i] = out[i - 1]! + haversine(a[0], a[1], b[0], b[1]);
  }
  return out;
}

export const LOOP_THRESHOLD_M = 100;

/** Everything derived from the geometry: distances, bbox and stats. Used on import and after DEM fill. */
export function computeTrailDerived(segments: LatLonEle[][]): Pick<Trail, 'cumDist' | 'bbox' | 'stats' | 'elevationSource'> {
  const cumDist = segments.map(cumulativeDistance);
  const bbox = emptyBbox();
  let pointCount = 0;
  let distanceM = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let withEle = 0;
  segments.forEach((seg, si) => {
    distanceM += cumDist[si]![seg.length - 1]!;
    for (const p of seg) {
      extendBbox(bbox, p[0], p[1]);
      pointCount++;
      if (p[2] !== null) {
        withEle++;
        if (p[2] < minEle) minEle = p[2];
        if (p[2] > maxEle) maxEle = p[2];
      }
    }
  });

  const first = segments[0]![0]!;
  const lastSeg = segments[segments.length - 1]!;
  const last = lastSeg[lastSeg.length - 1]!;
  const isLoop = distanceM > 3 * LOOP_THRESHOLD_M && haversine(first[0], first[1], last[0], last[1]) < LOOP_THRESHOLD_M;

  const profile = buildProfile(segments, cumDist);
  return {
    cumDist,
    bbox,
    elevationSource: withEle > 0 ? 'gpx' : 'none',
    stats: {
      distanceM,
      gainM: profile ? profile.gainM : 0,
      lossM: profile ? profile.lossM : 0,
      minEleM: withEle > 0 ? minEle : null,
      maxEleM: withEle > 0 ? maxEle : null,
      isLoop,
      pointCount,
    },
  };
}

/** Turn parsed GPX into a storable Trail record. */
export function buildTrail(parsed: ParsedGpx, opts: { id: string; fileName: string; gpxText: string; now: number }): Trail {
  const derived = computeTrailDerived(parsed.segments);
  return {
    id: opts.id,
    name: parsed.trackName ?? parsed.routeName ?? parsed.metadataName ?? fileBaseName(opts.fileName),
    importedAt: opts.now,
    fileName: opts.fileName,
    gpxText: opts.gpxText,
    segments: parsed.segments,
    waypoints: parsed.waypoints,
    reversed: false,
    ...derived,
  };
}
