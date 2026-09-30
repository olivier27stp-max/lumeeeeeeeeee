-- ───────────────────────────────────────────────────────────────
-- Les dépenses saisies dans le dossier système « Dépenses » alimentent
-- jobs.expenses_cents.
--
-- POURQUOI : `rentabilite_jobs` ne lit QUE `jobs.expenses_cents`. Les 10 champs
-- monétaires semés dans le dossier « Dépenses » (cf_depenses_champs_base) ne
-- comptaient donc dans AUCUN calcul de rentabilité — ni sur le web, ni sur le
-- mobile. Audit du 2026-09-30 : vérifié qu'aucune fonction, aucun trigger et
-- aucune ligne de code ne les additionnait.
--
-- SANS RISQUE DE PERTE : au moment d'écrire cette migration, la prod comptait
-- 0 job avec `expenses_cents > 0` et 0 valeur de champ dépense saisie. Il n'y a
-- donc rien à écraser.
--
-- ANCRAGE : on ne reconnaît PAS les dépenses à un motif de clé
-- (`depense_%`) mais à l'appartenance au dossier système
-- `custom_field_folders.cle_systeme = 'depenses'`. Conséquences voulues :
--   • un champ monétaire que l'entreprise ajoute elle-même dans ce dossier
--     compte automatiquement ;
--   • renommer le dossier ne casse rien (la clé système ne bouge pas) ;
--   • un champ nommé « dépense prévue » rangé ailleurs ne compte PAS.
--
-- ARCHIVAGE : un champ archivé qui porte encore une valeur continue de compter.
-- C'est délibéré — la valeur existe toujours sur la fiche (règle du serveur :
-- un champ archivé reste visible s'il a une valeur), donc elle doit rester dans
-- le total. Ça évite aussi un second trigger sur `custom_fields` et toute
-- possibilité de dérive entre les deux sources.
--
-- SAISIE MANUELLE : `expenses_cents` reste inscriptible (set_job_expenses).
-- Elle devient un repli : dès qu'une valeur du dossier « Dépenses » change, le
-- total recalculé l'emporte. Décision du propriétaire, 2026-09-30.
-- ───────────────────────────────────────────────────────────────

-- Total des dépenses d'une job, depuis le dossier système.
create or replace function public.cf_depenses_total_job(p_org uuid, p_job uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.value_money_cents), 0)::bigint
    from public.custom_field_values v
    join public.custom_fields f on f.id = v.field_id
    join public.custom_field_folders d on d.id = f.folder_id
   where v.org_id = p_org
     and v.job_id = p_job
     and v.object_type = 'job'
     and d.object_type = 'job'
     and d.cle_systeme = 'depenses';
$$;

comment on function public.cf_depenses_total_job(uuid, uuid) is
  'Somme des champs monétaires du dossier système « Dépenses » pour une job, en cents.';

-- Report du total dans jobs.expenses_cents à chaque écriture d'une valeur.
create or replace function public.cf_maj_depenses_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_org uuid;
  v_champ uuid;
  v_est_depense boolean;
  v_total bigint;
begin
  v_job := coalesce(new.job_id, old.job_id);
  v_org := coalesce(new.org_id, old.org_id);
  v_champ := coalesce(new.field_id, old.field_id);
  if v_job is null or v_org is null or v_champ is null then
    return null;  -- trigger AFTER : la valeur de retour est ignorée
  end if;

  select exists (
    select 1
      from public.custom_fields f
      join public.custom_field_folders d on d.id = f.folder_id
     where f.id = v_champ
       and d.object_type = 'job'
       and d.cle_systeme = 'depenses'
  ) into v_est_depense;

  if not v_est_depense then
    return null;
  end if;

  v_total := public.cf_depenses_total_job(v_org, v_job);

  -- Borne du type integer de la colonne : un total absurde ne doit pas faire
  -- échouer l'écriture de la valeur elle-même.
  v_total := least(greatest(v_total, 0), 2147483647);

  update public.jobs
     set expenses_cents = v_total::integer
   where id = v_job
     and org_id = v_org
     and coalesce(expenses_cents, 0) <> v_total;

  return null;
end;
$$;

drop trigger if exists custom_field_values_maj_depenses on public.custom_field_values;
create trigger custom_field_values_maj_depenses
  after insert or update or delete on public.custom_field_values
  for each row execute function public.cf_maj_depenses_job();

-- Rattrapage : aligner les jobs qui portent déjà des valeurs de dépenses.
-- Idempotent (le where ne touche que ce qui diverge).
update public.jobs j
   set expenses_cents = least(greatest(t.total, 0), 2147483647)::integer
  from (
    select v.org_id, v.job_id, coalesce(sum(v.value_money_cents), 0)::bigint as total
      from public.custom_field_values v
      join public.custom_fields f on f.id = v.field_id
      join public.custom_field_folders d on d.id = f.folder_id
     where v.object_type = 'job'
       and v.job_id is not null
       and d.object_type = 'job'
       and d.cle_systeme = 'depenses'
     group by v.org_id, v.job_id
  ) t
 where j.id = t.job_id
   and j.org_id = t.org_id
   and coalesce(j.expenses_cents, 0) <> t.total;
