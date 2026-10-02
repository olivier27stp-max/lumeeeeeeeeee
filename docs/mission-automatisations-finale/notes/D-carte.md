# Carte D — statistiques, historique et journaux des automatisations

Agent D, 2026-10-01. Tiré du code de `origin/main` (11e75ebc, worktree `D:/lume-final/wt-d`) et vérifié au vrai
navigateur sur la pile locale (bureaux « [TEST] QA Automatisations A/B (d) »). Les relevés bruts sont dans
`D:/lume-final/sorties/d/releve-{fr,en}-{A,B}.json` et les captures à côté.

Abréviations : **A** = `src/pages/Automations.tsx`, **APR** = `src/pages/AutomationsApercu.tsx`,
**Page** = `src/pages/AutomationBuilderPage.tsx`, **Journ** = `src/components/automations/OngletJournaux.tsx`,
**PEtape** = `src/components/automations/PanneauEtape.tsx`, **JApi** = `src/lib/automationJournauxApi.ts`,
**RApi** = `src/lib/automationRulesApi.ts`, **BApi** = `src/lib/automationBuilderApi.ts`,
**Stats** = `server/routes/automation-stats.ts`, **Moteur** = `server/lib/automationEngine.ts`,
**Actions** = `server/lib/actions/index.ts`.

Cette carte complète `AUTOMATIONS_UI_MAP.md` (sections 2.4, 2.12, 2.13, lignes L-18, L-29, P-04, EDT-015/016/102/131/150,
appels A04, A16, A17, 3, 30) : elle ne la répète pas, elle donne pour chaque chiffre sa définition exacte.

---

## 1. Les tables

| Table | Qui écrit | Ce qu'elle porte | Lue par |
|---|---|---|---|
| `automation_execution_logs` | Le moteur seul (rôle de service). Aucune policy d'écriture pour une session. | Une ligne par ACTION exécutée, sautée ou échouée ; une ligne `action_type = 'conditions'` par règle écartée par ses filtres. Colonnes : `org_id`, `automation_rule_id`, `scheduled_task_id`, `trigger_event`, `entity_type`, `entity_id`, `action_type`, `action_config`, `result_success`, `result_data` (jsonb), `result_error`, `duration_ms`, `created_at`, `execution_key`. | Liste, Vue d'ensemble, onglet Journaux, route de stats, outil Lumi `get_automation_health`, RPC `relances_du_deal` (fiche d'un deal), `server/lib/recu/lecture.ts`, `server/lib/trajets/propositionJournee.ts`, le moteur lui-même (anti-doublon, débit de textos, « une fois tous les N jours »). |
| `automation_scheduled_tasks` | Le moteur seul. | Une ligne par envoi PRÉVU : action différée, étape de parcours, report d'heures calmes, report de rafale, reprise d'un échec passager. `status` ∈ pending, running, completed, failed, cancelled. `last_error` porte aussi les motifs d'annulation et de reprise. `step_id`, `sequence_context`, `action_config` (le gabarit du message + `event_metadata`). | Onglet Historique, route de stats (« En cours », par étape). |
| `automation_rules` | Sessions (PostgREST, sous garde `automation_rules_garde`) et API. | La règle. Seule trace d'une modification : `updated_at`. | Tous les écrans. |
| `envois_simules` / `orgs_envois_simules` | Bac à sable (rôle de service). RLS activée, AUCUNE policy, aucun droit pour `anon`/`authenticated`. | Destinataire, sujet, corps de chaque envoi simulé. | Tests seulement. Aucun écran. |
| `domain_events` | Bus d'événements (outbox). Aucun droit pour une session. | Chaque événement émis, `processed_at`, `regles_traitees`. | Moteur. Aucun écran. |
| `agent_actions` | Lumi / MCP (rôle de service). | `outil`, `args_hash` (empreinte, pas les arguments), `resultat`. Lecture : soi-même ou `settings.update`. | Outil `get_recent_agent_actions`, dossier de support. |

RLS (relevé en base locale = schéma de prod) : `automation_execution_logs` et `automation_scheduled_tasks` n'ont
qu'une policy `SELECT` (`member_has_permission(auth.uid(), org_id, 'automations.read')`) plus la policy
RESTRICTIVE `bureau_actif` (le bureau demandé par l'en-tête `x-lume-org` / `x-org-id`). `FORCE ROW LEVEL SECURITY`
partout.

Rétention : voir section 7.

---

## 2. Ce que le moteur écrit, issue par issue

| Issue | Ligne de journal (`automation_execution_logs`) | Tâche (`automation_scheduled_tasks`) | Où dans le code |
|---|---|---|---|
| Action réussie | `result_success = true`, `result_data` = ce qui est parti (`{to, body}` texto, `{to, subject}` courriel, `{title}`…) | — (ou `completed` si différée) | Moteur:1116, 2489 ; Actions:1523, 1682 |
| Action en cours (réservation) | `result_success = false`, `result_error = 'en cours'`, complétée ensuite | — | Moteur:872-887 |
| Action plus lente que 5 s | `result_error = '… — résultat en attente (l’action continue)'`, complétée ensuite | reprise posée, annulée si succès | Moteur:1091-1111 |
| Échec | `result_success = false`, `result_error` = texte du fournisseur ou du moteur (anglais OU français) | reprise `pending` (5 min, 30 min, 2 h) si l'échec est passager ; sinon rien | Moteur:1123-1137, 1177-1218, 1716-1790 |
| Envoi SAUTÉ | `result_success = true`, `result_data = { saute: '<phrase en français>', saute_code: '<code>' }` | `completed` | Actions:165-167 |
| Règle écartée par ses conditions | `action_type = 'conditions'`, `result_success = true`, `result_data = { saute: 'Conditions non remplies : <champ>', saute_code: 'conditions', condition }` | — | Moteur:395-423, 1472-1487 |
| Hors heures d'envoi (report) | **aucune ligne** | `pending`, `execute_at` = prochaine fenêtre, `action_config.report_heures_calmes = true`, `last_error = null` | Moteur:1005-1030, 2050-2091 |
| Rafale de textos (report d'une minute) | aucune ligne | `pending` ; `last_error = 'Rafale de textos (> 30/min) : reporté d'une minute'` seulement au 2e report | Moteur:1032-1052, 2345-2351 |
| Doublon (même action, moins de 2 min) | **aucune ligne** (journal du serveur seulement) | — | Moteur:857-896 |
| Doublon d'une tâche déjà en file (23505) | aucune ligne | — | Moteur:1373-1380 ; `automationSequences.ts`:466-469 |
| « Une fois par client tous les N jours » | **aucune ligne** | — | Moteur:1490-1494 |
| Anti-boucle (règle déjà dans la chaîne de l'événement) | aucune ligne côté déclencheur ; `saute_code = 'boucle'` côté action « Démarrer une automatisation » | — | Moteur:1459-1462 ; Actions:3069-3072 |
| Événement qui ne vise pas la règle (autre étiquette, autre étape) | aucune ligne (voulu) | — | Moteur:1465-1469 |
| Bureau en pause (« Tout arrêter ») ou arrêt global | aucune ligne ; l'événement est perdu, la file est gardée | inchangée | Moteur:1401-1409 |
| Visite créée en lot (confirmation supprimée) | aucune ligne | — | Moteur:1570-1577 |
| Rappel « X avant » dont le créneau est dépassé de plus de 30 min | aucune ligne | — | Moteur:1291-1298 |
| Rappel « X avant » sans date | `saute_code = 'date_absente'` | — | Moteur:1325-1342 |
| Tâche annulée (règle en brouillon / à la corbeille, étape supprimée, client supprimé, condition d'arrêt, client a répondu, rappel périmé) | **aucune ligne** | `cancelled`, `last_error` = motif en français | Moteur:2002-2015, 2025-2033, 2064-2081, 2133-2140, 2193-2210 |
| Étape de parcours impossible à planifier | `result_success = false`, `trigger_event = 'sequence'`, `action_type = '__sequence__'` possible | — | `automationSequences.ts`:473-484 |

### Tous les `saute_code` écrits aujourd'hui

| Code | Phrase écrite dans `result_data.saute` (toujours en français) | Origine |
|---|---|---|
| `sms_non_configure` | « Aucun numéro texto configuré pour le bureau » ; « Le forfait n’inclut pas les textos » | Actions:1568, 1629-1634 |
| `sans_telephone` | « Aucun numéro de téléphone pour ce client » | Actions:1573 |
| `sans_courriel` | « Aucune adresse courriel pour ce client » | Actions:1321 |
| `adresse_injoignable` | « Adresse courriel injoignable (rebond ou plainte) » | Actions:1341 |
| `desabonne` (code PAR DÉFAUT de `saute()`) | « Client désabonné (texto) » ; « Client désabonné (courriel) » ; « … — bloqué par l'opérateur » ; « Consentement manquant (courriel) : le client s'est désabonné des courriels » ; et la demande d'avis sautée sur ses deux canaux, quels que soient les deux motifs (« motif 1 · motif 2 ») | Actions:1366-1368, 1390, 1393, 1588-1589, 1686, 2296 ; `desabonnement/index.ts`:148 |
| `sans_consentement` | « Consentement manquant (texto\|courriel) : aucune base légale … » ; « … destinataire inconnu du carnet de clients … » | Actions:1393, 1598 |
| `identite_manquante` | Le nom ou l'adresse postale de l'entreprise manque (LCAP) | Actions:1381-1382 |
| `deja_envoye` | « Déjà envoyé lors d’une tentative précédente » ; « Une autre relance de cette facture est déjà partie aujourd’hui » | Actions:1479, 1645 ; Moteur:1058, 2360 |
| `date_absente` | « Aucune date de rendez-vous : rappel « avant la date » non planifié » | Moteur:1336 |
| `boucle` | « Boucle évitée : … » ; « Chaîne arrêtée : plus de N automatisations démarrées à la suite » | Actions:3069-3072 |
| `client_sans_avis` | Client marqué « ne pas demander d'avis » | Actions:2115, 3265 |
| `conditions` | « Conditions non remplies : <libellé du champ> » | Moteur:412-413 |

Ce qui n'a PAS de code et s'écrit comme un ÉCHEC : le plafond de fréquence (`Frequency cap reached for <numéro ou
adresse> (max 3 commercial messages / 24h)`, Actions:1401, 1605, 2220), « demandes d'avis désactivées », « déjà
envoyée à ce client dans les 7 derniers jours », « aucun lien d'avis ».

Ce qui s'écrit comme une RÉUSSITE alors que rien n'a été fait : `{ aucun_deal: true }`, `{ pas_d_etape_cible: true }`,
`{ deja_ailleurs: true }`, `{ deja_dans_l_etape: true }` (déplacer dans le pipeline, Actions:2420-2482),
`{ ignore: 'un responsable était déjà assigné' }` (Actions:2805).

### Comment l'écran traduit

| Donnée | Fonction | Français | Anglais |
|---|---|---|---|
| `result_data.saute` | `motifSaut()` (JApi:293) — rend la phrase telle quelle | la phrase du moteur | **la même phrase, en français** |
| `result_error` (Journaux, Historique, panneau de la liste) | `raisonLisible()` (JApi:319) — 23 motifs reconnus par sous-chaîne | traduit ; sinon le texte brut | traduit ; sinon le texte brut (français pour les motifs du moteur écrits en français) |
| `result_error` (pastille de la liste) | `raisonEchecListe()` (JApi:372) | phrase entière ; sinon rien | idem |
| `last_error` d'une tâche | `raisonLisible()` | les motifs d'annulation et de reprise sont écrits en français et affichés tels quels | **affichés en français** |
| `saute_code` | — | jamais lu par l'interface ; visible brut dans le détail déplié (« saute_code: sans_telephone ») | idem |

---

## 3. La liste — `/automations` (A)

Appels au montage (`load()`, A:554-616), dans l'ordre :

| # | Appel | Table / route | Filtre | Sert à |
|---|---|---|---|---|
| 1 | `getAutomationRules()` RApi:46 | PostgREST `automation_rules?select=*` | `org_id`, `purged_at is null`, tri `name` | lignes, onglets |
| 2 | `getRecentAutomationFailures(200)` RApi:233 | PostgREST `automation_execution_logs` | `org_id`, `result_success = false`, `created_at ≥ maintenant − 7 j`, tri décroissant, **limite 200** | pastille d'échecs, onglet « À vérifier », « Dernier échec » |
| 3 | `chargerStatistiques()` BApi:208 | `GET /api/automations/rules/stats` | 60 jours (Stats:35) | colonnes « Total déclenché », « En cours », panneau « › », bandeau texto |
| 4 | `GET /api/automations/pause`, `/folders`, `/bureaux-cibles` | — | — | bandeau de pause, dossiers |

Aucun abonnement temps réel, aucun rafraîchissement périodique : les chiffres datent du dernier chargement.

| Chiffre à l'écran | Libellé FR / EN | Définition exacte | Période | Fichier |
|---|---|---|---|---|
| Colonne 4 | Total déclenché / Total enrolled | Nombre de FICHES distinctes (`entity_id`) ayant, pour la règle, au moins une tâche (créée depuis 60 j ou encore en attente) ou une ligne de journal hors `conditions` | 60 j, non dit dans l'en-tête | Stats:144-166 ; A:1935 |
| Colonne 5 | En cours / Active enrolled | Fiches distinctes ayant une tâche `pending` ou `running` (reprises d'échec et reports compris) | maintenant | Stats:146, 167 ; A:1936 |
| Pastille | N échec(s) dans les 7 derniers jours — cause | Lignes `result_success = false` de la règle parmi les 200 plus récentes du bureau ; la cause = `raisonLisible()` de la plus récente | 7 j | A:584-594, 1905-1912 |
| Onglet | À vérifier (N) | Règles vivantes ayant au moins une de ces lignes | 7 j | A:1000, 1282 |
| Onglets | Toutes (N), Prêtes à publier (N), Corbeille (N) | Comptes de règles en mémoire | — | A:1280-1287 |
| Panneau « › » | 60 derniers jours : X déclenchement(s), Y envoi(s), Z étape(s) sautée(s), W échec(s). V en cours. | X = colonne 4 ; Y = lignes `result_success = true` sans `result_data.saute` (TOUTE action : texto, tâche, étiquette…) ; Z = lignes avec `saute` ; W = lignes `result_success = false` sauf `'en cours'` ; V = colonne 5 | 60 j | Stats:96-100, 148-165 ; A:2150-2181 |
| Panneau | Dernier échec : … | `raisonLisible()` de la dernière ligne en échec des 7 jours | 7 j | A:2162-2166 |
| Panneau | Dernière étape sautée : … | `result_data.saute` de la ligne sautée la plus récente (phrase française du moteur) | 60 j | Stats:157-163 ; A:2169-2173 |
| Bandeau | Les étapes texto sont sautées tant qu’aucun numéro n’est configuré. | `texto_configure === false` : pas de client Twilio côté serveur OU pas de numéro actif | — | Stats:197-206 ; A:1329-1338 |

Éléments interactifs liés aux chiffres : en-têtes triables « Total déclenché » et « En cours » (A:1786-1787), chevron
« › » par ligne (`aria-expanded`, A:1942-1955), onglet « À vérifier ». Le panneau est du texte seul : pas de lien vers
l'onglet Journaux qu'il cite (S-43 de `AUTOMATIONS_UI_AUDIT`).

États (vérifiés au navigateur) : stats illisibles → « — » dans les deux colonnes, panneau « Les chiffres n’ont pas pu
être lus. » (preuve `[D-EL-16]`) ; échecs illisibles → rien n'est dit, « À vérifier (0) » (constat D-17) ; bureau sans
exécution → 0 partout (bureau B, relevé `releve-fr-B.json`). Le chargement de la liste elle-même relève de
`AUTOMATIONS_UI_MAP.md` (non rejoué ici).

---

## 4. La Vue d'ensemble — `/automations/apercu` (APR)

Appels au montage (`Promise.allSettled`, APR:50) : `getAutomationRules()`, `getRecentAutomationFailures(200)`,
`activiteParSemaine(7)` (JApi:424 : PostgREST `automation_execution_logs?select=created_at,entity_id,trigger_event`,
`org_id`, `action_type ≠ conditions`, `created_at ≥ début de la 1re tranche`, tri CROISSANT, `limit(5000)` — PostgREST
n'en rend que 1 000).

| Chiffre | Libellé FR / EN | Définition exacte | Période |
|---|---|---|---|
| Tuile 1 | Total des automatisations / Total workflows | Règles non supprimées (`deleted_at` nul), préréglages retirés exclus | — |
| Tuile 2 | Automatisations publiées / Published workflows | Dont `is_active` | — |
| Tuile 3 | Total des déclenchements / Total enrollments | Nombre de triplets distincts (tranche de 7 jours, `entity_id`, `trigger_event`) parmi les lignes lues — PAS par règle | 7 tranches de 7 jours finissant aujourd'hui (49 j), non dit sur la tuile |
| Courbe | Déclenchements — 7 dernières semaines | Le même compte, par tranche ; étiquette = premier jour de la tranche | 49 j |
| Sous la courbe | Du … au … · Déclenchements : N · Croissance : ±P % | Dernière tranche ; croissance contre la précédente, « — » si elle est à 0 | 7 j / 14 j |
| Résumé des erreurs | N envoi(s) ont échoué ces 7 derniers jours. | `echecs.length` de la lecture plafonnée à 200 ; toute action en échec, pas seulement les envois | 7 j |

Interactif : sous-navigation, bouton « Voir les automatisations à vérifier » (→ `/automations?onglet=verifier`). La
courbe est une image (`role="img"`, `aria-label` listant les 7 nombres), sans infobulle ni clic. Aucun filtre de
période, aucun export.

États : chargement (roue) ; règles illisibles → « — » dans les tuiles 1 et 2 ; échecs illisibles → « Les erreurs n’ont
pas pu être lues… » ; activité illisible → 0 et 7 barres vides sans message (S-30).

---

## 5. L'éditeur — `/automations/:id` (Page)

Onglets (Page:1864-1869) : Parcours · Réglages · **Historique** (EN « Enrollment history ») · **Journaux** (EN
« Execution logs »). L'en-tête de l'éditeur ne porte aucun chiffre (nom, état d'enregistrement, Tester,
Brouillon/Publier).

### 5.1 Panneau d'étape › onglet « Statistiques » (PEtape:416-444)

Appel : `GET /api/automations/rules/stats?rule_id=<id>` une fois à l'ouverture de l'éditeur (Page:433-440).
Affiché seulement pour une étape d'un PARCOURS (`steps`) : un journal se rattache à son étape par
`scheduled_task_id → automation_scheduled_tasks.step_id` (Stats:172-185).

| Tuile | Définition | Période |
|---|---|---|
| Réussis / Succeeded | lignes de journal de l'étape, succès sans `saute` | 60 j |
| Sautés / Skipped | lignes avec `saute` | 60 j |
| Échoués / Failed | lignes en échec (hors `'en cours'`) | 60 j |
| En attente / Pending | tâches de l'étape `pending` ou `running` | maintenant |

États : aucune donnée OU lecture ratée → « Aucun passage encore. … » (S-40). Chiffres vérifiés à l'écran sur le
parcours P du jeu connu (preuve `[D-EL-19]` : courriel 2 réussis, texto 2 en attente).

### 5.2 Onglet Historique (Journ:296-409)

Appel : `lireInscriptions({ ruleId, statut })` (JApi:111) → PostgREST `automation_scheduled_tasks`
(`id, entity_type, entity_id, status, execute_at, completed_at, attempts, last_error, step_id, action_config`),
`org_id`, `automation_rule_id`, `created_at ≥ −60 j`, tri `execute_at` décroissant, **limite 200** ; puis les noms des
clients (`clients`, ou `quotes`/`invoices`/`jobs` → `client_id`, ou `schedule_events` → `jobs`).

| Colonne FR / EN | Source |
|---|---|
| Client / Contact | nom résolu ; « — » si le client est à la corbeille, anonymisé, ou l'entité d'un type inconnu |
| Étape en cours / Current action | `libelleAction(action_config.type)` + `(step_id)` brut ; vide pour une attente ou une condition (`__sequence__`) |
| Statut / Status | pastille (`pending` En attente, `running` En cours, `completed` Terminé, `failed` Échoué, `cancelled` Annulé) + `raisonLisible(last_error)` + « N tentatives » si > 1 |
| Prévu le / Next execution | `execute_at` (réécrit à l'instant de la prise : pour une tâche terminée, c'est l'heure d'exécution) |
| Terminé le / Completed on | `completed_at` |

Interactif : UN filtre « Statut » (Tous / En attente / Terminés / Échoués / Annulés ; EN « All events »…). Compteur
« N ligne(s) ». Aucune recherche, aucun filtre client ou date, aucun lien, aucune pagination, aucun export, aucune
ligne dépliable.

États : chargement (roue), erreur « L’historique n’a pas pu être lu. », vide « Aucune inscription. » + « Disponible
sur les 60 derniers jours. ».

### 5.3 Onglet Journaux (Journ:135-292)

Appel : `lireJournaux({ ruleId, action, statut })` (JApi:70) → PostgREST `automation_execution_logs`
(`id, action_type, result_success, result_error, result_data, duration_ms, entity_type, entity_id, trigger_event,
created_at` — **pas `action_config`**), `org_id`, `automation_rule_id`, `created_at ≥ −60 j`, tri décroissant,
**limite 200** ; filtres `action_type = …`, `result_success = true|false` ; puis les noms des clients.

| Colonne FR / EN | Source |
|---|---|
| Client / Contact | nom résolu |
| Action | `libelleAction(action_type)` ; « Conditions » pour une règle écartée |
| Statut / Status | pastille : « Sauté » si `result_data.saute`, sinon « Terminé » / « Échoué » ; dessous, la phrase `saute` ou `raisonLisible(result_error)` |
| Exécuté le / Executed on | `created_at`, fuseau `America/Montreal` en dur (Journ:28-35) |

Ligne dépliée (`DetailEnvoi`, Journ:86-131) : `result_data` — Destinataire (`to`), Objet (`subject`), Message
(`body`/`message`), Titre (`title`), puis « Autres détails » = toutes les autres clés brutes (`saute:`, `saute_code:`,
`condition:`, `courriels:`…). Sans `result_data` (tout échec) : « Le contenu de cet envoi n’a pas été conservé
(exécution antérieure au journal détaillé). »

Colonnes lues mais jamais affichées : `duration_ms`, `trigger_event`, `entity_type`. Jamais lues : `action_config`,
`scheduled_task_id`, `execution_key`.

Interactif : filtre « Action » (les types présents dans les lignes chargées), filtre « Statut » (Tous / Réussis /
Échoués), ligne cliquable (`role="button"`, Entrée/Espace). Compteur « N ligne(s) ». Aucune recherche, aucun filtre
client ou date, aucun lien, aucune pagination, aucun export.

États : chargement (roue), erreur « Les journaux n’ont pas pu être lus. » (pas de bouton pour réessayer), vide
« Aucun journal. ».

---

## 6. La route de statistiques — `GET /api/automations/rules/stats[?rule_id=]` (Stats)

- Authentification : `requireAuthedClient` ; lectures avec le client de l'UTILISATEUR (RLS), jamais le rôle de service.
- Fenêtre fixe de 60 jours (`FENETRE_JOURS`), aucun paramètre de période.
- Lit toutes les tâches (`status in (pending, running)` OU créées depuis 60 j) et tous les journaux de 60 j du bureau,
  par pages de 1 000, plafond 20 000 lignes par table (au-delà : résultat tronqué en silence, tri par `id`).
- Rend `{ par_regle: { [id]: { declenches, en_cours, envoyes, sautes, echecs, dernier_saut } }, par_etape, texto_configure }`.
- `rule_id` mal formé → 400 ; lecture ratée → 500 « Impossible de lire les statistiques des automatisations. ».
- Classement d'une ligne (`classerJournal`, Stats:96) : `'en cours'` → ignorée ; échec → `echec` ; succès avec `saute`
  → `saute` ; sinon `envoye`. `action_type = 'conditions'` → ignorée partout.

Autres lecteurs agrégés : l'outil Lumi `get_automation_health` (`server/lib/agent/tools-etendus.ts`:960-1030 — les 100
dernières lignes du bureau, sans fenêtre ; il compte les lignes `conditions` parmi les « sautés », contrairement à la
route).

---

## 7. Rétention (relevé en base)

| Donnée | Durée | Mécanisme | Preuve |
|---|---|---|---|
| `automation_execution_logs` | 90 jours | `run_retention_logs()` (migration `20260910160000`), cron `lume_retention_logs` à 04 h 20 UTC, actif en prod | prod 2026-10-01 : plus vieille ligne = 2026-07-03 (90 j) |
| `automation_scheduled_tasks` | **aucune** | aucune fonction ne les supprime | prod : plus vieille tâche 2026-06-12 ; 237 tâches closes de plus de 90 j |
| `envois_simules` | **aucune** | — | prod : 658 lignes (bureaux de test) |
| `domain_events` | **aucune** | — | prod : 2 542 lignes depuis le 2026-09-28 |
| `notifications` lues | 90 jours | `run_retention_logs()` | — |
| `activity_log` | 180 jours | `run_retention_logs()` | — |
| Écrans | 60 jours | `FENETRE_JOURS` (JApi:31, Stats:35) | — |
| Effacement d'un client (`anonymize_client`) | ne touche ni les journaux, ni la file, ni le bac à sable | — | preuve `40-retention-loi25` [D-08] |

---

## 8. Ce qui n'existe pas (cherché, absent)

- Filtre de période choisi par l'utilisateur, sur n'importe lequel de ces écrans.
- Recherche, filtre par client, filtre par date dans l'Historique et les Journaux ; filtre par automatisation à
  l'échelle du bureau (il n'existe aucun journal global : il faut ouvrir chaque automatisation).
- Liens vers le client, la facture, le job, le devis.
- Pagination ou « voir plus » au-delà de 200 lignes.
- Export (CSV ou autre).
- Historique des modifications d'une automatisation (table, journal, écran).
- Rafraîchissement en direct.
