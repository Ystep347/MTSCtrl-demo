CREATE TABLE `app_ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "app_ai_settings_singleton" CHECK("app_ai_settings"."id" = 1)
);
