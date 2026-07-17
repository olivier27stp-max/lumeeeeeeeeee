-- ═══════════════════════════════════════════════════════════════
-- Automatisations en français + seed automatique des nouvelles orgs.
--
-- 1. apply_automation_presets_fr(org) : remplace les textes SMS et courriels
--    des règles preset par leurs versions françaises (les autres actions —
--    tâches, notifications, logs — sont intactes ; is_active est préservé).
-- 2. Trigger AFTER INSERT sur orgs : seed EN puis patch FR → une nouvelle
--    compagnie démarre avec les 30+ automatisations, en français.
-- 3. Patch FR appliqué à toutes les orgs existantes.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.apply_automation_presets_fr(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with fr(preset_key, sms, email_subject, email_body) as (
    values
      ('appointment_confirmation',
       'Bonjour [client_first_name], votre rendez-vous avec [company_name] est confirmé pour le [appointment_date] à [appointment_time]. À bientôt!',
       '[company_name] — Rendez-vous confirmé',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est confirmé :</p><ul><li><strong>Date :</strong> [appointment_date]</li><li><strong>Heure :</strong> [appointment_time]</li><li><strong>Adresse :</strong> [appointment_address]</li></ul><p>À bientôt!<br/>[company_name]</p></div>'),
      ('job_reminder_7d',
       'Rappel : votre rendez-vous avec [company_name] est dans une semaine, le [appointment_date] à [appointment_time].',
       '[company_name] — Rappel : rendez-vous dans une semaine',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Petit rappel : votre rendez-vous est prévu le <strong>[appointment_date]</strong> à <strong>[appointment_time]</strong>.</p><p>Répondez à ce courriel si vous avez des questions ou devez déplacer le rendez-vous.</p><p>À bientôt!<br/>[company_name]</p></div>'),
      ('job_reminder_1d',
       'Rappel : votre rendez-vous avec [company_name] est demain à [appointment_time]. Répondez à ce message si vous devez le déplacer.',
       '[company_name] — Votre rendez-vous est demain',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est <strong>demain</strong>, le [appointment_date] à [appointment_time].</p><p>Un empêchement? Répondez à ce courriel et on trouvera un autre moment.</p><p>À demain!<br/>[company_name]</p></div>'),
      ('job_reminder_2h',
       'C''est aujourd''hui! Votre rendez-vous avec [company_name] est à [appointment_time]. On s''en vient!',
       null, null),
      ('no_show_followup',
       'Bonjour [client_first_name], on a manqué notre rendez-vous. Répondez à ce message pour reprendre un moment qui vous convient. — [company_name]',
       null, null),
      ('welcome_new_lead',
       'Bonjour [client_first_name], merci d''avoir contacté [company_name]! On revient vers vous très vite.',
       null, null),
      ('lead_followup_1d',
       'Bonjour [client_first_name], avez-vous toujours besoin de nos services? Répondez à ce message et on s''occupe de vous. — [company_name]',
       null, null),
      ('lead_followup_3d',
       null,
       '[company_name] — On pense à vous',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment et on veut s''assurer de ne pas vous laisser sans réponse.</p><p>Répondez à ce courriel et on s''occupe de vous rapidement.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('lead_followup_14d',
       null,
       '[company_name] — Toujours intéressé?',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Ça fait deux semaines depuis votre demande — êtes-vous toujours à la recherche de nos services?</p><p>Un simple mot et on vous prépare une soumission.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('stale_lead_7d',
       'Bonjour [client_first_name], on ne vous oublie pas! Toujours intéressé par nos services? — [company_name]',
       null, null),
      ('lost_lead_reengagement',
       'Bonjour [client_first_name], ça fait un bout! Si vous avez des projets, [company_name] est là. Répondez STOP pour vous désabonner.',
       '[company_name] — Toujours des projets?',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Ça fait un moment! Si vous avez des projets d''entretien ou de nettoyage, on serait heureux de vous aider.</p><p>Répondez à ce courriel pour une soumission sans engagement.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('quote_followup_1d',
       'Bonjour [client_first_name], avez-vous eu le temps de regarder notre soumission? Répondez à ce message si vous avez des questions. — [company_name]',
       '[company_name] — Suivi de votre soumission',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>On vous a envoyé une soumission hier et on voulait s''assurer que vous l''avez bien reçue.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d''y répondre.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('quote_followup_3d',
       'Bonjour [client_first_name], petit rappel pour votre soumission de [company_name]. On peut l''ajuster au besoin!',
       '[company_name] — Votre soumission vous attend',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Petit rappel au sujet de la soumission qu''on vous a envoyée.</p><p>Si un détail ne convient pas, on peut l''ajuster — dites-le-nous simplement.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('quote_followup_7d',
       'Bonjour [client_first_name], votre soumission de [company_name] est toujours valide. Des questions? Répondez à ce message.',
       '[company_name] — Votre soumission est toujours valide',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Votre soumission est toujours valide et on garde votre place.</p><p>Si vous avez des questions ou souhaitez aller de l''avant, répondez à ce courriel.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('quote_followup_14d',
       'Bonjour [client_first_name], dernière relance pour votre soumission de [company_name]. On serait contents de travailler avec vous!',
       '[company_name] — Dernière relance pour votre soumission',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>On voulait faire un dernier suivi au sujet de votre soumission.</p><p>Si le moment n''est pas bon, aucun souci — répondez-nous et on se reprendra quand ça vous conviendra.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('quote_followup_21d',
       null,
       '[company_name] — On garde votre dossier ouvert',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>On garde votre dossier ouvert encore quelque temps si jamais vous souhaitez donner suite à votre soumission.</p><p>Répondez à ce courriel à tout moment.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('estimate_followup',
       null,
       '[company_name] — Suivi de votre devis',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>On vous a envoyé un devis récemment et on voulait faire un suivi.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d''y répondre.</p><p>Cordialement,<br/>[company_name]</p></div>'),
      ('deposit_reminder',
       'Merci d''avoir accepté la soumission de [company_name]! Un dépôt est requis pour réserver votre place à l''horaire.',
       '[company_name] — Dépôt requis pour réserver votre place',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Merci d''avoir accepté notre soumission!</p><p>Pour réserver votre place à l''horaire, un dépôt est requis. Répondez à ce courriel si vous avez des questions sur le paiement.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('deposit_followup_2d',
       'Rappel : votre dépôt pour [company_name] est en attente. Répondez à ce message si vous avez besoin d''aide.',
       null, null),
      ('deposit_received',
       'Dépôt bien reçu — merci [client_first_name]! Votre place est réservée. — [company_name]',
       '[company_name] — Dépôt reçu, merci!',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Merci [client_first_name]!</h2><p>Votre dépôt a bien été reçu et votre place est réservée à l''horaire.</p><p>On vous recontacte avec les détails du rendez-vous.</p><p>À bientôt,<br/>[company_name]</p></div>'),
      ('invoice_sent_reminder_1d',
       null,
       '[company_name] — Rappel : facture [invoice_number]',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Petit rappel amical : la facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en attente de paiement.</p><p>Si vous avez déjà payé, ignorez ce message.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('invoice_sent_reminder_3d',
       'Bonjour [client_first_name], petit rappel : votre facture de [company_name] est en attente de paiement.',
       '[company_name] — Rappel : facture [invoice_number]',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est toujours en attente de paiement.</p><p>Si vous avez déjà payé, ignorez ce message.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('invoice_sent_reminder_7d',
       'Bonjour [client_first_name], votre facture de [company_name] est toujours en attente. Merci de la régler quand vous pouvez!',
       '[company_name] — Facture [invoice_number] en attente depuis 7 jours',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en attente depuis une semaine.</p><p>Merci de la régler dès que possible, ou répondez à ce courriel si quelque chose ne va pas.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('invoice_sent_reminder_14d',
       'Bonjour [client_first_name], rappel : votre facture de [company_name] est impayée depuis 2 semaines. Répondez à ce message pour toute question.',
       '[company_name] — Facture [invoice_number] impayée depuis 2 semaines',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est impayée depuis deux semaines.</p><p>Merci de la régler rapidement. En cas de problème, répondez à ce courriel et on trouvera une solution.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('invoice_sent_reminder_30d',
       'Bonjour [client_first_name], votre facture de [company_name] est en souffrance depuis 30 jours. Merci de la régler rapidement ou de nous contacter.',
       '[company_name] — Facture [invoice_number] en souffrance (30 jours)',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>La facture <strong>[invoice_number]</strong> de <strong>[invoice_total]</strong> est en souffrance depuis 30 jours.</p><p>Merci de la régler sans tarder, ou contactez-nous pour convenir d''une entente de paiement.</p><p>Merci,<br/>[company_name]</p></div>'),
      ('payment_confirmation',
       'Paiement reçu — merci [client_first_name]! — [company_name]',
       null, null),
      ('thank_you_after_job',
       'Merci de faire affaire avec [company_name], [client_first_name]! Si tout n''est pas parfait, répondez à ce message.',
       null, null),
      ('post_appointment_survey',
       'Bonjour [client_first_name], comment s''est passé notre service? Répondez de 1 à 5 (5 = parfait). — [company_name]',
       null, null),
      ('review_reminder_7d',
       'Bonjour [client_first_name], un avis Google nous aiderait énormément : [google_review_url] Merci encore! — [company_name]',
       null, null),
      ('client_anniversary',
       'Déjà un an! Merci pour votre confiance, [client_first_name]. Besoin d''une retouche? [company_name] est là. Répondez STOP pour vous désabonner.',
       '[company_name] — Déjà un an!',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Ça fait déjà un an qu''on a fait des travaux chez vous — merci encore pour votre confiance!</p><p>Si c''est le temps d''une retouche ou d''un entretien, répondez à ce courriel et on vous prépare une soumission.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('cross_sell_30d',
       null,
       '[company_name] — Des nouvelles de nous',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Ça fait un mois depuis nos travaux chez vous — on espère que tout est encore impeccable!</p><p>Saviez-vous qu''on offre aussi d''autres services d''entretien? Répondez à ce courriel pour en savoir plus.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('reengagement_90d',
       'Bonjour [client_first_name], déjà 3 mois! Un entretien serait peut-être dû. — [company_name] Répondez STOP pour vous désabonner.',
       '[company_name] — Déjà 3 mois!',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Ça fait trois mois depuis notre dernier passage — un entretien serait peut-être dû.</p><p>Répondez à ce courriel et on vous trouve une place à l''horaire.</p><p>Au plaisir,<br/>[company_name]</p></div>'),
      ('seasonal_reminder_6m',
       'La saison avance! [company_name] peut préparer votre propriété. Répondez à ce message pour un devis. Répondez STOP pour vous désabonner.',
       '[company_name] — La saison s''en vient',
       '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>La saison avance — c''est le bon moment pour préparer votre propriété.</p><p>Répondez à ce courriel pour une soumission rapide et sans engagement.</p><p>À bientôt,<br/>[company_name]</p></div>')
  ),
  patched as (
    select r.id,
           (select jsonb_agg(
              case
                when elem->>'type' = 'send_sms' and fr.sms is not null
                  then jsonb_set(elem, '{config,body}', to_jsonb(fr.sms))
                when elem->>'type' = 'send_email' and fr.email_body is not null
                  then jsonb_set(jsonb_set(elem, '{config,body}', to_jsonb(fr.email_body)),
                                 '{config,subject}', to_jsonb(fr.email_subject))
                else elem
              end order by ord)
            from jsonb_array_elements(r.actions) with ordinality as t(elem, ord)) as new_actions
    from public.automation_rules r
    join fr on fr.preset_key = r.preset_key
    where r.org_id = p_org_id
  )
  update public.automation_rules r
  set actions = p.new_actions,
      updated_at = now()
  from patched p
  where r.id = p.id
    and p.new_actions is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.apply_automation_presets_fr(uuid) from anon, authenticated, public;

-- ── Seed automatique (EN puis patch FR) à la création d'une org ──
create or replace function public.handle_org_created_seed_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_automation_presets(new.id);
  perform public.apply_automation_presets_fr(new.id);
  return new;
exception when others then
  -- Ne jamais bloquer la création d'une org sur un échec de seed.
  raise warning 'seed automations failed for org %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_org_created_seed_automations on public.orgs;
create trigger trg_org_created_seed_automations
  after insert on public.orgs
  for each row execute function public.handle_org_created_seed_automations();

-- ── Franciser les orgs existantes (préserve is_active et les autres actions) ──
do $$
declare
  v_org record;
begin
  for v_org in select id from public.orgs loop
    perform public.apply_automation_presets_fr(v_org.id);
  end loop;
end $$;
