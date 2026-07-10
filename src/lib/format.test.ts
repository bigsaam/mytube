import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	formatDuration,
	formatBytes,
	formatCount,
	formatUntil,
	timestampToSeconds,
	parseDescription
} from './format';

describe('formatCount', () => {
	it('formats compact counts', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(999)).toBe('999');
		expect(formatCount(1000)).toBe('1K');
		expect(formatCount(1234)).toBe('1.2K');
		expect(formatCount(3_400_000)).toBe('3.4M');
		expect(formatCount(1_000_000_000)).toBe('1B');
		expect(formatCount(150_000)).toBe('150K');
	});
	it('returns empty for nullish/invalid', () => {
		expect(formatCount(null)).toBe('');
		expect(formatCount(undefined)).toBe('');
		expect(formatCount(-1)).toBe('');
	});
});

describe('formatUntil', () => {
	// formatUntil reads Date.now() itself, so with a real clock the microseconds
	// between building the argument and reading it make `+3d` land just under
	// three days — Math.floor then reports "in 2d" and the test flakes. Freeze time.
	afterEach(() => vi.useRealTimers());

	it('describes a future date and marks past ones expired', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const now = Date.now();
		expect(formatUntil(now + 3 * 86400_000)).toBe('in 3d');
		expect(formatUntil(now + 2 * 3600_000)).toBe('in 2h');
		expect(formatUntil(now - 1000)).toBe('expired');
		expect(formatUntil(null)).toBe('');
	});
});

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

describe('parseDescription', () => {
	it('splits timestamps from text', () => {
		const parts = parseDescription('Intro 0:00 then 1:23 the good part');
		expect(parts.filter((p) => p.seconds !== null).map((p) => p.seconds)).toEqual([0, 83]);
		expect(parts.map((p) => p.text).join('')).toBe('Intro 0:00 then 1:23 the good part');
	});
	it('handles h:mm:ss', () => {
		const parts = parseDescription('chapter at 1:02:03 here');
		expect(parts.find((p) => p.seconds !== null)?.seconds).toBe(3723);
	});
	it('returns [] for empty', () => {
		expect(parseDescription('')).toEqual([]);
	});
});
