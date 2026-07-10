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

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_ENTITY_PREFIX = 'shorts-shelf-item-';

/**
 * Item shapes YouTube uses, newest first. The home feed migrated from
 * `videoRenderer` to the `*ViewModel` family; other surfaces still emit the
 * old shape, so we parse all of them and preserve document order (= ranking).
 */
const FEED_ITEM_KEYS = ['videoRenderer', 'lockupViewModel', 'shortsLockupViewModel'];

/** Parse ytInitialData (or a browse continuation response) into items. */
export function extractRecommended(
	data: unknown,
	opts: ExtractOptions = {}
): RecommendedItem[] {
	const root = typeof data === 'string' ? safeJson(data) : data;
	if (!root || typeof root !== 'object') return [];

	const nodes = collectByKeys(root as Record<string, unknown>, FEED_ITEM_KEYS);
	const items: RecommendedItem[] = [];
	const seen = new Set<string>();

	for (const { key, node } of nodes) {
		const item =
			key === 'videoRenderer'
				? parseVideoRenderer(node)
				: key === 'lockupViewModel'
					? parseLockupViewModel(node)
					: parseShortsLockupViewModel(node);
		if (!item || seen.has(item.videoId)) continue;

		if (opts.filterShorts && item.isShort) continue;
		if (opts.filterLive && (item.isLive || item.isUpcoming)) continue;

		seen.add(item.videoId);
		items.push(item);
	}
	return items;
}

/**
 * Parse the modern home-feed item. Returns null for anything that isn't a plain
 * video — notably **sponsored items**, which YouTube injects as lockups carrying
 * `feedAdMetadataViewModel`. An ad-free library must never ingest those.
 */
export function parseLockupViewModel(lv: Record<string, unknown>): RecommendedItem | null {
	const meta = obj(lv.metadata);
	if (meta?.feedAdMetadataViewModel) return null; // advertisement
	const lm = obj(meta?.lockupMetadataViewModel);
	if (!lm) return null;

	// Ads omit contentType; playlists/mixes/channels use other values.
	const contentType = str(lv.contentType);
	if (contentType && contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;

	const videoId = str(lv.contentId);
	if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;

	const title = str(obj(lm.title)?.content) ?? videoId;

	// metadataRows[0] = channel (with a browseEndpoint); [1] = views · published.
	const rows = asArray(obj(obj(lm.metadata)?.contentMetadataViewModel)?.metadataRows);
	const firstPart = obj(asArray(obj(rows[0])?.metadataParts)[0]);
	const channelName = str(obj(firstPart?.text)?.content);
	// Home-feed lockups carry the channel's browseEndpoint on the metadata text's
	// `commandRuns`. Watch-page ("up next") lockups do NOT — but they hang the same
	// browseId off the channel avatar. Try both before giving up.
	const channelId =
		browseIdFromCommandRuns(obj(firstPart?.text)?.commandRuns) ?? browseIdFromAvatar(lm);

	const thumb = obj(obj(lv.contentImage)?.thumbnailViewModel);
	const badges = thumbnailBadges(thumb);
	const isLive = badges.some((b) => /LIVE/i.test(b.style) || /^live$/i.test(b.text));
	const isUpcoming = badges.some((b) => /UPCOMING/i.test(b.style));
	const isMembersOnly = badges.some((b) => /member/i.test(b.text));
	const durationSeconds =
		isLive || isUpcoming ? null : (badges.map((b) => parseClock(b.text)).find((n) => n != null) ?? null);

	return {
		videoId,
		title,
		channelName,
		channelId,
		durationSeconds,
		thumbnailUrl: bestSource(thumb) ?? fallbackThumb(videoId),
		isLive,
		isUpcoming,
		isShort: false,
		isMembersOnly,
		badges: badges.map((b) => b.text).filter(Boolean)
	};
}

/** Shorts shelf items. Marked `isShort` so the existing filter can drop them. */
export function parseShortsLockupViewModel(sl: Record<string, unknown>): RecommendedItem | null {
	const cmd = obj(obj(sl.onTap)?.innertubeCommand);
	// NB: strip the known prefix rather than splitting on '-' — video ids may
	// legally contain '-' and '_'.
	const entityId = str(sl.entityId);
	const fromEntity = entityId?.startsWith(SHORTS_ENTITY_PREFIX)
		? entityId.slice(SHORTS_ENTITY_PREFIX.length)
		: null;
	const videoId =
		str(obj(cmd?.reelWatchEndpoint)?.videoId) ?? str(obj(cmd?.watchEndpoint)?.videoId) ?? fromEntity;
	if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;

	const thumb = obj(sl.thumbnailViewModel);
	return {
		videoId,
		title: str(obj(obj(sl.overlayMetadata)?.primaryText)?.content) ?? videoId,
		channelName: null,
		channelId: null,
		durationSeconds: null,
		thumbnailUrl: bestSource(thumb) ?? fallbackThumb(videoId),
		isLive: false,
		isUpcoming: false,
		isShort: true,
		isMembersOnly: false,
		badges: ['SHORTS']
	};
}

/* ------------------------------------------------- view-model value helpers */

function fallbackThumb(videoId: string): string {
	return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Highest-resolution thumbnail from a thumbnailViewModel (sources ascend). */
function bestSource(thumb: Record<string, unknown> | null): string | null {
	const sources = asArray(obj(thumb?.image)?.sources);
	return str(obj(sources[sources.length - 1])?.url);
}

interface ThumbBadge {
	text: string;
	style: string;
}
/** Overlay badges carry duration ("21:51") and live/upcoming styles. */
function thumbnailBadges(thumb: Record<string, unknown> | null): ThumbBadge[] {
	const out: ThumbBadge[] = [];
	for (const overlay of asArray(thumb?.overlays)) {
		const bottom = obj(obj(overlay)?.thumbnailBottomOverlayViewModel);
		for (const b of asArray(bottom?.badges)) {
			const badge = obj(obj(b)?.thumbnailBadgeViewModel);
			if (!badge) continue;
			out.push({ text: str(badge.text) ?? '', style: str(badge.badgeStyle) ?? '' });
		}
	}
	return out;
}

function browseIdFromCommandRuns(commandRuns: unknown): string | null {
	for (const run of asArray(commandRuns)) {
		const browse = obj(obj(obj(obj(run)?.onTap)?.innertubeCommand)?.browseEndpoint);
		const id = str(browse?.browseId);
		if (id && /^UC/.test(id)) return id;
	}
	return null;
}

/** Watch-page lockups hide the channel browseId on the avatar, not the text. */
function browseIdFromAvatar(lockupMetadata: Record<string, unknown> | null): string | null {
	const avatar = obj(obj(lockupMetadata?.image)?.decoratedAvatarViewModel);
	const browse = obj(
		obj(obj(obj(obj(avatar?.rendererContext)?.commandContext)?.onTap)?.innertubeCommand)?.browseEndpoint
	);
	const id = str(browse?.browseId);
	return id && /^UC/.test(id) ? id : null;
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
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

/* ------------------------------------------------------ drift diagnostics */

/**
 * Renderer/view-model keys YouTube has used for feed items over time. Only used
 * for diagnostics: when a scrape yields 0 items we tally these so the logs say
 * *what* YouTube actually returned instead of leaving a silent zero.
 */
const RENDERER_KEYS = [
	'videoRenderer',
	'richItemRenderer',
	'gridVideoRenderer',
	'compactVideoRenderer',
	'reelItemRenderer',
	'lockupViewModel',
	'videoLockupViewModel',
	'shortsLockupViewModel',
	'playlistRenderer',
	'radioRenderer',
	'movieRenderer',
	'promotedVideoRenderer',
	'richGridRenderer',
	'shelfRenderer'
] as const;

/** Count occurrences of each known feed-item key. One traversal, cycle-safe. */
export function countRendererKeys(data: unknown): Record<string, number> {
	const root = typeof data === 'string' ? safeJson(data) : data;
	const counts: Record<string, number> = {};
	const seen = new Set<unknown>();
	const known = new Set<string>(RENDERER_KEYS);
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const v of node) walk(v);
			return;
		}
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (known.has(k)) counts[k] = (counts[k] ?? 0) + 1;
			walk(v);
		}
	};
	walk(root);
	return counts;
}

/** "videoRenderer=0, lockupViewModel=24, richItemRenderer=24" (top keys first). */
export function summarizeRenderers(counts: Record<string, number>): string {
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return entries.length ? entries.map(([k, n]) => `${k}=${n}`).join(', ') : 'none';
}

/* --------------------------------------------------- structural helpers */

export interface KeyedNode {
	key: string;
	node: Record<string, unknown>;
}

/**
 * Deep-walk collecting every object found under any of `keys`, in document
 * order (which is YouTube's ranking — preserve it). Drift-resistant vs fixed
 * paths: when YouTube renames a wrapper, only the key list changes.
 */
export function collectByKeys(root: unknown, keys: string[]): KeyedNode[] {
	const wanted = new Set(keys);
	const out: KeyedNode[] = [];
	const seen = new Set<unknown>();
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const v of node) walk(v);
			return;
		}
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (wanted.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
				out.push({ key: k, node: v as Record<string, unknown> });
			}
			walk(v);
		}
	};
	walk(root);
	return out;
}

/** Single-key convenience wrapper over {@link collectByKeys}. */
export function collectByKey(root: unknown, key: string): Record<string, unknown>[] {
	return collectByKeys(root, [key]).map((m) => m.node);
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
