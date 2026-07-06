import { describe, it, expect } from 'vitest';
import { parseNetscapeCookies } from './recommended-scraper';

describe('parseNetscapeCookies', () => {
	it('parses standard Netscape cookies.txt lines', () => {
		const txt = [
			'# Netscape HTTP Cookie File',
			'# comment',
			'.youtube.com\tTRUE\t/\tTRUE\t1799999999\tSID\tabc123',
			'.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf1=50000000'
		].join('\n');
		const cookies = parseNetscapeCookies(txt);
		expect(cookies).toHaveLength(2);
		expect(cookies[0]).toMatchObject({
			name: 'SID',
			value: 'abc123',
			domain: '.youtube.com',
			path: '/',
			secure: true,
			expires: 1799999999
		});
		expect(cookies[1].secure).toBe(false);
	});

	it('skips comments and malformed lines', () => {
		expect(parseNetscapeCookies('# just a comment\ngarbage line\n')).toEqual([]);
	});
});
