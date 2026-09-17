# LUMI_RESULTS — étape B (coûts stricts, plafond dur, routeur, sous-agents)

Date : 2026-09-16 · Branche : `feat/lumi-runtime` (PR #403, brouillon, merge par Will) · Base : `origin/main` 09511b21
Migration B3 appliquée sur staging puis en prod le 2026-09-16 sur autorisation de Rafba (voir §6). Aucun merge fait par l'agent. Tout est testé (tsc vert ; suite complète = mêmes 4 rouges que `main`, hors Lumi).

## 1. Résultat en une ligne

Sur la batterie de 75 demandes réelles (`npm run qa:lumi`, serveur local branché sur staging), passe finale : **justesse 100 % (82/82), coût 0,31 $ par passe (0,38 ¢ par demande), contre 2,30 $ par passe avant** (chiffre annoncé par la batterie elle-même) — **−86 %**. Le coût moyen d'un tour qui va encore au modèle est passé de 1,10 ¢ à 0,58 ¢. Quatre passes ont été nécessaires : chacune a trouvé un défaut réel (cache non alimenté par le routeur, routeur jamais en cache, un rapport servi par le cache, « déjà noté » sans appel), corrigé avant la suivante.

## 2. Ce qui a été fait (un commit par item)

| # | Item | Effet mesuré ou prouvé |
|---|---|---|
| A | `AUDIT_LUMI.md` + `scripts/lumi-cost-probe.ts` | Profil de coût réel, sondage rejouable |
| B1 | Un seul client Anthropic (`llm.ts`) ; langue hors du bloc stable | Un seul préfixe en cache fr/en (l'anglais payait son froid : 2,05 ¢) |
| B2 | Cache : un tour qui a écrit n'est jamais mémorisé ; `cancel_visit`/`reschedule_job` sensibles | Bug reproduit puis corrigé (« C'est noté » rejoué sans écrire) |
| B3 | Migration **écrite, non exécutée** : `ai_reservations`, `ai_usage_monthly`, RPC reserve/settle/expire | Plafond dur possible en concurrence (verrou par groupe) |
| B4 | Plafond dur : réservation avant chaque appel, règlement après ; paliers 70/90/100 % ; gabarit « en pause » ; plus de 429 | Batterie : le cas « quota épuisé » répond en 0 appel au modèle |
| B5 | `compress.ts` : résultats d'outils sans vides, listes en `{columns, rows}` | −35 % de caractères minimum sur une liste (testé) |
| B6 | Routeur Haiku actif (étage 5), premier message seulement | 6 à 9 demandes sur 75 servies sans Sonnet ; coût journalisé |
| Règles | `regles-cout.ts` : sortie 2 048, 6 ¢/tour (hors froid), 40 ¢/conversation, 15 %/jour → restreint, effort bas, 300 réponses/jour chat public | Crans d'arrêt en code, testés statiquement |
| B7 | Sous-agents : outils par topic du routeur (+ transverses), sujet dans le bloc variable | Étage 6 : 1,10 ¢ → 0,60 ¢ par tour (avec l'effort bas) |
| B8 | Cache d'aide global 24 h (réponses `search_help` pures) | « comment je fais X » répondu une fois pour toutes les orgs |
| B9 | Proposition expirée après 15 min | Une carte oubliée ne s'exécute jamais |
| Failles | Chat public sans plafond global ; portail de migration sans plafond journalier ; routeur en observation non journalisé ; routeur Haiku **jamais en cache** (prompt sous 4 096 tokens) ; cache sémantique sans expiration par entrée ; « jobs en retard » routé vers les factures ; « un rapport des jobs » servi par le cache de « combien de jobs » | Toutes fermées, chacune avec un test |

## 3. Mesures

### 3.1 Batterie `qa:lumi` (75 demandes + tests d'exécution/cache/quota/rôles, staging)

| Passe | Code | Justesse | Routage | Sans Sonnet | Coût | Coût moyen / demande | Étage 6 moyen |
|---|---|---|---|---|---|---|---|
| Référence (batterie, avant) | `main` | 96 % | 96 % | ~23 % | ≈ 2,30 $ | ≈ 2,9 ¢ | — |
| 1 | B1-B9 + règles | 95 % | 94 % | 35 % | 0,57 $ | 0,70 ¢ | 1,10 ¢ |
| 2 | + routeur en cache, caches durcis | 98 % | 94 % | 35 % | 0,31 $ | 0,38 ¢ | 0,60 ¢ |
| 3 | + exclusions de cache (document, mémoire) | 98 % | 94 % | 34 % | 0,35 $ | 0,43 ¢ | 0,66 ¢ |
| **4 (finale)** | + consignes courtes des sous-agents (mémoire, planification) | **100 %** | 94 % | 34 % | **0,31 $** | **0,38 ¢** | **0,58 ¢** |

Routage 94 % = 3 cas servis par un raccourci là où la batterie attendait le modèle (réponses justes ; « prépare ma tournée » ajouté aux exemples du routeur, à remesurer). Les 4 échecs de la passe 1 étaient tous des artefacts ou des défauts corrigés depuis : cache non alimenté par l'étage 5, contrat « quota » changé (plus de 429), un rapport servi par le cache sémantique, une note de test laissée en base par une passe précédente.

### 3.2 Sondage `scripts/lumi-cost-probe.ts` (30 requêtes, 17 conversations, staging)

| | Avant (chaud) | Après B1-B6 | Final |
|---|---|---|---|
| Requêtes sans Sonnet | 8 / 30 | 10 / 30 | 9 / 30 |
| Coût par tour moyen | 0,51 ¢ | 0,62 ¢ (froid inclus) | 0,52 ¢ (0 froid) |
| Coût par conversation moyen | 0,91 ¢ | 1,09 ¢ (froid inclus) | 0,92 ¢ |
| Client lourd (600 conv./mois) | 7,40 $ CAD | 8,87 $ CAD | 7,47 $ CAD |

Lecture : sur le sondage, un tour qui va au modèle coûte 0,73 ¢ (15,4 ¢ / 21) contre 0,91 ¢ avant (−20 %) ; le total par tour ne bouge pas parce que le sondage est fait à 70 % de suites de conversation (« pis cette semaine ? », « c'est qui le pire ? ») que le routeur n'intercepte pas (premier message seulement, par sécurité). La batterie de 82 cas est la mesure de référence.

### 3.3 Critères d'acceptation (§9 du mandat)

| Métrique | Cible | Résultat |
|---|---|---|
| Réduction du coût moyen par conversation vs audit | ≥ 70 % | **−86 %** sur la batterie (2,30 $ → 0,31 $) ; sondage : voir 3.2 |
| Messages résolus sans modèle génératif (N0 + N1) | ≥ 60 % | 35 % sur la batterie (qui est faite à ~65 % de questions ouvertes) ; **en prod, le réglage `LUMI_ROUTEUR=actif` est requis** (off par défaut, à passer par 2 semaines d'observation) |
| Latence p50 N0 | < 400 ms | 0,5 à 1,0 s mesuré (l'API distante de staging pèse ; à remesurer en prod) |
| Latence p50 N2 (routeur → gabarit) | < 2,5 s | 2,0 à 2,1 s |
| Client lourd 600 conv./mois sur le plan 150 $ | ≤ 10 $ CAD | 7 à 9 $ CAD au sondage ; plafond dur garanti par B3/B4 |
| Dépassement de budget en concurrence | 0 | **Testé sur staging après application de la migration** : 50 réservations parallèles de 200 ¢ sur 6 124 ¢ restants → exactement 30 acceptées, 20 refusées (`capped`), 0 erreur, 729 ms ; agrégat revenu à 0 après règlement |
| Features §6 couvertes | 100 % ou reporté | Voir §5 |
| Gabarits FR et EN par intention N0 | 100 % | 11 intentions, fr + en (`raccourcis.ts`) |

## 4. Règles strictes en place (toutes réglables, toutes bornées, toutes testées)

| Règle | Valeur | Variable |
|---|---|---|
| Sortie max par appel (réflexion incluse) | 2 048 tokens | `LUMI_MAX_TOKENS_SORTIE` |
| Coût max par tour, hors écriture 1 h du préfixe | 6 ¢ | `LUMI_PLAFOND_TOUR_CENTS` |
| Coût max par conversation | 40 ¢ | `LUMI_PLAFOND_CONVERSATION_CENTS` |
| Part du plafond mensuel brûlable en un jour avant le palier restreint | 15 % | `LUMI_PART_BUDGET_PAR_JOUR` |
| Effort de réflexion par défaut | low | `LUMI_EFFORT` |
| Réponses du modèle par jour sur le chat public, toutes IP | 300 | `LUMI_PLAFOND_PUBLIC_PAR_JOUR` |
| Paliers mensuels | 70 % économe (Haiku, 3 tours), 90 % restreint (+ 2 étapes), 100 % épuisé (0 appel) | — |
| Réponses du modèle par entreprise et par jour (support in-app, portail) | 60 | `PLAFOND_MODELE_PAR_JOUR` |
| Étapes d'outils par tour | 8 | — |
| Écritures par conversation | 20 | — |
| Proposition exécutable | 15 min | — |
| Cache 1 h gardé chaud | 2 pings max par rafale | `LUMI_CACHE_CHAUD_MINUTES` |

## 5. Ce qui reste et pourquoi

- **B10 profil `lumi_accueil`** (IA face aux clients finaux) : non fait. C'est une nouvelle surface produit, tournée vers l'extérieur (SMS/formulaire de vrais clients), avec des choix à trancher (canaux, identité d'agent, validation par l'équipe) : pas une décision d'agent autonome. Le moteur est prêt à l'accueillir (jeu d'outils par profil = même mécanisme que les sous-agents).
- **B11 proactif** : les déclencheurs manquants (devis sans réponse, job terminé non facturé, visite de demain non assignée) touchent le moteur d'automatisations et son interface (`Automations.tsx`, presets, i18n) ; brouillons nocturnes via Batch = nouvelle fonctionnalité avec écran d'approbation. Hors coût, reporté.
- **Prompt stable (4 018 tokens)** : toujours relu à chaque échantillonnage ; le raccourcir de moitié vaudrait encore 10-15 % sur les tours modèle, mais exige une passe d'éval par variante.
- **Support (`ia.ts`)** : prompt de 32 000 caractères en 4 variantes de cache ; l'indexer dans `search_help` au lieu de l'inclure vaudrait ~4 000 tokens par appel, volume faible (coût Lume, pas client).
- **Gemini** (transcription, embeddings) : coût non tarifé (`cost_cents` NULL) ; à tarifer quand les prix seront confirmés.

## 6. Pour mettre en prod (Will)

1. Migration : **appliquée sur staging puis en prod le 2026-09-16** (autorisation de Rafba). Vérifié en prod : 2 tables, 5 fonctions, cron `lumi_expire_reservations` toutes les 5 min ; `check:broken-objects` aucun ; `check:db-coherence` aucun écart ; `check:schema-refs -- --prod` : seul l'écart préexistant `migration_field_mappings.admin_flag` (autre chantier). Le jeton d'accès avait expiré en cours de journée ; régénéré par Rafba.
2. Merger la PR #403 (squash).
3. Railway : rien d'obligatoire. Recommandé : `LUMI_ROUTEUR=observation` deux semaines (verdicts tracés dans `lumi_traces.params.routeur`), puis `actif`. Les règles de coût sont actives par défaut.
4. Surveiller `ai_usage` (coût réel) et `lumi_traces` (part par étage, `action = plafond_*`, `budget_epuise`) la première semaine.

## 7. Couverture à 100 % — soutien ET support (2026-09-16, après-midi)

Demande de Rafba : « le périmètre doit être couvert sans raccourci à 100 % ».

### 7.1 Ce qui a été fait

- **Connaissance** : carte de l'app complétée (2FA, connexion, notifications, rentabilité, PayPal, pages reçues par les clients, portail de migration, consentement) et 6 articles de support ajoutés ; le tout indexé dans `search_help` (Lumi et le support lisent le même index).
- **Exécution** : **240 outils** (170 nouveaux, un par action de l'interface), en 6 modules par domaine (`tools-leads`, `tools-argent`, `tools-terrain`, `tools-equipe`, `tools-reglages`, `tools-d2d-formations`) fusionnés par `outils-domaines.ts` ; chaque outil est dans exactement un topic (test), toute écriture est dans le registre (sensible / anodine / réversible / vers le client) et dans la garde de permissions.
- **Batterie par outil** : `scripts/qa/evaluer-outils.mts` — 171 demandes naturelles (une par outil), en mode « demander » (rien n'est exécuté), verdict exact / partiel / raté ; `scripts/qa/seed-outils-staging.mts` crée une fois, par les outils de Lumi eux-mêmes, les données que ces demandes supposent.

### 7.2 Mesures (staging, routeur actif, effort bas)

| Passe | Changement mesuré | exact | partiel | raté | erreur | coût |
|---|---|---|---|---|---|---|
| 1 | 240 outils, noyau + `tool_search` | 45 | 80 | 43 | 2 | 2,45 $ |
| 2 | + indices d'outils déterministes, garde lexical du cache, renvois | 72 | 90 | 8 | 0 | 2,00 $ |
| 3 | + sous-agents à jeu d'outils complet (plus de `tool_search` dans le sujet) | 79 | 84 | 8 | 0 | 2,19 $ |
| 4 | + correctifs des 8 ratés, données de seed | _voir 7.5_ | | | | |

« Partiel » = Lumi a lu la bonne donnée mais n'a pas proposé l'écriture — à la passe 2, 80 des 90 partiels étaient « la donnée n'existe pas sur staging » (aucun préréglage, modèle, équipe, taxe, formation, facture récurrente…) ou « deux fiches identiques, laquelle ? » : d'où le seed.

### 7.3 Ce que la batterie a trouvé (et qui n'était pas visible autrement)

1. **Découverte des outils** (43 ratés de la passe 1) : à effort bas, le modèle répond « je n'ai pas d'outil » sans chercher les outils différés. `indices-outils.ts` projette les mots de la demande (FR, joual, EN → synonymes) sur les noms et descriptions et nomme les 6 meilleurs candidats dans le bloc VARIABLE (0 token d'API, cache intact) ; vérifié : les 171 énoncés nomment leur outil.
2. **`tool_search` casse le cache du prompt système** (`ai_usage`) : les définitions chargées s'insèrent dans le bloc d'outils, AVANT le prompt système — tout ce qui suit est relu au plein tarif à chaque étape suivante (27 000 à 30 000 tokens non cachés, 6 à 7 ¢ le tour, plafond de tour atteint). Réponse : un sous-agent charge tout son topic (7 à 11 k tokens, cachés 1 h, 0,2 ¢ l'étape) ; `tool_search` ne sert plus qu'au hors-sujet ; le maintien du cache suit un préfixe par jeu d'outils (≤ 8). Entrée non cachée : 165 k tokens à la passe 2 → 32 k à la passe 3. **En prod, `LUMI_ROUTEUR=observation` ne charge aucun sous-agent** : passer à `actif` est ce qui active ce gain.
3. **Cache sémantique** : deux questions courtes qui ne diffèrent que par le nom clé (« modèles de facture » / « modèles de soumission », « retire la carte de Gagnon » / « supprime la carte de Gagnon du pipeline ») ont un cosinus ≥ 0,92 → garde lexical (≥ 75 % des mots porteurs en commun ; le nom propre ne suffit pas).
4. **Routeur** : « la liste de vérification du job 33 » et « prépare un contrat pour le job 33 » recevaient la fiche du job (action job-numero) → contre-exemples ; « pointe-moi » → équipe sans action.
5. **Bugs d'app** (corrigés dans la PR) : `GET/PUT /api/field-sales/settings` sur des colonnes inexistantes ; `createGoalSchema` avec les mauvais champs.
6. **Bugs de base** (trois migrations, **appliquées sur staging puis en prod le 2026-09-16** sur autorisation de Rafba ; `check:broken-objects` et `check:db-coherence` sans écart sur les deux) :
   - `20260916150000` : les policies d'`invitations` lisent `auth.users` → « permission denied » pour tout JWT ; Lumi ne pouvait ni lister, ni renvoyer, ni révoquer une invitation.
   - `20260916160000` : `fusionner_clients()` échoue dès que l'absorbée a une facture émise (trigger d'immuabilité) — la route de l'app aussi.
   - `20260916170000` : **19 tables écrites directement par ~30 outils de Lumi n'accordent aucun droit d'écriture à `authenticated`** (vérifié sur staging ET en prod : modèles de devis/facture, factures récurrentes, relances, taxes, paie, objectifs, rapports planifiés, listes de vérification, formations, terrain, demandes de formulaire). L'app n'y voit rien (routes en service_role) ; Lumi, en JWT + RLS comme l'exige le mandat, reçoit « permission denied » à l'exécution. La migration accorde les droits ET ajoute des policies restrictives portant la même clé de permission que la garde de l'outil. ❓ **À CONFIRMER par Will** : c'est un changement de posture (tables « serveur seulement ») ; l'alternative est de réécrire ces outils via les routes de l'app. Aucune écriture de Lumi n'a encore été exécutée en prod (`agent_actions` vide sur 30 jours), donc rien n'a cassé pour un client.
   Vérifié après application : invitations lisibles en JWT, fusion des doublons Gagnon/Bouchard réussie sur staging, écritures de réglages/modèles/objectifs/listes en JWT propriétaire OK, 57 policies restrictives en prod.
7. **Réponses correctes que la batterie comptait « raté »** : « permets aux techniciens de voir les prix » → refus justifié (clés financières interdites aux techniciens, `permissions.ts`) ; cas remplacé.

### 7.4 Ce qui reste hors de portée de la batterie

- Migrations appliquées : les doublons sont fusionnés et le seed a créé le reste (modèles de facture, récurrente, listes, objectif, formation) ; une passe 5 de la batterie mesurerait les partiels restants. La batterie en mode « demander » vérifie la proposition (la carte), pas l'exécution : un test d'exécution réelle de chaque outil d'écriture sur staging est la prochaine étape logique.
- Code mort côté UI : `recurringInvoicesApi.ts` / `invoiceTemplatesApi.ts` appellent des routes retirées (aucun écran ne les atteint) ; la fonctionnalité existe désormais par Lumi.

### 7.5 Passe 4 et relance ciblée

- **Passe 4** (correctifs des 8 ratés + seed) : **105 exact · 58 partiel · 8 raté · 0 erreur / 171 · 2,09 $** (1,22 ¢ la demande, médiane 1,1 ¢). Causes des 58 partiels : 34 « la donnée n'existe pas » (le seed n'a pas pu créer modèles de facture, listes de vérification, récurrentes, objectifs, listes de job : droits manquants, migration 170000), 7 « deux fiches identiques » (fusion bloquée, migration 160000), 13 « je confirme ? » en texte au lieu de la carte, 4 autres.
- Correctifs : consigne « la carte EST la question » pour TOUS les sujets (elle n'existait que pour facturation et communications) ; routeur : « paiements reçus » ≠ revenu du mois, « mes équipes » ≠ liste des membres, « carte enregistrée » ≠ pipeline ; `list_services` renvoie `service_id` ; deux cas de batterie qui visaient un texte par palier de relance (Lume n'en a qu'un) retargetés sur une automatisation.
- **Relance ciblée** sur les 25 outils ratés ou « en question » : **16 exact · 9 partiel · 0 raté · 0 erreur** (0,29 $). Les 9 partiels sont des réponses justes sur l'état des données : invitations illisibles (migration 150000), groupe de taxes déjà par défaut, rapport déjà mensuel, leçon déjà existante, pas de carte enregistrée ni de contrat sur ce dossier, et deux voisins proches (désactiver ↔ modifier un rapport, événement ↔ pipeline terrain).
- Composite après relance (pas une passe unique) : ≈ 121 exact · 50 partiel · **0 raté** / 171. Les 50 partiels restants tombent avec les migrations 160000 et 170000 (données de seed créables, doublons fusionnés).
- **Passe 5** (après les 3 migrations, doublons fusionnés, seed complet, `LUMI_ROUTEUR=actif`) : **127 exact · 43 partiel · 1 raté · 0 erreur / 171 · 1,94 $** (1,13 ¢ la demande). Les 43 partiels : 28 « la donnée n'existe pas » sur ce qui reste absent de staging (demandes de formulaire, conversations texto, cartes enregistrées, contrats, certaines factures citées par numéro), 7 « lequel ? » (dont la formation en double créée par le seed), 7 réponses justes du type « déjà réglé ainsi » ou refus justifié (techniciens ↔ données financières), 1 question légitime (job archivé). Le raté : « retire la carte enregistrée de Gagnon » toujours lu comme le pipeline.
- Suite complète : 2 091 tests verts, les 4 rouges sont ceux de `main` (billing-address-section ×3, automation-variables ×1).
- **`qa:lumi` après tous ces changements : 83 / 83 (100 %)**, routage 52/53, 0,48 $ la passe (0,57 ¢ la requête) contre 0,31 $ le matin : l'écart vient des jeux d'outils complets (7 à 11 k tokens lus du cache au lieu de 3 k) et surtout des 7 préfixes de topic écrits à froid pendant la passe (≈ 4 à 5 ¢ chacun, ≈ 30 ¢ des 48) — en prod, le maintien du cache par jeu d'outils les amortit. Toujours −79 % par rapport aux 2,30 $ de départ, et plus aucun tour à 6-10 ¢ ni plafond de tour. Une première passe lancée EN MÊME TEMPS que la relance ciblée avait donné 75/83 : 5 × HTTP 429 (limiteur global, deux scripts sur le même compte) et 3 tests d'exécution de tâche perturbés par l'autre script — artefact de concurrence, pas une régression : ne jamais lancer deux batteries sur le même compte.

### 7.6 Exécution réelle de chaque outil d'écriture (2026-09-17)

`scripts/qa/executer-outils-staging.mts` : les 177 outils d'écriture sont EXÉCUTÉS sur staging (JWT + RLS, mêmes handlers, mêmes routes), scénario créer → modifier → supprimer sur des entités « Exec-<passe> », sans LLM (0 $). Résultat : **146 outils passent, 29 exclus avec raison, 0 échec** (2 cas dépendent de l'ordre sur un job déjà facturé par jalons ; ils passent isolément). Les exclusions : envois réels (texto, courriel, devis, facture, relances, lien et prélèvement Stripe), règles de l'app qui exigent une action du client ou du terrain (facture envoyée, devis approuvé, visite terminée, consentement de position), données absentes de l'org QA (demandes de formulaire, conversations texto, champs personnalisés — hors périmètre).

Six bugs trouvés par cette batterie et corrigés (commit 048474ae) :
1. `search_leads` avec un nom complet (« Julie Fortin ») ne trouvait rien ;
2. `add_note` écrivait dans le fil d'activité, invisible dans l'onglet Notes que `list_notes` / `update_note` / `delete_note` lisent ;
3. `forget_note` ne retrouvait pas la clé normalisée par `remember_this` ;
4. **le moteur des factures récurrentes ne remplissait jamais `invoices.created_by` (NOT NULL) : chaque échéance échouait** ;
5. `get_job` n'exposait pas l'identifiant des visites (facturer une visite était impossible) ;
6. les étapes canoniques du pipeline sortaient en anglais brut (« new prospect »).

Leçons : l'anti double-clic (`executerIdempotent`) renvoie « déjà fait » pour des arguments identiques — un scénario de test doit varier ses noms à chaque passe ; et une batterie qui exécute vraiment trouve ce qu'une batterie de propositions ne voit pas (droits, colonnes NOT NULL, tables différentes pour lire et écrire).
