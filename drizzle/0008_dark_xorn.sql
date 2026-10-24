ALTER TABLE `notes` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `notes_client_id_idx` ON `notes` (`client_id`);