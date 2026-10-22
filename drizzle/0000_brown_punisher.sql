CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`term_start` text,
	`term_end` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grade_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment` text NOT NULL,
	`category` text,
	`score` real,
	`max_score` real NOT NULL,
	`due_date` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_entries_student_idx` ON `grade_entries` (`student_id`);--> statement-breakpoint
CREATE TABLE `note_students` (
	`note_id` text NOT NULL,
	`student_id` text NOT NULL,
	`confirmed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`note_id`, `student_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_students_student_idx` ON `note_students` (`student_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`audio_key` text,
	`noted_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_class_idx` ON `notes` (`class_id`);--> statement-breakpoint
CREATE INDEX `notes_noted_at_idx` ON `notes` (`noted_at`);--> statement-breakpoint
CREATE TABLE `report_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`synthesis_id` text NOT NULL,
	`generated_text` text NOT NULL,
	`edited_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`synthesis_id`) REFERENCES `syntheses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`class_id` text PRIMARY KEY NOT NULL,
	`style_samples` text,
	`report_rules` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`pseudonym` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `students_class_idx` ON `students` (`class_id`);--> statement-breakpoint
CREATE TABLE `syntheses` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`version` integer NOT NULL,
	`input_hash` text NOT NULL,
	`model` text NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `syntheses_student_idx` ON `syntheses` (`student_id`);