-- Required for the ON CONFLICT (provider_message_id) upsert performed by
-- POST /api/messages/inbound (Twilio webhook). Without this index, inbound
-- SMS saves fail with: "no unique or exclusion constraint matching the
-- ON CONFLICT specification" and the message is dropped.
--
-- Partial index: multiple NULLs are still allowed (outbound messages may
-- be inserted before a provider SID is assigned).

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_uniq
  ON public.messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
