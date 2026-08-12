-- Notifications et tâches d'automatisation : passage au français
--
-- Les 18 actions internes (`create_notification`, `create_task`) des presets
-- étaient rédigées en anglais dans un produit francophone. Ce sont des textes
-- que l'UTILISATEUR voit dans sa cloche de notifications et sa liste de
-- tâches — pas des messages au client final, mais l'impression de sérieux se
-- joue là aussi : « Escalate to management. » dans un CRM québécois, ça ne
-- passe pas.
--
-- Mesuré en prod avant migration : ces titres existent sur 46 orgs (presets
-- issus du seed canonique) et 30 orgs (presets plus récents).
--
-- Deux corrections au passage, au-delà de la traduction :
--   * « Task created for follow-up. » ne disait pas de quoi il s'agissait ;
--   * « URGENT: » en majuscules sur deux presets — le niveau d'urgence se lit
--     dans le contenu (« 30 jours de retard »), pas dans une capitale.
--
-- Le fichier source `server/lib/automationPresets.data.ts` porte les mêmes
-- textes : une org créée après cette migration les reçoit directement.
--
-- Idempotente : rejouée, elle ne trouve plus de texte anglais à remplacer.

do $$
declare
  v_paires text[][] := array[
    -- Dépôts
    array['Deposit pending — [client_name]', 'Dépôt en attente — [client_name]'],
    array['Quote approved but deposit not yet received (2 days).',
          'La soumission est acceptée depuis 2 jours, mais le dépôt n''a pas été reçu.'],
    array['Deposit received: [client_name]', 'Dépôt reçu — [client_name]'],
    array['Deposit for [invoice_number] confirmed. Schedule the job.',
          'Le dépôt de la facture [invoice_number] est confirmé. La job peut être planifiée.'],

    -- Factures
    array['Follow up: Invoice [invoice_number] — 14 days overdue',
          'Relancer la facture [invoice_number] — 14 jours de retard'],
    array['Client [client_name] has not paid after 14 days.',
          '[client_name] n''a pas payé depuis 14 jours. Un appel est recommandé.'],
    array['Invoice [invoice_number] — 14 days overdue',
          'Facture [invoice_number] — 14 jours de retard'],
    -- NOTE : « Task created for follow-up. » seul est traité PLUS BAS, après
    -- la variante longue qui le contient. Remplacer le fragment court d'abord
    -- couperait la phrase longue en deux et produirait un mélange
    -- franco-anglais.
    array['URGENT: Invoice [invoice_number] — 30 days',
          'Facture [invoice_number] — 30 jours de retard'],
    array['Immediate action required.', 'Cette facture demande une intervention rapide.'],
    array['URGENT: Invoice [invoice_number] — 30 days overdue',
          'Facture [invoice_number] — 30 jours de retard, à escalader'],
    array['Escalate to management.',
          'Le retard dépasse 30 jours. À transmettre à un responsable ou à mettre en recouvrement.'],
    array['Invoice [invoice_number] — 7 days unpaid',
          'Facture [invoice_number] — 7 jours impayée'],
    array['[client_name] has not paid after 7 days.',
          '[client_name] n''a pas encore payé cette facture.'],

    -- Prospects
    array['Lead going cold: [client_name]', 'Prospect sans réponse — [client_name]'],
    array['Lead has not responded in 14 days. Make a final call or close.',
          'Aucune réponse depuis 14 jours. Faire un dernier appel, ou clore le dossier.'],
    array['Lead cold — 14 days', 'Prospect sans réponse — 14 jours'],
    array['[client_name] is going cold. Task assigned.',
          '[client_name] ne répond plus. Une tâche de suivi a été créée.'],
    array['Stale Lead — 7 days', 'Prospect inactif — 7 jours'],
    array['Lead [client_name] has had no activity for 7 days.',
          'Aucune activité sur le dossier de [client_name] depuis 7 jours.'],
    array['New Lead', 'Nouveau prospect'],
    array['New lead: [client_name] — [client_phone]', '[client_name] — [client_phone]'],

    -- Soumissions
    array['Urgent: Quote follow-up — [client_name]', 'Relancer la soumission — [client_name]'],
    array['Client [client_name] has not responded in 14 days. Call directly.',
          '[client_name] n''a pas répondu depuis 14 jours. Un appel direct est recommandé.'],
    array['Quote stale — 14 days', 'Soumission sans réponse — 14 jours'],
    array['[client_name] quote is 14 days old. Task created.',
          'La soumission de [client_name] date de 14 jours. Une tâche de relance a été créée.'],
    array['Quote closed — no response 21 days', 'Soumission close — aucune réponse'],
    array['[client_name] never responded. File closed.',
          '[client_name] n''a jamais répondu après 21 jours. Le dossier est clos.'],
    array['Quote not responded — 7 days', 'Soumission sans réponse — 7 jours'],
    array['[client_name] has not responded to their quote after 7 days.',
          '[client_name] n''a pas répondu à sa soumission depuis 7 jours.'],

    -- Rendez-vous et paiements
    array['Appointment Cancelled', 'Rendez-vous annulé'],
    array['[client_name] cancelled their appointment.',
          'Le rendez-vous de [client_name] a été annulé.'],
    array['Payment Received', 'Paiement reçu'],
    array['Payment received for invoice [invoice_number] from [client_name].',
          '[client_name] a payé la facture [invoice_number].'],

    -- ── Variantes présentes UNIQUEMENT en base ──────────────────────────
    -- Le seed SQL d'origine et le fichier `automationPresets.data.ts` ont
    -- divergé : la prod porte des formulations que le fichier source ne
    -- contient pas. Relevées en interrogeant `automation_rules` avant
    -- d'appliquer — sans elles, une partie des notifications serait restée en
    -- anglais après migration.
    array['[client_name] has an invoice outstanding for 30 days. Immediate follow-up required.',
          'La facture de [client_name] est impayée depuis 30 jours. Une relance est nécessaire.'],
    array['[client_name] has not paid invoice [invoice_number] after 7 days.',
          '[client_name] n''a pas payé la facture [invoice_number] depuis 7 jours.'],
    array['Client [client_name] has not paid invoice [invoice_number] after 30 days. Contact them directly.',
          '[client_name] n''a pas payé la facture [invoice_number] depuis 30 jours. Un contact direct est recommandé.'],
    array['Follow up: Invoice [invoice_number] — 30 days outstanding',
          'Relancer la facture [invoice_number] — 30 jours de retard'],
    array['Invoice [invoice_number] — 30 days outstanding',
          'Facture [invoice_number] — 30 jours de retard'],
    -- Mêmes libellés avec « overdue » au lieu de « outstanding » : les deux
    -- formulations coexistent selon la génération du seed.
    array['Follow up: Invoice [invoice_number] — 30 days overdue',
          'Relancer la facture [invoice_number] — 30 jours de retard'],
    array['Invoice [invoice_number] — 30 days overdue',
          'Facture [invoice_number] — 30 jours de retard'],
    array['Lead [client_name] has not responded in 14 days. Make a final call or close the lead.',
          '[client_name] n''a pas répondu depuis 14 jours. Faire un dernier appel, ou clore le dossier.'],
    array['Lead has not responded in 14 days. Make a final call or close the lead.',
          'Aucune réponse depuis 14 jours. Faire un dernier appel, ou clore le dossier.'],
    array['[client_name] never responded. File being closed.',
          '[client_name] n''a jamais répondu. Le dossier est clos.'],
    array['Quote closed — no response after 21 days', 'Soumission close — aucune réponse'],
    array['Follow up with stale lead: [client_name]', 'Relancer le prospect — [client_name]'],
    array['Deposit received from [client_name]', 'Dépôt reçu — [client_name]'],
    array['Deposit payment has been received.', 'Le dépôt a été reçu.'],
    array['A new lead has been created.', 'Un nouveau prospect a été enregistré.'],
    array['New lead: [client_name]', '[client_name]'],
    array['Client [client_name] approved quote but deposit not yet received (2 days).',
          '[client_name] a accepté la soumission il y a 2 jours, mais le dépôt n''a pas été reçu.'],
    array['Client [client_name] has not paid invoice [invoice_number] after 14 days. Call them directly.',
          '[client_name] n''a pas payé la facture [invoice_number] depuis 14 jours. Un appel direct est recommandé.'],
    array['[client_name] invoice overdue 14 days. Task created for follow-up.',
          'La facture de [client_name] a 14 jours de retard. Une tâche de relance a été créée.'],
    -- Le fragment court en DERNIER : ce qui reste après la ligne ci-dessus.
    array['Task created for follow-up.', 'Une tâche de relance a été créée.']
  ];
  v_i integer;
  v_avant text;
  v_apres text;
  v_touchees integer;
  v_total integer := 0;
begin
  for v_i in 1 .. array_length(v_paires, 1) loop
    v_avant := v_paires[v_i][1];
    v_apres := v_paires[v_i][2];

    -- `actions` est un tableau jsonb : on remplace le texte au niveau du
    -- document sérialisé, ce qui couvre `title`, `body` et `description`
    -- sans avoir à reconstruire chaque élément du tableau.
    update public.automation_rules
       set actions = replace(actions::text, to_jsonb(v_avant)::text, to_jsonb(v_apres)::text)::jsonb,
           updated_at = now()
     where actions::text like '%' || replace(v_avant, '''', '''''') || '%';

    get diagnostics v_touchees = row_count;
    v_total := v_total + v_touchees;
  end loop;

  raise notice '[notifs-fr] % remplacement(s) appliqué(s)', v_total;
end $$;
