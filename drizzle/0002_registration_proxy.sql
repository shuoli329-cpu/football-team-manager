-- Existing registrations remain self registrations.
ALTER TABLE registrations ADD COLUMN is_proxy INTEGER NOT NULL DEFAULT 0;
