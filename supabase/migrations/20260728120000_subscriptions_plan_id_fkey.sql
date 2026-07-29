-- subscriptions.plan_id n'avait AUCUNE clé étrangère vers plans (seul
-- scheduled_plan_id en avait une). Sans FK, PostgREST ne peut pas résoudre les
-- embeds `plans(...)` : il renvoie `null` en silence, sans erreur.
--
-- Effets observés en production :
--   - platform-admin (dashboard) : nom/slug du forfait vides
--   - billing-email : `plans(*)` null dans les courriels de facturation
--   - toute vérification d'accès basée sur cet embed échoue en « refusé »
--
-- Vérifié avant application : 0 ligne orpheline
--   select count(*) from subscriptions s where s.plan_id is not null
--     and not exists (select 1 from plans p where p.id = s.plan_id);  -- 0
--
-- RESTRICT : on ne veut jamais supprimer un forfait encore référencé par un
-- abonnement, ni effacer en cascade l'historique de facturation.

alter table public.subscriptions
  add constraint subscriptions_plan_id_fkey
  foreign key (plan_id) references public.plans(id)
  on delete restrict;

-- Index sur la colonne portante : PostgREST joint dessus à chaque embed, et
-- une FK sans index rend les suppressions de `plans` coûteuses.
create index if not exists idx_subscriptions_plan_id
  on public.subscriptions(plan_id);
