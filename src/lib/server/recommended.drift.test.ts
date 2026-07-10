import { describe, it, expect } from 'vitest';
import { countRendererKeys, summarizeRenderers, extractRecommended } from './recommended';

/**
 * Drift diagnostics. A logged-in YouTube home is never empty, so a zero-item
 * scrape means we parsed the page and recognised nothing — the scraper now
 * reports which renderer keys were actually present instead of a silent `ok`.
 */
describe('countRendererKeys', () => {
	it('tallies known feed-item keys, deeply and across arrays', () => {
		const data = {
			contents: {
				richGridRenderer: {
					contents: [
						{ richItemRenderer: { content: { videoRenderer: { videoId: 'a'.repeat(11) } } } },
						{ richItemRenderer: { content: { videoRenderer: { videoId: 'b'.repeat(11) } } } },
						{ richItemRenderer: { content: { lockupViewModel: { contentId: 'c'.repeat(11) } } } }
					]
				}
			}
		};
		const counts = countRendererKeys(data);
		expect(counts.videoRenderer).toBe(2);
		expect(counts.richItemRenderer).toBe(3);
		expect(counts.lockupViewModel).toBe(1);
		expect(counts.richGridRenderer).toBe(1);
		expect(counts.compactVideoRenderer).toBeUndefined();
	});

	it('accepts a JSON string and ignores unknown keys', () => {
		const counts = countRendererKeys(JSON.stringify({ somethingElse: { videoRenderer: {} } }));
		expect(counts.videoRenderer).toBe(1);
		expect(counts.somethingElse).toBeUndefined();
	});

	it('is cycle-safe and handles nullish input', () => {
		const node: Record<string, unknown> = { videoRenderer: {} };
		node.self = node; // cycle
		expect(() => countRendererKeys(node)).not.toThrow();
		expect(countRendererKeys(null)).toEqual({});
		expect(countRendererKeys(undefined)).toEqual({});
	});

	it('distinguishes drift (no videoRenderer) from filtered-out results', () => {
		// Drift: items exist, but under a shape the extractor does not know.
		const drifted = { c: [{ lockupViewModel: { contentId: 'x' } }, { lockupViewModel: { contentId: 'y' } }] };
		expect(extractRecommended(drifted)).toHaveLength(0);
		expect(countRendererKeys(drifted).videoRenderer).toBeUndefined();
		expect(countRendererKeys(drifted).lockupViewModel).toBe(2);

		// Filtered: videoRenderers ARE present, the filters removed them.
		const shorts = {
			c: [
				{
					videoRenderer: {
						videoId: 'a'.repeat(11),
						title: { simpleText: 'S' },
						navigationEndpoint: { reelWatchEndpoint: {} }
					}
				}
			]
		};
		expect(extractRecommended(shorts, { filterShorts: true })).toHaveLength(0);
		expect(countRendererKeys(shorts).videoRenderer).toBe(1); // <- the tell
	});
});

describe('summarizeRenderers', () => {
	it('orders by count, descending', () => {
		expect(summarizeRenderers({ a: 1, b: 9, c: 3 })).toBe('b=9, c=3, a=1');
	});
	it('says "none" when empty', () => {
		expect(summarizeRenderers({})).toBe('none');
	});
});
