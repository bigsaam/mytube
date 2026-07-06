/**
 * Recommended-feed extraction — the ONLY place that parses YouTube's home-page
 * JSON. YouTube's shape drifts constantly, so parsing here is deliberately
 * defensive (deep-walk for `videoRenderer` rather than fixed paths) and fully
 * fixture-tested. The Playwright driving that fetches the JSON lives in
 * ./recommended-scraper.ts; this module stays pure and browser-free.
 */

export interface RecommendedItem {
	videoId: string;
	title: string;
	channelName: string | null;
	channelId: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
	isLive: boolean;
	isUpcoming: boolean;
	isShort: boolean;
	isMembersOnly: boolean;
	badges: string[];
}

export interface ExtractOptions {
	filterShorts?: boolean;
	filterLive?: boolean;
	filterMixes?: boolean; // mixes/playlists aren't videoRenderers, so mostly a no-op
}

/** Parse ytInitialData (or a browse continuation response) into items. */
export function extractRecommended(
	data: unknown,
	opts: ExtractOptions = {}
): RecommendedItem[] {
	const root = typeof data === 'string' ? safeJson(data) : data;
	if (!root || typeof root !== 'object') return [];

	const renderers = collectByKey(root as Record<string, unknown>, 'videoRenderer');
	const items: RecommendedItem[] = [];
	const seen = new Set<string>();

	for (const vr of renderers) {
		const item = parseVideoRenderer(vr);
		if (!item || seen.has(item.videoId)) continue;

		if (opts.filterShorts && item.isShort) continue;
		if (opts.filterLive && (item.isLive || item.isUpcoming)) continue;

		seen.add(item.videoId);
		items.push(item);
	}
	return items;
}

/** Parse a single videoRenderer object into a normalized item. */
export function parseVideoRenderer(vr: Record<string, unknown>): RecommendedItem | null {
	const videoId = str(vr.videoId);
	if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

	const title = runsText(vr.title) ?? simpleText(vr.title) ?? videoId;
	const channelName = runsText(vr.ownerText) ?? runsText(vr.longBylineText) ?? runsText(vr.shortBylineText);
	const channelId = bylineBrowseId(vr.ownerText) ?? bylineBrowseId(vr.longBylineText);

	const badges = collectBadges(vr);
	const overlayStyle = timeStatusStyle(vr);
	const isLive = overlayStyle === 'LIVE' || badges.includes('LIVE') || badges.includes('LIVE NOW');
	const isUpcoming = overlayStyle === 'UPCOMING' || !!vr.upcomingEventData;
	const isShort =
		overlayStyle === 'SHORTS' ||
		hasReelEndpoint(vr) ||
		badges.includes('SHORTS');
	const isMembersOnly = badges.some((b) => /member/i.test(b));

	const durationSeconds = isLive || isUpcoming ? null : lengthSeconds(vr);
	const thumbnailUrl = bestThumbnail(vr) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

	return {
		videoId,
		title,
		channelName,
		channelId,
		durationSeconds,
		thumbnailUrl,
		isLive,
		isUpcoming,
		isShort,
		isMembersOnly,
		badges
	};
}

/* --------------------------------------------------- structural helpers */

/**
 * Deep-walk collecting every object found under `key`, in document order
 * (which is YouTube's ranking — preserve it). Drift-resistant vs fixed paths.
 */
export function collectByKey(root: unknown, key: string): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	const seen = new Set<unknown>();
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const v of node) walk(v);
			return;
		}
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (k === key && v && typeof v === 'object' && !Array.isArray(v)) {
				out.push(v as Record<string, unknown>);
			}
			walk(v);
		}
	};
	walk(root);
	return out;
}

function lengthSeconds(vr: Record<string, unknown>): number | null {
	// lengthText.simpleText like "1:02:03" or thumbnail overlay time status.
	const fromLength = parseClock(simpleText(vr.lengthText));
	if (fromLength != null) return fromLength;
	const overlays = asArray(vr.thumbnailOverlays);
	for (const o of overlays) {
		const t = (o as Record<string, unknown>)?.thumbnailOverlayTimeStatusRenderer as
			| Record<string, unknown>
			| undefined;
		const clock = parseClock(simpleText(t?.text));
		if (clock != null) return clock;
	}
	return null;
}

function parseClock(text: string | null): number | null {
	if (!text) return null;
	const parts = text.split(':').map((p) => Number.parseInt(p.trim(), 10));
	if (parts.some((n) => !Number.isFinite(n))) return null;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 1) return parts[0];
	return null;
}

function bestThumbnail(vr: Record<string, unknown>): string | null {
	const thumb = vr.thumbnail as Record<string, unknown> | undefined;
	const arr = asArray(thumb?.thumbnails);
	const last = arr[arr.length - 1] as Record<string, unknown> | undefined;
	return str(last?.url);
}

function timeStatusStyle(vr: Record<string, unknown>): string | null {
	for (const o of asArray(vr.thumbnailOverlays)) {
		const t = (o as Record<string, unknown>)?.thumbnailOverlayTimeStatusRenderer as
			| Record<string, unknown>
			| undefined;
		if (t?.style) return String(t.style);
	}
	return null;
}

function collectBadges(vr: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const b of asArray(vr.badges)) {
		const label = str((b as Record<string, unknown>)?.metadataBadgeRenderer &&
			((b as Record<string, unknown>).metadataBadgeRenderer as Record<string, unknown>).label);
		if (label) out.push(label);
	}
	return out;
}

function hasReelEndpoint(vr: Record<string, unknown>): boolean {
	const nav = vr.navigationEndpoint as Record<string, unknown> | undefined;
	return !!nav?.reelWatchEndpoint;
}

function bylineBrowseId(byline: unknown): string | null {
	const runs = asArray((byline as Record<string, unknown>)?.runs);
	for (const r of runs) {
		const nav = (r as Record<string, unknown>)?.navigationEndpoint as Record<string, unknown> | undefined;
		const browse = nav?.browseEndpoint as Record<string, unknown> | undefined;
		const id = str(browse?.browseId);
		if (id && /^UC/.test(id)) return id;
	}
	return null;
}

/* ------------------------------------------------------- value helpers */

function runsText(v: unknown): string | null {
	const runs = asArray((v as Record<string, unknown>)?.runs);
	if (!runs.length) return null;
	const text = runs.map((r) => str((r as Record<string, unknown>)?.text) ?? '').join('');
	return text || null;
}
function simpleText(v: unknown): string | null {
	return str((v as Record<string, unknown>)?.simpleText);
}
function str(v: unknown): string | null {
	if (typeof v === 'string') return v.trim() || null;
	if (typeof v === 'number') return String(v);
	return null;
}
function asArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}
function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
