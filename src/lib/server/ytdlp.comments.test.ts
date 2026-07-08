import { describe, it, expect } from 'vitest';
import { commentsFromInfo } from './ytdlp';
import type { RawInfo } from './ytdlp';

function info(comments: RawInfo['comments']): RawInfo {
	return { id: 'x', title: 't', comments };
}

describe('commentsFromInfo', () => {
	it('returns null when there are no comments', () => {
		expect(commentsFromInfo(null)).toBeNull();
		expect(commentsFromInfo(info(undefined))).toBeNull();
		expect(commentsFromInfo(info([]))).toBeNull();
	});

	it('threads replies under their parent', () => {
		const out = commentsFromInfo(
			info([
				{ id: 'a', parent: 'root', text: 'top A', author: 'Alice' },
				{ id: 'a.1', parent: 'a', text: 'reply 1', author: 'Bob' },
				{ id: 'a.2', parent: 'a', text: 'reply 2', author: 'Cara' },
				{ id: 'b', parent: 'root', text: 'top B', author: 'Dan' }
			])
		);
		expect(out).toHaveLength(2);
		expect(out![0].text).toBe('top A');
		expect(out![0].replies.map((r) => r.text)).toEqual(['reply 1', 'reply 2']);
		expect(out![1].replies).toHaveLength(0);
	});

	it('caps at 20 parents and 5 replies each', () => {
		const many: RawInfo['comments'] = [];
		for (let i = 0; i < 25; i++) many.push({ id: `p${i}`, parent: 'root', text: `p${i}`, author: 'A' });
		for (let r = 0; r < 8; r++) many.push({ id: `p0.${r}`, parent: 'p0', text: `r${r}`, author: 'B' });
		const out = commentsFromInfo(info(many))!;
		expect(out).toHaveLength(20);
		expect(out[0].replies).toHaveLength(5);
	});

	it('marks uploader and preserves like counts', () => {
		const out = commentsFromInfo(
			info([{ id: 'a', parent: 'root', text: 'hi', author: 'Me', author_is_uploader: true, like_count: 42 }])
		)!;
		expect(out[0].authorIsUploader).toBe(true);
		expect(out[0].likeCount).toBe(42);
	});
});
