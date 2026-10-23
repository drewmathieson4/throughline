PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`audio_key` text,
	`noted_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notes`("id", "class_id", "kind", "body", "audio_key", "noted_at", "created_at") SELECT "id", "class_id", "kind", "body", "audio_key", "noted_at", "created_at" FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notes_class_idx` ON `notes` (`class_id`);--> statement-breakpoint
CREATE INDEX `notes_noted_at_idx` ON `notes` (`noted_at`);