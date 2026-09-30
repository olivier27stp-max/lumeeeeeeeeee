-- ───────────────────────────────────────────────────────────────
-- Champs personnalisés : les valeurs du CLIENT suivent vers la JOB.
--
-- POURQUOI : « lead → job » n'était couvert par rien. Un lead n'est pas une
-- table à part : c'est une ligne de `clients` avec `status = 'lead'` (l'étape
-- vivant dans `lead_status`). « lead → job » est donc littéralement
-- « client → job », et aucun déclencheur ne le faisait — ni pour le web, ni
-- pour le mobile. Demandé par le propriétaire le 2026-09-30 (décision D4 de
-- AUDIT_MOBILE.md).
--
-- FORME : un déclencheur, pas un appel dans une route. C'est le choix déjà fait
-- le 2026-09-26 pour devis → job et job → facture, et pour la même raison :
-- couvrir TOUT chemin (app web, mobile, Lumi, MCP, import) sans avoir à se
-- souvenir d'appeler quelque chose.
--
-- RÈGLE DE COPIE (inchangée, celle de cf_copier_valeurs) : champ cible de même
-- clé ET même type, non archivé, encore VIDE sur la job ; une option est
-- retrouvée par son libellé. En pratique la copie ne fait donc rien tant que
-- l'entreprise n'a pas créé, côté job, un champ portant la même clé qu'un champ
-- client — c'est voulu, ça évite de polluer les jobs.
--
-- ⚠️ PRÉCÉDENCE, à connaître : la copie depuis le client a lieu à la CRÉATION
-- de la job, donc AVANT qu'un devis ne soit lié (devis → job se déclenche plus
-- tard, quand `quotes.job_id` est posé). Comme une copie ne remplit que les
-- champs encore vides, en cas de clé partagée entre un champ client et un champ
-- devis, c'est la valeur du CLIENT qui reste. Pour inverser cette priorité il
-- suffirait de retirer ce déclencheur de l'INSERT et de ne le garder que sur
-- l'UPDATE de client_id.
--
-- Une copie ne bloque JAMAIS la création de la job (exception avalée en warning),
-- même motif que cf_devis_job_lie().
-- ───────────────────────────────────────────────────────────────

create or replace function public.cf_job_client_lie()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    begin
      perform public.cf_copier_valeurs(new.org_id, 'client', new.client_id, 'job', new.id);
    exception when others then
      raise warning 'cf_copier_valeurs(client %, job %) : %', new.client_id, new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

comment on function public.cf_job_client_lie() is
  'Copie les champs personnalisés du client vers la job à la création, ou quand la job change de client. Couvre « lead → job » (un lead EST un client).';

drop trigger if exists jobs_cf_copier_depuis_client on public.jobs;
create trigger jobs_cf_copier_depuis_client
  after insert or update of client_id on public.jobs
  for each row execute function public.cf_job_client_lie();
