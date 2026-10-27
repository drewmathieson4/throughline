CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`picture_url` text,
	`created_at` text NOT NULL,
	`last_signin_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_idx` ON `users` (`google_sub`);--> statement-breakpoint
DROP INDEX `notes_client_id_idx`;--> statement-breakpoint
ALTER TABLE `notes` ADD `owner_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `notes_owner_idx` ON `notes` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notes_owner_client_id_idx` ON `notes` (`owner_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `classes` ADD `owner_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `classes_owner_idx` ON `classes` (`owner_id`);