import { XMLParser } from 'fast-xml-parser';

/**
 * YouTube channel RSS. No API key required:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 * `parseFeed` is pure (fixture-tested); `fetchChannelFeed` is the network edge.
 */

export interface FeedEntry {
	videoId: string;
	title: string;
	publishedAt: Date | null;
	thumbnailUrl: string;
}

export interface ParsedFeed {
	channelId: string | null;
	channelName: string | null;
	entries: FeedEntry[];
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	// Keep <entry> as an array even when there's a single one.
	isArray: (name) => name === 'entry'
});

export function parseFeed(xml: string): ParsedFeed {
	const doc = parser.parse(xml) as Record<string, unknown>;
	const feed = (doc.feed ?? {}) as Record<string, unknown>;

	const channelId = str(feed['yt:channelId']) ?? channelIdFromAuthor(feed.author);
	const author = feed.author as Record<string, unknown> | undefined;
	const channelName = str(feed.title) ?? str(author?.name) ?? null;

	const rawEntries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
	const entries: FeedEntry[] = [];
	for (const e of rawEntries) {
		const videoId = str(e['yt:videoId']);
		if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
		const published = str(e.published);
		const group = e['media:group'] as Record<string, unknown> | undefined;
		const thumb = group?.['media:thumbnail'] as Record<string, unknown> | undefined;
		entries.push({
			videoId,
			title: str(e.title) ?? str((group?.['media:title'] as unknown)) ?? videoId,
			publishedAt: published ? new Date(published) : null,
			thumbnailUrl: str(thumb?.['@_url']) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
		});
	}
	return { channelId, channelName, entries };
}

export async function fetchChannelFeed(channelId: string): Promise<ParsedFeed> {
	const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
	const res = await fetch(url, {
		headers: { 'user-agent': 'Mozilla/5.0 Haystack/1.0', accept: 'application/atom+xml' },
		signal: AbortSignal.timeout(20_000)
	});
	if (res.status === 404) throw new Error(`channel ${channelId} not found (404)`);
	if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`);
	return parseFeed(await res.text());
}

function str(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') return v.trim() || null;
	if (typeof v === 'number') return String(v);
	// fast-xml-parser may wrap text nodes in objects with #text.
	if (typeof v === 'object' && '#text' in (v as object)) return str((v as { '#text': unknown })['#text']);
	return null;
}

function channelIdFromAuthor(author: unknown): string | null {
	const uri = str((author as Record<string, unknown>)?.uri);
	const m = uri?.match(/channel\/(UC[\w-]+)/);
	return m ? m[1] : null;
}
