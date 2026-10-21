ALTER TABLE `amendments` ADD `created_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `name` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `voided` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `voided_by_amendment_id` integer;