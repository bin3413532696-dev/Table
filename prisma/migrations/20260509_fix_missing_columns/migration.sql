-- Fix missing columns that exist in schema.prisma but were missing from migrations
-- This is a comprehensive fix migration to prevent future users from encountering these errors

-- Add 'source' column to api_providers (used to track provider origin: 'manual', 'bootstrap', etc.)
ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';