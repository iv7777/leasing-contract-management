CREATE TABLE `deposit_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`transaction_type` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`receipt_id` integer,
	`charge_id` integer,
	`reversal_of_id` integer,
	`reason` text NOT NULL,
	`actor_user_id` integer NOT NULL,
	`approved_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deposit_transactions_contract_idx` ON `deposit_transactions` (`contract_id`);--> statement-breakpoint
CREATE TABLE `receipt_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`charge_id` integer NOT NULL,
	`amount_fen` integer NOT NULL,
	`reversal_of_id` integer,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipt_allocations_receipt_idx` ON `receipt_allocations` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_allocations_charge_idx` ON `receipt_allocations` (`charge_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`received_date` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`payment_method` text NOT NULL,
	`external_reference` text,
	`recorded_by` integer NOT NULL,
	`evidence_document_id` integer,
	`status` text DEFAULT 'posted' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipts_contract_idx` ON `receipts` (`contract_id`);