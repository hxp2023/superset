ALTER TABLE `host_settings` ADD `sandbox_new_workspaces` integer;--> statement-breakpoint
ALTER TABLE `host_settings` ADD `sandbox_provider` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sandbox_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sandbox_image_digest` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sandbox_port_map_json` text DEFAULT '{}' NOT NULL;