CREATE TABLE `blocked_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text,
	`channel_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocked_channels_channel_id_unique` ON `blocked_channels` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_blocked_name` ON `blocked_channels` (`channel_name`);