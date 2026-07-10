DROP INDEX IF EXISTS `uq_jobs_dedupe`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_jobs_dedupe_pending` ON `jobs` (`dedupe_key`) WHERE status in ('queued', 'active');