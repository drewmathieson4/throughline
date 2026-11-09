CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`synthesis_id` text NOT NULL,
	`model` text NOT NULL,
	`generated_text` text NOT NULL,
	`edited_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`synthesis_id`) REFERENCES `syntheses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reports_synthesis_idx` ON `reports` (`synthesis_id`);