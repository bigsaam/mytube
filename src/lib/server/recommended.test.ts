import { describe, it, expect } from 'vitest';
import { extractRecommended, parseVideoRenderer } from './recommended';

// A trimmed-but-realistic ytInitialData home-feed shape.
const INITIAL_DATA = {
	contents: {
		twoColumnBrowseResultsRenderer: {
			tabs: [
				{
					tabRenderer: {
						content: {
							richGridRenderer: {
								contents: [
									{
										richItemRenderer: {
											content: {
												videoRenderer: {
													videoId: 'dQw4w9WgXcQ',
													title: { runs: [{ text: 'A Normal Video' }] },
													lengthText: { simpleText: '3:32' },
													ownerText: {
														runs: [
															{
																text: 'Rick',
																navigationEndpoint: { browseEndpoint: { browseId: 'UCrickrollchannelid00' } }
															}
														]
													},
													thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg' }] },
													thumbnailOverlays: [
														{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '3:32' }, style: 'DEFAULT' } }
													]
												}
											}
										}
									},
									{
										richItemRenderer: {
											content: {
												videoRenderer: {
													videoId: 'livevideo01',
													title: { runs: [{ text: 'Live Right Now' }] },
													ownerText: { runs: [{ text: 'Streamer' }] },
													thumbnailOverlays: [
														{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: 'LIVE' }, style: 'LIVE' } }
													]
												}
											}
										}
									},
									{
										richItemRenderer: {
											content: {
												videoRenderer: {
													videoId: 'membersvid1',
													title: { simpleText: 'Members Only' },
													lengthText: { simpleText: '10:00' },
													ownerText: { runs: [{ text: 'Creator' }] },
													badges: [{ metadataBadgeRenderer: { label: 'Members only' } }]
												}
											}
										}
									},
									{
										richItemRenderer: {
											content: {
												videoRenderer: {
													videoId: 'shortsvid01',
													title: { runs: [{ text: 'A Short' }] },
													navigationEndpoint: { reelWatchEndpoint: { videoId: 'shortsvid01' } }
												}
											}
										}
									}
								]
							}
						}
					}
				}
			]
		}
	}
};

const BROWSE_CONTINUATION = {
	onResponseReceivedActions: [
		{
			appendContinuationItemsAction: {
				continuationItems: [
					{
						richItemRenderer: {
							content: {
								videoRenderer: {
									videoId: 'continued01',
									title: { runs: [{ text: 'Scrolled In' }] },
									lengthText: { simpleText: '1:02:03' },
									ownerText: { runs: [{ text: 'Chan' }] }
								}
							}
						}
					}
				]
			}
		}
	]
};

describe('extractRecommended', () => {
	it('parses richGrid items with all defaults off', () => {
		const items = extractRecommended(INITIAL_DATA);
		expect(items.map((i) => i.videoId)).toEqual([
			'dQw4w9WgXcQ',
			'livevideo01',
			'membersvid1',
			'shortsvid01'
		]);
	});

	it('normalizes the first item fully', () => {
		const [first] = extractRecommended(INITIAL_DATA);
		expect(first).toMatchObject({
			videoId: 'dQw4w9WgXcQ',
			title: 'A Normal Video',
			channelName: 'Rick',
			channelId: 'UCrickrollchannelid00',
			durationSeconds: 212,
			isLive: false
		});
		expect(first.thumbnailUrl).toContain('dQw4w9WgXcQ');
	});

	it('flags live, members, and shorts', () => {
		const items = extractRecommended(INITIAL_DATA);
		const live = items.find((i) => i.videoId === 'livevideo01')!;
		const members = items.find((i) => i.videoId === 'membersvid1')!;
		const short = items.find((i) => i.videoId === 'shortsvid01')!;
		expect(live.isLive).toBe(true);
		expect(live.durationSeconds).toBeNull();
		expect(members.isMembersOnly).toBe(true);
		expect(short.isShort).toBe(true);
	});

	it('applies filters', () => {
		const filtered = extractRecommended(INITIAL_DATA, { filterShorts: true, filterLive: true });
		expect(filtered.map((i) => i.videoId)).toEqual(['dQw4w9WgXcQ', 'membersvid1']);
	});

	it('parses browse continuation responses too', () => {
		const items = extractRecommended(BROWSE_CONTINUATION);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ videoId: 'continued01', durationSeconds: 3723 });
	});

	it('accepts a JSON string and dedupes', () => {
		const doubled = { a: INITIAL_DATA, b: INITIAL_DATA };
		expect(extractRecommended(JSON.stringify(doubled)).length).toBe(4);
	});

	it('returns [] for junk', () => {
		expect(extractRecommended(null)).toEqual([]);
		expect(extractRecommended('not json')).toEqual([]);
		expect(parseVideoRenderer({ videoId: 'bad' })).toBeNull();
	});
});
