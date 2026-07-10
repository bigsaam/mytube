import { describe, it, expect } from 'vitest';
import { extractRecommended } from './recommended';

/**
 * Watch-page ("up next") related rail. Shapes mirror a real logged-in capture
 * (values synthesized). Two things differ from the home feed and are easy to get
 * wrong:
 *
 *  1. The rail is `lockupViewModel`, NOT `compactVideoRenderer` — the watch page
 *     has migrated off the legacy renderer entirely.
 *  2. Watch-page lockups carry no `commandRuns` on the metadata text — but they
 *     DO expose the channel's browseId on the avatar
 *     (`lockupMetadataViewModel.image.decoratedAvatarViewModel`). Home-feed
 *     lockups use commandRuns. The parser tries both, so a per-channel blocklist
 *     works on either surface without any extra network lookup.
 *
 * Ads reach this rail via `adSlotRenderer` wrapping a lockup with a real
 * contentId, an empty `lockupMetadataViewModel`, and `feedAdMetadataViewModel`
 * sitting beside it under `metadata`. That marker is the ONLY thing rejecting
 * them: a lockup with no `contentType` at all is otherwise accepted (see
 * recommended.ts). Keep the ad marker check exact — this fixture's nesting is
 * copied from a real capture.
 */

const CHANNEL_ID = 'UCN0nCULM7jKvqmZ0EROkJxA';

const relatedLockup = (id: string, title: string) => ({
	lockupViewModel: {
		contentId: id,
		contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
		metadata: {
			lockupMetadataViewModel: {
				title: { content: title },
				// The only place a watch-page lockup exposes the channelId.
				image: {
					decoratedAvatarViewModel: {
						rendererContext: {
							commandContext: {
								onTap: { innertubeCommand: { browseEndpoint: { browseId: CHANNEL_ID } } }
							}
						}
					}
				},
				metadata: {
					contentMetadataViewModel: {
						metadataRows: [
							// No commandRuns — the watch page omits the channel browseEndpoint.
							{ metadataParts: [{ text: { content: 'Some Channel' } }] },
							{
								metadataParts: [
									{ text: { content: '267K views' } },
									{ text: { content: '8 months ago' } }
								]
							}
						]
					}
				}
			}
		},
		contentImage: {
			thumbnailViewModel: {
				image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg`, width: 720, height: 404 }] },
				overlays: [
					{
						thumbnailBottomOverlayViewModel: {
							badges: [
								{ thumbnailBadgeViewModel: { text: '38:58', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }
							]
						}
					}
				]
			}
		}
	}
});

/**
 * An ad: real contentId, no contentType, and — as in the real capture —
 * `feedAdMetadataViewModel` as a SIBLING of an empty `lockupMetadataViewModel`.
 */
const adSlot = (id: string) => ({
	adSlotRenderer: {
		fulfillmentContent: {
			fulfilledLayout: {
				inFeedAdLayoutRenderer: {
					renderingContent: {
						lockupViewModel: {
							contentId: id,
							contentImage: { thumbnailViewModel: { image: { sources: [] } } },
							metadata: {
								lockupMetadataViewModel: {},
								feedAdMetadataViewModel: { adBadge: { text: 'Sponsored' } }
							}
						}
					}
				}
			}
		}
	}
});

const watchPage = (contents: unknown[]) => ({
	contents: {
		twoColumnWatchNextResults: {
			secondaryResults: {
				secondaryResults: {
					results: [{ itemSectionRenderer: { contents } }]
				}
			}
		}
	}
});

describe('watch-page up-next rail', () => {
	it('extracts related videos from lockupViewModel', () => {
		const data = watchPage([
			relatedLockup('gj5OlwtFe5M', 'Autumn Meditations'),
			relatedLockup('gOwbMN0JswA', 'background music.')
		]);
		const items = extractRecommended(data, {});
		expect(items.map((i) => i.videoId)).toEqual(['gj5OlwtFe5M', 'gOwbMN0JswA']);
		expect(items[0].title).toBe('Autumn Meditations');
		expect(items[0].durationSeconds).toBe(38 * 60 + 58);
	});

	it('recovers channelId from the avatar when commandRuns is absent', () => {
		const items = extractRecommended(watchPage([relatedLockup('gj5OlwtFe5M', 'x')]), {});
		expect(items[0].channelId).toBe(CHANNEL_ID);
	});

	it('still yields null channelId when neither source is present', () => {
		const lockup = relatedLockup('gj5OlwtFe5M', 'x');
		delete (lockup.lockupViewModel.metadata.lockupMetadataViewModel as Record<string, unknown>).image;
		const items = extractRecommended(watchPage([lockup]), {});
		expect(items[0].channelId).toBeNull();
	});

	it('rejects sponsored lockups wrapped in adSlotRenderer', () => {
		const data = watchPage([
			adSlot('-q9I8Cx_41g'),
			relatedLockup('gj5OlwtFe5M', 'A Real Video'),
			{ continuationItemRenderer: {} }
		]);
		const items = extractRecommended(data, {});
		expect(items.map((i) => i.videoId)).toEqual(['gj5OlwtFe5M']);
		expect(items.map((i) => i.videoId)).not.toContain('-q9I8Cx_41g');
	});

	// The ad marker is load-bearing: absent `contentType` alone does NOT reject a
	// lockup. If YouTube ever renames `feedAdMetadataViewModel`, ads land in the
	// library silently. This test fails loudly the day that assumption changes.
	it('accepts a contentType-less lockup that carries no ad marker', () => {
		const lockup = relatedLockup('gj5OlwtFe5M', 'No contentType');
		delete (lockup.lockupViewModel as Record<string, unknown>).contentType;
		const items = extractRecommended(watchPage([lockup]), {});
		expect(items.map((i) => i.videoId)).toEqual(['gj5OlwtFe5M']);
	});
});
