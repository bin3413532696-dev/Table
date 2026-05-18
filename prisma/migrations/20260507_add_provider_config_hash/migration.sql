-- Add provider_config_hash column to user_settings for tracking AI provider configuration changes
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS provider_config_hash TEXT NULL;