# B — Constats : moteur, déclencheurs et exécution

Agent B, 2026-10-01. Worktree `D:/lume-final/wt-b` (branche `mission/auto-finale-b`). Phase d'enquête : rien n'est corrigé.

**Comment rejouer une preuve** (pile locale, bureaux « (b) » en bac à sable) :
`QA_AUTO_SUFFIXE=b npx vitest run --maxWorkers=2 --config tests/automations-finale/b/vitest.config.ts <fichier>`
Dernière passe complète de mes tests, hors mesure de charge : 60 tests, 30 rouges (les constats ci-dessous), 30 verts —
`D:/lume-final/sorties/b/passe-finale.log`. Mesure de charge (une fois) : `sorties/b/b-14-masse.json`. Processus tué :
`sorties/b/redemarrage.json`.

**Attention avant toute fusion vers `main`** : `vitest.config.ts` (la suite générale, `npm run test`, bloquante en CI)
ramasse `tests/**/*.test.ts` et n'exclut que `tests/automations-suite/**`. Les tests de `tests/automations-finale/**`
(les miens et ceux des autres agents) exigent une base et sont rouges par construction : il faut ajouter ce dossier à
`exclude` de `vitest.config.ts`, ou la CI casse. Je ne l'ai pas fait (fichier existant). Mes fichiers passent `tsc --noEmit`.

**En bref**
- Les 28 déclencheurs du catalogue ont tous un producteur, et ce qui les fait tourner en prod tourne (tick de 5 min dans le
  serveur, boucle de 15 s, 4 tâches pg_cron qui appellent `/api/cron/*`). Détail et preuves : `notes/B-carte.md`.
- Aucun constat bloquant. 13 constats majeurs : presque tous sont le même manque vu de plusieurs côtés — **avant une
  action différée, le moteur ne revérifie que quelques états** (facture payée ou annulée, devis accepté, rendez-vous
  annulé, prospect converti). Tout le reste part quand même.
- Ce qui marche et que j'ai prouvé à neuf : activer « Facture en retard » n'écrit à personne le jour même (B10-01) ; les
  réponses par texto vont au bon bureau et le STOP s'applique tout de suite (B12-01 à 06) ; le changement d'heure du
  1er novembre 2026 est juste (B11-10 à 13) ; les tâches en attente et en cours survivent à un processus tué, sans doublon.

Deux cas de la mission ne peuvent pas se produire : une facture ÉMISE ne revient pas en brouillon (le trigger de la base
re-dérive le statut, l'outil `revert_invoice_to_draft` le refuse) et son échéance ne se modifie plus (« Cette facture a
déjà été émise »). Je les ai retirés des tests après les avoir essayés.

---

## Majeurs

### B-01 — Le client reçoit le rappel de rendez-vous d'un job que l'entreprise a annulé
- Point de la mission : 9 (c'est l'exemple même de la mission : « job annulée → plus de rappel de RDV »)
- Gravité : majeur
- Ce qu'on voit : l'entreprise passe un job à « Annulé » (fiche du job, ou Lumi `update_job_status`). La veille de la date
  prévue, le client reçoit quand même « Rappel : votre rendez-vous est demain ».
- Reproduction : règle `appointment.created` + 1 jour → courriel ; créer un job et sa visite ; émettre l'événement ; passer
  `jobs.status` à `cancelled` ; faire avancer la file.
- Preuve : `tests/automations-finale/b/b-09-revalidation.test.ts::[B9-10] appointment.created + 1 jour — JOB annulé…` (1 message
  parti, tâche `completed`) ; même résultat dans un parcours (`[B9-10/attendre]`) et drapeau `auto_sortie_parcours` allumé
  (`[B9-10/drapeau]`).
- Cause racine : annuler un job ne touche pas ses visites (aucun trigger sur `jobs.status` ; `schedule_events.status` reste
  `scheduled`). Et la vérification d'arrêt ne lit que la visite : `server/lib/automationEngine.ts:2937-2949`
  (`checkStopConditions`) et `server/lib/sortie-parcours.ts:169-177` — jamais le job.
- Correctif proposé : dans ces deux fonctions, remonter au job de la visite et arrêter s'il est `cancelled` ou à la
  corbeille (motif « le job a été annulé »). En plus, un trigger `jobs` (statut → `cancelled`) qui annule les visites à
  venir : il émet alors `appointment.cancelled` par le trigger existant. Fichiers : `automationEngine.ts`,
  `sortie-parcours.ts`, une migration.
- Risque / à décider par Rafba : annuler un job doit-il retirer ses visites du calendrier ? (aujourd'hui : non).

### B-02 — Un rendez-vous déplacé garde ses rappels à l'ancienne date ; le rappel « c'est demain » peut partir APRÈS la visite
- Point de la mission : 9 et 13
- Gravité : majeur
- Ce qu'on voit : une visite du mardi suivant est avancée à jeudi. Le client reçoit lundi « votre rendez-vous est demain »,
  quatre jours après la visite. Ou, déplacée plus tard, le rappel « demain » arrive une semaine trop tôt.
- Reproduction : règle `appointment.created`, délai −1 jour, texto ; visite dans 6 jours ; modifier `schedule_events.start_at`
  sans passer par l'écran ; regarder la tâche, puis faire avancer la file.
- Preuve : `tests/automations-finale/b/b-02-producteurs.test.ts::[B2-03] rappel « 24 h avant » : la visite avancée…` (« le rappel
  reste prévu… 3 jour(s) APRÈS la visite déplacée ») et `::[B2-04] à son échéance, un rappel dont la visite est déjà PASSÉE ne
  part pas` (le texto part le lendemain de la visite).
- Cause racine : l'heure du rappel est calculée une seule fois (`automationEngine.ts:1256-1322`, `resolveExecuteAt`). Seul un
  appel HTTP « tire et oublie » replanifie : `POST /api/automations/events/appointment-rescheduled`
  (`server/routes/automation-events.ts:93`), envoyé par le navigateur (`src/lib/automationEventsApi.ts:25-49`, erreur
  avalée) ou par Lumi. À l'exécution, la tâche ne relit pas `start_at` (`automationEngine.ts:2064-2066` ne regarde que
  l'heure d'origine, et seulement pour les heures calmes). Le trigger SQL des visites ne réagit qu'à INSERT et au statut.
- Correctif proposé : (1) à l'exécution d'une tâche à délai négatif, relire le début de la visite comme le fait déjà
  l'attente « avant la date » d'un parcours (`server/lib/automationSequences.ts:504-559`) : visite passée → annuler
  « rappel périmé » ; visite déplacée → replanifier. (2) Rendre le déplacement durable : trigger `schedule_events` sur
  `UPDATE OF start_at` qui écrit dans `automation_evenements_base`, au lieu de dépendre du navigateur. Fichiers :
  `automationEngine.ts`, `evenementsBase.ts`, une migration.
- Risque / à décider par Rafba : aucun.

### B-03 — Facture, job ou opportunité mis à la corbeille : le message prévu part quand même
- Point de la mission : 13
- Gravité : majeur
- Ce qu'on voit : l'entreprise supprime une facture créée par erreur ; le client reçoit trois jours plus tard « votre facture
  est en retard ». Elle supprime un job ; le client reçoit « merci pour votre confiance » ou la demande d'avis.
- Reproduction : règle + 1 jour → courriel ; émettre l'événement ; poser `deleted_at` sur l'entité (ce que font
  `delete_invoice`, `soft_delete_job`, la suppression d'une opportunité) ; faire avancer la file.
- Preuve : `b-09-revalidation.test.ts::[B9-05] invoice.overdue + 1 jour — facture SUPPRIMÉE (corbeille)…`,
  `::[B9-13] job.completed + 1 jour — JOB supprimé…`, `::[B9-19] deal.stage_entered + 1 jour — opportunité SUPPRIMÉE…`,
  `::[B9-05/drapeau]` (le drapeau de sortie n'y change rien) ; et `::[B9-07] quote.sent + 1 jour — devis REVENU EN BROUILLON…`
  (cas rare : devis archivé puis restauré).
- Cause racine : `checkStopConditions` (`automationEngine.ts:2870-3004`) lit `invoices.status` sans `deleted_at`
  (`:2903-2912`), ne vérifie RIEN pour un job ni pour une opportunité, et ne tient pas « brouillon » pour un arrêt du devis
  (`:2964`). Même trou dans `sortie-parcours.ts:144-167`.
- Correctif proposé : une seule fonction « l'entité de la tâche existe-t-elle encore ? » pour les six types (client,
  prospect, devis, facture, job, rendez-vous, opportunité), qui lit `deleted_at` partout, avec un motif par cas. Fichiers :
  `automationEngine.ts`, `sortie-parcours.ts`.
- Risque / à décider par Rafba : aucun.

### B-04 — Les conditions et le ciblage ne sont jugés qu'à l'arrivée de l'événement, jamais avant l'envoi différé
- Point de la mission : 9 (et 6 : « évalué au moment de l'exécution »)
- Gravité : majeur
- Ce qu'on voit : une relance « seulement si le client a l'étiquette VIP » part trois jours plus tard à un client à qui on a
  retiré l'étiquette entre-temps. Le message de « Étiquette ajoutée » part après le retrait de l'étiquette. Le message de
  « Opportunité qui dort » part alors que l'opportunité a bougé.
- Reproduction : règle avec filtre d'étiquette + 1 jour ; retirer l'étiquette pendant le délai ; faire avancer la file.
- Preuve : `b-09-revalidation.test.ts::[B9-17] note.added + 1 jour — filtre « le client a l’étiquette X » : X retirée…`,
  `::[B9-16] client.tagged + 1 jour — étiquette RETIRÉE…`, `::[B9-18] deal.stage_idle + 1 jour — opportunité DÉPLACÉE…`.
- Cause racine : `handleEvent` juge conditions, champs et étiquettes une fois (`automationEngine.ts:1465-1487`) ; à
  l'échéance, `processScheduledTasks` n'appelle que les arrêts « métier » (`:2133-2210`). Rien pour l'opportunité quand le
  drapeau `auto_sortie_parcours` est éteint, et, allumé, seulement pour `deal.stage_entered` (`sortie-parcours.ts:179-191`).
- Correctif proposé : avant d'exécuter une tâche différée qui écrit au client, rejuger les filtres de la règle qui portent
  sur l'état ACTUEL : `conditionsEtiquettesOk`, `conditionsChampsOk` (déjà écrits pour le déclencheur), l'étiquette de
  `client.tagged`, l'étape de l'opportunité. Faux → tâche annulée, « ignoré : condition plus valide ». C'est aussi là que
  doit se brancher le ciblage du point 6. Fichier : `automationEngine.ts`.
- Risque / à décider par Rafba : pour une règle « à plat » dont le filtre porte sur l'événement d'origine (montant, source),
  on ne rejuge pas : ces valeurs ne changent pas.

### B-05 — Quand le moteur arrête un envoi, il n'écrit pas pourquoi
- Point de la mission : 9 (et 4, 5 : « ignorées, avec la raison »)
- Gravité : majeur
- Ce qu'on voit : la facture est payée pendant le délai ; la tâche est bien annulée, avec le texte « Annulée : la condition
  d'arrêt de la règle est remplie. » — pour une facture payée, un devis accepté, un rendez-vous annulé ou un prospect
  converti, sans distinction. Et rien n'est écrit dans le journal des exécutions : l'arrêt n'existe que sur la tâche.
- Reproduction : `[B9-01]`, `[B9-02]`, `[B9-06]`, `[B9-09]`.
- Preuve : `b-09-revalidation.test.ts::[B9-01] la tâche annulée dit pourquoi…` (et B9-02, B9-06, B9-09) : motif générique.
  En prod (lecture seule) : 16 tâches de vrais bureaux annulées avec ce motif générique, 334 annulées sans aucun motif.
  Drapeau allumé, le motif est bon (`::[B9-01/drapeau]` : « Arrêté : la facture a été payée. »).
- Cause racine : drapeau `auto_sortie_parcours` éteint (toutes les vraies entreprises), `checkStopConditions` rend un
  booléen ; le motif est écrit en dur à `automationEngine.ts:2203`. Aucune ligne `automation_execution_logs` pour une
  annulation (`:2193-2210`).
- Correctif proposé : `checkStopConditions` rend le motif (les textes existent déjà, `sortie-parcours.ts:75-88`) ; chaque
  arrêt écrit une ligne de journal « ignoré » avec un code (`condition_plus_valide`, `entite_supprimee`, `client_supprime`,
  `client_a_repondu`), pour que les statistiques puissent les compter. Fichiers : `automationEngine.ts`, `sortie-parcours.ts`.
- Risque / à décider par Rafba : aucun. (Affichage : agent D.)

### B-06 — Activer « Opportunité qui dort » écrit d'un coup à toutes les opportunités déjà dormantes
- Point de la mission : 10
- Gravité : majeur
- Ce qu'on voit : le propriétaire publie « sans mouvement depuis 7 jours → courriel ». Cinq minutes plus tard, les 20 clients
  dont l'opportunité dormait déjà (depuis 30 jours) reçoivent le courriel, tous ensemble.
- Reproduction : 20 opportunités avec `last_activity_at` il y a 30 jours ; publier la règle ; laisser passer un tick.
- Preuve : `tests/automations-finale/b/b-10-activation.test.ts::[B10-03] au tick qui suit l’activation : AUCUNE des 20
  opportunités…` → « 20 courriels partis d'un coup à l'activation » (`sorties/b/b-10-activation.json`).
- Cause racine : `pipeline_detecter_stagnation()` (`supabase/migrations/20261004200000_deal_sans_mouvement_regle_editeur.sql:26-52`)
  prend tout deal inactif depuis N jours ; rien ne compare à la date de publication de la règle.
- Correctif proposé : ne signaler que les opportunités dont le seuil est franchi APRÈS la publication (il faut une date de
  publication sur la règle ; aujourd'hui seul `updated_at` existe). Option « inclure les cas existants » avec le nombre
  exact et une confirmation, comme le veut la mission. Fichiers : une migration (fonction + colonne), la route de publication
  (`server/lib/automations-publication.ts`), l'éditeur.
- Risque / à décider par Rafba : le défaut (ne rien envoyer aux cas existants) et le texte de la confirmation. Aucune
  règle de ce type n'est publiée dans un vrai bureau aujourd'hui.

### B-07 — Activer « Client inactif » relance tout de suite les clients déjà inactifs (ROUGE ATTENDU — décision requise)
- Point de la mission : 10
- Gravité : majeur
- Ce qu'on voit : publier « aucun job depuis 6 mois → courriel » : au passage horaire suivant, les 20 clients inactifs depuis
  un an reçoivent le message (25 par heure au plus, de 9 h à 19 h), sans qu'on ait demandé confirmation.
- Reproduction et preuve : `b-10-activation.test.ts::[B10-04] ROUGE ATTENDU — décision requise…` → 20 courriels au premier
  passage.
- Cause racine : c'est la conception du déclencheur — une campagne de reconquête (`server/lib/client-inactif.ts:77-150`,
  RPC `clients_inactifs`). Le nombre de clients touchés se calcule déjà (`compterClientsInactifs`, `:68-72`).
- Correctif proposé : à la publication, afficher « X clients correspondent déjà » et demander le choix : seulement ceux
  qui deviendront inactifs, ou aussi ceux-là. Fichiers : route de publication, éditeur, `client-inactif.ts`.
- Risque / à décider par Rafba : le sens voulu du déclencheur. Drapeau `auto_client_inactif` éteint en prod.

### B-08 — Un courriel « facture en retard » peut partir à minuit ; les relances de paiement partent à heure UTC fixe
- Point de la mission : 11
- Gravité : majeur
- Ce qu'on voit : (a) une facture devient « en retard » à minuit, heure de l'entreprise ; une automatisation « à plat »
  (préréglage, règle créée par l'API ou dans l'ancien format) envoie son courriel dans les cinq minutes — à 0 h 05. Le
  texto, lui, attend 8 h. (b) Le cron des relances de paiement part à 13:00 UTC pour toutes les entreprises : 9 h à
  Montréal l'été, 8 h l'hiver, 5 h à Vancouver.
- Reproduction : bureau dont le fuseau est en pleine nuit ; facture échue d'hier ; `detectOverdueInvoices` (le tick).
- Preuve : `tests/automations-finale/b/b-11-heures-envoi.test.ts::[B11-01] automatisation « à plat »…` (« courriel parti à 1 h,
  heure locale de l'entreprise ») et `::[B11-04] une entreprise pour qui il est la nuit ne relance pas ses clients…`
  (« relance envoyée à 1 h »). À l'inverse, la même automatisation faite dans l'éditeur (un parcours) attend 8 h :
  `::[B11-00]` vert. En prod : les 42 « facture en retard » émises pour de vrais bureaux l'ont toutes été à 20 h, heure de
  Toronto (minuit UTC, avant le correctif de fuseau du 28 sept.) ; aucune règle n'y était branchée.
- Cause racine : (a) `shouldRespectQuietHours` (`automationEngine.ts:567-580`) exempte le courriel d'une règle sans délai,
  pensé pour une confirmation attendue — mais un événement de balayage (retard, date atteinte, opportunité qui dort)
  n'est pas une confirmation. Le détecteur tourne jour et nuit (`scheduler.ts:812`). (b) `reminders-cron.ts:310` ne lit
  ni le fuseau ni la fenêtre ; la tâche pg_cron est à `0 13 * * *`.
- Correctif proposé : (a) appliquer la fenêtre à tout message au client né d'un déclencheur de balayage
  (`invoice.overdue`, `date.reached`, `deal.stage_idle`, `client.inactive`), quelle que soit la forme de la règle.
  (b) faire passer le cron des relances chaque heure et ne traiter que les entreprises dans leur fenêtre (l'anti-doublon
  `reminder_log` existe). Fichiers : `automationEngine.ts`, `reminders-cron.ts`, une migration pour l'horaire pg_cron.
- Risque / à décider par Rafba : la fenêtre s'applique-t-elle aux courriels de TOUTES les automatisations sans délai
  (la mission le suggère : « fenêtre d'envoi par défaut de 8 h à 20 h ») ou seulement aux balayages ? Toutes les
  entreprises de prod sont aujourd'hui en `America/Toronto`.

### B-10 — L'étalement des textos : 30 par tick de 5 minutes, pas « 30 par minute » comme on l'annonce au propriétaire
- Point de la mission : 14
- Gravité : majeur
- Ce qu'on voit : 300 factures tombent en retard la même nuit. Le propriétaire reçoit « Les suivants partent au rythme de
  30 par minute ». En réalité 30 partent toutes les cinq minutes : le 300e texto part 45 minutes après le premier (annoncé :
  10). Aucune perte, aucun doublon. Dans la première minute, 37 textos sont partis au lieu de 30.
- Reproduction : `tests/automations-finale/b/b-14-masse.test.ts` (mesure, une fois).
- Preuve : `sorties/b/b-14-masse.json` — `textos_par_tick_de_5_min: [30,30,30,50,30,30,30,30,5]`,
  `minutes_avant_le_dernier_texto: 45`, `partis_dans_la_premiere_minute: 37`, `taches_par_etat: {completed: 265}`,
  `notification_rafale: « …au rythme de 30 par minute… »`. Tests `::[B14-02]` et `::[B14-03]` rouges.
  (`::[B14-01]` était rouge par une erreur de comptage de mon test — 2 textos d'autres factures du même bureau ; corrigée
  dans le fichier sans rejouer la charge : les 300 textos semés sont bien partis, une fois chacun.)
- Cause racine : un texto en rafale est repoussé de 60 s (`automationEngine.ts:1032-1052`, `:2345-2351`), mais la file n'est
  relue qu'au tick suivant : `viderFile` s'arrête dès qu'un lot n'est pas plein (`scheduler.ts:26-39`). Le dépassement de la
  première minute : les 300 événements sont traités en parallèle (l'émetteur n'attend pas les écouteurs,
  `eventBus.ts:229-243`) et chacun compte les textos DÉJÀ journalisés (`rafaleDeTextos`, `:691-704`).
- Correctif proposé : soit relire la file chaque minute tant qu'il reste des textos reportés (une minuterie d'une minute
  dans le tick), soit corriger le texte de la notification (`automationEngine.ts:747`) ; et réserver les 30 places de la
  minute de façon atomique. Fichiers : `scheduler.ts`, `automationEngine.ts`.
- Risque / à décider par Rafba : le débit voulu. À 30 par 5 minutes, 5 000 textos prennent près de 14 heures, pas 2 h 47
  (chiffre de `AUTOMATIONS_TEST_REPORT.md`) ; un rappel « 2 heures avant » pris dans une rafale arrive en retard.

### B-12 — Modifier une automatisation active : le client en cours reçoit un mélange des deux versions, ou sort du parcours sans trace
- Point de la mission : 15
- Gravité : majeur
- Ce qu'on voit : parcours A → 3 jours → B → 3 jours → C. Un client a reçu A et attend B. Le propriétaire réécrit les trois
  messages. Le client reçoit l'ANCIEN B puis le NOUVEAU C. S'il a raccourci l'attente à 1 jour, ce client attend quand
  même 3 jours. S'il a supprimé la carte B et en a posé une neuve à la place, le client ne reçoit plus rien.
- Reproduction : `PATCH /api/automations/rules/:id` pendant qu'une tâche attend.
- Preuve : `tests/automations-finale/b/b-15-modification.test.ts::[B15-01] le client reçoit une seule version…` (« V1 étape A |
  V1 étape B | V2 étape C »), `::[B15-02] attente passée de 3 jours à 1 jour…` (« reste prévue dans 3 jour(s) »),
  `::[B15-03] le message B est supprimé puis recréé…` (« reçu : V1 étape A ; b=cancelled (Étape supprimée du parcours :
  envoi annulé.) »).
- Cause racine : la tâche porte une COPIE de l'action et son échéance (`automationSequences.ts:417-444`,
  `automationEngine.ts:1363-1372`) ; elle est exécutée telle quelle (`:2121-2123`). L'étape SUIVANTE est relue dans la règle
  (`:2527-2545`). Une étape dont l'identifiant a disparu annule la tâche et rien ne planifie la suite (`:2023-2033`). La
  route PATCH ne touche pas aux tâches en attente.
- Correctif proposé : choisir UNE règle et l'écrire dans l'éditeur. Proposition : « la nouvelle version s'applique à tout ce
  qui n'est pas encore parti » — à l'exécution, relire l'action de l'étape dans `task.automation_rules.steps` (déjà chargé)
  au lieu de la copie ; au PATCH, recalculer l'échéance des tâches dont l'attente a changé ; et avant de supprimer une étape
  où des clients attendent, le dire (« 3 clients attendent ici ») et les faire passer à l'étape suivante. Fichiers :
  `automationEngine.ts`, `server/routes/automation-rules.ts`, l'éditeur.
- Risque / à décider par Rafba : ancienne ou nouvelle version pour les clients en cours (B15-02 est rouge sur ce choix).

### B-13 — Un redémarrage du serveur pendant une action immédiate la perd pour toujours
- Point de la mission : 2 (« jobs en attente qui survivent à un redémarrage »)
- Gravité : majeur
- Ce qu'on voit : un déploiement tombe pendant qu'une confirmation part. L'événement est bien rejoué trois minutes plus
  tard, mais la confirmation n'est jamais envoyée ; dans les Journaux, la ligne reste « en cours ».
- Reproduction : `QA_AUTO_SUFFIXE=b node --import tsx scripts/qa/finale/b/redemarrage.mts` (un processus émet 30 événements,
  il est tué par SIGKILL, les orphelins sont rejoués par le chemin de l'outbox).
- Preuve : `sorties/b/redemarrage.json` — 12 événements consignés et orphelins, 12 rejoués, **11 courriels**, 1 journal resté
  « en cours » (essai précédent : 10 courriels sur 12). Et, de façon déterministe,
  `tests/automations-finale/b/b-02-redemarrage.test.ts::[B2-10] la confirmation réservée mais jamais envoyée PART au rejeu`
  (« aucun courriel ; journal : send_email en cours »). En prod à 23:14 UTC : 0 réservation orpheline (le cas ne s'y est
  pas encore produit, ou pas laissé de trace) ; le serveur a redémarré trois fois en 30 minutes ce soir-là (22:35, 22:57,
  23:05 UTC).
- Cause racine : `reserverActionImmediate` écrit « en cours » AVANT d'exécuter, et au rejeu tient pour faite toute action
  « réussie — ou encore en cours » (`automationEngine.ts:839-855`, filtre `result_error.eq."en cours"`). Une réservation
  laissée par un processus mort bloque donc le rejeu.
- Correctif proposé : au rejeu, une réservation « en cours » vieille de plus que le délai maximal d'une action (5 s, plus
  une marge) est orpheline : la reprendre (mise à jour atomique de la ligne) et exécuter — le courriel et le texto ont déjà
  leur garde « déjà envoyé depuis » contre le doublon. Fichier : `automationEngine.ts`.
- Risque / à décider par Rafba : aucun.

### B-14 — « Note ajoutée » et « Tâche terminée » ne partent que depuis UN écran
- Point de la mission : 2
- Gravité : majeur
- Ce qu'on voit : une automatisation « Note ajoutée → … » ne réagit pas à une note écrite dans l'onglet Notes d'un client
  ou d'un job, ni à une note ajoutée par Lumi. « Tâche terminée → … » ne réagit pas à une tâche terminée par Lumi (ni par
  toute écriture qui n'est pas l'écran des tâches).
- Reproduction : appeler les outils `add_note` et `update_task_status` par la vraie garde de Lumi, sans modèle.
- Preuve : `tests/automations-finale/b/b-02-producteurs.test.ts::[B2-01] une note ajoutée par Lumi…` (aucun événement
  `note.added`) et `::[B2-02] une tâche marquée terminée par Lumi…` (aucun `task.completed`).
- Cause racine : `note.added` n'est émis que par `POST /api/activity-notes` (`server/routes/activity-notes.ts:100`, le fil
  d'activité) ; l'onglet Notes écrit `specific_notes` en direct (`src/lib/specificNotesApi.ts`), Lumi aussi
  (`server/lib/agent/tools-etendus.ts:3406`). `task.completed` n'est émis que par un appel du navigateur après l'écriture
  (`src/lib/tasksApi.ts:198,232` → `server/routes/automation-events.ts:628`) ; Lumi écrit `tasks` en direct
  (`tools-etendus.ts:3114`). Même fragilité pour `job.ready_for_invoicing` (navigateur seulement).
- Correctif proposé : faire écrire ces événements par la base, comme pour les devis et les factures : trigger sur `tasks`
  (statut → `done`) et sur `specific_notes` / `activity_notes` (INSERT) vers `automation_evenements_base`. Fichiers : une
  migration, `server/lib/evenementsBase.ts` ; retirer ensuite l'appel du navigateur de `tasksApi.ts`.
- Risque / à décider par Rafba : « Note ajoutée » doit-elle couvrir l'onglet Notes ? (le libellé du déclencheur le laisse
  croire). Les fichiers d'outils de Lumi sont dans la zone de la session a1 : le correctif par trigger n'y touche pas.

### B-15 — Drapeau « désabonnement par canal » allumé : un texto de rappel part à un client mis à la corbeille
- Point de la mission : 13
- Gravité : majeur le jour où le drapeau `auto_desabonnement_canal` est allumé (éteint aujourd'hui en prod)
- Ce qu'on voit : le client est supprimé pendant le délai ; son rappel de rendez-vous par texto part quand même.
- Preuve : `tests/automations-finale/b/b-15-modification.test.ts::[B13-01] rappel de rendez-vous par texto : le client a été mis
  à la corbeille…` (1 texto parti, tâche `completed`). Drapeau éteint, rien ne part, mais par accident : l'envoi est
  « sauté » par le contrôle du consentement avec le motif « destinataire inconnu du carnet de clients »
  (`sorties/b/b-09-revalidation.json`, cas B9-08, B9-12, B9-14).
- Cause racine : `clientDeLaTacheSupprime` ne regarde que les tâches dont l'entité EST le client
  (`automationEngine.ts:2850-2868`, `if (entityType !== 'client' && entityType !== 'lead') return false`). Pour un devis, un
  job ou une visite, le client supprimé n'est vérifié nulle part (sauf pour une facture, `:2913-2919`).
- Correctif proposé : remonter au client par `clientDeLaTache` (`:2705`) pour tous les types, puis lire `deleted_at`.
  Fichier : `automationEngine.ts`.
- Risque / à décider par Rafba : aucun. À corriger AVANT d'allumer le drapeau.

### B-18 — « Date atteinte » : un passage manqué n'est jamais rattrapé
- Point de la mission : 2 (« que se passe-t-il s'il plante ou rate une exécution ? »)
- Gravité : majeur
- Ce qu'on voit : le balayage des dates tourne une fois par jour (12:15 UTC). S'il ne tourne pas ce jour-là — déploiement
  à cette minute, base saturée, serveur en panne — les rappels du jour (fin de contrat, entretien annuel) ne partent
  jamais : le lendemain, on cherche les dates du lendemain.
- Reproduction : champ date d'un client = hier ; règle `date.reached`, 0 jour avant ; lancer le balayage aujourd'hui.
- Preuve : `b-10-activation.test.ts::[B10-05] …un balayage manqué hier n’est PAS rattrapé aujourd’hui` (1 seul envoi : la date du
  jour ; celle d'hier, rien). En prod : `lume_rappels_dates` = 1 passage par jour, sans verrou ni surveillance ; sur les
  7 derniers jours, pg_cron a manqué 49 démarrages de tâches (« job startup timeout », base saturée) ; le serveur a
  redémarré trois fois en 30 minutes le 1er octobre au soir.
- Cause racine : `server/lib/rappels-dates.ts` ne lit que `value_date = jour visé` ; `cron.job` n° 43 `15 12 * * *` →
  `trigger_cron_api` (`supabase/migrations/20261004200200_…sql:27-66`) : un seul `net.http_post`, sans reprise ; la route
  `server/routes/cron.ts:94-104` n'a pas de verrou.
- Correctif proposé : balayer une fenêtre de quelques jours en arrière avec une réservation par (règle, fiche, date) —
  le modèle existe pour les clients inactifs (`clients_inactifs_declenches`) — et lancer le balayage depuis le tick
  (sous verrou) plutôt qu'une fois par jour. Fichiers : `rappels-dates.ts`, `scheduler.ts`, une migration.
- Risque / à décider par Rafba : jusqu'à combien de jours de retard un rappel sur date a encore un sens (proposition : 2).
  Aucune règle de ce type n'est publiée dans un vrai bureau aujourd'hui.

---

## Mineurs

### B-09 — Un message reporté « hors heures d'envoi » ne laisse aucune ligne au journal
- Point de la mission : 11 (« reporté au prochain créneau, loggé »)
- Gravité : mineur
- Ce qu'on voit : le texto déclenché la nuit est bien reporté à 8 h, heure de l'entreprise, mais les Journaux de
  l'automatisation sont vides jusqu'à l'envoi : on ne peut pas répondre à « pourquoi il n'est pas parti ? ».
- Preuve : `b-11-heures-envoi.test.ts::[B11-03] le report « hors heures d’envoi » laisse une ligne lisible…` (0 ligne) ;
  `::[B11-02]` vert (le report lui-même est juste, y compris le fuseau).
- Cause racine : `automationEngine.ts:1005-1030` (immédiat) et `:2050-2091` (file) écrivent ou déplacent la tâche, sans
  journal ; seul `action_config.report_heures_calmes` le dit.
- Correctif proposé : une ligne « reporté : hors heures d'envoi, partira à 8 h 00 » (une seule par tâche). Fichier :
  `automationEngine.ts`.
- Risque / à décider par Rafba : aucun.

### B-11 — Les courriels d'une rafale ne sont pas régulés (NON VÉRIFIÉ en prod)
- Point de la mission : 14
- Gravité : mineur
- Ce qu'on voit : 300 courriels « facture en retard » partent en 27 secondes, avec une pointe de 32 dans la même seconde
  (pile locale). Aucun échec, aucun effet mesurable sur une lecture ordinaire de l'app (95e centile : 34 ms pendant la
  rafale, 40 ms au repos).
- Preuve : `sorties/b/b-14-masse.json` (`courriels`) ; `b-14-masse.test.ts::[B14-11]` rouge sur un seuil de 14 par seconde,
  qui est le quota SES par défaut et PAS une valeur lue en prod.
- Cause racine : aucun étalement pour le courriel ; les écouteurs tournent en parallèle (`eventBus.ts:229-243`).
- Correctif proposé : lire le vrai quota SES du compte, puis borner le nombre d'envois simultanés (file d'attente simple
  dans `server/lib/mailer.ts`).
- Ce que je n'ai pas pu vérifier : le quota SES de prod (pas d'accès AWS) ; en prod chaque émission attend deux écritures
  en base, donc le débit réel y est plus bas que sur la pile locale.

### B-16 — Fusion de deux fiches : le client gardé sort du parcours, et le journal dit « le client a été supprimé »
- Point de la mission : 13
- Gravité : mineur
- Ce qu'on voit : deux fiches du même client sont fusionnées pendant qu'une relance attend sur la fiche absorbée. La
  relance est annulée (rien ne part, c'est propre), mais avec le motif « Annulée : le client a été supprimé. » et le client
  — qui existe toujours — ne reçoit pas la suite.
- Preuve : `b-09-revalidation.test.ts::[B9-15]` vert (aucun message) ; motif relevé dans `sorties/b/b-09-revalidation.json`.
- Cause racine : `fusionner_clients` (fonction SQL) repointe toutes les clés étrangères vers la fiche gardée, mais
  `automation_scheduled_tasks.entity_id` n'est pas une clé étrangère : la tâche reste sur la fiche absorbée, que le moteur
  trouve à la corbeille.
- Correctif proposé : dans `fusionner_clients`, repointer les tâches `pending` de la fiche absorbée vers la fiche gardée,
  ou les annuler avec « fiche fusionnée ». Fichier : une migration.
- Risque / à décider par Rafba : continuer sur la fiche gardée, ou arrêter.

### B-19 — Le tick du planificateur, seul à écrire aux clients, n'est surveillé par rien
- Point de la mission : 2
- Gravité : mineur (majeur le jour où il s'arrête)
- Ce qu'on voit : si le tick de 5 minutes se fige, rien ne le dit : ni alerte, ni `/api/health`. Les relances s'arrêtent
  en silence.
- Preuve : `grep -n "withCronCheckIn\|captureCronFailure" server/lib/scheduler.ts server/lib/evenementsBase.ts
  server/lib/pipelineEvenements.ts server/routes/cron.ts server/routes/reminders-cron.ts` → aucune ligne, alors que les
  tâches voisines (clients inactifs, rapports planifiés, reprises de courriels) en ont. `/api/health` ne rend que
  `status, uptime, db_ms, courriel`. Observation en prod : au démarrage de 22:35:07 UTC, le verrou `automation-scheduler`
  pris à 22:35:08 était encore tenu à 22:43:10 (8 min, pour un bail de 10) ; libéré à 22:45:23. Au démarrage suivant
  (22:57), il était libre moins de 4 minutes après.
- Ce que je n'ai pas pu vérifier : pourquoi ce tick a duré plus de 8 minutes (pas d'accès aux journaux de Railway). Si un
  tick dépasse 10 minutes, le bail expire et un second processus peut le doubler (déjà noté dans
  `AUTOMATIONS_TEST_REPORT.md`, « Risques restants »).
- Correctif proposé : `withCronCheckIn('automation-scheduler', …)` autour du tick, l'heure du dernier tick et l'âge du plus
  vieil élément des trois files dans `/api/health`. Fichiers : `scheduler.ts`, la route de santé.
- Risque / à décider par Rafba : aucun.

### B-20 — L'ancien système d'automatisations tourne encore à chaque tick, pour rien
- Point de la mission : P6 (et carte de la phase 0)
- Gravité : mineur
- Ce qu'on voit : rien pour l'utilisateur. À chaque tick, le serveur lit la table `automations` et l'ancienne récurrence
  de factures, hors pause d'entreprise et hors arrêt global.
- Preuve : prod, lecture seule : `automations` = 0 ligne, `invoices.is_recurring` = 0 facture. `grep -rn "from('automations')"
  server src scripts` → `server/lib/scheduler.ts:851` seul.
- Cause racine et liste exacte du code à retirer : `notes/B-carte.md`, « Code mort ou parallèle à retirer ».
- Correctif proposé : retirer `scheduler.ts:41-59, 95-130, 135-330, 361-495, 497-605, 772, 850-888` et les trois aides de
  `scheduler-utils.ts` ; garder `detectOverdueInvoices`, `expireOverdueQuotes`, `viderFile`. Table `automations` : à
  proposer à Rafba, pas à supprimer.
- Risque / à décider par Rafba : garder un seul des deux systèmes de relance de factures (`reminder_settings` + cron, ou
  le déclencheur « Facture en retard »).

### B-21 — Le filet de la suite de tests devient aveugle au-delà de 1 000 envois simulés
- Point de la mission : règles (« tous les envois routés vers un mock, prouve-le »)
- Gravité : mineur
- Ce qu'on voit : après un test de charge, un test qui affirme « aucun envoi » peut passer au vert à tort.
- Preuve : `tests/automations-finale/b/b-00-harnais.test.ts::[B0-01] le 1 001e envoi de la fenêtre est vu par envoisSimules()`
  (« 1000 lignes lues : le dernier envoi n'y est pas »). Vécu pendant cette enquête : après la mesure de charge, mon
  test B11-01 ne voyait plus un courriel pourtant parti.
- Cause racine : `tests/automations-suite/harnais/moteur.ts:138-145` lit toute la fenêtre en ordre croissant, sans
  pagination ; PostgREST plafonne à 1 000 lignes (`PGRST_DB_MAX_ROWS`, comme Supabase). `envoisMarques`
  (`tests/automations-suite/integration/20-cde-outils.ts`) élargit encore la fenêtre de 10 minutes.
- Correctif proposé : filtrer par la marque côté base (ce que fait `envoisAvec` dans `tests/automations-finale/b/outils-b.ts`)
  ou paginer. Fichier : `harnais/moteur.ts`.
- Risque / à décider par Rafba : aucun.

---

## Manque (fonction absente)

### B-17 — Une automatisation n'a qu'un seul déclencheur
- Point de la mission : 18
- Gravité : majeur pour le point 18, sans effet aujourd'hui
- Ce qu'on voit : impossible de faire « devis envoyé OU facture envoyée → … » dans une même automatisation.
- Preuve : `b-15-modification.test.ts::[B18-01] l’éditeur peut enregistrer une automatisation à DEUX déclencheurs` — la route
  répond 201 et IGNORE le champ `triggers` (la règle enregistrée n'a que `trigger_event: quote.sent`).
- Cause racine : `automation_rules.trigger_event` est un texte ; le moteur cherche `eq('trigger_event', event.type)`
  (`automationEngine.ts:1430`) ; Zod : `z.enum(CLES_DECLENCHEURS)`.
- Correctif proposé : une colonne `trigger_events text[]` (ou garder `trigger_event` comme premier et ajouter les autres),
  recherche par « contient », et la clé d'exécution SANS le déclencheur — elle l'est déjà (`règle:entité:étape`,
  `automationSequences.ts:185`), donc « un client entré par deux déclencheurs = une seule exécution » tient sans rien
  changer. Ré-entrée : `settings.reentree`, prouvé par D-030 et D-031.
- Risque / à décider par Rafba : fonction du bloc P5, à bâtir après P1-P3.

---

## Non vérifiés par exécution (lecture du code seulement)

### B-22 — NON VÉRIFIÉ — Relances de paiement : au-delà de 500 factures en retard par palier, certaines ne sont jamais relancées
- Point de la mission : 14
- Gravité : mineur
- Ce qu'on a vu : une fois, pendant l'enquête — avec 600 factures en retard dans le bureau de test, le cron n'a pas traité
  la facture du test B11-04 (le test a été déplacé dans l'autre bureau). Pas de test dédié.
- Cause racine : `server/routes/reminders-cron.ts:380` — `.limit(500)` sans `order`.
- Correctif proposé : paginer avec un ordre stable, comme `detectOverdueInvoices` (`scheduler.ts:630-651`).

### B-23 — NON VÉRIFIÉ — « Nouveau prospect » ne part pas pour un prospect créé par le porte-à-porte
- Point de la mission : 2
- Gravité : mineur
- Cause supposée : `server/routes/field-sales.ts:316`, `server/lib/fieldPinSync.ts:358` et
  `server/lib/leadClientSync.ts:74` insèrent un client `status: 'lead'` sans `eventBus.emit('lead.created')` (aucun `emit`
  dans ces fichiers).
- Correctif proposé : un trigger sur `clients` (INSERT avec `status = 'lead'`) vers `automation_evenements_base`.

### B-24 — NON VÉRIFIÉ — « Opportunité qui dort » ne prévient qu'une fois par étape, pour toujours
- Point de la mission : 18 (ré-entrée)
- Gravité : mineur
- Cause supposée : clé d'unicité `idle:<deal>:<règle>:<jours>:<étape>` (`supabase/migrations/20261004200000_…sql:62-65`),
  sans date : une opportunité relancée, qui se rendort dans la MÊME étape trois mois plus tard, ne déclenche plus rien.
- Correctif proposé : ajouter à la clé la date de la dernière activité (jour).

---

## Ce qui est déjà prouvé ailleurs (cité, pas refait)
- Désactivée, en brouillon, à la corbeille, purgée, supprimée → ne part jamais : C-001 à C-004, C-010 à C-013, B-324.
- Chaînes (A déclenche B) : B-130, B-503. Boucles (A → B → A) : D-040 (étiquettes), D-041 (démarrer), D-042 (opportunités).
- Idempotence, doublons, ré-entrée : D-010, D-030, D-031 ; reprise après arrêt simulé : E-020 à E-023.
- Attente « avant la date » relue à l'échéance : A-300, A-304, B-314. Étalement à 30 textos : F-082, F-084.
- Étape supprimée → tâche annulée avec son motif : C-032 (mais voir B-12 : le client sort du parcours).
- Événements perdus pendant « Tout arrêter » ou l'arrêt global : `AUTOMATIONS_INVENTORY.md`, §9 n° 18.

## Ce que je n'ai pas pu vérifier
- La réponse HTTP des trois tâches pg_cron quotidiennes (pg_net ne garde les réponses qu'une heure) : prouvé seulement pour
  `webhook-retries` (six réponses 200), qui passe par la même fonction et le même secret.
- Qui d'autre que Railway fait tourner un serveur branché sur la base de prod : tout serveur lancé avec les clés de prod
  et les tâches de fond prend le verrou et dépile la file (le code le rappelle, `server/index.ts:1393-1398`).
- Le quota SES et les limites Twilio du compte de prod ; l'état du dossier Trust Hub. Un seul vrai bureau a un numéro
  texto actif.
- La réponse d'un client par COURRIEL (boîte Gmail connectée) : hors bac à sable, comme B-091.
- La cause du tick de plus de 8 minutes observé à 22:35 UTC.
- Rien n'a été envoyé, rien n'a été écrit en prod, aucune route `/api/cron/*` de prod n'a été appelée ; staging non touché.
