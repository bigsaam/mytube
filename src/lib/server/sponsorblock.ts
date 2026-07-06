import type { SponsorSegment } from './db/schema';

/**
 * SponsorBlock client. We fetch segment metadata and store it; we never cut the
 * file. The player renders/skips segments client-side (auto-skip is a toggle).
 *
 * Privacy note: SponsorBlock's API supports querying by a SHA-256 hash prefix of
 * the video id so the full id never leaves the box. We use that endpoint.
 */

const API = 'https://sponsor.ajay.app';

export async function fetchSponsorSegments(
	videoId: string,
	categories: string[]
): Promise<SponsorSegment[]> {
	if (!categories.length) return [];
	try {
		const hashPrefix = (await sha256Hex(videoId)).slice(0, 4);
		const params = new URLSearchParams();
		params.set('categories', JSON.stringify(categories));
		const res = await fetch(`${API}/api/skipSegments/${hashPrefix}?${params}`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status === 404) return []; // no segments for this hash bucket
		if (!res.ok) return [];
		const buckets = (await res.json()) as Array<{
			videoID: string;
			segments: Array<{ category: string; segment: [number, number]; UUID?: string }>;
		}>;
		const mine = buckets.find((b) => b.videoID === videoId);
		if (!mine) return [];
		return mine.segments
			.filter((s) => Array.isArray(s.segment) && s.segment.length === 2)
			.map((s) => ({
				category: s.category,
				start: s.segment[0],
				end: s.segment[1],
				uuid: s.UUID
			}))
			.sort((a, b) => a.start - b.start);
	} catch {
		// SponsorBlock is best-effort; never fail a download over it.
		return [];
	}
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
