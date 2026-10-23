DROP INDEX `syntheses_student_idx`;--> statement-breakpoint
ALTER TABLE `syntheses` ADD `period_start` text NOT NULL;--> statement-breakpoint
ALTER TABLE `syntheses` ADD `period_end` text NOT NULL;--> statement-breakpoint
CREATE INDEX `syntheses_student_idx` ON `syntheses` (`student_id`,`period_start`,`period_end`);