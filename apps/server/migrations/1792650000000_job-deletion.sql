-- Up Migration

-- Keep immutable text, drafts and application history when a job leaves the list.
alter table job add column deleted_at timestamptz;
