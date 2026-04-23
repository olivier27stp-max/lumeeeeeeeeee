-- ============================================================
-- Raise attachments bucket file_size_limit to 5 GB so course videos
-- up to ~3h HD can upload through TUS resumable. No-op if bucket
-- already has a higher limit.
-- ============================================================

update storage.buckets
set file_size_limit = 5368709120  -- 5 GiB in bytes
where id = 'attachments'
  and (file_size_limit is null or file_size_limit < 5368709120);
