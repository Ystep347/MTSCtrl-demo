CREATE TABLE `incident_workflow` (
	`incident_id` text NOT NULL,
	`sys_id` text NOT NULL,
	`version` integer NOT NULL,
	`phase` text NOT NULL,
	`pending` integer NOT NULL,
	`team` text DEFAULT '' NOT NULL,
	`target_id` text,
	`target_name` text,
	`owner_id` text,
	`owner_name` text,
	`taken_at` integer,
	`updated_at` integer NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`report_source` text DEFAULT 'rules' NOT NULL,
	PRIMARY KEY(`incident_id`, `sys_id`),
	CONSTRAINT "incident_workflow_phase_check" CHECK("incident_workflow"."phase" IN ('new','assigned','working','deferred'))
);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `analyst_team` text;