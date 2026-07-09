-- Data migration: move legacy recommended rows out of `feed_items` into the
-- `recommendations` pool (added in 0005) and drop them from the feed.
--
-- Before the Discover surface existed, recommended items were stored as
-- feed_items(source='recommended'). The Feed is now subscription-only, so those
-- rows are invisible — and, more importantly, `ingestRecommended` no longer
-- consults feed_items, so previously *dismissed* recommendations would come
-- back. Carrying the status over preserves that suppression.
--
-- Idempotent: INSERT OR IGNORE (video_id is unique) + the DELETE leaves nothing
-- to re-migrate on a re-run.

INSERT OR IGNORE INTO recommendations (
	video_id, title, channel_name, channel_id, thumbnail_url, duration_seconds,
	source, rank, status, seen_at, created_at
)
SELECT
	video_id,
	title,
	channel_name,
	channel_id,
	thumbnail_url,
	duration_seconds,
	'home',
	0,
	CASE status
		WHEN 'grabbed' THEN 'downloaded'
		WHEN 'dismissed' THEN 'dismissed'
		WHEN 'expired' THEN 'dismissed'
		ELSE 'new'
	END,
	created_at,
	created_at
FROM feed_items
WHERE source = 'recommended';
--> statement-breakpoint
DELETE FROM feed_items WHERE source = 'recommended';
