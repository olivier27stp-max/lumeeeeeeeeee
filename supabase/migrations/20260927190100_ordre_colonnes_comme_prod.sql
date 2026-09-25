-- Ordre des colonnes identique à la prod (db:diff « corps différent » sur
-- automation_rules et job_line_items : mêmes colonnes, ordre inversé parce
-- que les migrations ont été appliquées dans un ordre différent).
-- Gardé : ne fait RIEN là où l'ordre est déjà celui de la prod (la prod).
-- Sinon (staging) : recrée la colonne mal placée en fin de table, données,
-- contrainte, index et commentaire compris, déclencheurs utilisateur coupés
-- le temps de la recopie (aucun effet de bord : totaux, horodatage).

do $$
begin
  -- automation_rules : prod = deleted_at puis folder_id.
  if (select attnum from pg_attribute where attrelid = 'public.automation_rules'::regclass and attname = 'folder_id' and not attisdropped)
     < (select attnum from pg_attribute where attrelid = 'public.automation_rules'::regclass and attname = 'deleted_at' and not attisdropped) then
    alter table public.automation_rules disable trigger user;
    alter table public.automation_rules rename column folder_id to folder_id_ancien;
    alter table public.automation_rules add column folder_id uuid;
    update public.automation_rules set folder_id = folder_id_ancien where folder_id_ancien is not null;
    alter table public.automation_rules drop column folder_id_ancien;  -- emporte FK et index
    alter table public.automation_rules
      add constraint automation_rules_folder_id_fkey foreign key (folder_id) references public.automation_folders(id) on delete set null;
    create index if not exists automation_rules_folder_idx on public.automation_rules using btree (org_id, folder_id) where (folder_id is not null);
    alter table public.automation_rules enable trigger user;
    raise notice 'automation_rules : folder_id replacée après deleted_at';
  end if;

  -- job_line_items : prod = visit_date puis description.
  if (select attnum from pg_attribute where attrelid = 'public.job_line_items'::regclass and attname = 'description' and not attisdropped)
     < (select attnum from pg_attribute where attrelid = 'public.job_line_items'::regclass and attname = 'visit_date' and not attisdropped) then
    alter table public.job_line_items disable trigger user;
    alter table public.job_line_items rename column description to description_ancien;
    alter table public.job_line_items add column description text;
    update public.job_line_items set description = description_ancien where description_ancien is not null;
    alter table public.job_line_items drop column description_ancien;  -- emporte la contrainte de longueur
    alter table public.job_line_items
      add constraint job_line_items_description_len check ((length(description) <= 20000));
    comment on column public.job_line_items.description is
      'Description libre de la ligne — reprise du catalogue (predefined_services.description) au moment de choisir le service, ou saisie à la main.';
    alter table public.job_line_items enable trigger user;
    raise notice 'job_line_items : description replacée après visit_date';
  end if;
end $$;
