import crypto from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from './db';
import { shares, videos, type Share } from './db/schema';

/**
 * Per-video share links. A share is a scoped, revocable, optionally-expiring
 * grant to read ONE video (its stream/thumb/subs) via the public `/s/` routes.
 *
 * It is intentionally a separate concern from `auth.ts` (identity): a share
 * token never authenticates the request in the usual sense — it only ever
 * resolves to a single `video_id`, and only the `/s/` routes consult it. This
 * keeps the blast radius to exactly one video even if a link leaks.
 *
 * Tokens are stored hashed (sha256); the plaintext is shown once at creation.
 */

const SHARE_PREFIX = 'mts_';
const DAY_MS = 24 * 60 * 60 * 1000;

function sha256(input: string): string {
	return crypto.createHash('sha256').update(input).digest('hex');
}

export interface CreatedShare {
	token: string; // plaintext — shown once
	row: Share;
}

export interface CreateShareOptions {
	/** Days until the link stops working. `null`/`0`/undefined = never expires. */
	expiresInDays?: number | null;
	/** Optional human label, e.g. a friend's name. */
	label?: string;
}

/** Mint a share link for a single video. */
export function createShare(videoId: string, opts: CreateShareOptions = {}): CreatedShare {
	const token = SHARE_PREFIX + crypto.randomBytes(24).toString('hex');
	const tokenHash = sha256(token);
	const tokenPrefix = token.slice(0, 12);
	const days = opts.expiresInDays;
	const expiresAt = days && days > 0 ? new Date(Date.now() + days * DAY_MS) : null;
	const label = opts.label?.trim().slice(0, 80) || null;
	db.insert(shares).values({ videoId, tokenHash, tokenPrefix, label, expiresAt }).run();
	const row = db.select().from(shares).where(eq(shares.tokenHash, tokenHash)).get()!;
	return { token, row };
}

/**
 * Resolve a share token to its `videoId`, or `null` if the token is unknown,
 * revoked, or expired. Bumps `lastUsedAt`/`viewCount` at most once per minute
 * (the page + its media requests all call this within the same second).
 */
export function verifyShare(token: string | undefined): { videoId: string } | null {
	if (!token || !token.startsWith(SHARE_PREFIX)) return null;
	const hash = sha256(token);
	const row = db
		.select()
		.from(shares)
		.where(and(eq(shares.tokenHash, hash), eq(shares.revoked, false)))
		.get();
	if (!row) return null;
	if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
	if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
		db.update(shares)
			.set({ lastUsedAt: new Date(), viewCount: row.viewCount + 1 })
			.where(eq(shares.id, row.id))
			.run();
	}
	return { videoId: row.videoId };
}

export function listSharesForVideo(videoId: string): Share[] {
	return db
		.select()
		.from(shares)
		.where(eq(shares.videoId, videoId))
		.orderBy(desc(shares.createdAt))
		.all();
}

export function listShares(): Share[] {
	return db.select().from(shares).orderBy(desc(shares.createdAt)).all();
}

export interface ShareWithVideo extends Share {
	videoTitle: string | null;
}

/** Every share across all videos, with the video title for display. */
export function listSharesWithVideo(): ShareWithVideo[] {
	return db
		.select({
			id: shares.id,
			videoId: shares.videoId,
			tokenHash: shares.tokenHash,
			tokenPrefix: shares.tokenPrefix,
			label: shares.label,
			expiresAt: shares.expiresAt,
			revoked: shares.revoked,
			viewCount: shares.viewCount,
			createdAt: shares.createdAt,
			lastUsedAt: shares.lastUsedAt,
			videoTitle: videos.title
		})
		.from(shares)
		.leftJoin(videos, eq(videos.videoId, shares.videoId))
		.orderBy(desc(shares.createdAt))
		.all();
}

export function revokeShare(id: number): void {
	db.update(shares).set({ revoked: true }).where(eq(shares.id, id)).run();
}
