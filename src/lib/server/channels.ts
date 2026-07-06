import { eq, sql, desc } from 'drizzle-orm';
import { db } from './db';
import { channels, videos, feedItems, type Channel } from './db/schema';
import { resolveChannelId } from './ytdlp';
import { fetchChannelFeed } from './rss';
import { ingestEntries } from './feed';
import { enqueueJob } from './jobs';

/**
 * Channel subscriptions. Add by pasting a channel URL / handle / video URL
 * (resolved via yt-dlp) or bulk-import a Google Takeout subscriptions.csv.
 */

export interface AddChannelResult {
	status: 'added' | 'exists' | 'unresolved';
	channel?: Channel;
}

export async function addChannelFromInput(input: string): Promise<AddChannelResult> {
	const raw = input.trim();
	if (!raw) return { status: 'unresolved' };

	// Already a channel id?
	let channelId = /^UC[\w-]{20,}$/.test(raw) ? raw : null;
	let url = raw;
	if (!channelId) {
		if (!/^https?:\/\//.test(raw)) {
			// Treat as handle or /channel path.
			url = raw.startsWith('@')
				? `https://www.youtube.com/${raw}`
				: `https://www.youtube.com/${raw.replace(/^\//, '')}`;
		}
		channelId = await resolveChannelId(url);
	}
	if (!channelId) return { status: 'unresolved' };

	const existing = db.select().from(channels).where(eq(channels.id, channelId)).get();
	if (existing) return { status: 'exists', channel: existing };

	// First fetch gives us the channel name + seeds the feed.
	const feed = await fetchChannelFeed(channelId).catch(() => null);
	const name = feed?.channelName ?? channelId;

	db.insert(channels)
		.values({ id: channelId, name, url, handle: raw.startsWith('@') ? raw : null })
		.onConflictDoNothing()
		.run();
	const channel = db.select().from(channels).where(eq(channels.id, channelId)).get()!;

	if (feed) {
		ingestEntries(channel, feed.entries);
		db.update(channels).set({ lastPolledAt: new Date() }).where(eq(channels.id, channelId)).run();
	}
	return { status: 'added', channel };
}

/** Parse and import a Google Takeout subscriptions.csv. */
export async function importTakeoutCsv(csv: string): Promise<{ added: number; total: number }> {
	const rows = parseCsv(csv);
	if (!rows.length) return { added: 0, total: 0 };

	// Locate the Channel Id column (Takeout header: "Channel Id,Channel Url,Channel Title").
	const header = rows[0].map((c) => c.toLowerCase().trim());
	const idIdx = header.findIndex((h) => h === 'channel id');
	const titleIdx = header.findIndex((h) => h === 'channel title');
	const urlIdx = header.findIndex((h) => h === 'channel url');
	const dataRows = idIdx >= 0 ? rows.slice(1) : rows;

	let added = 0;
	for (const cols of dataRows) {
		const id = (idIdx >= 0 ? cols[idIdx] : cols[0])?.trim();
		if (!id || !/^UC[\w-]{20,}$/.test(id)) continue;
		const existing = db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).get();
		if (existing) continue;
		const title = (titleIdx >= 0 ? cols[titleIdx] : undefined)?.trim() || id;
		const url = (urlIdx >= 0 ? cols[urlIdx] : undefined)?.trim() || `https://www.youtube.com/channel/${id}`;
		db.insert(channels).values({ id, name: title, url }).onConflictDoNothing().run();
		// Poll shortly after import rather than blocking the request.
		enqueueJob('rss_poll', { channelId: id }, { dedupeKey: `rss:${id}` });
		added++;
	}
	return { added, total: dataRows.length };
}

export function setAutoGrab(channelId: string, autoGrab: boolean): void {
	db.update(channels).set({ autoGrab }).where(eq(channels.id, channelId)).run();
}

export function removeChannel(channelId: string): void {
	// Keep the library; just stop following and clear un-acted feed items.
	db.delete(feedItems)
		.where(sql`${feedItems.channelId} = ${channelId} and ${feedItems.status} in ('new','expired')`)
		.run();
	db.delete(channels).where(eq(channels.id, channelId)).run();
}

export interface ChannelRow {
	id: string;
	name: string;
	url: string;
	autoGrab: boolean;
	lastPolledAt: Date | null;
	videoCount: number;
}

export function listChannels(): ChannelRow[] {
	return db
		.select({
			id: channels.id,
			name: channels.name,
			url: channels.url,
			autoGrab: channels.autoGrab,
			lastPolledAt: channels.lastPolledAt,
			videoCount: sql<number>`(select count(*) from ${videos} v where v.channel_id = ${channels.id} and v.status = 'ready')`
		})
		.from(channels)
		.orderBy(desc(channels.autoGrab), channels.name)
		.all();
}

/* -------------------------------------------------------------------- csv */
// Minimal RFC-4180-ish parser (handles quotes, commas, CRLF). Good enough for
// Takeout exports, which are simple.
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += c;
		} else if (c === '"') inQuotes = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.some((f) => f !== '')) rows.push(row);
			row = [];
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		if (row.some((f) => f !== '')) rows.push(row);
	}
	return rows;
}
