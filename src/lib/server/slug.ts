/**
 * Filesystem-safe channel slug. Never trust channel names for paths — they can
 * contain slashes, unicode, emoji, control chars, or be empty. The canonical
 * on-disk key is always `{slug}/{video_id}`; `video_id` guarantees uniqueness,
 * so slug collisions are cosmetic, not dangerous.
 */
export function channelSlug(name: string | null | undefined, channelId?: string | null): string {
	const base = (name ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // strip diacritics
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	if (base) return base;
	// Fall back to a sanitized channel id, then a constant bucket.
	const idSlug = (channelId ?? '').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 40);
	return idSlug ? `channel-${idSlug}` : 'unknown';
}

/** Reject anything that isn't a plausible 11-char YouTube video id. */
export function isVideoId(id: string): boolean {
	return /^[A-Za-z0-9_-]{11}$/.test(id);
}
