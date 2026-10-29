CREATE TABLE `ai_decision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ai_run_id` integer,
	`item` text NOT NULL,
	`decision` text NOT NULL,
	`before` text,
	`after` text,
	`decided_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`model` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_run_job_idx` ON `ai_run` (`job`,`created_at`);--> statement-breakpoint
CREATE TABLE `day_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`trigger` text NOT NULL,
	`brief` text NOT NULL,
	`top_step_ids` text NOT NULL,
	`ai_run_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `day_plan_date_idx` ON `day_plan` (`date`);--> statement-breakpoint
CREATE TABLE `mail_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`thread_id` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`snippet` text NOT NULL,
	`received_at` integer NOT NULL,
	`unread` integer NOT NULL,
	`category` text,
	`summary` text,
	`summarized_at` integer
);
--> statement-breakpoint
CREATE INDEX `mail_thread_received_idx` ON `mail_thread` (`received_at`);--> statement-breakpoint
CREATE TABLE `proposed_block` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_plan_id` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`step_id` text,
	`reason` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`google_event_id` text,
	`decided_at` integer,
	FOREIGN KEY (`day_plan_id`) REFERENCES `day_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposed_block_plan_idx` ON `proposed_block` (`day_plan_id`);--> statement-breakpoint
CREATE TABLE `reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`list` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer,
	`all_day` integer DEFAULT false NOT NULL,
	`flagged` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL
);
