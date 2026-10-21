CREATE TABLE `opening_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`as_of_date` text NOT NULL,
	`balance_owed_fen` integer NOT NULL,
	`billed_fen` integer NOT NULL,
	`receipt_id` integer,
	`status` text DEFAULT 'provisional' NOT NULL,
	`provisional_until` text NOT NULL,
	`finalized_at` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opening_balances_live_idx` ON `opening_balances` (`contract_id`) WHERE "opening_balances"."status" <> 'reversed';