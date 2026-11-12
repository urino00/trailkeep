// Display formatting: metric units, 24h clock (PLAN §2 defaults).

export function formatKm(meters: number, digits?: number): string {
  const km = meters / 1000;
  const d = digits ?? (km >= 100 ? 0 : km >= 10 ? 1 : 2);
  return `${km.toFixed(d)} km`;
}

/** Short distances in metres, longer ones in km. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return formatKm(meters);
}

export function formatMeters(m: number | null | undefined): string {
  return m === null || m === undefined || !Number.isFinite(m) ? '–' : `${Math.round(m)} m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export function formatGrade(slope: number): string {
  const pct = slope * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}
