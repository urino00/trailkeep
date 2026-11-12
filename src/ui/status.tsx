// Offline status of a trail's map, shared by the library cards and the trail screen (PLAN §6.3).
import type { DownloadProgress } from '../data/downloader';
import type { Region } from '../domain/types';
import { IconAlert, IconCheck } from './icons';

export type OfflineStatus =
  | { kind: 'none' }
  | { kind: 'downloading'; fraction: number }
  | { kind: 'ready' }
  | { kind: 'incomplete' };

export function offlineStatus(
  regionId: string | undefined,
  regions: Region[],
  progress: ReadonlyMap<string, DownloadProgress>,
): OfflineStatus {
  if (!regionId) return { kind: 'none' };
  const region = regions.find((r) => r.id === regionId);
  if (!region) return { kind: 'none' };
  const live = progress.get(region.id);
  if (live && live.status === 'downloading') {
    return { kind: 'downloading', fraction: live.total > 0 ? live.done / live.total : 0 };
  }
  switch (region.status) {
    case 'complete':
      return { kind: 'ready' };
    case 'queued':
    case 'downloading':
      return { kind: 'downloading', fraction: region.expectedTiles > 0 ? region.storedTiles / region.expectedTiles : 0 };
    default:
      return { kind: 'incomplete' };
  }
}

export function OfflineBadge({ status }: { status: OfflineStatus }) {
  switch (status.kind) {
    case 'ready':
      return (
        <span className="badge ok">
          Ready offline <IconCheck />
        </span>
      );
    case 'downloading':
      return <span className="badge busy">Downloading {Math.round(status.fraction * 100)}%</span>;
    case 'incomplete':
      return (
        <span className="badge warn">
          <IconAlert /> Incomplete — retry
        </span>
      );
    default:
      return <span className="badge muted">Not downloaded</span>;
  }
}
