// Parses large GPX files off the main thread (PLAN §6.2). The parser is pure TypeScript,
// so it needs no DOM here.
import { GpxError, parseGpx, type ParsedGpx } from '../domain/gpx';

export type GpxWorkerReply = { ok: true; parsed: ParsedGpx } | { ok: false; code: string; message: string };

self.onmessage = (e: MessageEvent<string>) => {
  let reply: GpxWorkerReply;
  try {
    reply = { ok: true, parsed: parseGpx(e.data) };
  } catch (err) {
    reply =
      err instanceof GpxError
        ? { ok: false, code: err.code, message: err.message }
        : { ok: false, code: 'not-gpx', message: 'This file could not be read as GPX.' };
  }
  (self as unknown as { postMessage(msg: GpxWorkerReply): void }).postMessage(reply);
};
