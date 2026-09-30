-- ═══════════════════════════════════════════════════════════════
-- Titre d'un deal (Rafba, 2026-09-29 : « fais en sorte qu'on puisse mettre des
-- titres à nos clients ou leads de pipeline ») — le « Opportunity name » de GHL.
-- Facultatif : sans titre, la carte montre le nom du client comme avant.
-- La RLS de `deals` couvre la colonne (aucune policy à changer).
--
-- ROLLBACK : alter table public.deals drop column if exists title;
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.deals add column if not exists title text;

alter table public.deals drop constraint if exists deals_title_longueur;
alter table public.deals add constraint deals_title_longueur
  check (title is null or char_length(title) <= 200);

comment on column public.deals.title is
  'Titre du deal (GHL « Opportunity name »), facultatif ; vide = nom du client.';

commit;
