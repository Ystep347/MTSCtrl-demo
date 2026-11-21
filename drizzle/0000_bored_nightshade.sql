CREATE TABLE `incident_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`import_id` text NOT NULL,
	`incident_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`at` integer NOT NULL,
	`changes_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `incident_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_events_id_uq` ON `incident_events` (`id`);--> statement-breakpoint
CREATE INDEX `incident_events_incident_seq_idx` ON `incident_events` (`incident_id`,`seq`);--> statement-breakpoint
CREATE TABLE `incident_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`revision` text NOT NULL,
	`source_name` text NOT NULL,
	`at` integer NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`record_count` integer NOT NULL,
	`summary_json` text NOT NULL,
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_imports_version_uq` ON `incident_imports` (`version`);--> statement-breakpoint
CREATE TABLE `incident_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`revision` text NOT NULL,
	`raw_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`source_name` text NOT NULL,
	`import_id` text NOT NULL,
	`last_source_revision` text,
	FOREIGN KEY (`import_id`) REFERENCES `incident_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incident_state_singleton" CHECK("incident_state"."id" = 1)
);
