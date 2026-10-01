-- Avertissements « crédits Lumi » au propriétaire : UN par seuil et par période.
--
-- POURQUOI (demande de Rafba, 2026-09-30) : le client n'était averti que dans
-- la page Lumi. À 80 % puis à 100 % de ses crédits, le propriétaire reçoit
-- maintenant un courriel (et une notification), en crédits, jamais en $.
--
-- CE QUI CHANGE
-- Une ligne par (groupe d'entreprises, période, seuil) : l'insertion « si
-- absente » décide qui envoie. Dix requêtes qui franchissent le seuil en même
-- temps n'envoient qu'UN courriel (clé primaire). Service seulement.
--
-- DOWN : drop table if exists public.lumi_credits_avis;

create table if not exists public.lumi_credits_avis (
  company_group_id uuid        not null,
  periode          text        not null,
  seuil            smallint    not null check (seuil in (80, 100)),
  envoye_le        timestamptz not null default now(),
  primary key (company_group_id, periode, seuil)
);
alter table public.lumi_credits_avis enable row level security;
revoke all on public.lumi_credits_avis from anon, authenticated;
comment on table public.lumi_credits_avis is
  'Avertissements crédits Lumi déjà envoyés (80 / 100 %), un par groupe d''entreprises et par période.';
