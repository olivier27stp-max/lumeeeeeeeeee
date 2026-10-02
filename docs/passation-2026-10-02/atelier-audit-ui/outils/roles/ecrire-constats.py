# -*- coding: utf-8 -*-
"""Écrit sorties/roles/constats.jsonl : UNIQUEMENT des défauts du produit observés (réponse reçue ou ligne lue en base), avec leur preuve."""
import io
import json

P = 'D:/lume-uiaudit/sorties/roles/'
C = []


def c(**k):
    C.append(k)


c(id="roles-01", ids_carte=["S-02", "API-34", "API-35", "API-38", "API-39", "API-40"],
  ecran="API serveur — routes d’événements /api/automations/events/*",
  element="Garde de permission (rbacMiddleware) devant les routes d’événements",
  attendu="Un technicien (ni automations.update, ni clients.update, ni leads.update) reçoit 403 quel que soit l’habillage du chemin, et aucun événement n’est émis.",
  observe="Avec le jeton du technicien, sur l’API Express directe (:3112) ET par le mandataire Vite : POST /api/automations/events/lead-created/ (barre finale), /events/LEAD-CREATED (casse), /api//automations/events/lead-created (double barre), /API/automations/events/lead-created → 200 {\"ok\":true} alors que le chemin exact répond 403. Idem lead-status-changed/, quote-sent/, deal-stage-changed/, client-tagged/. Effet en base : une ligne activity_log par événement au nom du technicien (lead_created, status_changed, quote_sent, deal_stage_changed, client_tagged) ; les automatisations publiées du bureau ont tourné (journal : lead.created → send_sms [sauté ici : aucun numéro texto sur cette instance] + create_notification « New lead » créée ; quote-sent/ → tâche de relance de devis planifiée pour le lendemain). D’après le code, en production avec un numéro texto, le préréglage « nouveau prospect » écrit au client : envoi réel À VÉRIFIER hors bac à sable impossible, l’exécution de la règle est prouvée.",
  gravite="bloquant",
  capture=P + "preuves/S-02-evenements.error-context.md ; " + P + "sonde-securite.txt (bloc « S-02 » : lignes « tech POST …/events/… » et « activity_log par le technicien » ; bloc « S-06 » : journaux et file) ; " + P + "preuves/notifications-en-anglais.txt",
  test="50-soupcons-securite.spec.ts › [S-02] événements : une barre finale, une autre casse ou une double barre ne laissent PAS un technicien déclencher les automatisations @defaut",
  cause_probable="server/lib/route-permissions.ts:424-447 et :521-522 — la règle est cherchée par correspondance EXACTE de « MÉTHODE chemin » ; sans règle trouvée la requête continue (« let route handler's own auth handle it »). Express route sans « strict routing » ni « case sensitive routing » : barre finale, casse et double barre atteignent le même handler, qui lit en service_role (server/routes/automation-events.ts) et ne revérifie aucune permission. Vaut pour toute entrée de ROUTE_PERMISSIONS, pas seulement les automatisations (hors lot : à vérifier).")

c(id="roles-02", ids_carte=["S-02", "API-04"],
  ecran="API serveur — POST /api/automations/rules/generer",
  element="Garde de permission devant « Construire avec Lumi »",
  attendu="403 pour un technicien et pour un membre en lecture seule, quel que soit l’habillage du chemin.",
  observe="Chemin exact : 403 « Permission denied: automations.update ». Avec /generer/ (barre finale), /GENERER, /api/Automations/…, /API/automations/…, /api//automations/…, /generer/?x=1 : 422 {\"error\":\"Lumi n’est pas configuré.\"} pour techA et lecteurA — le handler du générateur est atteint. Lumi n’est pas branché sur cette instance ; d’après le code (server/routes/automation-rules.ts:310-482, budget réservé en service_role) l’appel au modèle serait facturé au budget Lumi du bureau : À VÉRIFIER sur l’instance Lumi.",
  gravite="majeur",
  capture=P + "preuves/S-02-generer.error-context.md ; " + P + "sonde-securite.txt (bloc « S-02 », 10 premières lignes)",
  test="50-soupcons-securite.spec.ts › [S-02] « Construire avec Lumi » : le même appel avec une barre finale, une autre casse ou une double barre reste refusé (403) à un technicien et à un membre en lecture seule @defaut",
  cause_probable="server/lib/route-permissions.ts:424-447, :521-522 — même cause que roles-01 ; le handler n’a pas de contrôle de permission propre.")

c(id="roles-03", ids_carte=["S-02", "API-01", "API-02", "API-06", "API-12", "API-16", "API-18", "API-20", "API-27"],
  ecran="API serveur — lectures /api/automations/*",
  element="Garde de permission devant les routes de lecture",
  attendu="403 pour un technicien, comme par le chemin exact.",
  observe="Jeton du technicien : GET /api/automations/rules/ et /api/AUTOMATIONS/rules → 200 {\"rules\":[],\"catalogue\":{…}} ; /pause/ → 200 {\"paused\":false,\"pausedAt\":null} (état réel du bureau) ; /templates/ → 200 (catalogue complet des modèles) ; /editeur/?rule_id=… → 200 {\"rule\":null,\"catalogue\":…} ; /rules/stats/, /folders/, /webhooks/, /bureaux-cibles/ → 200 (vides). La RLS tient : aucune règle, aucun dossier ni adresse d’appel du bureau n’est rendu. Ce qui sort : l’état « Tout arrêter » du bureau et les catalogues.",
  gravite="majeur",
  capture=P + "preuves/S-02-lectures.error-context.md ; " + P + "sonde-securite.txt (bloc « S-02 », lignes « tech GET … »)",
  test="50-soupcons-securite.spec.ts › [S-02] lectures : par un chemin équivalent, un technicien reçoit 403 comme par le chemin exact @defaut",
  cause_probable="server/lib/route-permissions.ts:424-447, :521-522 — même cause que roles-01 ; la policy company_settings_select_org ouvre company_settings à toute adhésion (supabase/SCHEMA_SNAPSHOT.md:4893-4894).")

c(id="roles-04", ids_carte=["S-02", "API-30", "API-31", "API-36", "API-37"],
  ecran="API serveur — routes d’événements sans authentification propre",
  element="POST /api/automations/events/{invoice-paid, appointment-created, appointment-cancelled, quote-approved}/",
  attendu="401 sans jeton, comme par le chemin exact.",
  observe="SANS AUCUN JETON, avec une barre finale : 200 {\"ok\":true,\"via\":\"base\"} sur les quatre routes (le chemin exact répond 401). Ces quatre handlers ne font rien aujourd’hui (l’événement naît d’un trigger en base) : aucun effet, mais la seule authentification de ces routes est la garde contournée.",
  gravite="majeur",
  capture=P + "preuves/S-02-sans-jeton.error-context.md ; " + P + "sonde-securite.txt (lignes « anonyme POST … »)",
  test="50-soupcons-securite.spec.ts › [S-02] sans jeton : une route d’événement appelée avec une barre finale répond 401, comme par le chemin exact @defaut",
  cause_probable="server/routes/automation-events.ts:23, :33, :330, :340 — handlers sans requireAuthedClient ; server/lib/route-permissions.ts:521-522.")

c(id="roles-05", ids_carte=["S-04", "RLS-01"],
  ecran="Base — table automation_rules par PostgREST",
  element="Colonne is_active écrite directement par un rôle qui a automations.update",
  attendu="Un parcours que la route de publication refuse (422 « Publication refusée : « Envoyer un texto » : « Texte du message » est vide ») ne peut pas être publié par une écriture directe.",
  observe="Admin puis membre « read + update » : update automation_rules set is_active = true par supabase-js sur la règle au texto vide → accepté, la base rend is_active:true. La même règle par POST /rules/:id/publication → 422.",
  gravite="majeur",
  capture=P + "preuves/S-04-publier.error-context.md ; " + P + "sonde-securite.txt (bloc « S-04 / S-17 », 2 premières lignes)",
  test="50-soupcons-securite.spec.ts › [S-04] publier directement en base un parcours que le serveur refuse de publier est refusé @defaut",
  cause_probable="supabase/SCHEMA_SNAPSHOT.md:4714-4716 — policy UPDATE = automations.update, sans restriction de colonne ; supabase/baseline/01_schema.sql:57556-57557 — GRANT ALL à authenticated ; aucun trigger de garde. Les contrôles de publication n’existent que dans Express (server/lib/automations-publication.ts:68-79).")

c(id="roles-06", ids_carte=["S-04", "RLS-01"],
  ecran="Base — table automation_rules par PostgREST",
  element="Colonnes is_preset, preset_key, trigger_event",
  attendu="Ces colonnes appartiennent au serveur : une règle ne devient pas « fournie », sa clé ne s’invente pas, son déclencheur reste dans le catalogue.",
  observe="Membre « read + update » : update { is_preset: true, preset_key: 'invente_par_le_navigateur' } puis { trigger_event: 'declencheur.inexistant' } → acceptés ; relu par le service : is_preset=true, preset_key='invente_par_le_navigateur', trigger_event='declencheur.inexistant'. Ce que la base refuse bien (observé) : changer org_id vers un autre bureau et insérer dans un autre bureau — « new row violates row-level security policy ».",
  gravite="majeur",
  capture=P + "preuves/S-04-colonnes.error-context.md ; " + P + "sonde-securite.txt (bloc « S-04 / S-17 », ligne « éditeur is_preset… »)",
  test="50-soupcons-securite.spec.ts › [S-04] `is_preset`, `preset_key` et le déclencheur ne se réécrivent pas directement en base @defaut",
  cause_probable="Même cause que roles-05 ; aucune contrainte CHECK sur trigger_event (supabase/baseline/01_schema.sql:20406-20428). Le seeder et checkStopConditions s’appuient sur (preset_key, trigger_event) — server/routes/automation-rules.ts:512-521.")

c(id="roles-07", ids_carte=["S-04", "RLS-01"],
  ecran="Base — table automation_rules par PostgREST",
  element="Corbeille, purge et suppression dure d’une automatisation fournie",
  attendu="Comme par le serveur (DELETE /rules/:id → 400 « Une automatisation fournie ne se supprime pas ») : un préréglage ne va ni à la corbeille ni à la purge, et aucune ligne n’est supprimée pour de bon.",
  observe="Membre « read + update » sur une règle is_preset=true : update { deleted_at, purged_at } → accepté (les deux dates sont posées) ; puis DELETE → la ligne n’existe plus. La sonde a aussi supprimé pour de bon une règle ordinaire (DELETE rendu avec l’id).",
  gravite="majeur",
  capture=P + "preuves/S-04-prereglage.error-context.md ; " + P + "sonde-securite.txt (bloc « S-04 / S-17 », lignes « éditeur is_preset… » et « éditeur DELETE dur »)",
  test="50-soupcons-securite.spec.ts › [S-04] une automatisation FOURNIE (préréglage) ne se met pas à la corbeille, ne se purge pas et ne se supprime pas en direct, comme le serveur l’interdit @defaut",
  cause_probable="supabase/SCHEMA_SNAPSHOT.md:4708-4709 — policy DELETE ouverte à automations.update ; privilège DELETE accordé à authenticated. La règle « jamais de suppression dure » (corbeille + purged_at, server/routes/automation-rules.ts:743-892) n’existe pas en base.")

c(id="roles-08", ids_carte=["S-05", "API-05"],
  ecran="API serveur — PATCH /api/automations/rules/:id",
  element="Publication d’une règle à la corbeille par PATCH",
  attendu="Refus, comme la route de publication (422 « Cette automatisation est à la corbeille : restaurez-la avant de la publier. »).",
  observe="Admin : PATCH { is_active: true } sur une règle dont deleted_at est posé → 200 ; en base : {\"is_active\":true,\"deleted_at\":\"2026-10-01T15:20:46.872+00:00\"}. La route /publication sur la même règle répond 422. D’après le code (non observé), le moteur ignore les règles à la corbeille : pas d’envoi, mais un état incohérent « publiée + supprimée ».",
  gravite="mineur",
  capture=P + "sonde-securite.txt (bloc « S-05 corbeille », 3 premières lignes)",
  test="50-soupcons-securite.spec.ts › [S-05] `PATCH /rules/:id { is_active: true }` sur une règle à la corbeille est refusé, comme la route de publication @defaut",
  cause_probable="server/routes/automation-rules.ts:493-498 — la lecture avant modification ne filtre ni deleted_at ni purged_at ; :532-535 rejoue problemesBloquants mais pas le contrôle de corbeille de server/lib/automations-publication.ts:69-74.")

c(id="roles-09", ids_carte=["S-05", "API-08"],
  ecran="API serveur — POST /api/automations/rules/:id/duplicate",
  element="Duplication d’une règle supprimée définitivement",
  attendu="404 : une règle supprimée définitivement n’existe plus pour l’utilisateur.",
  observe="Admin : duplicate sur une règle dont purged_at est posé → 201, une copie « … purgée (copie) » naît en brouillon. Restaurer la même règle répond bien 404 « Automatisation introuvable dans la corbeille. » et l’éditeur rend rule:null.",
  gravite="mineur",
  capture=P + "sonde-securite.txt (bloc « S-05 corbeille », ligne « duplicate d’une règle supprimée définitivement »)",
  test="50-soupcons-securite.spec.ts › [S-05] dupliquer une règle supprimée DÉFINITIVEMENT est refusé (404) : elle ne ressuscite pas @defaut",
  cause_probable="server/routes/automation-rules.ts:694-699 — lecture de la source sans filtre deleted_at / purged_at.")

c(id="roles-10", ids_carte=["S-05", "API-29", "API-02"],
  ecran="API serveur — POST /rules/:id/apercu et GET /editeur",
  element="« Tester » et ouvrir une règle à la corbeille",
  attendu="Une règle à la corbeille ne se teste pas et ne s’ouvre pas dans l’éditeur sans passer par « Restaurer ».",
  observe="Admin : POST /rules/:id/apercu sur une règle à la corbeille → 200 avec l’aperçu rendu sur un vrai client (nom, courriel, téléphone) ; GET /editeur?rule_id=<règle à la corbeille> → 200 avec la règle complète. L’effet à l’écran (ouvrir /automations/<id à la corbeille>) reste À VÉRIFIER.",
  gravite="mineur",
  capture=P + "sonde-securite.txt (bloc « S-05 corbeille », lignes « GET editeur » et « POST apercu »)",
  test="50-soupcons-securite.spec.ts › [S-05] « Tester » (aperçu) une règle à la corbeille est refusé @defaut",
  cause_probable="server/routes/automation-test.ts:329-334 et server/routes/automation-rules.ts:178 — pas de filtre deleted_at.")

c(id="roles-11", ids_carte=["S-06", "API-28"],
  ecran="API serveur — GET /api/automations/test",
  element="Batterie de diagnostic rendue à tout propriétaire / admin d’un bureau client",
  attendu="Aucune information de la plateforme (compte SMTP, SID et numéro Twilio) ni détail interne de la file dans une réponse faite à un client ; messages dans la langue du compte.",
  observe="Admin du bureau de test : 200. La réponse contient « SMTP email configured … SMTP user: piege@lume-qa.test » = la valeur de la variable d’environnement SMTP_USER du serveur (fournisseur factice sur cette instance). Elle contient aussi les clés d’exécution des 10 prochaines tâches de la file, les 10 derniers journaux, les variables résolues d’un rendez-vous (nom, téléphone, courriel du client, coordonnées du bureau), le tout en anglais ; la liste des 18 préréglages « attendus » est périmée (1 contrôle en échec sur 25). Twilio étant vide ici, la ligne rendue est « Twilio not configured » ; d’après le code (automation-test.ts:266) la production rendrait « SID=<8 premiers caractères>…, Phone=<numéro Twilio de la plateforme> » : À VÉRIFIER en production. Aucun écran n’appelle cette route.",
  gravite="majeur",
  capture=P + "sonde-securite.txt (bloc « S-06 /api/automations/test (admin) ») ; " + P + "sonde-api.txt (bloc « API-28 »)",
  test="50-soupcons-securite.spec.ts › [S-06] la batterie de diagnostic ne renvoie à un admin de bureau AUCUNE information de la plateforme (compte SMTP, SID et numéro Twilio) @defaut",
  cause_probable="server/routes/automation-test.ts:260-278 — process.env.SMTP_USER, TWILIO_ACCOUNT_SID et TWILIO_PHONE_NUMBER écrits dans `details` ; :62-73 liste de préréglages périmée ; route de diagnostic laissée ouverte aux clients (RBAC automations.read + admin).")

c(id="roles-12", ids_carte=["S-08", "S-06", "API-28", "API-33"],
  ecran="API serveur — refus rendus au navigateur",
  element="Texte des refus (champ `error`)",
  attendu="Un refus dit en français à un compte en français, sans nom de clé technique (ex. « Votre rôle ne permet pas de créer une automatisation. »).",
  observe="Corps réellement reçus : 403 {\"error\":\"Permission denied: automations.update\"} (toutes les routes d’écriture, pour le membre en lecture seule, le vendeur et le technicien) ; 403 {\"error\":\"Permission denied: automations.read\"} ; 403 {\"error\":\"Permission denied: jobs.complete\"} ; 403 {\"error\":\"Only admins can run automation tests.\"} ; 404 {\"error\":\"Job not found\"} ; 401 {\"error\":\"Missing authorization header.\"}. Les refus écrits par les handlers, eux, sont en français (« Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté. »). L’affichage de ces textes anglais dans un toast reste À VÉRIFIER à l’écran.",
  gravite="mineur",
  capture=P + "sonde-api.txt (lignes « 403 … Permission denied », blocs « API-28 » et « API-33 »)",
  test="50-soupcons-securite.spec.ts › [S-08] un refus de permission du serveur est dit en français à un compte en français, sans nom de clé technique @defaut",
  cause_probable="server/lib/route-permissions.ts:531 et :540 — messages codés en dur en anglais, hors de repondreDansLaLangue (server/lib/automations-langue.ts) ; server/routes/automation-test.ts:41 ; server/routes/automation-events.ts:60, :142, :153.")

c(id="roles-13", ids_carte=["S-07", "S-19", "EXT-025", "EXT-017"],
  ecran="Base — table notifications (ce que le centre d’activités affiche)",
  element="Notifications créées par « job terminé » et par le préréglage « nouveau prospect »",
  attendu="Dans un bureau français (default_language = fr, propriétaire en français), des notifications en français.",
  observe="Lignes lues en base dans le bureau de test A : type job_ready_for_invoicing, titre « Job ready for invoicing: Job Décor-Rôles », corps « Cliente Décor-Rôles has been completed by a technician and is ready for invoicing. » (une par propriétaire / admin, après POST job-completed par le technicien) ; type automation, titre « New lead: Cliente Décor-Rôles », corps « A new lead has been created. ». Lecture à l’écran (centre d’activités) À VÉRIFIER.",
  gravite="mineur",
  capture=P + "preuves/notifications-en-anglais.txt",
  test="70-evenements-et-messages.spec.ts › [S-07][S-19] quand un technicien termine un job, la notification « prêt à facturer » reçue par le propriétaire est en français @defaut",
  cause_probable="server/routes/automation-events.ts:219-220 — titre et corps codés en dur en anglais ; le préréglage « nouveau prospect » porte un create_notification au texte anglais (semis des préréglages).")

c(id="roles-14", ids_carte=["S-07", "API-32", "EXT-017"],
  ecran="API serveur — POST /api/automations/events/appointment-rescheduled",
  element="Annonce « visite déplacée » sans vérification que la visite a bougé",
  attendu="Comme les routes étiquette et tâche (qui vérifient que l’état annoncé est vrai) : pas de nouvelle confirmation au client quand la date n’a pas changé.",
  observe="Les six rôles du bureau (dont vendeur et technicien, pour une visite quelconque du bureau) : 200 {\"ok\":true,\"cancelled\":n} avec n = 0, 0, 2, 7, 7, 8 rappels annulés puis replanifiés à chaque appel ; le bac à sable a retenu DEUX courriels « Votre rendez-vous est confirmé » pour le même client et la même visite, qui n’avait pas changé de date. À ARBITRER : c’est voulu pour un vrai déplacement, mais rien ne vérifie le déplacement ni le lien entre l’appelant et la visite.",
  gravite="mineur",
  capture=P + "sonde-api.txt (bloc « API-32 ») ; " + P + "preuves/envois-simules-confirmation.txt",
  test="70-evenements-et-messages.spec.ts › [S-07] « visite déplacée » signalée pour une visite qui n’a PAS bougé : aucune nouvelle confirmation ne repart vers le client (comme les routes étiquette et tâche, qui vérifient l’état annoncé) @defaut",
  cause_probable="server/routes/automation-events.ts:52-127 — appointment.created est ré-émis à chaque appel, sans comparer start_at à une valeur précédente ni vérifier l’assignation.")

with io.open(P + 'constats.jsonl', 'w', encoding='utf-8', newline='\n') as f:
    for x in C:
        f.write(json.dumps(x, ensure_ascii=False) + '\n')
print(len(C), 'constats')

io.open(P + 'preuves/notifications-en-anglais.txt', 'w', encoding='utf-8').write(u"""Lecture service_role de la table notifications du bureau de test A (766cd6ac-…), 2026-10-01 ~15:25 UTC :
[{"type":"automation","title":"New lead: Cliente Décor-Rôles","body":"A new lead has been created.","created_at":"2026-10-01T15:20:43.976917+00:00"},
 {"type":"job_ready_for_invoicing","title":"Job ready for invoicing: Job Décor-Rôles","body":"Cliente Décor-Rôles has been completed by a technician and is ready for invoicing.","created_at":"2026-10-01T15:12:16.309266+00:00"},
 {"type":"job_ready_for_invoicing","title":"Job ready for invoicing: Job Décor-Rôles","body":"Cliente Décor-Rôles has been completed by a technician and is ready for invoicing.","created_at":"2026-10-01T15:12:16.309266+00:00"},
 {"type":"quote_created","title":"Devis créé","body":"#QA-ROLES-mupn897t · Cliente Décor-Rôles · $0","created_at":"2026-10-01T14:42:30.993577+00:00"}]

Journaux d'exécution correspondants (automation_execution_logs du bureau A) :
 2026-10-01T15:20:41 lead.created send_sms success {"saute":"Aucun numéro texto configuré pour le bureau","saute_code":"sms_non_configure"}
 2026-10-01T15:20:43 lead.created create_notification success {"title":"New lead: Cliente Décor-Rôles","courriels":0,"destinataires":"equipe"}
L'événement lead.created de 15:20:42 a été émis par le TECHNICIEN via POST /api/automations/events/lead-created/ (voir roles-01) :
 activity_log : {"event_type":"lead_created","entity_id":"e7ec5022-ae39-4866-bc96-ddd6d794af80","actor_id":"e97d06dd-ee5f-4c10-adf9-70d911facef4" (= techA),"created_at":"2026-10-01T15:20:42.20941+00:00"}
""")
io.open(P + 'preuves/envois-simules-confirmation.txt', 'w', encoding='utf-8').write(u"""Lecture service_role de envois_simules pour le bureau de test A, après la sonde API-32 (six rôles, même visite, date inchangée), 2026-10-01 :
[{"canal":"courriel","destinataire":"decor-roles@lume-qa.test","sujet":"Votre rendez-vous est confirmé","created_at":"2026-10-01T15:05:38.948015+00:00"},
 {"canal":"courriel","destinataire":"decor-roles@lume-qa.test","sujet":"Votre rendez-vous est confirmé","created_at":"2026-10-01T15:08:57.828593+00:00"}]
automation_execution_logs : appointment.created send_email success (15:04:51), send_sms success (15:05:36), send_email success (15:08:43), send_sms success (15:08:55)
automation_scheduled_tasks : rappels J-7 / J-1 / 2 h annulés (« cancelled ») puis recréés (« pending ») à chaque appel.
Réponses de la route (sonde-api.txt, bloc API-32) : proprioA 200 cancelled 0 · adminA 200 cancelled 0 · editeurA 200 cancelled 2 · lecteurA 200 cancelled 7 · vendeurA 200 cancelled 7 · techA 200 cancelled 8
Tous ces envois sont restés dans le bac à sable (table envois_simules) : rien n'est parti.
""")
