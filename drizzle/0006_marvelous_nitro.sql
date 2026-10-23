PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_grade_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment` text NOT NULL,
	`category` text,
	`score` real,
	`max_score` real NOT NULL,
	`due_date` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_grade_entries`("id", "student_id", "assignment", "category", "score", "max_score", "due_date", "position") SELECT "id", "student_id", "assignment", "category", "score", "max_score", "due_date", "position" FROM `grade_entries`;--> statement-breakpoint
DROP TABLE `grade_entries`;--> statement-breakpoint
ALTER TABLE `__new_grade_entries` RENAME TO `grade_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `grade_entries_student_idx` ON `grade_entries` (`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grade_entries_student_assignment_idx` ON `grade_entries` (`student_id`,`assignment`);