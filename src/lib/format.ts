/** Pure display formatters shared by client and server. */

export function formatDuration(totalSeconds: number | null | undefined): string {
	if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
	const s = Math.floor(totalSeconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null || bytes <= 0) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let n = bytes;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(date: Date | number | null | undefined): string {
	if (date == null) return '';
	const t = typeof date === 'number' ? date : date.getTime();
	const diff = Date.now() - t;
	if (diff < 0) return 'just now';
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

/** "1:02:03" → seconds, for clickable description timestamps. */
export function timestampToSeconds(ts: string): number | null {
	const parts = ts.split(':').map((p) => Number.parseInt(p, 10));
	if (parts.some((n) => !Number.isFinite(n))) return null;
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	return null;
}
