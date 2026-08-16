-- Ajoute le courriel aux automatisations qui n'avaient que le SMS
--
-- POURQUOI
-- Mesuré sur les 59 clients réels de la production : 30 n'ont PAS de numéro de
-- téléphone, et 12 ne sont joignables QUE par courriel. Une automatisation
-- SMS-seule ne les atteint donc jamais — le SMS est proprement sauté, mais
-- rien ne prend le relais.
--
-- CE QUE FONT LES AUTRES (vérifié dans leur documentation)
--   · Housecall Pro : « si un client n'a pas d'adresse courriel mais a un
--     mobile, il reçoit uniquement les textos » — et l'inverse. Le canal suit
--     les coordonnées disponibles, il n'est jamais imposé.
--     Certaines notifications partent sur les DEUX (rendez-vous planifié,
--     demande d'avis), d'autres en SMS seul (« je suis en route », travail
--     terminé) — celles où le courriel arriverait trop tard.
--   · Jobber : un SMS ET un courriel configurables par rappel, mais SANS
--     repli automatique — si seul le SMS est activé, le client sans téléphone
--     ne reçoit rien.
--
-- Lume fait déjà mieux que Jobber sur ce point : `sendOrgSms` saute
-- proprement un destinataire sans téléphone. Il manquait juste le courriel en
-- face.
--
-- LA RÈGLE RETENUE
--   Les deux canaux → ce qui ne doit jamais être manqué (confirmation de
--     rendez-vous, rappels J-7 et J-1, paiement, dépôt, accueil prospect).
--   SMS seul       → l'immédiat, où le courriel arriverait trop tard
--     (rappel 2 h avant). Volontairement inchangé.
--   Un seul canal  → les relances, qui reviennent plusieurs fois. Cinq
--     relances de facture × deux canaux = dix messages pour une seule
--     facture : personne ne fait ça.
--
-- CE QUE FAIT CETTE MIGRATION
-- Deux presets seulement, vérifiés en prod avant écriture :
--   · payment_confirmation (30 orgs) — SMS seul
--   · welcome_new_lead     (30 orgs) — SMS seul
-- Les autres presets clés portent déjà les deux canaux.
--
-- Idempotente : rejouée, elle ne trouve plus de règle sans action `send_email`.

do $$
declare
  v_enveloppe constant text := '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
  v_paiement jsonb;
  v_prospect jsonb;
  v_n integer;
  v_total integer := 0;
begin
  v_paiement := jsonb_build_object(
    'type', 'send_email',
    'config', jsonb_build_object(
      'subject', 'Paiement reçu — merci [client_first_name]!',
      'body', v_enveloppe
        || '<h2 style="color:#1a1a1a;font-size:18px;">Merci [client_first_name]!</h2>'
        || '<p style="color:#333;line-height:1.6;">Nous confirmons la réception de votre paiement pour la facture [invoice_number].</p>'
        || '<p style="color:#333;line-height:1.6;">Merci de votre confiance.</p>'
        || '<p style="color:#333;line-height:1.6;">[company_name]</p></div>'
    )
  );

  v_prospect := jsonb_build_object(
    'type', 'send_email',
    'config', jsonb_build_object(
      'subject', 'Merci d''avoir contacté [company_name]',
      'body', v_enveloppe
        || '<h2 style="color:#1a1a1a;font-size:18px;">Bonjour [client_first_name],</h2>'
        || '<p style="color:#333;line-height:1.6;">Merci d''avoir communiqué avec nous. Nous avons bien reçu votre demande et nous revenons vers vous très rapidement.</p>'
        || '<p style="color:#333;line-height:1.6;">Si votre demande est urgente, répondez à ce courriel — nous la traiterons en priorité.</p>'
        || '<p style="color:#333;line-height:1.6;">[company_name]</p></div>'
    )
  );

  -- Le courriel est AJOUTÉ au tableau existant : le SMS et les actions
  -- internes (notification, journal) restent intacts.
  update public.automation_rules
     set actions = actions || jsonb_build_array(v_paiement),
         updated_at = now()
   where preset_key = 'payment_confirmation'
     and is_active
     and not exists (
       select 1 from jsonb_array_elements(actions) a
        where a->>'type' = 'send_email'
     );
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.automation_rules
     set actions = actions || jsonb_build_array(v_prospect),
         updated_at = now()
   where preset_key = 'welcome_new_lead'
     and is_active
     and not exists (
       select 1 from jsonb_array_elements(actions) a
        where a->>'type' = 'send_email'
     );
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  raise notice '[canaux] % règle(s) enrichie(s) d''un courriel', v_total;
end $$;
