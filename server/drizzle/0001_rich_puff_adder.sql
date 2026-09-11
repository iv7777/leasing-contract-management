CREATE TABLE `amendments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`effective_date` text NOT NULL,
	`base_contract_version` integer NOT NULL,
	`changes_json` text NOT NULL,
	`supporting_document_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_by` integer,
	`submitted_at` text,
	`reviewed_by` integer,
	`reviewed_at` text,
	`review_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supporting_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendments_contract_idx` ON `amendments` (`contract_id`);--> statement-breakpoint
CREATE TABLE `billing_rules` (
	`contract_id` integer PRIMARY KEY NOT NULL,
	`billing_frequency` text DEFAULT 'monthly' NOT NULL,
	`period_anchor_day` integer DEFAULT 1 NOT NULL,
	`due_day` integer NOT NULL,
	`due_month_offset` integer DEFAULT 0 NOT NULL,
	`short_month_fallback` text DEFAULT 'last_day_of_month' NOT NULL,
	`proration_method` text DEFAULT 'actual_calendar_day' NOT NULL,
	`rounding_mode` text DEFAULT 'round_half_up' NOT NULL,
	`late_penalty_enabled` integer DEFAULT false NOT NULL,
	`late_penalty_daily_rate_permille` text,
	`late_penalty_cap_fen` integer,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `charge_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`charge_id` integer NOT NULL,
	`amount_fen` integer NOT NULL,
	`reason` text NOT NULL,
	`source_amendment_id` integer,
	`actor_user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`pricing_stream_id` integer NOT NULL,
	`fee_type` text NOT NULL,
	`service_start` text NOT NULL,
	`service_end` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`calculation_snapshot_json` text NOT NULL,
	`source_contract_version` integer NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_stream_id`) REFERENCES `pricing_streams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charges_dedupe_idx` ON `charges` (`contract_id`,`pricing_stream_id`,`service_start`,`service_end`);--> statement-breakpoint
CREATE TABLE `concessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`pricing_stream_id` integer,
	`effective_start` text NOT NULL,
	`effective_end` text NOT NULL,
	`discount_percentage` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_stream_id`) REFERENCES `pricing_streams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `concessions_contract_idx` ON `concessions` (`contract_id`);--> statement-breakpoint
CREATE TABLE `contract_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`effective_start` text NOT NULL,
	`effective_end` text,
	`contracted_area_sqm` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contract_units_contract_idx` ON `contract_units` (`contract_id`);--> statement-breakpoint
CREATE TABLE `contract_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`version_number` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`source_amendment_id` integer,
	`effective_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_amendment_id`) REFERENCES `amendments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_versions_unique_idx` ON `contract_versions` (`contract_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference_number` text NOT NULL,
	`landlord_party_id` integer NOT NULL,
	`tenant_party_id` integer NOT NULL,
	`term_start` text NOT NULL,
	`term_end` text NOT NULL,
	`renewal_notice_days` integer DEFAULT 90 NOT NULL,
	`special_terms` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`landlord_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_reference_idx` ON `contracts` (`reference_number`);--> statement-breakpoint
CREATE TABLE `deposit_terms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`effective_start` text NOT NULL,
	`requirement_type` text NOT NULL,
	`fixed_amount_fen` integer,
	`formula_basis` text,
	`waiver_condition_text` text,
	`waiver_met` integer,
	`waiver_evidence_document_id` integer,
	`due_date` text,
	`notes` text,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waiver_evidence_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deposit_terms_contract_idx` ON `deposit_terms` (`contract_id`);--> statement-breakpoint
CREATE TABLE `pricing_stream_units` (
	`pricing_stream_id` integer NOT NULL,
	`contract_unit_id` integer NOT NULL,
	FOREIGN KEY (`pricing_stream_id`) REFERENCES `pricing_streams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_unit_id`) REFERENCES `contract_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_stream_units_pk` ON `pricing_stream_units` (`pricing_stream_id`,`contract_unit_id`);--> statement-breakpoint
CREATE TABLE `pricing_streams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`fee_type` text NOT NULL,
	`target_type` text NOT NULL,
	`label` text,
	`notes` text,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pricing_streams_contract_idx` ON `pricing_streams` (`contract_id`);--> statement-breakpoint
CREATE TABLE `rate_schedule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pricing_stream_id` integer NOT NULL,
	`effective_start` text NOT NULL,
	`effective_end` text,
	`calculation_method` text NOT NULL,
	`amount_or_rate` text NOT NULL,
	`rate_basis` text NOT NULL,
	`escalation_base` text,
	`escalation_percentage` text,
	`escalation_interval_months` integer,
	`notes` text,
	FOREIGN KEY (`pricing_stream_id`) REFERENCES `pricing_streams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rate_schedule_stream_idx` ON `rate_schedule` (`pricing_stream_id`);--> statement-breakpoint
CREATE TABLE `usage_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`pricing_stream_id` integer NOT NULL,
	`service_start` text NOT NULL,
	`service_end` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`source` text,
	`entered_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_stream_id`) REFERENCES `pricing_streams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
