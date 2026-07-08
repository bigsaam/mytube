CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel_name` text,
	`channel_id` text,
	`thumbnail_url` text,
	`duration_seconds` integer,
	`badges` text,
	`source` text DEFAULT 'home' NOT NULL,
	`source_video_id` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendations_video_id_unique` ON `recommendations` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_rec_status` ON `recommendations` (`status`,`seen_at`);