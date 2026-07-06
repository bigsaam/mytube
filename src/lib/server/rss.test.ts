import { describe, it, expect } from 'vitest';
import { parseFeed } from './rss';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <yt:channelId>UCSMOQeBJ2RAnuFungnQOxLg</yt:channelId>
  <title>Blender</title>
  <author><name>Blender</name><uri>https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg</uri></author>
  <entry>
    <id>yt:video:aqz-KE-bpKQ</id>
    <yt:videoId>aqz-KE-bpKQ</yt:videoId>
    <yt:channelId>UCSMOQeBJ2RAnuFungnQOxLg</yt:channelId>
    <title>Big Buck Bunny</title>
    <published>2014-11-10T14:05:00+00:00</published>
    <media:group>
      <media:title>Big Buck Bunny</media:title>
      <media:thumbnail url="https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:abcdef12345</id>
    <yt:videoId>abcdef12345</yt:videoId>
    <title>Second Video</title>
    <published>2015-01-01T00:00:00+00:00</published>
  </entry>
</feed>`;

describe('parseFeed', () => {
	it('extracts channel + entries', () => {
		const feed = parseFeed(SAMPLE);
		expect(feed.channelId).toBe('UCSMOQeBJ2RAnuFungnQOxLg');
		expect(feed.channelName).toBe('Blender');
		expect(feed.entries).toHaveLength(2);
	});

	it('parses entry fields and thumbnails', () => {
		const [first, second] = parseFeed(SAMPLE).entries;
		expect(first.videoId).toBe('aqz-KE-bpKQ');
		expect(first.title).toBe('Big Buck Bunny');
		expect(first.publishedAt?.getUTCFullYear()).toBe(2014);
		expect(first.thumbnailUrl).toContain('aqz-KE-bpKQ');
		// Falls back to a constructed thumbnail when media:thumbnail is absent.
		expect(second.thumbnailUrl).toBe('https://i.ytimg.com/vi/abcdef12345/hqdefault.jpg');
	});

	it('handles an empty feed', () => {
		const feed = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>X</title></feed>');
		expect(feed.entries).toEqual([]);
	});
});
