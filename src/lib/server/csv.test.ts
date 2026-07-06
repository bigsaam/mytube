import { describe, it, expect } from 'vitest';
import { parseCsv } from './channels';

describe('parseCsv (Takeout subscriptions.csv)', () => {
	it('parses the standard Takeout header + rows', () => {
		const csv =
			'Channel Id,Channel Url,Channel Title\n' +
			'UCSMOQeBJ2RAnuFungnQOxLg,http://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg,Blender\n' +
			'UCabc1234567890abcdefgh,http://www.youtube.com/channel/UCabc1234567890abcdefgh,Some Channel\n';
		const rows = parseCsv(csv);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual(['Channel Id', 'Channel Url', 'Channel Title']);
		expect(rows[1][2]).toBe('Blender');
	});

	it('handles quoted fields with commas', () => {
		const rows = parseCsv('a,b\n"hello, world","x ""y"" z"\n');
		expect(rows[1]).toEqual(['hello, world', 'x "y" z']);
	});

	it('skips blank lines', () => {
		expect(parseCsv('a,b\n\n\nc,d\n')).toHaveLength(2);
	});
});
