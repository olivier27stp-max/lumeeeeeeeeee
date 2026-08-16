-- Collision de SMS après un job terminé
--
-- Deux presets se déclenchaient à la MÊME seconde (1 h après `job.completed`),
-- tous deux par SMS, tous deux invitant le client à répondre :
--
--   thank_you_after_job      « Merci de faire affaire avec X ! Si tout n'est
--                              pas parfait, répondez à ce message. »
--   post_appointment_survey  « Comment s'est passé notre service ? Répondez
--                              de 1 à 5 (5 = parfait). »
--
-- Le client recevait les deux d'un coup, avec deux consignes contradictoires.
-- L'org payait deux SMS. Mesuré en prod : 30 organisations concernées.
--
-- POURQUOI DÉCALER PLUTÔT QUE SUPPRIMER
-- Le sondage n'est pas inutile en soi, mais il faisait doublon à deux titres :
--   * même créneau que le remerciement ;
--   * la demande d'avis Google part 1 h plus tard (2 h après le job) — trois
--     sollicitations en 120 minutes.
-- Il devient un vrai suivi le lendemain (24 h), quand le client a eu le temps
-- de constater le travail.
--
-- POURQUOI CHANGER LE TEXTE
-- « Répondez de 1 à 5 » demandait une note que RIEN dans le code ne traite :
-- aucun handler n'interprète les réponses numériques, aucune table ne les
-- stocke. Le client notait dans le vide. Le nouveau texte ouvre une réponse
-- libre, que l'org voit dans sa boîte de messages — un canal qui, lui, existe.
--
-- Idempotente : rejouée, elle ne trouve plus de règle à 3600 s.

do $$
declare
  v_decalees integer;
  v_textes integer;
begin
  -- 1. Décaler le sondage au lendemain
  update public.automation_rules
     set delay_seconds = 86400,
         description   = 'Suivi de satisfaction le lendemain du service',
         updated_at    = now()
   where preset_key = 'post_appointment_survey'
     and delay_seconds = 3600;
  get diagnostics v_decalees = row_count;

  -- 2. Remplacer la demande de note par une question ouverte
  update public.automation_rules
     set actions = replace(
           actions::text,
           to_jsonb('Bonjour [client_first_name], comment s''est passé notre service? Répondez de 1 à 5 (5 = parfait). — [company_name]'::text)::text,
           to_jsonb('Bonjour [client_first_name], est-ce que tout est à votre goût depuis notre passage? Répondez à ce message si quelque chose ne va pas. — [company_name]'::text)::text
         )::jsonb,
         updated_at = now()
   where preset_key = 'post_appointment_survey'
     and actions::text like '%Répondez de 1 à 5%';
  get diagnostics v_textes = row_count;

  raise notice '[collision-sms] % règle(s) décalée(s), % texte(s) remplacé(s)', v_decalees, v_textes;
end $$;
