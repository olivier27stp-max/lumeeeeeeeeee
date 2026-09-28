-- Liste Clients : Courriel, Téléphone, Entreprise, N° de client, Source, Ville et
-- Créé le sont maintenant dans « Champs dans le tableau » par défaut (demande de
-- Rafba, 2026-09-28 : ce sont les infos du formulaire, pas des champs à ajouter).
-- Les réglages déjà enregistrés reçoivent aussi ces colonnes (ajoutées à la fin,
-- sans doublon) ; chacun peut encore les retirer.
update public.table_view_preferences p
set columns = p.columns || coalesce((
  select jsonb_agg(c order by o)
  from unnest(array['courriel','telephone','entreprise','numero','source','ville','cree']) with ordinality as t(c, o)
  where not (p.columns ? c)
), '[]'::jsonb)
where p.object_type = 'client'
  and jsonb_typeof(p.columns) = 'array'
  and jsonb_array_length(p.columns) <= 73; -- plafond du CHECK : 80 colonnes
