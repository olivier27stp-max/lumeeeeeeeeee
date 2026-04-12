-- Fix "column reference 'id' is ambiguous" error on quote_line_items, quote_sections, etc.
-- The RLS policies reference `quote_id` without qualifying the table, causing ambiguity.

begin;

-- ── quote_line_items ──
drop policy if exists quote_line_items_select on public.quote_line_items;
drop policy if exists quote_line_items_insert on public.quote_line_items;
drop policy if exists quote_line_items_update on public.quote_line_items;
drop policy if exists quote_line_items_delete on public.quote_line_items;

create policy quote_line_items_select on public.quote_line_items
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_line_items.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_insert on public.quote_line_items
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_line_items.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_update on public.quote_line_items
  for update using (exists (
    select 1 from public.quotes q where q.id = quote_line_items.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_delete on public.quote_line_items
  for delete using (exists (
    select 1 from public.quotes q where q.id = quote_line_items.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ── quote_sections ──
drop policy if exists quote_sections_all on public.quote_sections;

create policy quote_sections_select on public.quote_sections
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_sections.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_sections_insert on public.quote_sections
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_sections.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_sections_update on public.quote_sections
  for update using (exists (
    select 1 from public.quotes q where q.id = quote_sections.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_sections_delete on public.quote_sections
  for delete using (exists (
    select 1 from public.quotes q where q.id = quote_sections.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ── quote_send_log ──
drop policy if exists quote_send_log_all on public.quote_send_log;

create policy quote_send_log_select on public.quote_send_log
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_send_log.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_send_log_insert on public.quote_send_log
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_send_log.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ── quote_status_history ──
drop policy if exists quote_status_history_all on public.quote_status_history;

create policy quote_status_history_select on public.quote_status_history
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_status_history.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_status_history_insert on public.quote_status_history
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_status_history.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ── quote_attachments ──
drop policy if exists quote_attachments_all on public.quote_attachments;

create policy quote_attachments_select on public.quote_attachments
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_attachments.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_attachments_insert on public.quote_attachments
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_attachments.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_attachments_update on public.quote_attachments
  for update using (exists (
    select 1 from public.quotes q where q.id = quote_attachments.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_attachments_delete on public.quote_attachments
  for delete using (exists (
    select 1 from public.quotes q where q.id = quote_attachments.quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

commit;
