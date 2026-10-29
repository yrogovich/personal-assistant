CREATE TABLE `ai_proposal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`payload` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ai_run_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`notes` text,
	`draft` text,
	`final` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text,
	`notion_page_id` text,
	`ai_run_id` integer,
	`created_at` integer NOT NULL,
	`confirmed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_type_period_idx` ON `review` (`type`,`period_start`);