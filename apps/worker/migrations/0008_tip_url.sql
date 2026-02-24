-- Add tip_url column to channels for contributor donation links
ALTER TABLE channels ADD COLUMN tip_url TEXT;
