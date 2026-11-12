import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTrail, parseGpx } from '../../src/domain/gpx';
import type { Trail } from '../../src/domain/types';

export const exampleGpxText = readFileSync(fileURLToPath(new URL('../fixtures/example.gpx', import.meta.url)), 'utf8');

export function trailFromText(text: string, fileName = 'test.gpx'): Trail {
  return buildTrail(parseGpx(text), { id: 't1', fileName, gpxText: text, now: 0 });
}

export function exampleTrail(): Trail {
  return trailFromText(exampleGpxText, 'example.gpx');
}

export const gpx11 = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">${body}</gpx>`;
