CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_sessions_expiry_idx` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `app_sessions_user_idx` ON `app_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'coordinator' NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "app_users_role_check" CHECK("app_users"."role" IN ('coordinator','editor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_username_uq` ON `app_users` (`username`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_limits_reset_idx` ON `auth_limits` (`reset_at`);