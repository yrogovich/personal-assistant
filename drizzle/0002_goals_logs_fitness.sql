CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sport_type` text NOT NULL,
	`start_at` integer NOT NULL,
	`moving_seconds` integer,
	`elapsed_seconds` integer,
	`distance_m` real,
	`external_id` text
);
--> statement-breakpoint
CREATE INDEX `activity_start_idx` ON `activity` (`start_at`);--> statement-breakpoint
CREATE TABLE `book` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`total_pages` integer,
	`current_page` integer,
	`status` text NOT NULL,
	`started_on` text,
	`finished_on` text,
	`notion_edited_at` integer
);
--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`why` text,
	`target_date` text,
	`measure` text NOT NULL,
	`habit_period` text,
	`habit_min` integer,
	`habit_max` integer,
	`start_value` real,
	`target_value` real,
	`unit` text,
	`status` text NOT NULL,
	`notion_edited_at` integer
);
--> statement-breakpoint
CREATE TABLE `habit_confirmation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit` text NOT NULL,
	`date` text NOT NULL,
	`event_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `habit_confirmation_date_idx` ON `habit_confirmation` (`date`);--> statement-breakpoint
CREATE TABLE `reading_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`page` integer NOT NULL,
	`date` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reading_log_book_idx` ON `reading_log` (`book_id`,`date`);--> statement-breakpoint
CREATE TABLE `reel_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `step` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text,
	`title` text NOT NULL,
	`estimate_min` integer,
	`status` text NOT NULL,
	`due` text,
	`order` integer,
	`done_on` text,
	`notion_edited_at` integer
);
--> statement-breakpoint
CREATE INDEX `step_goal_idx` ON `step` (`goal_id`);--> statement-breakpoint
CREATE TABLE `weight_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`kg` real NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weight_log_date_source_idx` ON `weight_log` (`date`,`source`);--> statement-breakpoint
CREATE TABLE `workout` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`volume_kg` real NOT NULL,
	`set_count` integer NOT NULL,
	`hevy_updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `workout_start_idx` ON `workout` (`start_at`);--> statement-breakpoint
CREATE TABLE `workout_set` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_index` integer NOT NULL,
	`exercise_template_id` text,
	`exercise_title` text NOT NULL,
	`set_index` integer NOT NULL,
	`set_type` text NOT NULL,
	`weight_kg` real,
	`reps` integer,
	`rpe` real,
	FOREIGN KEY (`workout_id`) REFERENCES `workout`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_set_workout_idx` ON `workout_set` (`workout_id`);--> statement-breakpoint
CREATE INDEX `workout_set_exercise_idx` ON `workout_set` (`exercise_title`);