-- Mode de confirmation de Lumi, par personne — comme les modes de permission
-- de Claude Code :
--   demander : chaque écriture attend un clic (l'ancien comportement) ;
--   argent   : jobs, tâches, statuts, notes, planification passent tout
--              seuls ; devis, factures, paiements, textos, courriels et
--              fusions demandent encore (DÉFAUT) ;
--   tout     : rien ne demande, tout part d'office.
-- Les autorisations par outil (lumi_autorisations) s'ajoutent au mode.
alter table public.memberships
  add column if not exists lumi_mode text not null default 'argent';
alter table public.memberships
  drop constraint if exists memberships_lumi_mode_check;
alter table public.memberships
  add constraint memberships_lumi_mode_check check (lumi_mode in ('demander', 'argent', 'tout'));
comment on column public.memberships.lumi_mode is
  'Confirmation des écritures de Lumi : demander (chaque fois) | argent (seulement argent, envois, fusions) | tout (jamais). Par personne.';
