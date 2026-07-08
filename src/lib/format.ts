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

/** Compact engagement count: 1234 → "1.2K", 3_400_000 → "3.4M". */
export function formatCount(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n) || n < 0) return '';
	if (n < 1000) return String(n);
	for (const [suffix, div] of [
		['B', 1e9],
		['M', 1e6],
		['K', 1e3]
	] as const) {
		if (n >= div) {
			const v = n / div;
			return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${suffix}`;
		}
	}
	return String(n);
}

/** Human "time until" a future date: "in 29d", "in 3h"; "expired" if past. */
export function formatUntil(date: Date | number | null | undefined): string {
	if (date == null) return '';
	const t = typeof date === 'number' ? date : date.getTime();
	const diff = t - Date.now();
	if (diff <= 0) return 'expired';
	const mins = Math.floor(diff / 60000);
	if (mins < 60) return `in ${Math.max(1, mins)}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `in ${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `in ${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `in ${months}mo`;
	return `in ${Math.floor(months / 12)}y`;
}

/** "1:02:03" → seconds, for clickable description timestamps. */
export function timestampToSeconds(ts: string): number | null {
	const parts = ts.split(':').map((p) => Number.parseInt(p, 10));
	if (parts.some((n) => !Number.isFinite(n))) return null;
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	return null;
}

export type DescPart = { text: string; seconds: number | null };

/**
 * Split a description into plain-text and clickable-timestamp parts. A run is a
 * timestamp only if it looks like m:ss or h:mm:ss on a token boundary.
 */
export function parseDescription(text: string): DescPart[] {
	if (!text) return [];
	const re = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
	const parts: DescPart[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > last) parts.push({ text: text.slice(last, m.index), seconds: null });
		parts.push({ text: m[1], seconds: timestampToSeconds(m[1]) });
		last = m.index + m[1].length;
	}
	if (last < text.length) parts.push({ text: text.slice(last), seconds: null });
	return parts;
}
