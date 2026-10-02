# Constats de l'agent D — statistiques, historique et journaux

Mission « correction finale Automatisations », points 4 et 5. Agent D, 2026-10-01.
Code examiné : `origin/main` 11e75ebc (worktree `D:/lume-final/wt-d`, branche `mission/auto-finale-d`).
Tout a été joué sur la pile locale, dans les bureaux « [TEST] QA Automatisations A/B (d) ».
La carte des écrans, des appels et des tables est dans `D:/lume-final/notes/D-carte.md`.

## Comment rejouer les preuves

```
cd D:/lume-final/wt-d

# 1. Intégration (vrai moteur, pile locale). 10-jeu-connu FABRIQUE le jeu : à lancer en premier.
QA_AUTO_SUFFIXE=d npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project integration

# 2. Écrans (vrai navigateur). Lancer les serveurs une fois, en arrière-plan, puis :
node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-d 3494 5494
QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 QA_UI_SORTIES=D:/lume-final/sorties/d \
  npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project ui

# Une seule preuve : ajouter  -t "D-10"
```

Les fichiers s'appellent `*.preuve.ts` (et non `*.test.ts`) pour ne pas entrer dans `npm test`, qui ramasse
`tests/**/*.test.ts` : ils exigent la pile locale et sont rouges exprès.

État au 2026-10-01, dernière passe : **71 preuves, 36 vertes** (état des lieux et isolation : préfixes `D-EL`, `D-ST`,
`D-RET`, `D-ISO`) **et 35 rouges** (une par constat ou sous-constat ci-dessous). Sorties :
`D:/lume-final/sorties/d/passe-integration.log`, `passe-ui.log`, captures `d-*.png`, relevés `releve-*.json`.

Abréviations de fichiers : voir l'en-tête de `D-carte.md`. `P/` = `tests/automations-finale/d/`.

## Le jeu connu

Fabriqué par le vrai moteur (`P/jeu-connu.ts`, harnais `tests/automations-suite/harnais/moteur.ts`) : 15 règles sur
« Nouveau prospect », chacune publiée le temps de ses événements. Seules les dates ont été retouchées (`created_at`
antidaté). Manifeste : `D:/lume-final/sorties/d/jeu-connu.json`.

| Règle | Issue voulue | Événements (âge en jours) | Ce que le moteur a écrit |
|---|---|---|---|
| S | réussie (texto) | 0, 0, 3, 10, 40, 70 | 6 lignes en succès |
| E | échouée (bac à sable en `panne`) | 0, 3, 10 | 3 échecs + 3 reprises en file |
| T | sautée : client sans téléphone | 0, 10 | 2 × `sans_telephone` |
| D | sautée : client désabonné | 0, 40 | 2 × `desabonne` |
| C | sautée : sans consentement (envoi commercial) | 0, 3 | 2 × `sans_consentement` |
| N | sautée : client sans courriel | 0 | 1 × `sans_courriel` |
| K | conditions non remplies | 0, 0, 10 | 3 lignes `conditions` |
| A | action interne (notification) | 0 | 1 succès |
| H | hors heures d'envoi | 0 | 0 ligne, 1 tâche en attente |
| X | doublon (même événement deux fois) | 0, 0 | 1 seule ligne |
| F1-F3 | réussies (3 offres au même client) | 0 | 1 succès chacune |
| F4 | plafond de fréquence (4e offre) | 0 | 1 ÉCHEC « Frequency cap reached… » |
| P | parcours courriel → attendre 3 j → texto | 0, 0 | 2 succès (e1), 2 tâches en attente (e3) |

Totaux du jeu : 24 déclenchements en 49 jours, 3 échecs en 7 jours, 2 règles à vérifier.

## Synthèse des métriques

| Écran | Métrique affichée | Verdict | Constat |
|---|---|---|---|
| Liste | Total déclenché (60 j) | Juste sur le jeu (15 règles sur 15). Trompeuse : ce sont des fiches distinctes, pas des déclenchements ; la période n'est pas dans l'en-tête | D-06, D-24 |
| Liste | En cours | Juste (compte aussi les reprises d'échec et les reports) | — |
| Liste | N échec(s) dans les 7 derniers jours | Juste jusqu'à 200 échecs par bureau ; fausse au-delà ; compte le plafond de fréquence | D-02, D-03 |
| Liste | À vérifier (N) | Juste jusqu'à 200 ; fausse au-delà ; « 0 » quand la lecture échoue | D-02, D-17 |
| Liste, panneau | X déclenchement(s) | Comme « Total déclenché » | D-06 |
| Liste, panneau | Y envoi(s) | Trompeuse : toute action réussie, même interne, même « rien à faire » | D-23 |
| Liste, panneau | Z étape(s) sautée(s) | Juste. Pas de détail par raison ; « Dernière étape sautée » en français dans l'interface anglaise | D-25, D-12 |
| Liste, panneau | W échec(s) | Juste (plafond de fréquence compris) | D-03 |
| Vue d'ensemble | Total des automatisations, Automatisations publiées | Justes (relevé : 49 et 29 pour A, 37 et 34 pour B) | — |
| Vue d'ensemble | Total des déclenchements | Fausse au-delà de 1 000 lignes ; autre définition que la liste (20 contre 24) ; période non dite | D-01, D-09, D-24 |
| Vue d'ensemble | Courbe des 7 semaines, Croissance | Justes sous 1 000 lignes (0, 2, 0, 0, 0, 3, 15 = le jeu) ; fausses au-delà | D-01 |
| Vue d'ensemble | N envoi(s) ont échoué ces 7 derniers jours | Juste jusqu'à 200 ; plafonnée au-delà ; « envoi » pour toute action | D-02, D-23 |
| Éditeur, étape | Réussis, Sautés, Échoués, En attente (60 j) | Justes (route et écran, parcours P) ; pas de mise à jour, lecture ratée = « Aucun passage encore » (S-40 de l'audit d'interface) | — |
| Onglet Journaux | N ligne(s) | Juste jusqu'à 200 ; au-delà, 200 sans le dire | D-15 |
| Onglet Historique | N ligne(s) | Juste pour la file ; vide pour toute automatisation immédiate | D-16 |
| Lumi | partis / sautés / échoués | « sautés » compte les règles écartées (10 contre 7 à l'écran) ; 100 dernières lignes, sans période | D-21 |

Jeu cible demandé (déclenchées, envoyées, échouées, ignorées avec la raison) — ce qui existe, ce qui manque :

| Cible | Aujourd'hui | Où la donnée se lit | Manque |
|---|---|---|---|
| Déclenchées | « Total déclenché » = fiches distinctes | journaux + file, par `entity_id` | un identifiant de PASSAGE (une règle lancée pour un événement) ; sans lui, deux passages du même client n'en font qu'un (D-06) |
| Envoyées | « envoi(s) » = toute action réussie sans `saute` | `result_success = true` et `result_data.saute` absent | distinguer les envois au client (`send_sms`, `send_email`, `request_review`, `envoyer_facture`, `envoyer_soumission`) des actions internes (D-23) |
| Échouées | « échec(s) » | `result_success = false` hors `'en cours'` | sortir le plafond de fréquence des échecs (D-03) |
| Ignorées : doublon | rien | nulle part (journal du serveur) | une trace (D-04) |
| Ignorées : désabonné | compté dans « sautées » | `saute_code = 'desabonne'` | le détail par raison (D-25) ; `desabonne` est aussi le code par défaut de `saute()` |
| Ignorées : hors ciblage | pas compté (voulu), visible dans Journaux | `action_type = 'conditions'`, `saute_code = 'conditions'`, `result_data.condition` | un compteur « écartées par leurs conditions » ; la valeur reçue et la valeur attendue (D-26) |
| Ignorées : donnée manquante | compté dans « sautées » | `saute_code ∈ sans_telephone, sans_courriel, date_absente, identite_manquante, sms_non_configure` | le détail par raison (D-25) |
| Ignorées : condition plus valide | pas compté ; tâche `cancelled` | `automation_scheduled_tasks.last_error` (« Annulée : … ») | un compteur d'annulées et un filtre ; aucune ligne de journal (visible seulement dans l'Historique) |
| Ignorées : hors heures d'envoi | compté « en cours » (c'est un report, pas un abandon) | `action_config.report_heures_calmes` — aucune raison affichée | la raison à l'écran (D-05) |
| Ignorées : plafond de fréquence | compté ÉCHEC | `result_error ilike 'Frequency cap%'` | un code (D-03) |
| Filtre de période | aucun ; 7 j, 49 j, 60 j selon l'écran | — | D-24 |

## Isolation par bureau : vérifiée, aucun constat

`P/ui/40-isolation.preuve.ts`, 13 preuves vertes. Avec le jeton d'un vrai utilisateur du bureau B :
- PostgREST : 0 ligne du bureau A dans `automation_execution_logs`, `automation_scheduled_tasks`, `automation_rules`,
  sans en-tête, en se déclarant dans A (`x-lume-org`, `x-org-id`) ou dans B ; par l'identifiant d'une règle ou d'un
  client de A ; `envois_simules`, `orgs_envois_simules`, `domain_events` illisibles ; écriture, modification et
  suppression d'un journal de A refusées.
- API : `GET /api/automations/rules/stats` ne rend aucune règle de A (même avec `rule_id` d'une règle de A :
  `par_regle = {}`, `par_etape = {}`) ; avec `x-org-id` = A : **403** « Accès refusé à ce bureau. » ;
  `GET /api/automations/editeur?rule_id=<règle de A>` : `rule: null` ; `GET /api/automations/test` : rien de A.
- Écran : la liste, la Vue d'ensemble et l'adresse directe d'une règle de A (« Cette automatisation est introuvable »)
  ne montrent rien de A, même en forçant `lume-active-org` = A dans le navigateur ; aucune réponse réseau ne porte une
  donnée de A.
- Dans le bureau A : le propriétaire ne peut ni modifier ni supprimer une ligne de journal (aucune policy d'écriture) ;
  le technicien (sans `automations.read`) ne lit aucun journal (PostgREST : 0 ligne ; API : 403).

---

## Statistiques (point 4)

### D-01 — Dès qu'un bureau dépasse 1 000 exécutions en sept semaines, la Vue d'ensemble affiche 1 000 et met les semaines récentes à zéro
- Point de la mission : 4
- Gravité : majeur
- Ce qu'on voit : la tuile « Total des déclenchements » reste bloquée à 1000, la barre de la semaine en cours est vide, « Déclenchements : 0 · Croissance : — », alors que des centaines d'automatisations sont parties cette semaine. Le propriétaire le plus actif est celui qui lit « rien ne se passe ».
- Reproduction : bureau B (d) : 1 000 exécutions il y a 30 jours, 50 aujourd'hui, 235 échecs cette semaine (1 285 lignes) ; ouvrir `/automations/apercu`. Commande : `… --project ui P/ui/30-volume-plafonds.preuve.ts -t "D-01"`.
- Preuve : `P/ui/30-volume-plafonds.preuve.ts::[D-01]` — écran : total **1000**, semaine en cours **0**, courbe « 0, 0, 1000, 0, 0, 0, 0 » ; base : **1 285** et **285**. Capture `d-volume-apercu.png`. Témoin vert `[D-EL-20]` : la liste (route serveur, paginée) affiche bien 1050 pour la même règle. Prod, 2026-10-01 (compte agrégé, lecture seule) : un bureau a **2 961** lignes en 49 jours — sa Vue d'ensemble est déjà fausse.
- Cause racine : `src/lib/automationJournauxApi.ts:447-455` lit les lignes dans le navigateur, triées de la plus ANCIENNE à la plus récente, avec `.limit(5000)` ; PostgREST plafonne toute réponse à 1 000 lignes (`PGRST_DB_MAX_ROWS=1000`, prod et pile locale). Seules les 1 000 plus vieilles lignes de la fenêtre sont donc comptées.
- Correctif proposé : compter côté serveur. Ajouter à `server/routes/automation-stats.ts` (qui pagine déjà) un champ `par_semaine` et un `total` calculés avec la même définition que `par_regle` ; `src/pages/AutomationsApercu.tsx` et `src/lib/automationJournauxApi.ts` (`activiteParSemaine`) le lisent au lieu d'interroger PostgREST. À terme, un agrégat SQL (RPC `security invoker`) évitera de rapatrier 20 000 lignes.
- Risque / à décider par Rafba : aucun. À noter : la route plafonne elle-même à 20 000 lignes par table (`MAX_LIGNES`, `automation-stats.ts:38`), tronquées en silence, triées par `id` ; non atteint en prod aujourd'hui (2 961).

### D-02 — Au-delà de 200 échecs en 7 jours, les pastilles sont fausses et des automatisations en échec disparaissent de « À vérifier »
- Point de la mission : 4
- Gravité : majeur
- Ce qu'on voit : une automatisation qui a échoué 230 fois affiche « 200 échec(s) » ; une autre, qui a échoué 5 fois il y a 5 jours, n'a aucune pastille et n'est pas dans l'onglet « À vérifier (1) » ; la Vue d'ensemble dit « 200 envoi(s) ont échoué ».
- Reproduction : bureau B (d), règle V2 = 230 échecs aujourd'hui, règle V3 = 5 échecs il y a 5 jours ; ouvrir `/automations`, puis `/automations/apercu`.
- Preuve : `P/ui/30-volume-plafonds.preuve.ts::[D-02]` — écran `{ V2: 200, V3: 0, onglet: 'À vérifier (1)' }`, base `{ V2: 230, V3: 5, 2 règles }` ; `::[D-02b]` — écran 200, base 235. Captures `d-volume-echecs.png`, `d-volume-apercu.png`. Prod : le bureau le plus touché a 120 échecs en 7 jours (60 % du plafond).
- Cause racine : `src/lib/automationRulesApi.ts:233-249` (`getRecentAutomationFailures(200)`) rapatrie les 200 échecs les plus récents du bureau, et le navigateur les compte par règle (`src/pages/Automations.tsx:584-594`, `AutomationsApercu.tsx:50, 197`). Déjà signalé pour le seul résumé de la Vue d'ensemble (S-30 de `AUTOMATIONS_UI_AUDIT.md`) ; la liste et l'onglet « À vérifier » ne l'étaient pas.
- Correctif proposé : la route de statistiques rend `echecs_7j` et `derniere_cause` par règle (comptés en base) ; `Automations.tsx` et `AutomationsApercu.tsx` s'en servent ; `getRecentAutomationFailures` / `getFailureCountsByRule` disparaissent de `automationRulesApi.ts`.
- Risque / à décider par Rafba : aucun.

### D-03 — Un envoi retenu par le plafond de fréquence est compté et affiché comme un ÉCHEC, avec le numéro du client dans le motif
- Point de la mission : 4 (et 5)
- Gravité : majeur
- Ce qu'on voit : le 4e message commercial de la journée vers le même client fait apparaître la règle dans « À vérifier », avec « 1 échec(s) dans les 7 derniers jours — Plafond atteint… », et compte dans « N envoi(s) ont échoué ». Or rien n'a échoué : le moteur a fait exactement ce qu'on lui demande (ne pas inonder le client).
- Reproduction : quatre règles commerciales publiées sur le même événement, un client avec consentement ; la 4e (F4) est plafonnée. `… --project integration P/integration/10-jeu-connu.preuve.ts -t "D-03"`.
- Preuve : `P/integration/10-jeu-connu.preuve.ts::[D-03]` — ligne écrite : `result_success: false`, `result_error: "Frequency cap reached for +14295550120 (max 3 commercial messages / 24h) — skipped to avoid spamming"`, `result_data: null` ; `::[D-03b]` — le motif porte le numéro du client. Écran (relevé `releve-fr-A.json`) : F4 « 1 échec(s)… », onglet « À vérifier (2) ». Prod : 28 lignes de ce type en 60 jours.
- Cause racine : `server/lib/actions/index.ts:1401` (courriel), `:1605` (texto), `:2218-2231` (demande d'avis) rendent `{ success: false, error: 'Frequency cap reached for <destinataire>…' }` au lieu d'un saut. `saute()` (`:165`) n'a pas de code pour ce cas.
- Correctif proposé : `saute('Plafond de messages atteint pour ce client aujourd’hui', 'plafond_frequence')` aux trois endroits (ajouter le code à `CodeSaut`, `actions/index.ts:151-162`) ; retirer `'frequency cap'` de `isTransientFailure` (`automationEngine.ts:1724`) et de `prevenirEchecDefinitif` (`:1836`) ; garder la traduction dans `raisonLisible` pour les anciennes lignes. Le destinataire ne doit plus figurer dans le motif (la fonction `relances_du_deal` le masque déjà : la base sait que c'est un problème).
- Risque / à décider par Rafba : un saut laisse le parcours CONTINUER (l'étape suivante part), alors qu'un échec l'arrête, et il ne déclenche plus la notification « Échec d'envoi ». À trancher : un message plafonné doit-il arrêter le parcours du client ?

### D-04 — Un doublon écarté ne laisse aucune trace ; quatre autres motifs d'« ignorée » non plus
- Point de la mission : 4 (jeu cible : « ignorées … doublon »), 5
- Gravité : majeur
- Ce qu'on voit : le même événement arrive deux fois ; un seul envoi part (voulu). Le second passage n'existe nulle part : ni dans les chiffres, ni dans les Journaux. Devant « pourquoi ce client n'a rien reçu la 2e fois ? », il n'y a pas de réponse à l'écran.
- Reproduction : règle X publiée, émettre deux fois « Nouveau prospect » pour le même client dans la même minute.
- Preuve : `P/integration/10-jeu-connu.preuve.ts::[D-04]` — une seule ligne (`{"to":"+1429…","body":"Bonjour, confirmation de votre demande."}`), aucune ligne `saute_code = 'doublon'`. Le journal du serveur, lui, dit : `[automationEngine] doublon ignoré (même action, même tranche de 2 min)`.
- Cause racine : `server/lib/automationEngine.ts:857-896` (`reserverActionImmediate`) n'écrit qu'un `logger.info`. Même silence, lu dans le code et non rejoué (NON VÉRIFIÉ par un test) : « une fois par client tous les N jours » (`:1490-1494`), anti-boucle côté déclencheur (`:1459-1462`), confirmation supprimée d'une visite créée en lot (`:1544-1546`, `:1570-1577`), rappel dont le créneau est dépassé (`:1291-1298`), tâche déjà en file (`:1373-1380`).
- Correctif proposé : une fonction `journaliserIgnoree(regle, evenement, code, motif)` dans `automationEngine.ts`, sur le modèle de `journaliserRegleEcartee` (`:395-423`) : une ligne `result_success = true`, `result_data = { saute, saute_code }` avec les codes `doublon`, `deja_passe`, `boucle`, `visite_en_lot`, `creneau_depasse`. La route de statistiques et l'écran les rangent sous « ignorées ».
- Risque / à décider par Rafba : ces lignes ne doivent PAS être prises pour un passage par `dejaPasseRecemment` (`:1634-1656`, qui compte toute ligne hors `conditions`) ni par `rafaleDeTextos` (`:691-704`), sinon un doublon prolongerait la fenêtre « une fois tous les N jours ». Le plus sûr : un `action_type` réservé (comme `conditions`), exclu de ces deux lectures. À tester avec les suites existantes `20-cde-idempotence` et `30-fgh-moteur`.

### D-05 — Un envoi reporté hors des heures d'envoi attend sans dire pourquoi
- Point de la mission : 4 (« hors heures d'envoi »), 5
- Gravité : mineur
- Ce qu'on voit : dans l'Historique, « Texto — En attente — 2 oct. 2026, 03 h 19 », sans un mot. Dans la liste, la règle compte « 1 en cours ». Rien ne dit que le message attend la prochaine fenêtre d'envoi.
- Reproduction : règle H (fenêtre d'envoi qui exclut l'heure courante), un événement ; ouvrir l'onglet Historique.
- Preuve : `P/integration/10-jeu-connu.preuve.ts::[D-05]` — la tâche porte `action_config.report_heures_calmes = true` et `last_error = null` ; `P/ui/20-ecrans-contre-base.preuve.ts::[D-05]` — ligne affichée : « Jeu H1 … Texto En attente 2 oct. 2026, 03 h 19 — ». Capture `d-historique-report.png`.
- Cause racine : `server/lib/automationEngine.ts:1008-1021` pose la tâche sans motif ; `:2083-2086` repousse une tâche déjà en file sans rien écrire non plus. `src/components/automations/OngletJournaux.tsx:386-396` n'affiche que `last_error`.
- Correctif proposé : écrire `last_error: 'Hors des heures d’envoi : reporté à la prochaine fenêtre'` aux deux endroits du moteur (le report de rafale le fait déjà, `:2347`), et donner à l'écran une traduction par motif (voir D-12).
- Risque / à décider par Rafba : aucun.

### D-06 — « Total déclenché » compte des clients distincts, pas des déclenchements
- Point de la mission : 4
- Gravité : mineur
- Ce qu'on voit : une règle qui s'est déclenchée deux fois pour le même client (aujourd'hui et il y a 20 jours) affiche « 5 » et non « 6 » dans « Total déclenché », et « 5 déclenchement(s), 6 envoi(s) » dans son panneau — plus d'envois que de déclenchements.
- Reproduction : `… --project integration P/integration/10-jeu-connu.preuve.ts -t "D-06"`.
- Preuve : `::[D-06]` — après un 2e passage du même client : `envoyes` passe à 6, `declenches` reste à **5**.
- Cause racine : `server/routes/automation-stats.ts:137-166` compte la taille d'un ensemble d'`entity_id`. Le journal ne porte aucun identifiant de passage : on ne peut pas faire mieux avec les colonnes actuelles.
- Correctif proposé : soit renommer (« Clients touchés » / « Contacts reached »), soit — et c'est ce qui rend le jeu cible calculable — ajouter une colonne `passage_id uuid` (nullable) à `automation_execution_logs` et `automation_scheduled_tasks`, posée par `lancerRegle` (`automationEngine.ts:1536`) et transmise dans `sequence_context`. « Déclenchées » = passages distincts ; « envoyées / échouées / ignorées » = l'issue de chaque passage. La même colonne permet à l'Historique de montrer un passage par ligne (D-16).
- Risque / à décider par Rafba : colonne ajoutée par migration (staging puis prod) — additive, aucune donnée existante touchée.

### D-09 — « Total des déclenchements » (Vue d'ensemble) et « Total déclenché » (liste) ne comptent pas la même chose : 20 contre 24
- Point de la mission : 4
- Gravité : majeur
- Ce qu'on voit : pour les mêmes sept semaines, la somme de la colonne « Total déclenché » fait 24, la tuile de la Vue d'ensemble dit 20.
- Reproduction : jeu connu ; ouvrir `/automations/apercu`.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-09]` — tuile **20**, jeu **24**. L'écart : quatre règles déclenchées par le même événement sur le même client comptent pour 1 (−3) ; un envoi reporté, qui n'a pas encore de ligne de journal, compte pour 0 (−1).
- Cause racine : `src/lib/automationJournauxApi.ts:466-477` dédoublonne par (tranche, `entity_id`, `trigger_event`), sans la règle, et ne lit que les journaux ; `server/routes/automation-stats.ts:144-166` compte par règle et lit aussi la file.
- Correctif proposé : le même que D-01 — une seule définition, calculée dans `automation-stats.ts`.
- Risque / à décider par Rafba : aucun.

### D-21 — Lumi ne donne pas les mêmes chiffres que l'écran : 10 « sautés » contre 7
- Point de la mission : 4
- Gravité : mineur
- Ce qu'on voit : « pourquoi mes automatisations ne partent pas ? » — Lumi annonce 10 envois sautés ; les panneaux de la liste en totalisent 7.
- Reproduction : `… --project integration P/integration/15-lumi-sante.preuve.ts`.
- Preuve : `P/integration/15-lumi-sante.preuve.ts::[D-21]` — « Lumi : 10 sautés ; base : 7 envois sautés + 3 règles écartées ».
- Cause racine : `server/lib/agent/tools-etendus.ts:998-1001` compte toute ligne portant `result_data.saute`, y compris `action_type = 'conditions'`, que la route de statistiques ignore (`automation-stats.ts:152`). L'outil lit les 100 dernières lignes sans fenêtre de dates.
- Correctif proposé : dans `tools-etendus.ts`, sortir les lignes `conditions` de `sautes` et les rendre à part (`ecartees_par_leurs_conditions`) ; idéalement appeler `calculerStatistiques` pour ne garder qu'une définition.
- Risque / à décider par Rafba : aucun.

### D-23 — « envoi(s) » compte toute action réussie, même celles qui n'envoient rien
- Point de la mission : 4 (« métrique sans sens → remplace »)
- Gravité : mineur
- Ce qu'on voit : une automatisation qui ne fait que créer une notification pour l'équipe affiche « 1 envoi(s) » ; la Vue d'ensemble dit « N envoi(s) ont échoué » pour une tâche ou une étiquette en échec.
- Reproduction : règle A (notification interne), un événement ; déplier le panneau « › ».
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-23]` — panneau : « 60 derniers jours : 1 déclenchement(s), 1 envoi(s), … ».
- Cause racine : `server/routes/automation-stats.ts:96-100` (`classerJournal`) : tout succès sans `saute` est `envoye`. Sont aussi comptés « envoyés » les résultats où rien n'a été fait (`{ deja_ailleurs: true }`, `{ aucun_deal: true }`, `{ ignore: … }`, `actions/index.ts:2420-2482, 2805` — lu dans le code, NON VÉRIFIÉ par un test).
- Correctif proposé : la route rend `envoyes` (actions de `ACTIONS_MESSAGE`, `automationEngine.ts:565`) et `actions` (le reste) ; libellés « message(s) envoyé(s) » et « action(s) faite(s) » dans `Automations.tsx:2160-2161` et `PanneauEtape.tsx:424-429`.
- Risque / à décider par Rafba : le vocabulaire (« envoi », « action », « passage »).

### D-24 — Aucun écran ne laisse choisir la période, et chaque chiffre a la sienne sans le dire
- Point de la mission : 4 (« avec chaque filtre de période »)
- Gravité : majeur (manque)
- Ce qu'on voit : il n'y a aucun filtre de période. La pastille d'échecs porte sur 7 jours, la Vue d'ensemble sur 49 jours (non dit sur la tuile « Total »), la liste et les onglets sur 60 jours (non dit dans les en-têtes « Total déclenché » / « En cours »), Lumi sur « les 100 dernières lignes ». Une exécution de 70 jours existe encore en base et n'est visible nulle part.
- Reproduction : ouvrir `/automations` et `/automations/apercu`.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-24]` — aucun contrôle de période sur les deux écrans. Relevé `releve-fr-A.json` : en-têtes « Nom, Statut, Total déclenché, En cours, Modifiée le, Créée le, Stats, Actions ».
- Cause racine : `FENETRE_JOURS = 60` en dur (`server/routes/automation-stats.ts:35`, `src/lib/automationJournauxApi.ts:31`), 7 jours en dur (`automationRulesApi.ts:237`), 7 tranches en dur (`AutomationsApercu.tsx:50`).
- Correctif proposé : un paramètre `?jours=7|30|60|90` sur la route de statistiques (borné par la rétention), un sélecteur unique dans `SousNavigation` ou en tête de la liste et de la Vue d'ensemble, la période écrite dans les en-têtes.
- Risque / à décider par Rafba : les périodes offertes ; 90 jours est le maximum possible aujourd'hui (purge).

### D-25 — Les envois ignorés n'ont pas de détail par raison
- Point de la mission : 4 (jeu cible)
- Gravité : majeur (manque)
- Ce qu'on voit : « 2 étape(s) sautée(s) » et la raison du DERNIER saut seulement. Impossible de savoir combien de clients n'ont rien reçu faute de numéro, de consentement, ou parce qu'ils sont désabonnés.
- Reproduction : `… --project integration P/integration/10-jeu-connu.preuve.ts -t "D-25"`.
- Preuve : `::[D-25]` — clés rendues par la route : `declenches, en_cours, envoyes, sautes, echecs, dernier_saut`.
- Cause racine : `server/routes/automation-stats.ts:125` ne lit que `result_data->>saute` (la phrase), pas `saute_code` ; `:157-163` ne garde que le dernier motif.
- Correctif proposé : lire `code:result_data->>saute_code`, rendre `sautes_par_raison: { <code>: n }` ; l'écran affiche les raisons par libellé traduit (D-12). Les codes existants et leurs phrases sont dans `D-carte.md`, section 2.
- Risque / à décider par Rafba : les regroupements montrés au propriétaire (proposition : doublon, désabonné, hors ciblage, donnée manquante, condition plus valide, hors heures d'envoi, plafond de fréquence, non configuré).

---

## Historique et journaux (point 5)

### D-16 — L'onglet Historique est vide pour toute automatisation immédiate : ce n'est pas un historique, c'est la file d'attente
- Point de la mission : 5 (« Historique = vue lisible pour le propriétaire »)
- Gravité : majeur
- Ce qu'on voit : une automatisation qui a envoyé un texto à 5 clients affiche « Aucune inscription. Disponible sur les 60 derniers jours. ». L'onglet ne montre que les envois PRÉVUS (différés, étapes de parcours, reprises, reports). Pour un parcours, il montre une ligne par étape planifiée, avec l'identifiant brut « (e3) », pas une ligne par client. L'onglet Journaux, lui, montre les actions exécutées : les deux ne sont pas redondants, mais aucun n'est la vue « quel client, quand, quoi, résultat » d'un bout à l'autre.
- Reproduction : règle S (immédiate, 5 clients en 60 jours) ; ouvrir l'onglet Historique.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-16]` — « Aucune inscription. Disponible sur les 60 derniers jours. » Capture `d-historique-immediat.png`. Témoin vert `[D-EL-15]` : pour E, H, P l'onglet montre exactement les tâches de la file (3, 1, 4).
- Cause racine : `src/lib/automationJournauxApi.ts:111-138` (`lireInscriptions`) ne lit que `automation_scheduled_tasks` ; une action immédiate n'y passe jamais (`automationEngine.ts:1578-1580`).
- Correctif proposé : l'Historique devient la vue par PASSAGE : une ligne par (client, déclenchement) — client (lien), date, ce qui s'est passé en clair (« Texto envoyé », « Rien envoyé : pas de numéro », « En attente jusqu'au 4 oct. »), résultat. Construit côté serveur (nouvelle route `GET /api/automations/rules/:id/passages`) à partir des journaux ET de la file, regroupés par `passage_id` (D-06) ou, à défaut, par (`entity_id`, tranche de temps). Les Journaux gardent le détail technique (D-26). Fichiers : `server/routes/automation-stats.ts` (ou un fichier neuf), `src/lib/automationJournauxApi.ts`, `src/components/automations/OngletJournaux.tsx`.
- Risque / à décider par Rafba : le nom de l'onglet en anglais (« Enrollment history ») et ce que le propriétaire veut y voir en premier.

### D-10 — Le filtre « Réussis » des Journaux montre les envois sautés, et aucun filtre ne les isole
- Point de la mission : 5
- Gravité : majeur
- Ce qu'on voit : filtre « Statut : Réussis » sur une automatisation dont les deux clients n'ont pas de téléphone → deux lignes « Sauté — Aucun numéro de téléphone pour ce client ». Les options sont « Tous les statuts, Réussis, Échoués » : pas de « Sautés ». Les lignes « Conditions » sortent aussi sous « Réussis ».
- Reproduction : règle T ; onglet Journaux ; Statut = Réussis.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-10]` (2 lignes « Sauté » affichées) et `::[D-10b]` (options du filtre). Capture `d-journaux-filtre-reussis.png`.
- Cause racine : `src/lib/automationJournauxApi.ts:87-88` filtre sur `result_success`, que le moteur met à `true` pour un saut ; `OngletJournaux.tsx:207-209`.
- Correctif proposé : « Réussis » = `result_success = true` ET `result_data->saute` nul ; ajouter « Sautés » (`result_data->saute` non nul) ; même correction pour l'Historique (l'audit d'interface S-34 signale déjà qu'il lui manque « En cours » et « Sauté »).
- Risque / à décider par Rafba : aucun.

### D-11 — Le détail d'un envoi échoué dit « exécution antérieure au journal détaillé » et ne montre pas le message
- Point de la mission : 5 (« erreur exacte »)
- Gravité : mineur
- Ce qu'on voit : on déplie un échec d'aujourd'hui : « Le contenu de cet envoi n’a pas été conservé (exécution antérieure au journal détaillé). » C'est faux (l'exécution date de la minute), et le texte qui devait partir n'est pas montré.
- Reproduction : règle E ; onglet Journaux ; cliquer la première ligne.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-11]`. Capture `d-journaux-detail-echec.png`.
- Cause racine : un échec n'a pas de `result_data` ; l'écran se rabat sur `action_config` (`OngletJournaux.tsx:87-98`), mais la requête ne lit pas cette colonne (`automationJournauxApi.ts:78`). Le repli ne marche donc jamais.
- Correctif proposé : ajouter `action_config` au `select` ; pour un échec, afficher « Rien n'est parti » + le gabarit configuré + l'erreur exacte du fournisseur.
- Risque / à décider par Rafba : aucun.

### D-12 — Dans l'interface anglaise, les raisons d'un envoi sauté, annulé ou reporté sont en français
- Point de la mission : 5 (« raison compréhensible »)
- Gravité : majeur (pour un bureau anglophone)
- Ce qu'on voit : « Skipped — Aucun numéro de téléphone pour ce client », « Skipped — Client désabonné (texto) », « Conditions — Skipped — Conditions non remplies : source », « Pending — … reprise 1/4 dans 5 min », et dans la liste « Last skipped step: Aucun numéro de téléphone pour ce client ».
- Reproduction : interface en anglais ; onglet Execution logs des règles T, D, C, N, K.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-12]` (5 règles sur 5) ; `P/integration/25-raisons-lisibles.preuve.ts::[D-12b]` (13 motifs du moteur sur 14 rendus en français par `raisonLisible(…, false)`) et `::[D-12c]` (`motifSaut` n'a pas de langue). Capture `d-journaux-anglais.png`. Les motifs anglais du moteur, eux, sont bien traduits en français (témoin vert `[D-EL-25]`, 9 motifs relevés en prod).
- Cause racine : le moteur écrit la phrase en français dans `result_data.saute` et dans `last_error` ; `motifSaut()` (`automationJournauxApi.ts:293-296`) la rend telle quelle ; `raisonLisible()` (`:319-353`) ne connaît que des motifs anglais.
- Correctif proposé : traduire PAR CODE dans l'interface — une table `saute_code → { fr, en }` dans `automationJournauxApi.ts`, utilisée par `motifSaut(ligne, fr)`, par le panneau de la liste (`Automations.tsx:2169-2173`, via `dernier_saut_code` rendu par la route) et par `raisonLisible` pour les motifs d'annulation. Le moteur ajoute un code aux annulations (`annule_code` dans la tâche) plutôt que de faire reconnaître des phrases.
- Risque / à décider par Rafba : aucun.

### D-22 — Une étape retirée du parcours est expliquée par « l'automatisation a été supprimée »
- Point de la mission : 5
- Gravité : mineur
- Ce qu'on voit : dans l'Historique, une tâche annulée parce que son étape a été retirée affiche « Annulé — l’automatisation a été supprimée ». L'automatisation existe toujours.
- Reproduction : `… --project integration P/integration/25-raisons-lisibles.preuve.ts -t "D-22"`.
- Preuve : `::[D-22]` — `raisonLisible('Étape supprimée du parcours : envoi annulé.', true)` rend « l’automatisation a été supprimée ».
- Cause racine : `src/lib/automationJournauxApi.ts:347` reconnaît le mot « supprimée » n'importe où ; le motif écrit par `automationEngine.ts:2028` le contient.
- Correctif proposé : même correctif que D-12 (codes) ; à défaut, reconnaître « Automatisation supprimée ».
- Risque / à décider par Rafba : aucun.

### D-13 — Ni recherche, ni filtre par client, ni filtre par date ; et aucun journal à l'échelle du bureau
- Point de la mission : 5 (« recherche et filtres : automatisation, client, statut, date »)
- Gravité : majeur (manque)
- Ce qu'on voit : Journaux : deux listes (action, statut). Historique : une liste (statut). Pour répondre à « qu'est-ce que Mme Tremblay a reçu ? », il faut ouvrir chaque automatisation une à une et lire jusqu'à 200 lignes.
- Reproduction : ouvrir l'onglet Journaux d'une règle.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-13]` — 0 champ de recherche, 0 champ de date. Relevé : filtres `["Toutes les actions","Texto"]`, `["Tous les statuts","Réussis","Échoués"]`, `["Tous","En attente","Terminés","Échoués","Annulés"]`.
- Cause racine : `lireJournaux` accepte déjà `depuis` et `jusqua` (`automationJournauxApi.ts:59-68`), l'écran ne les propose pas ; aucun filtre par `entity_id` ; aucune page « Journal » sous `/automations`.
- Correctif proposé : (1) dans les deux onglets, un champ « Client » (recherche par nom → `entity_id`), deux dates, les statuts complets ; (2) un 4e écran de la sous-navigation, « Journal », toutes automatisations confondues, filtrable par automatisation, client, statut, date. Lecture par une route serveur paginée (voir D-15). La fiche d'un deal a déjà sa lecture restreinte (`relances_du_deal`) : la fiche client mériterait la même.
- Risque / à décider par Rafba : faut-il le journal global pour le lancement, ou les filtres par onglet suffisent-ils ?

### D-14 — Aucun lien vers le client, la facture, le devis ou le job
- Point de la mission : 5
- Gravité : mineur
- Ce qu'on voit : le nom du client est du texte ; rien ne mène à sa fiche ni à l'entité (facture, devis, job) qui a déclenché l'automatisation. L'entité n'est d'ailleurs pas affichée.
- Reproduction : onglets Journaux et Historique.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-14]` et `::[D-14b]` — 0 lien dans les deux tableaux.
- Cause racine : `OngletJournaux.tsx:258-260, 377-379` ; `nommerLesClients` (`automationJournauxApi.ts:153-268`) rend un nom, pas l'identifiant du client.
- Correctif proposé : `nommerLesClients` rend aussi `client_id` ; la cellule devient un lien vers `/clients/<id>` ; une colonne « Sur » donne l'entité (« Facture 1042 ») avec son lien.
- Risque / à décider par Rafba : aucun.

### D-15 — Au-delà de 200 lignes, les Journaux s'arrêtent sans le dire
- Point de la mission : 5 (« chaque exécution apparaît »)
- Gravité : majeur
- Ce qu'on voit : « 200 ligne(s) » pour une automatisation qui en a 230 ; aucune pagination, aucun « voir plus », aucun avertissement. Même plafond pour l'Historique.
- Reproduction : bureau B (d), règle V2 (230 lignes) ; onglet Journaux.
- Preuve : `P/ui/30-volume-plafonds.preuve.ts::[D-15]`. Capture `d-volume-journaux.png`. Prod : une règle a **2 727** lignes en 60 jours — 92 % de ses journaux sont invisibles.
- Cause racine : `src/lib/automationJournauxApi.ts:83` et `:130` (`.limit(200)`), sans compte total ni page suivante.
- Correctif proposé : pagination (`.range()` + `count: 'exact'`), compteur « 200 sur 2 727 », bouton « Voir les suivantes ».
- Risque / à décider par Rafba : aucun.

### D-17 — Si la lecture des échecs tombe en panne, la liste affiche « À vérifier (0) » comme si tout allait bien
- Point de la mission : 4 (état d'erreur)
- Gravité : majeur
- Ce qu'on voit : aucune pastille, « À vérifier (0) », aucun message. Le propriétaire croit que rien n'a échoué.
- Reproduction : bloquer les réponses de `/rest/v1/automation_execution_logs` (500) ; ouvrir `/automations`.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-17]` — onglet « À vérifier (0) », aucun avertissement, alors que le jeu a 2 règles en échec. Capture `d-echecs-illisibles.png`. Console : « Failed to load automation failures: panne simulée ».
- Cause racine : `src/pages/Automations.tsx:595-597` : `catch` → `console.error` seulement ; `failureCounts` reste `{}`. La Vue d'ensemble, elle, le dit (`AutomationsApercu.tsx:174-182`).
- Correctif proposé : un état `echecsIllisibles` dans `Automations.tsx` ; l'onglet devient « À vérifier (?) » et un bandeau dit « Les échecs n’ont pas pu être lus ». Disparaît de lui-même si D-02 fait passer ce compte par la route de statistiques (un seul état d'erreur, celui qui existe déjà).
- Risque / à décider par Rafba : aucun.

### D-18 — Les chiffres ne bougent pas tant qu'on ne recharge pas la page
- Point de la mission : 4 (« mise à jour après une nouvelle exécution »)
- Gravité : mineur
- Ce qu'on voit : une exécution arrive pendant que la liste est ouverte ; 20 secondes plus tard, « Total déclenché » est toujours à 0. Après rechargement : 1. Même chose pour la Vue d'ensemble, les onglets et le panneau d'étape (S-40).
- Reproduction : `… --project ui P/ui/20-ecrans-contre-base.preuve.ts -t "D-18"`.
- Preuve : `::[D-18]` — « 0 » après 20 s sans recharger, « 1 » après rechargement.
- Cause racine : `Automations.tsx:554-616` (chargement au montage et après une action de l'utilisateur seulement) ; aucun abonnement, aucune relance périodique ; aucun bouton « Actualiser » dans les onglets.
- Correctif proposé : relire les statistiques au retour sur l'onglet du navigateur (`visibilitychange`) et toutes les 60 s tant que la page est visible ; un bouton « Actualiser » dans les onglets Journaux et Historique.
- Risque / à décider par Rafba : le rafraîchissement automatique coûte une requête par minute et par onglet ouvert.

### D-19 — Les heures des Journaux sont celles de Montréal, quel que soit le fuseau de l'entreprise
- Point de la mission : 5
- Gravité : mineur
- Ce qu'on voit : un bureau réglé sur Vancouver lit « 18 h 49 » pour un envoi parti à 15 h 49 chez lui. Le moteur, lui, calcule ses fenêtres d'envoi dans le fuseau de l'entreprise : l'écran et le moteur ne parlent pas de la même heure.
- Reproduction : `company_settings.timezone = 'America/Vancouver'` ; onglet Journaux.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-19]` — affiché « 1 oct. 2026, 18 h 49 », attendu « 1 oct. 2026, 15 h 49 ».
- Cause racine : `src/components/automations/OngletJournaux.tsx:28-35` — `timeZone: 'America/Montreal'` en dur.
- Correctif proposé : passer le fuseau de l'entreprise (déjà dans `CompanyContext`) à `quand()`.
- Risque / à décider par Rafba : aucun.

### D-26 — Les Journaux ne donnent pas le détail technique attendu
- Point de la mission : 5 (« Journaux = événement déclencheur, conditions évaluées, décision de ciblage, résultat de chaque étape, erreur exacte »)
- Gravité : mineur (manque)
- Ce qu'on voit : quatre colonnes (Client, Action, Statut, Exécuté le). Ligne dépliée : destinataire et message pour un envoi ; pour un saut, les clés brutes « saute: … saute_code: sans_telephone ». Jamais : l'événement déclencheur, la durée, l'entité, l'étape du parcours, la tentative, l'erreur brute du fournisseur quand elle est traduite, la valeur qui a fait échouer une condition (« Conditions non remplies : source », sans dire que la source était « manuel » et qu'on attendait « site_web »).
- Reproduction : règle S ; onglet Journaux ; déplier une ligne.
- Preuve : `P/ui/20-ecrans-contre-base.preuve.ts::[D-26]` — détail affiché : « Destinataire +1429… Message Bonjour, merci de votre demande. », sans l'événement. Relevé `releve-fr-A.json`, `editeur.K.journaux.detail_premiere_ligne`.
- Cause racine : `trigger_event`, `duration_ms`, `entity_type` sont lus (`automationJournauxApi.ts:78`) et jamais affichés ; `scheduled_task_id` et `action_config` ne sont pas lus ; `journaliserRegleEcartee` (`automationEngine.ts:411-415`) n'écrit que le nom du champ, pas les valeurs.
- Correctif proposé : dans la ligne dépliée, un bloc « Détail technique » : événement (libellé du catalogue), entité, étape (nom donné dans le parcours, pas « e3 »), durée, tentative, erreur brute ; `journaliserRegleEcartee` ajoute `{ recu, attendu }` à `result_data`. Le libellé du motif vient du code (D-12), pas des clés brutes.
- Risque / à décider par Rafba : jusqu'où montrer l'erreur brute du fournisseur au propriétaire (elle peut citer un numéro).

### D-20 — Aucun historique des modifications d'une automatisation
- Point de la mission : 5 (« qui a modifié quoi et quand, utilisateur ou Lumi »)
- Gravité : majeur (manque)
- Ce qu'on voit : rien. Ni table, ni journal, ni écran. La seule trace d'une modification est `automation_rules.updated_at` — une date, sans auteur ni contenu. Si un message part avec un mauvais texte, on ne peut pas savoir qui l'a changé ni ce qu'il disait avant.
- Reproduction : modifier le texte d'une règle par l'API (`PATCH /api/automations/rules/:id`), puis par PostgREST (ce que fait la liste, `updateRuleMessage`), puis chercher la règle dans toute la base.
- Preuve : `P/ui/50-historique-modifications.preuve.ts::[D-20]` — « tables portant une trace de la règle depuis la modification : [] » (toutes les tables de `public` ayant un `created_at` sont fouillées) ; `::[D-20b]` — onglets de l'éditeur : « Parcours, Réglages, Historique, Journaux ». Témoin vert `[D-EL-30]` : les deux chemins modifient bien la règle.
- Cause racine : aucune route de `server/routes/automation-*.ts` n'écrit dans `audit_events` ni `activity_log` (cherché : aucune occurrence). `agent_actions` garde le nom de l'outil appelé par Lumi, une EMPREINTE de ses arguments et un résumé du résultat : ni la règle visée, ni l'avant/après, et rien pour les modifications faites à l'écran.
- Correctif proposé — le plus petit modèle qui le permet :
  - Table `automation_rule_revisions` : `id uuid pk`, `org_id uuid not null` (FK `orgs`, `on delete cascade`), `automation_rule_id uuid not null` (FK composite `(org_id, automation_rule_id)` → `automation_rules(org_id, id)`, `on delete cascade`), `acteur_id uuid null` (`auth.uid()` ; nul = système), `source text not null check (source in ('app', 'api', 'lumi', 'mcp', 'systeme'))`, `operation text not null` (`creation`, `modification`, `publication`, `depublication`, `corbeille`, `restauration`, `suppression`), `champs text[] not null`, `avant jsonb`, `apres jsonb` (les seules colonnes changées parmi `name, trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, folder_id, deleted_at`), `created_at timestamptz not null default now()`. Index `(org_id, automation_rule_id, created_at desc)`.
  - Qui écrit : un trigger `AFTER INSERT OR UPDATE` sur `automation_rules` (fonction `SECURITY DEFINER`, `search_path` fixé). C'est le seul point par où passent TOUS les chemins : PostgREST depuis la liste, l'API, les outils de Lumi, les préréglages. Il ignore une mise à jour qui ne touche que `updated_at` ou `lumi_conversation`.
  - L'auteur : `auth.uid()`. La source : l'en-tête de requête `x-lume-source` (lu comme `bureau_actif_demande()` lit `x-lume-org`), posé par le serveur — `api` dans les routes, `lumi` ou `mcp` dans le client construit pour les outils de l'agent ; absent avec un utilisateur = `app` ; sans utilisateur = `systeme`.
  - RLS : `FORCE ROW LEVEL SECURITY` ; `SELECT` à `member_has_permission(auth.uid(), org_id, 'automations.read')` + la policy RESTRICTIVE `bureau_actif` ; aucune policy d'écriture ; `REVOKE INSERT, UPDATE, DELETE` à `anon` et `authenticated` nommément.
  - Écran : une section « Modifications » dans l'onglet Réglages de l'éditeur (date, « par Marie » ou « par Lumi, à la demande de Marie », ce qui a changé).
  - Rétention : à fixer (proposition : 12 mois), dans `run_retention_logs`.
- Risque / à décider par Rafba : migration nouvelle (staging puis prod), additive — elle ne touche aucune automatisation existante. À décider : la durée de conservation, et si le texte des messages (qui peut contenir un nom saisi à la main) doit y figurer en clair.

---

## Rétention et Loi 25 (point 5)

Ce que la Loi 25 (Loi sur la protection des renseignements personnels dans le secteur privé) demande ici, en clair :
des durées de conservation DÉFINIES, la destruction ou l'anonymisation des renseignements une fois leur finalité
accomplie, et pas de conservation indéfinie. Elle ne fixe pas un nombre de jours : c'est à l'entreprise de le
fixer, de l'écrire et de l'appliquer. (Lecture d'ingénieur, pas un avis juridique.)

État des lieux : les journaux d'exécution ont une durée (90 jours) et une purge qui tourne en prod — preuve verte
`P/integration/40-retention-loi25.preuve.ts::[D-RET-01]`, et prod au 2026-10-01 : plus vieille ligne = 2026-07-03.

### D-07 — La file planifiée, le bac à sable et l'outbox n'ont ni durée de conservation ni purge
- Point de la mission : 5 (« rétention définie »)
- Gravité : majeur
- Ce qu'on voit : rien à l'écran. En base, les tâches closes restent pour toujours, avec le gabarit du message, les métadonnées de l'événement et, dans `last_error`, parfois le numéro ou l'adresse du client.
- Reproduction : `… --project integration P/integration/40-retention-loi25.preuve.ts -t "D-07"`.
- Preuve : `::[D-07]` et `::[D-07b]` — tables purgées aujourd'hui : `automation_execution_logs` 90 j, `activity_log` 180 j, `login_history` 180 j, `security_events` 365 j, `webhook_deliveries` 30 j, `tracking_live_locations` 7 j ; aucune fonction de la base ne supprime de `automation_scheduled_tasks` ni de `envois_simules`. Prod (lecture seule) : plus vieille tâche = 2026-06-12, **237 tâches closes de plus de 90 jours** ; `envois_simules` 658 lignes ; `domain_events` 2 542 lignes depuis le 2026-09-28, aucune purge trouvée.
- Cause racine : `run_retention_logs()` (`supabase/migrations/20260910160000_scale_retention_logs.sql`) ne liste pas ces tables.
- Correctif proposé : une migration qui ajoute à `run_retention_logs()` : `automation_scheduled_tasks` (statut `completed`, `failed`, `cancelled`, `completed_at` de plus de 90 jours — jamais une tâche `pending`), `envois_simules` (30 jours), `domain_events` traités (30 jours) ; et écrire ces durées là où le produit décrit sa conservation.
- Risque / à décider par Rafba : migration qui SUPPRIME des lignes anciennes (tâches closes) dans les vrais bureaux — c'est le cas « arrête et demande-moi ». Les journaux gardent une référence `scheduled_task_id` (`ON DELETE SET NULL`) : les statistiques par étape d'une tâche purgée tombent, sans effet sur la fenêtre affichée (60 j < 90 j).

### D-08 — Effacer un client ne l'efface pas des journaux : son numéro, son adresse et le texte reçu y restent
- Point de la mission : 5 (Loi 25)
- Gravité : majeur
- Ce qu'on voit : après « Effacer ce client » (`POST /api/dsr/erase/client/:id`), la fiche est anonymisée, mais l'onglet Journaux de chaque automatisation montre toujours, ligne dépliée, « Destinataire +1 … » et le message avec son nom — jusqu'à 90 jours. Dans le bac à sable, sans limite.
- Reproduction : `… --project integration P/integration/40-retention-loi25.preuve.ts -t "D-08"`.
- Preuve : `::[D-08]` — après `anonymize_client` (fiche : `ANONYMIZED`, téléphone et courriel nuls), coordonnées encore présentes : `{ automation_execution_logs: 2, automation_scheduled_tasks: 0, envois_simules: 2 }` (2 = le numéro ET l'adresse).
- Cause racine : `public.anonymize_client` (définition relevée en base) met à jour `clients`, `contacts` et `custom_field_values`, rien d'autre. `result_data` porte `to`, `subject`, `body` (`actions/index.ts:1523, 1682`).
- Correctif proposé : dans `anonymize_client` (migration), pour les lignes dont `entity_id` est le client ou une de ses entités (devis, factures, jobs, rendez-vous) : `result_data = result_data - 'to' - 'body' - 'subject' - 'message'`, `result_error` masqué comme le fait déjà `relances_du_deal` ; même traitement pour `automation_scheduled_tasks.last_error` et suppression des `envois_simules` du destinataire.
- Risque / à décider par Rafba : migration qui modifie une fonction de conformité ; à faire relire. Les tables `messages`, `email_deliveries` et `activity_log` (`metadata.to`) portent les mêmes coordonnées : hors de mon domaine, NON VÉRIFIÉ, à traiter dans le même geste.

### D-27 — 30 jours de journaux sont gardés sans être consultables, et la durée n'est dite nulle part
- Point de la mission : 5
- Gravité : cosmétique (à décider)
- Ce qu'on voit : les écrans disent « Disponible sur les 60 derniers jours » ; la base garde 90 jours. Une exécution de 70 jours existe et n'est lisible par personne (règle S du jeu : 6 lignes en base, 5 à l'écran).
- Reproduction : `… --project integration P/integration/40-retention-loi25.preuve.ts -t "D-RET-02"`.
- Preuve : `::[D-RET-02]` (vert, état des lieux) : `{ affiche: 60, conserve: 90 }`.
- Cause racine : `FENETRE_JOURS = 60` (`automationJournauxApi.ts:31`, `automation-stats.ts:35`) contre `'90 days'` dans `run_retention_logs()`.
- Correctif proposé : aligner — afficher 90 jours (avec D-24), ou purger à 60.
- Risque / à décider par Rafba : laquelle des deux durées.

---

## Ce que je n'ai pas pu vérifier

- Les textos : la pile locale n'a pas de fournisseur ; le bandeau « Les étapes texto sont sautées tant qu’aucun numéro n’est configuré » s'y affiche donc toujours (pas de client Twilio côté serveur). Son exactitude contre un vrai numéro n'a pas été éprouvée.
- Le temps réel : la pile locale n'a pas de service Realtime (erreurs WebSocket dans la console). Le code de ces écrans ne s'y abonne pas (D-18), mais je n'ai pas pu observer la prod.
- Les motifs d'« ignorée » sans trace autres que le doublon (D-04) : lus dans le code, non rejoués.
- Les automatisations déclenchées par une facture, un devis ou un rendez-vous : le jeu n'utilise que « Nouveau prospect » ; la résolution du nom du client par `quotes` / `invoices` / `jobs` / `schedule_events` (`nommerLesClients`) n'a pas été rejouée.
- Le plafond de 20 000 lignes de la route de statistiques (`MAX_LIGNES`) : non atteint, non éprouvé.
- La purge elle-même (`run_retention_logs`) n'a pas été exécutée : elle aurait vidé les lignes antidatées des autres agents sur la pile partagée. Sa définition a été lue en base, et la prod confirme son effet (plus vieille ligne = 90 jours).
- L'effacement d'un client par la route HTTP : la preuve appelle la fonction `anonymize_client` que la route appelle.

## Observations hors de mon domaine (pour le coordinateur, NON VÉRIFIÉES par un test)

- `rafaleDeTextos` (`automationEngine.ts:691-704`) compte les textos SAUTÉS (`result_success = true`) comme partis : 30 textos sautés en une minute (bureau sans numéro) feraient reporter les envois réels.
- `server/lib/recu/lecture.ts:69-75` tient un devis pour « déjà relancé » dès qu'une ligne `send_email` / `send_sms` est en succès, saut compris : un devis dont la relance a été SAUTÉE n'est plus proposé.
- Une réservation `'en cours'` laissée par un arrêt du processus est vue comme « faite » par le rejeu de l'outbox (`automationEngine.ts:839-855`) : l'action n'est jamais reprise, et la ligne s'affiche « Échoué — en cours ». Aucune ligne de ce type en prod sur 60 jours.
- `get_recent_agent_actions` (`tools-etendus.ts:2488-2520`) n'a aucun libellé pour les outils d'automatisation : une modification faite par Lumi y sortirait sous son nom d'outil brut.
- Atelier : `D:/lume-final/outils/env-local.mjs` écrit une `PAYMENTS_ENCRYPTION_KEY` de 48 octets ; l'API refuse de démarrer (« Expected 32 bytes, got 48 »). J'ai posé une clé jetable de 32 octets dans `wt-d/.env.local`. Et le délai de 120 s de `tests/automations-suite/harnais/serveurs-ui.ts` est trop court quand le poste est chargé : mes preuves d'écran se branchent sur des serveurs lancés à part (`P/serveurs-existants.ts`).
