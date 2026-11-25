CREATE TABLE `cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cache_expires_index` ON `cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`parent_id` integer,
	`name` text NOT NULL,
	`icon` text(16),
	`type` text DEFAULT 'expense' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`match_field` text NOT NULL,
	`match_value` text NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_user_field_value_unique` ON `category_rules` (`user_id`,`match_field`,`match_value`);--> statement-breakpoint
CREATE TABLE `forwarding_confirmations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`inbound_address_id` integer NOT NULL,
	`gmail_address` text NOT NULL,
	`code` text NOT NULL,
	`confirm_url` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_address_id`) REFERENCES `inbound_addresses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forwarding_confirmations_user_received_index` ON `forwarding_confirmations` (`user_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `inbound_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`replaced_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_addresses_token_unique` ON `inbound_addresses` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_addresses_active_user_unique` ON `inbound_addresses` (`user_id`) WHERE "replaced_at" is null;--> statement-breakpoint
CREATE TABLE `inbound_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbound_receipts_received_index` ON `inbound_receipts` (`received_at`);--> statement-breakpoint
CREATE TABLE `raw_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`inbound_address_id` integer,
	`source` text NOT NULL,
	`verification` text NOT NULL,
	`dkim_domain` text,
	`message_id` text NOT NULL,
	`from_address` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`received_at` integer NOT NULL,
	`body_html` text,
	`body_text` text,
	`bank_code` text,
	`parsed_at` integer,
	`parse_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_address_id`) REFERENCES `inbound_addresses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `raw_emails_bank_code_index` ON `raw_emails` (`bank_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `raw_emails_user_message_unique` ON `raw_emails` (`user_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`raw_email_id` integer,
	`bank_code` text NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text(3),
	`original_amount` integer,
	`amount_estimated` integer DEFAULT false NOT NULL,
	`unverified` integer DEFAULT false NOT NULL,
	`counterparty` text,
	`counterparty_account` text,
	`description` text,
	`reference` text,
	`occurred_at` integer NOT NULL,
	`category_id` integer,
	`note` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_email_id`) REFERENCES `raw_emails`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_raw_email_id_unique` ON `transactions` (`raw_email_id`);--> statement-breakpoint
CREATE INDEX `transactions_user_occurred_index` ON `transactions` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`locale` text DEFAULT 'vi' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`viewing_demo` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);