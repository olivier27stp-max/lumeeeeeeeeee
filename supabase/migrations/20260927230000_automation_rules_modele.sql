-- Automatisations partagées entre bureaux (multi-bureaux, phase 2).
--
-- Une automatisation copiée vers un autre bureau de l'entreprise peut rester
-- LIÉE à son modèle : `modele_id` pointe vers la règle d'origine (dans un
-- autre bureau). Modifier le modèle met à jour ses copies (côté serveur,
-- server/lib/automatisations-bureaux.ts, chaque bureau écrit avec l'identité
-- de la personne et après vérification de automations.update dans ce bureau).
-- Modifier une copie la détache (modele_id remis à null).
--
-- Purement ADDITIF : une colonne nullable, aucune règle existante ne change.
-- ON DELETE SET NULL : la suppression définitive d'un modèle laisse ses
-- copies vivre seules (les règles vont d'abord à la corbeille, deleted_at).

alter table public.automation_rules
  add column if not exists modele_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'automation_rules_modele_fk'
  ) then
    alter table public.automation_rules
      add constraint automation_rules_modele_fk
      foreign key (modele_id) references public.automation_rules(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'automation_rules_modele_pas_soi'
  ) then
    alter table public.automation_rules
      add constraint automation_rules_modele_pas_soi check (modele_id is null or modele_id <> id);
  end if;
end $$;

create index if not exists automation_rules_modele_idx
  on public.automation_rules (modele_id)
  where modele_id is not null;

comment on column public.automation_rules.modele_id is
  'Règle modèle (autre bureau de la même entreprise) que cette copie suit ; null = automatisation autonome.';
