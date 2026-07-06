import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl, watchUrl } from './youtube-url';

describe('parseYouTubeUrl', () => {
	it('parses a standard watch URL', () => {
		expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
			videoId: 'dQw4w9WgXcQ',
			playlistId: null,
			isPlaylistOnly: false
		});
	});

	it('parses youtu.be short links', () => {
		expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
		expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42').videoId).toBe('dQw4w9WgXcQ');
	});

	it('parses shorts / embed / live / v paths', () => {
		expect(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
		expect(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
		expect(parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
	});

	it('accepts a bare video id', () => {
		expect(parseYouTubeUrl('dQw4w9WgXcQ').videoId).toBe('dQw4w9WgXcQ');
	});

	it('extracts a real playlist alongside a video', () => {
		const p = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abc');
		expect(p.videoId).toBe('dQw4w9WgXcQ');
		expect(p.playlistId).toBe('PL1234567890abc');
		expect(p.isPlaylistOnly).toBe(false);
	});

	it('treats a playlist-only link as such', () => {
		const p = parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890abc');
		expect(p.videoId).toBeNull();
		expect(p.playlistId).toBe('PL1234567890abc');
		expect(p.isPlaylistOnly).toBe(true);
	});

	it('ignores Mix/radio (RD…) and WL pseudo-playlists', () => {
		const p = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
		expect(p.videoId).toBe('dQw4w9WgXcQ');
		expect(p.playlistId).toBeNull();
	});

	it('rejects non-YouTube hosts and garbage', () => {
		expect(parseYouTubeUrl('https://vimeo.com/12345').videoId).toBeNull();
		expect(parseYouTubeUrl('not a url').videoId).toBeNull();
		expect(parseYouTubeUrl('').videoId).toBeNull();
	});

	it('builds a canonical watch URL', () => {
		expect(watchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	});
});
