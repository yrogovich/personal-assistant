CREATE TABLE `recurring_payment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`day_of_month` integer NOT NULL,
	`method` text NOT NULL,
	`sender_match` text,
	`done_month` text,
	`problem` text,
	`problem_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `mail_thread` ADD `label` text;--> statement-breakpoint
ALTER TABLE `mail_thread` ADD `label_source` text;--> statement-breakpoint
ALTER TABLE `mail_thread` ADD `labeled_at` integer;--> statement-breakpoint
ALTER TABLE `mail_thread` ADD `suggest_star` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_thread` ADD `star_decision` text;