ALTER TABLE `host_agent_configs` ADD `fork_args_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Backfill native fork commands only for untouched bundled configs. Matching
-- the executable as well as preset id avoids attaching provider-specific
-- arguments to a custom config that merely reused a builtin preset tag.
UPDATE `host_agent_configs` SET `fork_args_json` = '["--resume","{sessionId}","--fork-session"]' WHERE `fork_args_json` = '[]' AND `command` = `preset_id` AND `preset_id` = 'claude';--> statement-breakpoint
UPDATE `host_agent_configs` SET `fork_args_json` = '["fork","{sessionId}"]' WHERE `fork_args_json` = '[]' AND `command` = `preset_id` AND `preset_id` = 'codex';
