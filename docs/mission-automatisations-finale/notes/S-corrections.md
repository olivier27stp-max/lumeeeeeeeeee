# Corrections de l'agent S — statistiques, Historique et Journaux des automatisations

Mission « correction finale Automatisations », points 4 et 5. Agent S, 2026-10-01.
Worktree `D:/lume-final/wt-d`, branche `mission/auto-finale-d` (rien n'est poussé). Tout a été joué sur la
pile locale, dans les bureaux « [TEST] QA Automatisations A/B (d) ». Liste de travail : les 27 constats de
`D-constats.md`. Captures et journaux des passes : `D:/lume-final/sorties/s/`.

« Corrigé » ci-dessous veut dire : la preuve a été VUE verte. « Vérifié au navigateur » : par une preuve
Playwright (`tests/automations-finale/d/ui/*.preuve.ts`), en français, et en anglais là où le texte compte.

## 1. Constat → commit → preuve → vérifié au navigateur

Commits (dans l'ordre) :

| Abrégé | Commit | Contenu |
|---|---|---|
| C1 | `62c17cf6` | `src/lib/automationIssues.ts` : ce qu'une issue veut dire à l'écran (libellés, catégories, repli des anciennes lignes) |
| C2 | `f38deadc` | `server/lib/automations-modifications.ts` : historique des modifications (bibliothèque) |
| C3 | `0429f555` | `server/lib/automations-stats.ts`, `server/routes/automation-stats.ts` : comptes en base, routes de lecture |
| C4 | `b98ccfc9` | **à reporter** : `server/lib/route-permissions.ts`, `Dockerfile` |
| C5 | `9a022819` | Vue d'ensemble (`src/pages/AutomationsApercu.tsx`, `src/lib/automationStatsApi.ts`) |
| C6 | `71edd9ee` | Liste (`src/pages/Automations.tsx`, `src/lib/automationRulesApi.ts`) |
| C7 | `566384bf` | Historique, Journaux, Modifications (`OngletJournaux.tsx`, `automationJournauxApi.ts`) |
| C8 | `2ad62dbf` | Page « Activité » du bureau (`AutomationsActivite.tsx`, `SousNavigation.tsx`, `src/App.tsx`) |
| C9 | `a1e20947` | `tests/automations-finale/d/**` (les preuves de D passées au vert, et les preuves neuves) |

| Constat | État | Commits | Preuve vue verte | Navigateur |
|---|---|---|---|---|
| D-01 Vue d'ensemble bloquée à 1 000 | corrigé | C3, C5 | `ui/30::[D-01]` (7, 30, 90 j : 285 / 285 / 1 285, dernière barre 285), `ui/30::[D-ST-10]` | oui |
| D-02 pastilles fausses au-delà de 200 échecs | corrigé | C3, C5, C6 | `ui/30::[D-02]` (230 et 5, « À vérifier (2) »), `[D-02b]` (235) | oui |
| D-03 plafond de fréquence compté en échec | corrigé à la LECTURE ; l'ÉCRITURE est au moteur | C1, C3, C6 | `integration/10::[D-03c]`, `12::[S-F-01]`, `ui/20::[D-03]` (ni échec, ni numéro, pas dans « À vérifier ») | oui |
| D-03 (ce que le moteur écrit), D-03b | NON corrigé — zone du moteur | — | `integration/10::[D-03]`, `[D-03b]` rouges | — |
| D-04 doublon sans trace | NON corrigé — zone du moteur ; la lecture est prête | C3 | `12::[S-F-02]` (un doublon tracé ne fait pas un 2e déclenchement) ; `10::[D-04]` rouge | — |
| D-05 report sans raison | corrigé à l'ÉCRAN (la raison se lit sur la tâche) ; `last_error` reste au moteur | C3, C7 | `ui/20::[D-05]`, `10::[D-05b]` ; `10::[D-05]` rouge (moteur) | oui |
| D-06 « déclenché » = clients distincts | corrigé (sans nouvelle colonne) | C3 | `10::[D-06]` | — (donnée) |
| D-07, D-07b purge de la file et du bac à sable | NON corrigé — décision du propriétaire | — | `40::[D-07]`, `[D-07b]` rouges | — |
| D-08 effacement d'un client dans les journaux | PROPOSÉ, non appliqué | — | `S-03_test_local.sql` (7 vérifications, transaction annulée) ; `40::[D-08]` rouge | — |
| D-09 deux définitions de « déclenchement » | corrigé | C3, C5 | `10::[D-09]` (7, 30, 90 j), `ui/20::[D-09]` (tuile = somme de la colonne = somme des barres) | oui |
| D-10 « Réussis » montrait les sautés | corrigé | C1, C3, C7 | `ui/20::[D-10]`, `[D-10b]`, `[D-10c]` | oui |
| D-11 détail d'un échec sans le message | corrigé | C7 | `ui/20::[D-11]` | oui |
| D-12 raisons en français en anglais | corrigé | C1, C6, C7 | `25::[D-12b]`, `[D-12c]`, `ui/20::[D-12]` (8 règles × 2 onglets), `[D-12a]` | oui (EN) |
| D-13 ni recherche, ni filtres, ni vue du bureau | corrigé | C3, C7, C8 | `ui/20::[D-13]`, `[D-13b]` (7, 30 j), `[D-13c]`, `ui/30::[D-13d]` | oui |
| D-14 aucun lien | corrigé (client ; facture, devis, job quand la fiche en est une) | C3, C7 | `ui/20::[D-14]`, `[D-14b]` ; lien de facture : test jsdom | oui (client) |
| D-15 arrêt à 200 lignes | corrigé | C3, C7 | `ui/30::[D-15]`, `[D-15a]`, `[D-15b]`, `[D-15c]` | oui |
| D-16 Historique vide pour une automatisation immédiate | corrigé | C3, C7 | `ui/20::[D-16]` (7, 30, 90 j), `[D-16b]` | oui |
| D-17 « À vérifier (0) » quand la lecture est en panne | corrigé (l'onglet est SANS compteur depuis `35cd0c43`, c'était « (?) » ; l'état vide ne dit plus « tout roule » : `b6aa344a`) | C5, C6 | `ui/20::[D-17]`, `[D-17b]`, `[D-EL-17]` | oui |
| D-18 chiffres figés | corrigé (30 s + retour sur l'onglet + « Actualiser ») | C5, C6, C7 | `ui/20::[D-18]` | oui |
| D-19 heures de Montréal en dur | corrigé | C3, C7 | `ui/20::[D-19]` | oui |
| D-20 historique des modifications | BÂTI ; reste à BRANCHER (§ 5) | C2, C3, C7 | `ui/50::[D-20a]`, `[D-20b]`, `[D-20c]`, `[D-20d]` ; `[D-20]` rouge tant que les routes n'appellent pas la fonction | oui (écran, FR et EN) |
| D-21 Lumi compte autrement | NON corrigé — hors zone (§ 7) | — | `15::[D-21]` rouge | — |
| D-22 « étape supprimée » = « automatisation supprimée » | corrigé | C1 | `25::[D-22]` | — (fonction) |
| D-23 « envoi » pour toute action | corrigé | C1, C3, C5, C6 | `10::[D-23]`, `ui/20::[D-23]` | oui |
| D-24 aucune période | corrigé | C3, C5, C6, C7 | `ui/20::[D-24]` et toutes les preuves « 7, 30, 90 jours » | oui |
| D-25 pas de détail par raison | corrigé | C3, C5, C6 | `10::[D-25]`, `ui/20::[D-25]`, `[D-25b]` (FR et EN) | oui |
| D-26 pas de détail technique | corrigé ; « valeur reçue / attendue » d'une condition : l'écran les affiche dès que le moteur les écrit (`result_data.recu`, `attendu`) | C7 | `ui/20::[D-26]` | oui |
| D-27 60 jours affichés, 90 gardés | corrigé (90 partout) | C3, C7 | `40::[D-RET-02]` | non — le texte « Les journaux sont gardés 90 jours » est vérifié en jsdom (`tests/automatisations-historique-journaux.test.tsx`), la rétention par la preuve d'intégration |

Isolation par bureau : gardée. `ui/40-isolation` (les 13 preuves de D) et `ui/45-isolation-nouvelles-lectures`
(11 preuves neuves : les cinq fonctions SQL et les quatre routes, avec les jetons du bureau B, du technicien
de A, et sans session).

## 2. Les définitions retenues

Écrites à UN endroit — la fonction SQL `automation_evenements` (migration S-01) pour le classement d'une ligne,
l'en-tête de `server/lib/automations-stats.ts` pour le sens — et lues par la liste, la Vue d'ensemble, les
onglets de l'éditeur et la page Activité.

| Métrique | Définition |
|---|---|
| **Déclenchée** | Une fiche est entrée dans l'automatisation : une action immédiate, ou la première tâche posée (action différée, report, première étape d'un parcours). Deux entrées de la même fiche dans la même automatisation à moins de 2 minutes (la fenêtre anti-doublon du moteur) en font UNE ; le même client qui repasse plus tard en fait deux. Un événement écarté AVANT d'entrer (conditions, hors ciblage, « une fois par client », bureau en pause) n'est PAS déclenché : il est ignoré. |
| **Envoyée** | Un message réellement parti chez le client : action réussie de type `send_sms`, `send_email`, `request_review`, `envoyer_facture`, `envoyer_soumission` (le `vers_client` du catalogue ; un test garde cette liste égale à `ACTIONS_MESSAGE` du moteur). |
| **Action faite** | Mon choix : comptée À PART (« action(s) interne(s) faite(s) »), jamais dans « envoyées » : tâche, étiquette, notification interne, webhook… |
| **Échouée** | Échec DÉFINITIF. Une action reprise quatre fois avant d'abandonner compte UNE fois ; un échec passager dont la reprise est encore en file n'est pas un échec (la fiche est « en cours ») ; un échec suivi d'une reprise réussie non plus. Une réservation du moteur restée « en cours » plus de 15 minutes est comptée échouée (« interrompue »). |
| **Ignorée** | Catégories « ignorée » et « annulée » de `automationMotifs.ts`, détaillées par groupe : doublon, désabonné ou sans consentement, hors ciblage, donnée manquante, condition plus valide, limite d'envois, autre. Un code inconnu du fichier est rangé « autre » (jamais perdu). |
| **Reportée** | L'envoi attend le prochain créneau (`hors_heures`, `rafale`). Montrée à part : le message partira, ce n'est pas une ignorée. |
| **En cours** | Fiches qui ont une étape en file (`pending`, `running`), MAINTENANT — sans période. |
| **Période** | 7, 30 ou 90 jours CIVILS, aujourd'hui compris, dans le fuseau de l'entreprise (`company_settings.timezone`). Les journaux sont gardés 90 jours. |

Lignes anciennes : « Frequency cap reached… » (écrit en échec) est classé ignoré / limite d'envois ; un report ou
une annulation que l'ancien moteur n'écrivait pas au journal est lu sur la tâche, et n'est jamais compté deux
fois quand le moteur corrigé écrit aussi la ligne (`integration/12-nouveau-format`, 9 preuves).

Ce que le moteur corrigé doit respecter pour que tout tombe juste (à transmettre à l'agent du moteur) :
- le code dans `result_data.saute_code`, avec `result_success = true` ;
- pour une tâche annulée ou reportée : `action_config.motif_code`, et si une ligne de journal est écrite, lui
  donner `scheduled_task_id` (à défaut : même fiche, même minute — la lecture sait les rapprocher) ;
- une ligne qui écarte l'événement AVANT d'entrer (`conditions`, `hors_ciblage`, `une_fois_par_client`,
  `pause_bureau`) : `scheduled_task_id` nul ;
- la valeur reçue et attendue d'une condition : `result_data.recu` et `result_data.attendu` (l'écran les affiche).

## 3. Migrations proposées (`D:/lume-final/notes/S-migrations-proposees/`)

| Fichier | Ce qu'elle fait | Appliquée | Retour arrière |
|---|---|---|---|
| `S-01_automation_statistiques.sql` | Cinq fonctions `SECURITY INVOKER`, `search_path = public, pg_temp`, EXECUTE retiré à `public` et à `anon` nommément : `automation_client_de`, `automation_evenements` (le flux unique : lignes du journal + états de la file sans ligne, avec code d'issue et catégorie), `automation_statistiques`, `automation_journal`, `automation_passages`. Aucun index ajouté (les index existants suffisent, liste dans l'en-tête). Aucune donnée touchée. | pile locale | les cinq `drop function` de l'en-tête |
| `S-02_automation_rule_modifications.sql` | La table `automation_rule_modifications` (bureau, règle, auteur + son nom, origine, action, champs, résumés FR / EN, avant / après, date), 2 index, RLS forcée : lecture `member_has_permission(…, 'automations.read')` + policy restrictive `bureau_actif` ; aucune policy d'écriture, droits retirés à `anon` et `authenticated`. Purge à 12 mois : UNE ligne ajoutée à `run_retention_logs()` (le reste de la fonction est repris à l'identique). | pile locale | remettre `run_retention_logs()` d'origine, puis `drop table` |
| `S-03_PROPOSITION_anonymize_client_journaux.sql` + `S-03_test_local.sql` | D-08 : `anonymize_client` retire des journaux, de la file et du bac à sable les coordonnées et le texte reçu par le client effacé (les lignes restent, les statistiques ne bougent pas). **À relire.** | **nulle part** (test local dans une transaction annulée : 7 vérifications passées) | réappliquer la définition d'origine |

Mesure de charge (transaction annulée, poste chargé) : 100 000 lignes dans un bureau — statistiques 1,1 s,
journaux 1,7 à 2,1 s, historique 2,4 à 5,5 s, comptes exacts (101 285). Le plus gros bureau de prod en a 2 961.
L'ordre de déploiement compte : S-01 et S-02 AVANT le code (sans les fonctions, les routes répondent 500 — les
écrans le disent, ils n'affichent pas de zéros).

## 4. Montage du routeur

Rien à ajouter dans `server/index.ts` : `automationStatsRouter` y est déjà monté (`app.use('/api', automationStatsRouter)`).
Les routes ajoutées vivent sous `/api/automations/rules/…` (`stats`, `historique`, `journaux`, `modifications`) :
elles héritent de la limite de débit des lectures (`reglesLimiter`, 300 / min).

À reporter (commit C4 `b98ccfc9`, deux fichiers partagés) :
- `server/lib/route-permissions.ts` — trois lignes, après `'GET /api/automations/rules/stats'` :
  `'GET /api/automations/rules/historique': 'automations.read'`, `…/journaux`, `…/modifications`.
- `Dockerfile` — `COPY src/lib/automationIssues.ts ./src/lib/automationIssues.ts`, après la ligne de `automationMotifs.ts`.
Et, dans C8 : `src/App.tsx` — l'import paresseux `AutomationsActivite` et la route `/automations/activite`
(droit `automations.read`), placée avant `/automations/:id`.

## 5. Où brancher `journaliserModification`

`import { journaliserModification } from '../lib/automations-modifications';`
Signature : `journaliserModification({ orgId, ruleId, auteurId, origine: 'utilisateur' | 'lumi' | 'systeme', action?, avant, apres })`.
Elle ne lève jamais et n'écrit rien si aucun champ suivi n'a changé : on peut l'appeler sans condition, APRÈS
l'écriture réussie. `avant` / `apres` : la ligne de la règle (au moins `name, trigger_event, conditions,
delay_seconds, actions, steps, settings, is_active, folder_id, deleted_at`). Lignes du fichier tel qu'il est en
`11e75ebc` (elles auront bougé).

`server/routes/automation-rules.ts`
| Route | Ligne | Appel |
|---|---|---|
| `POST /automations/rules` | ≈ 232-306, avant chaque `return res.status(201)` | `{ orgId: auth.orgId, ruleId: data.id, auteurId: auth.user.id, origine: 'utilisateur', action: 'creation', avant: null, apres: data }` |
| `POST /automations/rules/generer` (Lumi bâtit dans l'éditeur) | ≈ 354-546 | rien si la route ne fait qu'enregistrer la conversation ; si elle écrit `steps` ou `actions` : `origine: 'lumi'`, `avant` = la règle relue avant, `apres` = après |
| `PATCH /automations/rules/:id` | ≈ 548-718, juste avant `return res.json(…)` | `{ orgId: auth.orgId, ruleId: req.params.id, auteurId: auth.user.id, origine: 'utilisateur', avant: existante, apres: data }` — et AJOUTER `name, settings, folder_id` au `select` de `existante` (l. ≈ 557), sinon un renommage ou un réglage changé n'est pas vu |
| `POST /automations/templates/utiliser` | ≈ 744-824, après l'insertion | `action: 'creation'`, `avant: null`, `apres: data` |
| `POST /automations/rules/:id/duplicate` | ≈ 826-885, avant `return res.status(201)` | `ruleId: data.id`, `action: 'duplication'`, `avant: null`, `apres: data` |
| `DELETE /automations/rules/:id` (corbeille) | ≈ 887-972, après la mise à jour | `avant: { deleted_at: null, is_active: <lu avant> }`, `apres: { deleted_at: <date>, is_active: false }` (l'action « corbeille » est déduite) |
| `POST /automations/rules/:id/restaurer` | ≈ 983-1006 | `avant: { deleted_at: <non nul> }`, `apres: data` (« restauration » déduite) |
| `POST /automations/rules/:id/copier-bureaux` | ≈ 1159 (dans la fonction de copie) | une ligne par règle créée ou mise à jour dans le bureau cible : `orgId` = bureau cible, `action: 'creation'` ou rien (déduit) |
| `DELETE …/definitivement` | — | rien : la règle part, son historique avec elle (clé étrangère en cascade) |

`server/lib/automations-publication.ts`
| Fonction | Ligne | Appel |
|---|---|---|
| `changerPublication` (interrupteur et lot) | ≈ 176, avant le `return { ok: true … }` | `avant: { is_active: !ligne.is_active }`, `apres: { is_active: ligne.is_active }` (« publication » / « dépublication » déduites) ; `auteurId` et `origine` à passer en paramètres par l'appelant |
| `activerApresEcritureUtilisateur` | ≈ 69 | rien de plus si l'appelant (PATCH) journalise déjà `is_active` |

Outils de Lumi et du MCP (hors zone) — `origine: 'lumi'`, `auteurId` = l'utilisateur de la conversation :
`server/lib/agent/tools-reglages.ts` (écritures ≈ 490, 521, 567, 597, 639), `tools-lot-entreprise.ts` (≈ 394, 414, 441),
`tools-etendus.ts` (≈ 941), `server/lib/lumi/execution.ts` (≈ 119). Relire la règle avant et après l'écriture.

Ce que la fonction ne peut PAS voir : une écriture faite par le navigateur directement dans PostgREST.
Il en reste une dans la liste — `updateRuleMessage` (`src/lib/automationRulesApi.ts`, « Voir les messages » › Enregistrer).
Tant qu'elle ne passe pas par `PATCH /api/automations/rules/:id`, la correction d'un texte depuis la liste ne
laisse pas de trace (c'est le second chemin de la preuve `[D-EL-30]`). Ce fichier est en cours de correction
par un autre agent (texto écrasé, `05-lignes:488`) : à faire dans le même geste.
(Mon propre changement dans ce fichier : le retrait de `getRecentAutomationFailures` et
`getFailureCountsByRule`, section « Échecs d'automatisation » — à fusionner avec le sien.)

## 6. Codes d'issue manquants dans `src/lib/automationMotifs.ts`

Aucun code écrit aujourd'hui par le moteur, ni aucun des treize annoncés, ne manque (test
`tests/automation/issues-lisibles.test.ts`, « les codes que le moteur écrit aujourd'hui sont tous dans la liste »).
À envisager, pour ce que mes écrans affichent sans code de la liste :
- `interrompue` — une réservation du moteur restée « en cours » plus de 15 minutes (classée échouée par la
  base ; libellé écrit dans `automationIssues.ts`) ;
- un code pour une tâche annulée SANS motif (`annulee` côté base, rangé « condition plus valide ») ;
- `visite_en_lot` et `creneau_depasse` (D-04 : confirmation d'une visite créée en lot, rappel dont le créneau
  est dépassé de plus de 30 minutes) si le moteur se met à les tracer : aujourd'hui `rappel_perime` couvre le second.
Deux remarques sur les libellés existants, sans les avoir touchés :
- `doublon` dit « Le client a déjà reçu ce message d'une autre automatisation » : le doublon du constat D-04
  (le MÊME événement reçu deux fois) porterait le même code avec une phrase qui ne lui va pas ;
- `desabonne` est encore le code par défaut de `saute()` : une demande d'avis sautée pour une autre raison
  s'affiche « Client désabonné » en anglais (en français, la phrase du moteur corrige).

## 7. Constats NON corrigés, et pourquoi

| Constat | Pourquoi | Ce qu'il faut |
|---|---|---|
| D-03, D-03b (écriture), D-04, D-05 (`last_error`) | Ce que le MOTEUR écrit — zone de l'agent du moteur. Les écrans et les comptes sont justes dans les deux formats. | `saute(…, 'plafond_frequence')` sans le destinataire ; une ligne `doublon` ; le motif du report. Les preuves `10::[D-03]`, `[D-03b]`, `[D-04]`, `[D-05]` passeront alors au vert sans changement. |
| D-07, D-07b | Purger les tâches closes, le bac à sable et l'outbox SUPPRIME des données de vrais bureaux : décision du propriétaire. | Trancher les durées ; ajouter les cibles à `run_retention_logs()`. |
| D-08 | Fonction de conformité : proposée (S-03), à relire. | Relire S-03, l'appliquer staging puis prod ; traiter `messages`, `email_deliveries`, `activity_log` dans le même geste. |
| D-20 (la trace écrite par les routes) | Les appels sont dans `automation-rules.ts`, hors zone. | Le § 5. |
| D-21 | `server/lib/agent/tools-etendus.ts` (`get_automation_health`, ≈ l. 960-1030), hors zone. | Remplacer la lecture des 100 dernières lignes par `calculerStatistiques(client, orgId, null, { jours: 30 })` (`server/lib/automations-stats.ts`) et rendre `total.envoyees`, `total.echouees`, `total.ignorees` + `ignorees_par_groupe`, `total.reportees`, la période dite. À défaut : sortir les lignes `action_type = 'conditions'` de « sautés ». |
| Panneau d'étape de l'éditeur (« 60 derniers jours ») | `PanneauEtape.tsx` et `AutomationBuilderPage.tsx`, hors zone. La route garde 60 jours quand `jours` est absent : le texte reste vrai. | Passer `?jours=90` (ou la période choisie : `lirePeriodeChoisie()`) dans `chargerStatistiques(ruleId)` et écrire la période dans le panneau. |
| Onglet « Modifications » de l'éditeur | Ajouter un onglet est dans `AutomationBuilderPage.tsx`. « Modifications » est une vue de l'onglet Historique (`VueModifications` est exporté pour en faire un onglet). | Aussi : l'onglet s'appelle encore « Enrollment history » en anglais. |

## 8. Lot « liste » — les défauts de `D:/lume-uiaudit/sorties/triage/liste.md`

Second lot, dans `src/pages/Automations.tsx`. Test de régression du dépôt : `tests/automatisations-liste-triage.test.tsx`
(un bloc par ligne du triage, nommé par sa spec). « Spec rejouée » : la spec Playwright de la session d'audit
(`D:/lume-uiaudit/wt-lumi`, lecture seule), rejouée au vrai navigateur contre MES serveurs (Vite 5494, API 3494, jeu « d »).

**Comment lire « attentes vertes ».** La pile locale « lumefinal » n'a pas de service temps réel : chaque page tente un
WebSocket, reçoit 404, et le MONITEUR du banc (qui refuse toute erreur de console) fait échouer le test APRÈS ses
attentes. Aucune spec ne peut donc sortir « passed » sur ma pile. « Attentes vertes » = toutes les attentes du test ont
passé, et les seuls problèmes relevés par le moniteur sont ces WebSocket. Ce n'est PAS un « passed » du banc : à rejouer
sur une pile qui a le temps réel pour l'avoir.

### 8.1 Les quatre majeurs

| Ligne du triage | Commit | Test du dépôt (jsdom) | Vérifié au navigateur (spec rejouée) |
|---|---|---|---|
| `07-lot:188` — « Client inactif » publié en lot sans confirmation | `28e89950` | bloc « 07-lot:188 » (5 cas) | oui — `07-lot.spec.ts:189` @defaut : attentes vertes |
| `12-permissions:86`, `:102` — « voir sans modifier » → « Accès restreint » | `2da8fb34` | bloc « 12-permissions » (8 cas) ; `tests/automation/sous-navigation.test.tsx` | oui — `12-permissions.spec.ts`, les 6 tests dont `:86` et `:102` @defaut : attentes vertes |
| `10-volume:210` — au-delà de 200 échecs, une automatisation en échec sort de « À vérifier » | `71edd9ee` (D-02) + `b6aa344a` | bloc « 03-onglets-etats:229 et 10-volume:210 » (4 cas) ; preuves D `ui/30::[D-02]`, `[D-02b]` | en partie — `10-volume.spec.ts:211` : la ligne discrète EST dans l'onglet à côté de la bruyante (attente l. 229 verte) ; l'attente finale « À vérifier (2) » lit « (3) » parce que mon bureau porte aussi le jeu connu des preuves D (une automatisation en échec). À rejouer sur un bureau propre. |
| `03-onglets-etats:229` — lecture des échecs en panne → « tout roule » | `71edd9ee` (D-17) + `b6aa344a` | même bloc ; preuves D `ui/20::[D-17]`, `[D-17b]` | attentes vertes, mais LA SPEC NE PROUVE PLUS RIEN : elle simule la panne sur `/rest/v1/automation_execution_logs`, que la page ne lit plus (voir 8.4). La panne réelle (route des chiffres en 500) est prouvée au navigateur par `ui/20::[D-17]`. |
| `11-clavier:178` — menu « ⋮ » hors d'atteinte du clavier (portail) ; avec `:209` (reste ouvert) et `:161` (flèches dans « Créer ») | `8deac877` | bloc « 11-clavier:178, :209, :161 » (7 cas) | oui — `11-clavier.spec.ts:161`, `:178`, `:209` @defaut et `:135`, `:150`, `:197` : attentes vertes |

Majeur 2, précisions : la garde de la page passe à `automations.read`. Sans `automations.update` : note « Lecture seule »
avec la raison ; Créer, Construire avec Lumi, Nouveau dossier, renommer / supprimer un dossier, menu « ⋮ », « Tout arrêter »,
« Modifier dans l'éditeur » sont ABSENTS ; cases à cocher, interrupteur et langue des messages sont GRISÉS avec la raison en
infobulle ; le nom n'est plus un bouton (l'éditeur exige de modifier) ; les messages se lisent sans champ ; « Réglages
globaux » (page qui exige de modifier) n'est plus dans la sous-navigation ; la lecture des bureaux cibles (403) n'est plus
lancée. La Vue d'ensemble et « Activité » (Historique et Journaux du bureau) demandaient déjà `automations.read`.
Fichiers touchés hors `Automations.tsx` : `src/components/automations/BandeauPause.tsx` (prop `lectureSeule`),
`src/components/automations/SousNavigation.tsx`.

**À REPORTER — App.tsx** : rien pour ce lot. La route `/automations` et l'entrée de menu demandent déjà
`automations.read` ; qui n'a pas ce droit ne voit pas l'entrée (spec `12-permissions.spec.ts:75`, attentes vertes).
(La seule ligne d'`App.tsx` que j'ai ajoutée est celle de la page « Activité », commit C8 `2ad62dbf` : l'import
`React.lazy` d'`AutomationsActivite` et la route `/automations/activite` gardée par `automations.read`.)

### 8.2 Mineurs et cosmétiques

| Ligne du triage | Commit | Test du dépôt (jsdom), bloc | Vérifié au navigateur (spec rejouée) |
|---|---|---|---|
| `03-onglets-etats:184` — « Corbeille (0) » quand la lecture est en panne | `35cd0c43` | « 03-onglets-etats:184 » (3 cas) | oui — `:184` @defaut : attentes vertes |
| `03-onglets-etats:143` — le tableau attendait les statistiques | `62475d7b` | « 03-onglets-etats:143 » (2 cas) | oui — `:143` @defaut : attentes vertes |
| `03-onglets-etats:130` — roue muette | `55f9062c` | « 03-onglets-etats:130 » (2 cas, FR et EN) | oui — `:130` @defaut : attentes vertes (et `:113`, sans marque) |
| `06-menu-actions:255` — le tableau retiré à chaque rechargement | `66995bf4` | « 06-menu-actions:255 » (3 cas) | oui — `:255` @defaut : attentes vertes |
| `06-menu-actions:217` — double duplication | `74b5b1ac` | « 06-menu-actions:217 » (2 cas) | oui — `:217` @defaut : attentes vertes (et `:237`, sans marque) |
| `13-libelles-et-complements:143` — panne de « Duplicate » dite en français | `b93ffd61` | « 13-libelles-et-complements:143 » (3 cas) | oui — `:143` @defaut : attentes vertes |
| `03-onglets-etats:86`, `:96` — l'onglet n'était pas dans l'adresse | `41c4cbca` | « 03-onglets-etats:86 et :96 » (3 cas) | oui — `:86`, `:96` @defaut : attentes vertes (et les quatre `:78`) |
| `11-clavier:50` — onglets aux flèches | `74f5fd03` | « 11-clavier:50 » (3 cas) | oui — `:50` @defaut : attentes vertes (et `:60` Entrée / Espace) |
| `11-clavier:113` — focus perdu après Échap dans la saisie d'un dossier | `0096e0cf` | « 11-clavier:113 » (4 cas) | oui — `:113` @defaut : attentes vertes (et `:99`) |
| `03-onglets-etats:266` — l'état vide ne proposait rien | `55b86aa9` | « 03-onglets-etats:266 » (4 cas) | oui — `:266` @defaut : attentes vertes (et `:245`) |
| `03-onglets-etats:277` — « Aucune automatisation » pour une recherche sans résultat | `7205cae6` | « 03-onglets-etats:277 » (3 cas) ; attente retournée dans `front-automations-ecran.test.tsx` (T13.2 figeait le défaut) | oui — `:277` @defaut : attentes vertes |
| `04-filtres-recherche-tri:160` — filtre actif invisible | `e0e67f60` | « 04-filtres-recherche-tri:160 » (3 cas) | NON rejouable sur mon bureau : la spec exige une liste VIDE sous « Statut : Brouillon », or mon bureau porte les brouillons du jeu connu des preuves D ; elle tombe sur cette précondition (l. 166), avant l'attente du bouton. jsdom seulement. |
| `04-filtres-recherche-tri:99`, `:106` — accents, espaces | `b64b4069` | « 04-filtres-recherche-tri:99 et :106 » (3 cas) | oui — `:99`, `:106` @defaut : attentes vertes |
| `04-filtres-recherche-tri:113`, `:123` — chercher ce qu'on voit | `22563de2` | « 04-filtres-recherche-tri:113 et :123 » (4 cas) | oui — `:113`, `:123` @defaut : attentes vertes |
| `05-lignes:119` — clé technique du déclencheur | `931b7f0b` | « 05-lignes:119 » (2 cas) | oui — `:119` @defaut : attentes vertes (et `:100`, les sous-titres) |
| `04-filtres-recherche-tri:205` — catégorie d'une automatisation personnelle | `00f5fdb4` | « 04-filtres-recherche-tri:205 » (3 cas) | oui — `:205` @defaut : attentes vertes |
| `04-filtres-recherche-tri:264`, `:413` — un seul tri | `54e499b3` | « 04-filtres-recherche-tri:264 et :413 » (3 cas) | oui — `:264`, `:413` @defaut : attentes vertes (et tout le bloc « tri par colonne » sauf `:343`, voir 8.4) |
| `05-lignes:148` — l'avertissement d'avis ouvrait l'éditeur | `b6c8ede4` | « 05-lignes:148 » (3 cas) | oui — `:148` @defaut : attentes vertes (et `:135`) |
| `05-lignes:409` — « Journaux » sans lien | `0993dba7` | « 05-lignes:409 » (2 cas) | oui — `:409` @defaut : attentes vertes |
| `05-lignes:78` — interrupteur vert à la corbeille | `a9ec9524` | « 05-lignes:78 » (2 cas) | oui — `:78` @defaut : attentes vertes |
| `05-lignes:336` — rien ne bouge pendant le décompte | `5132c3bb` | « 05-lignes:336 » (2 cas) | oui — `:336` @defaut : attentes vertes (et `:304`) |
| `06-menu-actions:433` — messages modifiables à la corbeille | `a446ed2e` | « 06-menu-actions:433 » (3 cas) | oui — `:433` @defaut : attentes vertes (et `:418`) |
| `07-lot:179` — « Publier (0) » actif | `593de73b` | « 07-lot:179 » (2 cas) | oui — `07-lot.spec.ts:180` @defaut : attentes vertes |
| `07-lot:159` — deux refus sur une ligne | `5bbbd269` | « 07-lot:159 » ; le collecteur de toasts de `automatisations-liste-launch.test.tsx` lit maintenant le texte d'un message-élément (même attente) | oui — `:160` @defaut : attentes vertes |
| `07-lot:66` — case « Tout cocher » jamais intermédiaire | `884b7380` | « 07-lot:66 » | oui — `:67` @defaut : attentes vertes |
| `10-volume:164` — pas de « Sélectionner les 60 » | `7e693f60` | « 10-volume:164 » (5 cas, dont le découpage du lot par 200) | oui — `10-volume.spec.ts:165` @defaut : attentes vertes (et `:36`, `:139`, `:175`, `:191`) |
| `02-dossiers:150` — fil d'Ariane fixe | `3738052c` | « 02-dossiers:150 » (3 cas) | oui — `02-dossiers.spec.ts` rejouée EN ENTIER (20 tests) : attentes vertes |
| `07-lot:97` — le tableau descend quand on coche | `5403ce00` + `9dc9f9ac` | « 07-lot:97 » (structure) | oui — `:98` @defaut : attentes vertes (écart mesuré : 4 px au premier essai, 0 après réglage) ; et MA preuve `ui/60-liste-lot::[07-lot:97]` à 1 440 × 900 et 1 024 × 800 |
| `02-dossiers:283` — suppression d'un dossier sans un mot | `c3d06966` | « 02-dossiers:283 » (3 cas) | oui — `:283` @defaut : attentes vertes |
| `02-dossiers:354` — dossiers illisibles | `a91d9f3e` | « 02-dossiers:354 » (4 cas) | oui — `:354` @defaut : attentes vertes |
| `09-copier-bureaux:221`, `:231`, `:241` — modale de copie | `5cef0a08` | « 09-copier-bureaux:221, :231, :241 » (4 cas) | oui — `09-copier-bureaux.spec.ts` rejouée EN ENTIER (11 tests) : attentes vertes |

Rejouées en entier après le dernier correctif, toutes attentes vertes : `01-barre-haut` (23 tests), `02-dossiers` (20),
`07-lot` (17), `09-copier-bureaux` (11), `12-permissions` (6). Les autres fichiers : voir 8.4 pour ce qui reste rouge et pourquoi.

Deux restes trouvés par MES mesures au navigateur, corrigés dans `9dc9f9ac` : à 1 024 px la barre de lot passait sur deux
lignes (le tableau redescendait) ; et le bandeau « Les étapes texto sont sautées… », dont la réponse arrive avec les
chiffres, poussait le tableau de 58 px après son affichage — saut créé par mon correctif de `03-onglets-etats:143`.
Preuve : `tests/automations-finale/d/ui/60-liste-lot.preuve.ts` (5 preuves). Limite restante, dite : à la toute première
visite d'un bureau sans numéro texto, le bandeau peut encore arriver après le tableau (rien n'est encore retenu).

### 8.3 Lignes du triage NON corrigées, et pourquoi

| Ligne | Pourquoi | Ce qu'il faut |
|---|---|---|
| `05-lignes:488` — le second texto écrasé | Exclue par le coordinateur : cause dans `src/lib/automationRulesApi.ts`, qu'un autre agent corrige. | — |
| `08-confirmation:91`, `:107` — le focus sort du dialogue de confirmation, et n'y revient pas | HORS ZONE : `src/components/ui/ConfirmDialog.tsx`, partagé par 51 fichiers de l'application. Rejouées : toujours rouges (« après 2 Tab, le focus est encore dans le dialogue » ; `toBeFocused`). | Dans `ConfirmDialog.tsx`, l'effet des lignes 94-103 : (1) retenir `document.activeElement` à l'ouverture et lui rendre le focus à la fermeture ; (2) piéger Tab / Maj+Tab entre les boutons du dialogue (même geste que dans `CopierVersBureauxModal.tsx`, commit `5cef0a08`, qu'on peut reprendre tel quel). |
| `05-lignes:127` — « Anniversaire client » : « Nouveau prospect · 12 mois après » | DÉCISION DE PRODUIT (le triage le dit ; « NON FAIT » au tableau des constats). Le sous-titre dit vrai : le préréglage part 12 mois après la création de la fiche. C'est le NOM du préréglage qui promet autre chose. Rejouée : rouge. | Trancher : renommer le préréglage (« Un an après la création de la fiche ») ou lui donner un vrai déclencheur d'anniversaire (`date.reached` sur un champ de date). Les deux touchent les préréglages semés en base et `automationPresets.data.ts`, hors zone. |

### 8.4 Specs Playwright : celles que mes changements rendent fausses, et celles que mon bureau de test fait tomber

Je n'ai modifié aucun fichier de `e2e/automations/**`. Voici ce que j'y ai vu.

**A. À adapter — le produit a changé exprès (mission D, points 4 et 5).**

| Spec | Ce qu'elle attend | Ce que l'écran fait maintenant |
|---|---|---|
| `03-onglets-etats.spec.ts:229` (S-26, @defaut) | panne simulée sur `/rest/v1/automation_execution_logs` | La liste ne lit plus cette table depuis le navigateur : la panne à simuler est `**/api/automations/rules/stats*` (500). L'onglet dit alors « À vérifier » SANS compteur et l'état vide « Les échecs n'ont pas pu être lus… ». Telle quelle, la spec passe à vide (et déclare deux pannes « attendues » qui ne surviennent plus). |
| `03-onglets-etats.spec.ts:220` | « 1 échec(s) dans les 7 derniers jours » | La période se choisit (7 / 30 / 90 jours), 30 par défaut : « … dans les 30 derniers jours ». |
| `11-clavier.spec.ts:29` (ordre de tabulation) | « Vue d'ensemble », « Réglages globaux »… « Filtres avancés », « Rechercher »… « Total déclenché » ; quatre arrêts sur les onglets | S'y ajoutent le lien « Activité » et le choix « Période » ; l'en-tête s'appelle « Déclenchées (30 j) » ; les onglets ne font plus qu'UN arrêt de tabulation (`11-clavier:50`). |
| `04-filtres-recherche-tri.spec.ts:343` | clic sur l'en-tête « Total déclenché » | L'en-tête s'appelle « Déclenchées (N j) ». |
| `04-filtres-recherche-tri.spec.ts:171` | toutes les automatisations personnelles sous « Suivi » | Elle figeait le défaut `04:205` : une automatisation personnelle est rangée d'après son déclencheur. |
| `05-lignes.spec.ts` « chevron Stats » (`:356` et suivants) | « les chiffres des 60 derniers jours » | Le panneau donne les chiffres de la période choisie, écrite dans la phrase. |
| `13-libelles-et-complements.spec.ts:19` | une réponse dont l'adresse FINIT par `/api/automations/rules/stats` | L'appel porte la période : `/api/automations/rules/stats?jours=30`. Le motif de route (sans `*`) et l'attente de réponse ne le voient plus. |

**B. Rouges sur MON bureau seulement — données d'avant, pas le produit.** Les preuves de D sèment dans le bureau A un « jeu connu »
(dont une automatisation en échec et des brouillons). Tant qu'il y était : `03-onglets-etats.spec.ts:212` (« À vérifier (0) »
attendu, « (1) » lu), `10-volume.spec.ts:211` (« (2) » attendu, « (3) » lu — la ligne discrète y EST, l'attente de la ligne 229
passe), `04-filtres-recherche-tri.spec.ts:160` (liste vide attendue sous « Brouillon »). À rejouer sur un bureau propre.

**C. Aucune spec ne peut sortir « passed » sur la pile locale « lumefinal »** : pas de service temps réel, donc un WebSocket en
404 que le moniteur relève à chaque test. D'où « attentes vertes » partout dans ce rapport, jamais « passed ».

### 8.5 À savoir pour l'intégration du lot

- **Fichiers touchés hors `src/pages/Automations.tsx`** (tous propres à l'écran de la liste) : `src/components/automations/BandeauPause.tsx`
  (prop `lectureSeule`), `src/components/automations/SousNavigation.tsx` (« Réglages globaux » seulement pour qui peut modifier),
  `src/components/automations/CopierVersBureauxModal.tsx` (focus, Échap, pas de fermeture pendant la copie).
  `MessageEditor.tsx`, `InterrupteurPublication.tsx`, `ConfirmDialog.tsx`, `automationBuilderApi.ts`, `automationMotifs.ts` : PAS touchés.
- **Conflit possible** : `src/lib/automationRulesApi.ts`. Mon commit C6 (`71edd9ee`) y retire `getRecentAutomationFailures`,
  `getFailureCountsByRule` et le type `AutomationFailure` (la liste ne lit plus les échecs depuis le navigateur). Un autre agent
  corrige `updateRuleMessage` dans le même fichier (`05-lignes:488`) : zones différentes du fichier, mais à fusionner à la main.
- **Replis français du client de l'API** (`src/lib/automationBuilderApi.ts`, hors zone) : chaque `erreurDe(reponse, 'Impossible de…')`
  n'existe qu'en français. La liste les traduit elle-même (`REPLIS_EN` dans `Automations.tsx`, garde-fou dans le test
  « 13-libelles-et-complements:143 ») ; le vrai remède est un repli bilingue dans le client, qui servirait aussi l'éditeur.
- **Tests existants dont l'attente a changé** (même intention, dit dans chaque test) : `front-automations-ecran.test.tsx` — T13.2
  figeait le défaut `03:277` (attente retournée), et D-17 lisait « À vérifier (?) » (maintenant sans compteur) ;
  `sous-navigation.test.tsx` — quatre sections depuis « Activité » ; `automatisations-liste-launch.test.tsx` — le collecteur de
  toasts lit le texte d'un message-élément ; la preuve `ui/20::[D-17]` — sans compteur.
- **Choix de comportement à relire** : sélection étendue (« Sélectionner les N ») — elle agit sur des lignes d'autres PAGES de la
  même vue, ce que l'audit M9 interdisait pour des lignes d'une autre VUE ; elle est explicite, annoncée, et tombe au moindre
  changement de page ou de vue. Onglets : la flèche ouvre l'onglet atteint (activation automatique). Bandeau texto : retenu
  dans le stockage du navigateur, par bureau (`lume-automations-texto:<bureau>`).

### 8.6 Reports de l'agent T dans mes fichiers (après `git merge mission/automatisations-finale`, commit `c19efabf`)

Fusion : un seul conflit, `Dockerfile` (ma ligne `COPY src/lib/automationIssues.ts`, gardée). `src/lib/automationRulesApi.ts`
s'est fusionné seul (mon retrait des lectures d'échecs, son API des messages).

| Report | Commit | Ce qui est fait | Tests |
|---|---|---|---|
| `T-a-reporter/Automations.patch`, points 1 et 2 (`04-courriel:260`, propriétés de `<MessageEditor>`) | `83db2c75` | Reporté À LA MAIN (le patch ne s'appliquait plus). `load({ silencieux })` + `onSaved={() => { void load({ silencieux: true }); }}` ; `rang`, `bodyEn`, `langueBureau`, `lectureSeule` passés à `<MessageEditor>`. Point 3 (retirer le sélecteur FR / EN) : PAS appliqué. | Bloc « 04-courriel:260 » de `automatisations-liste-triage.test.tsx` (2 cas, verts). `a-reporter-message-editor.test.tsx` : toujours ROUGE (17 / 19) — il monte `MessageEditor` directement et attend le patch de `MessageEditor.tsx` (agent U), pas le mien. |
| `T-a-reporter/AutomationsApercu-et-automationJournauxApi.patch` (`05-vue-ensemble:155`, `:209`, `:173`) | `3a82f953` | Le patch vise `activiteParSemaine`, qui n'existe plus (la Vue d'ensemble lit la route des chiffres). Intention reportée : phrase accordée (« 1 action a échoué… », « N actions ont échoué… », plus aucun « (s) » sur la page) ; chiffres illisibles = « — » + « Les déclenchements n'ont pas pu être lus pour le moment. Réessayez dans un instant. », journalisé une fois ; `:155` déjà vrai par construction (même route, même définition que la liste). `automationJournauxApi.ts` : rien à reporter. | `a-reporter-vue-ensemble.test.tsx` : **5 / 5 VERTS**, mais RÉÉCRIT par moi sur la lecture actuelle (il alimentait une fausse table que la page ne lit plus) — mêmes trois intentions, dit dans son en-tête. À relire par T. |

**`tsc` après le report** : les quatre propriétés ne sont pas encore déclarées par `MessageEditor.tsx` (patch de U non intégré) ;
voir § 9 pour la sortie exacte. Aucun `any` posé.

À la corbeille, la liste rend toujours `MessageFige` (mon champ en lecture seule, `a446ed2e`) : le jour où `MessageEditor` porte
`lectureSeule`, ce composant peut partir et la branche « corbeille » passer par `<MessageEditor lectureSeule>` (une ligne).

### 8.7 Le sélecteur FR / EN de la liste et la carte des Réglages globaux (`06-reglages-globaux:116`) — commit `85a884f9`

Vérifié au vrai navigateur, sans rechargement (`tests/automations-finale/d/ui/61-langue-liste-et-reglages.preuve.ts`) :

| Sens | Avant | Après |
|---|---|---|
| liste (« EN ») → carte des Réglages globaux | suivait | suit |
| carte → « Changer dans les réglages » (Paramètres › Entreprise) → retour → liste | suivait | suit |
| écriture LENTE (retenue 2 s) : « EN » puis les Réglages globaux aussitôt | **la carte disait « Français » jusqu'au rechargement** (la base, elle, disait anglais) | la carte dit « English » |

Correctif : une seule source d'état, `src/lib/langueMessages.ts` + `src/hooks/useLangueMessages.ts`, lue par le sélecteur de la
liste et par la carte (`src/pages/AutomationsReglages.tsx`, zone de T : seul l'état local de la carte est remplacé). Test de
composant : `tests/automatisations-langue-partagee.test.tsx` (5 cas, les deux vraies pages dans un même routeur).
Reste hors de cette source : Paramètres › Entreprise (`src/pages/CompanySettings.tsx`, hors zone) écrit la langue de son côté ;
la liste et la carte la RELISENT à leur affichage, donc elles suivent — sauf si l'on quitte Paramètres pendant l'enregistrement.
La spec `06-reglages-globaux.spec.ts:116` (@defaut) exige, elle, que le sélecteur DISPARAISSE : elle restera rouge tant qu'elle
n'est pas réécrite selon la décision.

### 8.8 Le banc e2e et les preuves de D se marchent dessus (à savoir avant de rejouer l'un après l'autre)

Constaté dans la pile locale, pas déduit :
- Les preuves de D (`QA_AUTO_SUFFIXE=d`) et le banc e2e (`E2E_JEU=d`) partagent les comptes `…+d@lume-qa.test` et
  retrouvent leurs bureaux par leur NOM (`[TEST] QA Automatisations A (d) — ne pas utiliser`).
- Après mes passes de specs, les bureaux d'origine s'appelaient `[TEST] QA Automatisations A — ne pas utiliser`, SANS le
  suffixe. Le seul code qui renomme un bureau de test est le ménage du banc (`e2e/automations/_outils/banc.ts`, l. 341-344 :
  `update({ name: NOM_ORG_A })`, avec `NOM_ORG_A` importé du harnais) ; je n'ai pas établi pourquoi il y vaut le nom sans suffixe.
- À la passe suivante, le harnais des preuves ne trouve plus ses bureaux, en CRÉE de nouveaux (03:01 UTC) : les mêmes comptes
  sont alors membres de deux paires de bureaux, et le jeu connu est rebâti dans la nouvelle.
- Effets : `ui/40-isolation` rouge sur quatre preuves (un compte à deux bureaux voit ses deux bureaux — pas une fuite) ; des
  specs rouges sur des données d'avant (8.4 B). Les preuves sont ajustées (`96a8e52f`) pour dire la vraie règle : aucune ligne
  d'un bureau dont l'utilisateur n'est PAS membre, et nommément du bureau A.
- Autre piège du même ordre : enregistrer Paramètres › Entreprise renomme le bureau (`orgs.name` = nom de l'entreprise) ; ma
  preuve `ui/61` remet le nom après chaque cas.

## 9. Résultats

RÉSULTATS_FINAUX
