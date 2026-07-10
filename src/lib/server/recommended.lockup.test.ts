import { describe, it, expect } from 'vitest';
import { extractRecommended, parseLockupViewModel, parseShortsLockupViewModel } from './recommended';

/**
 * YouTube's home feed migrated off `videoRenderer` to the `*ViewModel` family.
 * Shapes below mirror a real capture (values synthesized). Notably the home feed
 * now injects SPONSORED items as lockups carrying `feedAdMetadataViewModel` —
 * those must never be ingested.
 */

const lockup = (over: Record<string, unknown> = {}) => ({
	contentId: 'BcW4i4wO6G0',
	contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
	metadata: {
		lockupMetadataViewModel: {
			title: { content: 'A Real Video' },
			metadata: {
				contentMetadataViewModel: {
					metadataRows: [
						{
							metadataParts: [
								{
									text: {
										content: 'Some Channel',
										commandRuns: [
											{
												onTap: {
													innertubeCommand: {
														browseEndpoint: { browseId: 'UCSP4cUlyW3RceLF5brDwmTQ' }
													}
												}
											}
										]
									}
								}
							]
						},
						{ metadataParts: [{ text: { content: '22K views' } }, { text: { content: '1 year ago' } }] }
					]
				}
			}
		}
	},
	contentImage: {
		thumbnailViewModel: {
			image: {
				sources: [
					{ url: 'https://i.ytimg.com/vi/BcW4i4wO6G0/hq360.jpg', width: 360, height: 202 },
					{ url: 'https://i.ytimg.com/vi/BcW4i4wO6G0/hq720.jpg', width: 720, height: 404 }
				]
			},
			overlays: [
				{
					thumbnailBottomOverlayViewModel: {
						badges: [
							{ thumbnailBadgeViewModel: { badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } },
							{ thumbnailBadgeViewModel: { text: '21:51', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }
						]
					}
				}
			]
		}
	},
	...over
});

const ad = {
	contentId: 'AdAdAdAdAd1',
	// ads omit contentType and carry feedAdMetadataViewModel
	metadata: { feedAdMetadataViewModel: { adBadge: { adBadgeViewModel: { label: { content: 'Sponsored' } } } } }
};

const short = {
	entityId: 'shorts-shelf-item-qRTj15B6wRE',
	onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'qRTj15B6wRE' } } },
	overlayMetadata: { primaryText: { content: 'A Short' } },
	thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/qRTj15B6wRE/hq.jpg' }] } }
};

describe('parseLockupViewModel', () => {
	it('parses a real video', () => {
		const item = parseLockupViewModel(lockup())!;
		expect(item.videoId).toBe('BcW4i4wO6G0');
		expect(item.title).toBe('A Real Video');
		expect(item.channelName).toBe('Some Channel');
		expect(item.channelId).toBe('UCSP4cUlyW3RceLF5brDwmTQ');
		expect(item.durationSeconds).toBe(21 * 60 + 51);
		expect(item.thumbnailUrl).toContain('hq720'); // highest-res source
		expect(item.isShort).toBe(false);
		expect(item.isLive).toBe(false);
	});

	it('REJECTS sponsored items (ads are lockups too)', () => {
		expect(parseLockupViewModel(ad)).toBeNull();
	});

	it('rejects non-video lockups (playlists / mixes / channels)', () => {
		expect(parseLockupViewModel(lockup({ contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' }))).toBeNull();
	});

	it('rejects a malformed / missing video id', () => {
		expect(parseLockupViewModel(lockup({ contentId: 'too-short' }))).toBeNull();
	});

	it('treats a LIVE badge as live, with no duration', () => {
		const live = lockup({
			contentImage: {
				thumbnailViewModel: {
					image: { sources: [{ url: 'x' }] },
					overlays: [
						{
							thumbnailBottomOverlayViewModel: {
								badges: [{ thumbnailBadgeViewModel: { text: 'LIVE', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' } }]
							}
						}
					]
				}
			}
		});
		const item = parseLockupViewModel(live)!;
		expect(item.isLive).toBe(true);
		expect(item.durationSeconds).toBeNull();
	});
});

describe('parseShortsLockupViewModel', () => {
	it('parses a short and marks isShort', () => {
		const item = parseShortsLockupViewModel(short)!;
		expect(item.videoId).toBe('qRTj15B6wRE');
		expect(item.title).toBe('A Short');
		expect(item.isShort).toBe(true);
	});

	it('falls back to entityId without splitting on "-" (ids may contain "-")', () => {
		const item = parseShortsLockupViewModel({ entityId: 'shorts-shelf-item-a-b_cDEFGHI' })!;
		expect(item.videoId).toBe('a-b_cDEFGHI');
	});
});

describe('extractRecommended over a modern home feed', () => {
	const feed = {
		contents: {
			richGridRenderer: {
				contents: [
					{ richItemRenderer: { content: { lockupViewModel: lockup() } } },
					{ richItemRenderer: { content: { lockupViewModel: ad } } },
					{ richItemRenderer: { content: { lockupViewModel: lockup({ contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' }) } } },
					{ richSectionRenderer: { content: { shortsLockupViewModel: short } } }
				]
			}
		}
	};

	it('keeps videos + shorts, drops ads and playlists, preserves order', () => {
		const items = extractRecommended(feed);
		expect(items.map((i) => i.videoId)).toEqual(['BcW4i4wO6G0', 'qRTj15B6wRE']);
	});

	it('filterShorts drops the shorts shelf', () => {
		const items = extractRecommended(feed, { filterShorts: true });
		expect(items.map((i) => i.videoId)).toEqual(['BcW4i4wO6G0']);
	});

	it('still parses the legacy videoRenderer shape', () => {
		const legacy = { c: [{ videoRenderer: { videoId: 'dQw4w9WgXcQ', title: { runs: [{ text: 'Old' }] } } }] };
		expect(extractRecommended(legacy).map((i) => i.videoId)).toEqual(['dQw4w9WgXcQ']);
	});
});
