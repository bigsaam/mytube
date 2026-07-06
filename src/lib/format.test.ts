import { describe, it, expect } from 'vitest';
import { formatDuration, formatBytes, timestampToSeconds } from './format';

describe('formatDuration', () => {
	it('formats mm:ss and h:mm:ss', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(62)).toBe('1:02');
		expect(formatDuration(3661)).toBe('1:01:01');
	});
	it('returns empty for nullish/invalid', () => {
		expect(formatDuration(null)).toBe('');
		expect(formatDuration(undefined)).toBe('');
		expect(formatDuration(-5)).toBe('');
	});
});

describe('formatBytes', () => {
	it('scales units', () => {
		expect(formatBytes(0)).toBe('—');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1073741824)).toBe('1.0 GB');
	});
});

describe('timestampToSeconds', () => {
	it('parses mm:ss and h:mm:ss', () => {
		expect(timestampToSeconds('1:02')).toBe(62);
		expect(timestampToSeconds('1:01:01')).toBe(3661);
	});
	it('rejects garbage', () => {
		expect(timestampToSeconds('abc')).toBeNull();
	});
});
