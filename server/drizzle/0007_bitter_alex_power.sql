CREATE TABLE `billing_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`contracts_processed` integer DEFAULT 0 NOT NULL,
	`charges_created` integer DEFAULT 0 NOT NULL,
	`contracts_failed` integer DEFAULT 0 NOT NULL,
	`missing_readings` integer DEFAULT 0 NOT NULL,
	`details_json` text,
	`error` text
);
--> statement-breakpoint
DROP INDEX `charges_dedupe_idx`;--> statement-breakpoint
ALTER TABLE `charges` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `charges` ADD `voided_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `charges` ADD `void_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `charges_dedupe_idx` ON `charges` (`contract_id`,`pricing_stream_id`,`service_start`,`service_end`) WHERE "charges"."status" = 'posted';--> statement-breakpoint
ALTER TABLE `billing_rules` ADD `overdue_grace_days` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_rules` ADD `auto_billing` integer DEFAULT false NOT NULL;