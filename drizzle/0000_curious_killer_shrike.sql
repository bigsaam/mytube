CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`handle` text,
	`url` text NOT NULL,
	`avatar_url` text,
	`auto_grab` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_polled_at` integer
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`speed` text,
	`eta` text,
	`stage` text,
	`error` text,
	`add_to_watch_later` integer DEFAULT false NOT NULL,
	`max_height` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_downloads_status` ON `downloads` (`status`);--> statement-breakpoint
CREATE INDEX `idx_downloads_runafter` ON `downloads` (`run_after`);--> statement-breakpoint
CREATE TABLE `feed_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`source` text DEFAULT 'subscription' NOT NULL,
	`channel_id` text,
	`channel_name` text,
	`title` text NOT NULL,
	`thumbnail_url` text,
	`published_at` integer,
	`duration_seconds` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`badges` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feed_video_source` ON `feed_items` (`video_id`,`source`);--> statement-breakpoint
CREATE INDEX `idx_feed_status` ON `feed_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_feed_published` ON `feed_items` (`published_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`error` text,
	`dedupe_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_runafter` ON `jobs` (`run_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_jobs_dedupe` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`channel_id` text,
	`channel_name` text,
	`channel_slug` text,
	`duration_seconds` integer,
	`upload_date` integer,
	`video_path` text,
	`thumbnail_path` text,
	`subtitle_path` text,
	`info_json_path` text,
	`width` integer,
	`height` integer,
	`container` text,
	`filesize_bytes` integer,
	`chapters` text,
	`sponsorblock` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`watched` integer DEFAULT false NOT NULL,
	`watched_at` integer,
	`in_watch_later` integer DEFAULT false NOT NULL,
	`watch_later_order` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`files_deleted` integer DEFAULT false NOT NULL,
	`history_sync_optout` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`downloaded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_video_id_unique` ON `videos` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_videos_channel` ON `videos` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_videos_status` ON `videos` (`status`);--> statement-breakpoint
CREATE INDEX `idx_videos_wl` ON `videos` (`in_watch_later`,`watch_later_order`);--> statement-breakpoint
CREATE INDEX `idx_videos_added` ON `videos` (`added_at`);--> statement-breakpoint
CREATE TABLE `watch_progress` (
	`video_id` text PRIMARY KEY NOT NULL,
	`position_seconds` real DEFAULT 0 NOT NULL,
	`duration_seconds` real,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
