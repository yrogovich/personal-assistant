CREATE TABLE `calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`included` integer DEFAULT true NOT NULL,
	`role` text DEFAULT 'normal' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_source_ext_idx` ON `calendar` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendar`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_start_idx` ON `event` (`start_at`);--> statement-breakpoint
CREATE INDEX `event_calendar_idx` ON `event` (`calendar_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `feed` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `integration` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`account` text,
	`credentials` text NOT NULL,
	`last_error` text,
	`connected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ok` integer,
	`items` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `sync_run_feed_idx` ON `sync_run` (`feed`,`started_at`);