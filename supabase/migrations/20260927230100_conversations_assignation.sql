-- Boîte de réception : assigner une conversation à une personne (multi-bureaux, phase 3).
--
-- `assigned_to` = la personne responsable de répondre. La clé étrangère
-- composite (assigned_to, org_id) → memberships(user_id, org_id) garantit EN
-- BASE que la personne est membre du bureau de la conversation : impossible
-- d'assigner quelqu'un d'un autre bureau, même par un appel direct à l'API.
-- Retirer la personne du bureau (suppression de l'adhésion) désassigne ses
-- conversations (ON DELETE SET NULL sur la seule colonne assigned_to).
--
-- Purement ADDITIF : colonnes nullables, aucune conversation existante ne change.

alter table public.conversations
  add column if not exists assigned_to uuid,
  add column if not exists assigned_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_assigned_to_membre') then
    alter table public.conversations
      add constraint conversations_assigned_to_membre
      foreign key (assigned_to, org_id) references public.memberships(user_id, org_id)
      on delete set null (assigned_to);
  end if;
end $$;

create index if not exists conversations_assigned_to_idx
  on public.conversations (org_id, assigned_to)
  where assigned_to is not null;

comment on column public.conversations.assigned_to is
  'Personne assignée (membre du bureau de la conversation) ; null = non assignée.';
