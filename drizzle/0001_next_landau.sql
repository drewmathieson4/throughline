CREATE TABLE `note_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`mention_text` text NOT NULL,
	`quotes` text DEFAULT '[]' NOT NULL,
	`candidate_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_mentions_note_idx` ON `note_mentions` (`note_id`);--> statement-breakpoint
ALTER TABLE `note_students` ADD `quotes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `aliases` text DEFAULT '[]' NOT NULL;