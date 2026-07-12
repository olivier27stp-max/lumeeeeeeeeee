-- ════════════════════════════════════════════════════════════════════════
-- Numéros (#) modifiables sur les hub pages — jobs, clients, devis, factures
-- ════════════════════════════════════════════════════════════════════════
-- Complément de 20260716000000 (numéros dans les forms de création) et de
-- 20260729000000 (numéros clients) : le # devient modifiable directement sur
-- la page hub de chaque entité, avec les mêmes règles qu'à la création :
--   • numérique obligatoire
--   • jamais au-delà du prochain numéro disponible de l'org
--   • warning si le numéro est déjà pris (doublon)
--
--   1. rpc_update_entity_number(entity, id, number) → validation + update +
--      avance du compteur/séquence de l'org, le tout atomique.
--   2. Les triggers d'attribution jobs/clients écoutent aussi UPDATE de la
--      colonne numéro : tout chemin qui modifie un # garde le compteur en
--      avance (aucune collision possible avec un futur numéro auto).
--
-- Idempotent et sûr à re-exécuter.
-- ════════════════════════════════════════════════════════════════════════

-- 1. RPC de mise à jour d'un numéro d'entité ──────────────────────────────
create or replace function public.rpc_update_entity_number(
  p_entity text,
  p_id uuid,
  p_number text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_digits text;
  v_wanted bigint;
  v_next   bigint;
  v_stored text;
  v_count  int;
  v_prefix text;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;
  if p_id is null then
    raise exception 'p_id is required' using errcode = '22023';
  end if;

  v_digits := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '');
  if v_digits is null then
    raise exception 'Invalid number "%"', p_number using errcode = '22023';
  end if;
  v_wanted := v_digits::bigint;

  if p_entity = 'job' then
    select greatest(
      coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
                from public.jobs j
                where j.org_id = v_org and j.job_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Job number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.jobs j
      where j.org_id = v_org and j.deleted_at is null
        and j.job_number = v_wanted::text and j.id <> p_id
    ) then
      raise exception 'Job number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.jobs
    set job_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Job not found';
    end if;

    insert into public.org_job_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
          updated_at  = now();

  elsif p_entity = 'quote' then
    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org and q.deleted_at is null
        and btrim(q.quote_number) = v_wanted::text and q.id <> p_id
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.quotes
    set quote_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Quote not found';
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(public.quote_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'invoice' then
    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    -- Prefix configurable (company_settings.invoice_prefix, 20260711140000);
    -- défaut 'INV-' si la colonne/ligne n'existe pas encore.
    begin
      select coalesce(nullif(trim(invoice_prefix), ''), 'INV-') into v_prefix
      from public.company_settings where org_id = v_org;
    exception when others then v_prefix := null; end;
    v_stored := coalesce(v_prefix, 'INV-') || lpad(v_wanted::text, 6, '0');

    -- Doublon comparé sur la partie numérique (le prefix peut avoir changé
    -- depuis la création des anciennes factures). La contrainte unique
    -- (org_id, invoice_number) inclut les factures supprimées (soft delete) :
    -- on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.id <> p_id
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_stored;
    end if;

    update public.invoices
    set invoice_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Invoice not found';
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'client' then
    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Client number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.clients c
      where c.org_id = v_org and c.deleted_at is null
        and c.client_number = v_wanted::text and c.id <> p_id
    ) then
      raise exception 'Client number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.clients
    set client_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Client not found';
    end if;

    insert into public.org_client_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
          updated_at  = now();

  else
    raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  return v_stored;
end;
$$;

revoke all on function public.rpc_update_entity_number(text, uuid, text) from public;
grant execute on function public.rpc_update_entity_number(text, uuid, text) to authenticated, service_role;

-- 2. Triggers d'attribution : écouter aussi UPDATE de la colonne numéro ────
--    Un # modifié par un autre chemin (ex. formulaire d'édition de job)
--    avance aussi le compteur; un # vidé se voit réattribuer le prochain.
drop trigger if exists trg_jobs_zz_assign_number on public.jobs;
create trigger trg_jobs_zz_assign_number
  before insert or update of job_number on public.jobs
  for each row execute function public.assign_job_number();

drop trigger if exists trg_clients_zz_assign_number on public.clients;
create trigger trg_clients_zz_assign_number
  before insert or update of client_number on public.clients
  for each row execute function public.assign_client_number();

notify pgrst, 'reload schema';
