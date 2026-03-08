begin;

drop policy if exists jobs_select_org on public.jobs;
create policy jobs_select_org
on public.jobs
for select
to authenticated
using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists jobs_insert_org on public.jobs;
create policy jobs_insert_org
on public.jobs
for insert
to authenticated
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists jobs_update_org on public.jobs;
create policy jobs_update_org
on public.jobs
for update
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id))
with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists jobs_delete_org on public.jobs;
create policy jobs_delete_org
on public.jobs
for delete
to authenticated
using (public.has_org_admin_role(auth.uid(), org_id));

commit;
