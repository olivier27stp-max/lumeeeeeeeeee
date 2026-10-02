# Passation — chantier « Outils de Lumi » (Lume CRM)

État établi le 2026-10-02 vers 13:10 UTC par la session Claude Code de Rafba. Légende : **[V]** vérifié par une commande ou un fichier pendant cette session · **[R]** rapporté dans la conversation, non revérifié · **[?]** à vérifier · **[P]** proposé, rien d'implémenté.

Limite : le début de la conversation (2026-10-01) n'est plus lisible en entier ; il est connu par un résumé. Les éléments qui en viennent sont marqués [R]. Le transcript complet existe sur le poste de Rafba : `C:\Users\Rafba\.claude\projects\c--Users-Rafba-lumeeeeeeeeee\1247a4af-7673-4a96-9b72-fb98f6b53701.jsonl`.

## 0. Instruction de départ pour la nouvelle session

Tout le travail de cette session est sur GitHub, branche `main` : le code, les tests, les résultats des passes en prod (`evals/lumi-tools/resultats/prod-2026-10-0*.json`), les cas de test (`evals/lumi-tools/cas-lots/lots.json`) et ce document (`docs/passation/reprise-outils-lumi-2026-10-02.md`). **Rien n'est à récupérer sur le poste de Rafba.**

Avant toute chose :
1. `git clone https://github.com/olivier27stp-max/lumeeeeeeeeee.git` (ou `git fetch`), puis brancher depuis `origin/main` à jour.
2. Lire `CLAUDE.md` à la racine, puis ce document en entier.
3. Obtenir `.env.local` auprès de Rafba (section 7).
4. Faire la vérification de la section 9.1 avant d'écrire du code.
5. Ne jamais merger, migrer ou tester en prod sans respecter les règles de la section 2.

---

## 1. Résumé exécutif

- **Projet** : Lume CRM, SaaS multi-entreprises pour les entreprises de services. Dépôt `github.com/olivier27stp-max/lumeeeeeeeeee`, prod https://lumecrm.net.
- **Objectif** : rendre fiables, sûrs et peu coûteux TOUS les outils de **Lumi** (l'assistant IA intégré à l'app) avant le lancement, et ajouter ce qui manquait (outils, cartes de confirmation complètes).
- **État** : tout le travail est mergé sur `main` et déployé [V]. Aucune modification locale non poussée [V]. Dernier merge : PR #905 à 13:00:28 UTC, déployée à 13:05:05 UTC [V].
- **Ce qui reste incertain** : #905 n'a pas encore été vérifiée par une vraie demande en prod.
- **Prochaine action** : rejouer 3 demandes dans le bureau de test de la prod (section 9.1), puis continuer la boucle « petite passe en prod → corriger l'outil → test → PR » (section 9.2).

---

## 2. Contexte et demande de Rafba

**Demandes explicites** [R] :
1. Audit final de tous les outils de Lumi : exactitude, sécurité, coût de l'API.
2. Puis « maxer 100 % des features qui manquent, les vues, tout ça ». Rafba a accepté (« tt sa ») 4 cibles : (a) points ouverts de Lumi, (b) cartes de confirmation complètes, (c) nouveaux outils, (d) features de l'app hors Lumi — **(d) n'a jamais été précisée**, Rafba devait nommer les écrans.
3. « Lâche pas » : continuer à monter la qualité au-delà de 7/10 ; tout finir avant le lancement.

**Règles imposées par Rafba, toujours valides** [R] :
- Aucune migration, aucun changement aux préréglages de rôle, aucune correction de données sans son OK : les écrire, puis s'arrêter pour approbation. (Une seule migration a été approuvée et appliquée : voir 6.)
- Aucun envoi réel pendant les tests (courriel, texto, paiement Stripe).
- Nouvel outil seulement si une action existante ne peut pas être rendue fiable autrement (levé pour les 30 outils par « tt sa »).
- Tests en prod seulement dans un bureau de test, en mode « demander » (Lumi propose, rien ne s'exécute).

**Contraintes apprises en route** [R] :
- **Un seul flux de test à la fois contre la prod.** Le 2026-10-01, trois sessions qui testaient en même temps ont coïncidé avec une panne de la base de prod de 65 min (redémarrage du projet Supabase). La base a ensuite été montée au format « Small » (2 Go).
- Rafba n'aime pas les questions inutiles ni l'attente : avancer, résumer court et concret.

**Hors périmètre** : le chantier Automatisations (une autre session), le rapport de fiabilité globale de Lumi (une autre session, `LUMI_READINESS.md`).

**Échéance** : « dernière session avant le launch » [R] ; `LUMI_READINESS.md` parle d'un lancement le 26 octobre [R, non revérifié].

---

## 3. Architecture utile

Versions lues dans `package.json` [V] : React ^19.0.0, Express ^4.21.2, Vite ^6.2.0, Vitest ^4.1.2, @supabase/supabase-js ^2.98.0, @anthropic-ai/sdk 0.124.0. TypeScript strict.

- **Frontend** `src/` (SPA React, pages en `React.lazy`). **Backend** `server/` (Express, port 3002 en local). **Base** Supabase (PostgreSQL + Auth + RLS).
- **Multi-entreprise** : chaque table a `org_id` ; la RLS vérifie l'appartenance (`has_org_membership`). Les outils de Lumi lisent et écrivent avec le **client Supabase de l'utilisateur** (donc sous sa RLS) et ajoutent `.eq('org_id', ctx.orgId)` à chaque requête. Le client service (`getServiceClient()`) contourne la RLS : il n'est pas utilisé par les outils.
- **Permissions** : chaque outil déclare une clé de la page Rôles (`PERMISSIONS_*` dans chaque module, vérifiée par `server/lib/agent/garde.ts`). Les outils qui touchent l'argent ou les droits sont listés dans `ARGENT_ET_DROITS` (`server/lib/agent/registre.ts`).
- **Parcours d'une demande à Lumi** : `server/routes/lumi.ts` → orchestrateur `server/lib/lumi/` → routeur de sujet (Haiku) → **sous-agent par sujet** (`server/lib/lumi/sous-agents.ts`, outils du sujet + `OUTILS_VOISINS`) → outils (`server/lib/agent/*.ts`). Une LECTURE s'exécute ; une ÉCRITURE devient une **carte** (`server/lib/lumi/fiches.ts` → `apercu-action.ts` + `complements-cartes.ts`), exécutée seulement après confirmation par `POST /api/lumi/execute`.
- **Modules d'outils** : chaque module exporte `OUTILS_X`, `REGISTRE_X`, `PERMISSIONS_X`, `TOPICS_X`, assemblés par `server/lib/agent/outils-domaines.ts`.
- **Environnements** : prod Supabase `bbzcuzqfgsdvjsymfwmr`, staging `boylnjjlhexljmddmjyg` (`.env.local` pointe sur staging). **Déployer = merger sur `main`** : Railway redéploie seul (≈ 3 min).

---

## 4. Inventaire du travail (tout de cette session, toutes les PR mergées sur `main`)

Les PR #863 à #901 viennent de la partie résumée de la conversation [R] ; #902, #904, #905 ont été mergées et vérifiées ici [V].

| Élément | Fichiers principaux | Modification | Vérification | Statut |
|---|---|---|---|---|
| Recherche, verbes, lectures de base (#863 #864 #865) | `server/lib/agent/tools.ts`, `src/lib/lumiVerbes.ts` | recherche de client par nom ; `schedule_job` refuse un job déjà planifié ; `get_invoice`, `get_quote` | tests unitaires, prod [R] | terminé |
| Outils du pipeline (#867) | outils de deals | lisaient l'ancienne table `pipeline_deals` (8 cartes contre 2 deals à l'écran) → table `deals` | prod [R] | terminé |
| Cartes complètes (#869 #874 #891) | `server/lib/lumi/libelles-cartes.ts`, `apercu-action.ts`, `complements-cartes.ts`, `fiches.ts`, `server/routes/lumi.ts` | libellé FR/EN de chaque paramètre, statuts jamais en code brut, effets non visibles dans les arguments (remboursement, automatisations déclenchées…), aperçu des envois avec le vrai texte, carte rouverte qui garde son aperçu | tests (`tests/lumi-libelles-cartes`, `lumi-complements-cartes`…), prod [R] | terminé |
| Pointages (#872) | `src/pages/Timesheets.tsx`, `src/lib/correctionPointage.ts` | corriger un pointage écrit aussi `punch_in_at`/`punch_out_at` (ce que la paie additionne) ; la sortie forcée ferme la pause | `tests/correction-pointage` [R] | terminé |
| **30 nouveaux outils (#875)** | `server/lib/agent/tools-lot-ventes.ts`, `tools-lot-paie.ts`, `tools-lot-entreprise.ts` | deals, statut/rabais/dépôt de devis, consentement, archives, paie, pointages, commissions, horaire d'équipe, taxes perçues, modèles d'automatisation, statistiques, versements Stripe | staging : 13 lectures/13, 17 écritures/17 relues en base (#896) [R] ; prod : 95,9 % sur 221 demandes (autre session) [R] | terminé |
| Interrupteur d'urgence | `outils-domaines.ts` | variable `LUMI_OUTILS_LOTS=0` sur Railway retire les 30 outils au démarrage | `tests/lumi-lots-interrupteur` [R] | terminé |
| **Migration (#883)** | `supabase/migrations/20261007200000_fonctions_stables_qui_ecrivent.sql` | `restore_client`, `restore_job`, `finish_job` passées de STABLE à VOLATILE (« Restaurer » échouait) | appliquée staging + prod le 2026-10-01 19:58 UTC avec l'OK de Rafba [R] | terminé |
| Dictée et noms (#884 #895 #899) | `server/lib/agent/texte-dicte.ts`, `sans-accent.ts`, `tools.ts`, `server/lib/lumi/reperage.ts` | « sous mission » → « soumission » ; noms trouvés sans accents, puis à une lettre près (marqué « approchant ») | tests, prod [R] | terminé |
| Remboursement hors Stripe (#901) | `server/lib/agent/tools-argent.ts`, `complements-cartes.ts` | un paiement par chèque/comptant/virement est refusé clairement au lieu de finir en annulation de facture | prod, confirmé par l'autre session [R] | terminé |
| Bon outil chargé (#902) | `server/lib/lumi/sous-agents.ts` | `get_team_schedule` voisin de « planification », `get_team_performance` voisin de « facturation » | prod, 8 demandes : les 3 ratées passent [V] (`evals/lumi-tools/resultats/prod-2026-10-02-verif-902.json`) | terminé et vérifié |
| Horaire et statistiques (#904) | `tools-lot-paie.ts` (`get_team_schedule`), `tools-lot-entreprise.ts` (3 statistiques), `scripts/qa/lire-outils-lots.mts` | `date_to` (14 jours en un appel au lieu de 7) ; visites de jobs du jour par équipe quand la grille Horaire est vide (2 lignes dans toute la prod) ; sans période et mois vide → 12 derniers mois, dit dans la réponse | 120 tests ; lecture réelle staging ; prod 6 demandes, 5 justes [V] (`prod-2026-10-02-verif-904.json`) | terminé et vérifié |
| Équipe sur chaque visite (#905) | `server/lib/agent/tools.ts` (`fetchScheduleEvents`, `query_schedule`), `tests/lumi-visite-equipe.test.ts` | chaque visite rend `team`, et `teams` liste les membres actifs une seule fois | 4 tests, `npm run lint`, `npm run test:lumi` 1942/1942 [V] ; CI verte ; déployée 13:05:05 [V] | **implémenté, comportement en prod non vérifié** |
| Documentation | `docs/audits/outils-lumi/inventaire-trous-2026-10-01.md`, `evals/lumi-tools/cas-lots/lots.json` (51 cas) | inventaire des trous, preuves, passes du 2026-10-02 | [V] | à jour au merge de #905 |

Aucune dépendance ajoutée, aucune variable d'environnement nouvelle hors `LUMI_OUTILS_LOTS` (optionnelle), aucun changement de contrat d'API publique [R pour #863–#901, V pour #902–#905].

**Pas de mon fait** [V] : sur `main` après #905, trois commits d'autres sessions (`f6af753d` paiements, `e5fd3282`, `f8d3eed8` page d'accueil). Les 156 fichiers modifiés du checkout principal (`C:\Users\Rafba\lumeeeeeeeeee`) ne viennent pas de ce chantier.

---

## 5. Point d'arrêt exact

- **Dernière action** : merge de #905 (13:00:28 UTC, commit `6ec83a55` sur `main`), puis lecture du statut de déploiement : `success` à 13:05:05 UTC, `/api/health` = 200 [V].
- **Prochaine action prévue** : rejouer en prod « qui travaille lundi prochain » et deux variantes (section 9.1). Elle n'a pas été lancée.
- **Hypothèse à confirmer** : avec l'équipe sur chaque visite, Lumi nomme l'équipe et ses membres au lieu de « tu veux que je vérifie qui y est assigné ? ».
- **Processus actifs** : aucun. Le compte de test est revenu en mode « argent » après la dernière passe [R ; à relire si doute, voir 9.1].
- **Fichiers perdus** : le dossier temporaire de la session (cas de test et lanceurs `.cmd`) n'existe plus ; tout ce qui est utile est recopié ici.

---

## 6. Git et récupération du code

- Dépôt : `https://github.com/olivier27stp-max/lumeeeeeeeeee.git`, branche de référence `main` [V].
- **Tout le travail est sur `origin/main`** : #902 (`b0bc9b0e`), #904 (`5de9718c`), #905 (`6ec83a55`) [V] ; les PR antérieures sont mergées [R].
- Worktree de la session : `C:\Users\Rafba\lume-outils`, branche `fix/lumi-visite-dit-son-equipe` (déjà mergée en squash ; « 1 en avance » = le commit d'origine `73c3f8ae`, contenu identique à `6ec83a55`) [V]. Rien de non commité ni d'indexé [V].
- Les résultats des passes du 2026-10-01 et ce document ont été poussés sur `main` par une PR de passation (`docs/passation-outils-lumi`). Restent non suivis, volontairement : les `*.partiel` (sauvegardes en cours de passe, doublons des fichiers finaux) et **`.etat-prod.json`** (état d'origine du compte de test, lu par `run.mts --remettre` — ne pas le supprimer sur ce poste) [V].
- **Ne pas travailler dans `C:\Users\Rafba\lumeeeeeeeeee`** : il est sur `main` mais 784 commits en retard, avec 156 fichiers modifiés par d'autres sessions [V].

**Reprendre** (sur n'importe quel poste) :
```
git clone https://github.com/olivier27stp-max/lumeeeeeeeeee.git
git switch -c <ta-branche> origin/main
```
Sur le poste de Rafba : `git worktree add <dossier> origin/main` puis brancher. Avant chaque push : `git fetch && git diff --stat origin/main` (deux PR ont déjà failli annuler des dizaines de fichiers en partant d'une base périmée). Jamais `git stash` (la pile est partagée entre worktrees ; Rafba a 4 stashs à ne pas toucher).

---

## 7. Accès et secrets (noms seulement)

`.env.local` (gitignoré, à demander à Rafba — jamais dans un commit ni dans le chat) contient notamment : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (staging) ; `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_URL_PROD`, `SUPABASE_SERVICE_ROLE_KEY_PROD`, `SUPABASE_ACCESS_TOKEN` (exigés par `evals/lumi-tools/run.mts --prod`) ; `ANTHROPIC_API_KEY`. Il faut aussi `gh` connecté au dépôt pour les PR, et un accès Railway pour l'interrupteur `LUMI_OUTILS_LOTS`.

---

## 8. Ce qui fonctionne, ce qui reste incertain

- **Vérifié en prod aujourd'hui** [V] : « ki travail aujourd'hui » → « l'équipe Vitres (Mathieu Lavoie et Karine Bélanger) à 9 h, l'équipe Pression (Olivier Gauthier) à 13 h » ; la semaine en un appel ; « mes clients me paient surtout comment » → répartition des 12 derniers mois avec la période dite ; « en septembre » reste sur septembre ; taux de gain des soumissions.
- **Non vérifié** : #905 en prod ; `job_visits` n'a été lu que dans le bureau de test de la prod (staging n'avait aucune visite dans la période).
- **Vu une fois, non corrigé** [R] : le modèle a écrit « 45,5 % » pour une part rendue à 46,5 % par l'outil (montants justes).

---

## 9. Ce qu'il reste à faire

### 9.1 Vérifier #905 (≈ 0,10 $, ~2 min)

1. Lire `https://lumecrm.net/api/health` (doit répondre 200). Demander à Rafba si une autre session teste en prod en ce moment : **un seul flux à la fois**.
2. Créer, hors du dépôt, `D:\verif-905\lots.json` :
```json
[
  { "id": "v905-qui-lundi", "section": "equipe", "outil": "get_team_schedule", "langue": "fr", "type": "lecture", "q": "qui travaille lundi prochain", "voisins": ["get_team", "query_schedule"] },
  { "id": "v905-qui-fait-quoi", "section": "jobs", "outil": "query_schedule", "langue": "fr", "type": "lecture", "q": "c ki qui fait les jobs de dimanche", "voisins": ["get_team_schedule", "get_day_route", "list_jobs"] },
  { "id": "v905-agenda-lundi", "section": "jobs", "outil": "query_schedule", "langue": "fr", "type": "lecture", "q": "j'ai quoi comme jobs lundi", "voisins": ["list_jobs", "get_day_route"] }
]
```
3. Depuis la racine du dépôt :
```
node --env-file=.env.local --import tsx evals/lumi-tools/run.mts --prod --org 93daa0c7-b749-4200-9755-dbeee62ce32d --compte qa.map.owner@lume.test --cas D:\verif-905 --sortie evals/lumi-tools/resultats/prod-2026-10-02-verif-905.json
```
Le script met le compte de test en mode « demander » puis le remet ; s'il est interrompu : même commande avec `--remettre`. Le bureau « ZZ QA Champs (banc de test) » refuse toute org dont le nom ne contient pas QA/TEST/banc.
4. Attendu : la réponse nomme l'équipe et ses membres. Sinon, lire la conversation dans `lumi_messages` (id dans le fichier de sortie) et corriger l'outil.

### 9.2 Continuer à monter la qualité (méthode qui a marché)

Petite passe en prod (5 à 10 demandes réalistes, en joual aussi) → lire chaque réponse → corriger l'**outil** quand il rend trop peu ou trop → test unitaire (base en mémoire, voir `tests/lumi-lot-paie.test.ts`) → `npm run lint` + `npm run test:lumi` → PR → merge → rejouer. Cas restés faibles [R] : devis-08 (`convert_quote_to_job`, dans `server/lib/agent/tools-etendus.ts`), devis-10, fact-30 (deux actions demandées, une seule proposée).

### 9.3 Décisions qui attendent Rafba — ne rien faire sans son OK

- Purge Loi 25 : seul test critique en échec [R].
- rapp-03 / rapp-15 : sens de « payant » [R].
- `/taxes/collected` et `/payments/payouts/*` ne vérifient que l'appartenance à l'entreprise, pas un droit financier (`server/routes/taxes.ts`, `server/routes/payments.ts`) [R].
- `time_entries` n'a pas de `deleted_at` : supprimer un pointage est définitif (migration nécessaire) [R].
- `npm run check:db-coherence` signale 4 écarts antérieurs : `commissions_totaux_periode`, `quickbooks_claim_jobs`, `quickbooks_enqueue`, `quickbooks_enqueue_history` non exécutables par `authenticated` [R].
- Cible (d), features hors Lumi : écrans jamais nommés.
- [P] Comparer automatiquement les chiffres dits par Lumi aux chiffres rendus par les outils, seulement si Rafba le demande.

### 9.4 À coordonner

- Une autre session (Automatisations) devait remplacer elle-même, dans `tools-lot-entreprise.ts` (≈ ligne 456, `create_automation_from_template`/`duplicate`), le repli `update({ is_active: false })` par sa garde `ecrireRegle` (`server/lib/automations-ecriture.ts`) [R ; à vérifier sur `main`]. Elle détenait aussi `registre.ts`, `outils-domaines.ts`, `topics.ts`, `sujet-par-regle.ts`, `libelles-cartes.ts`, `apercu-action.ts`, `lumiVerbes.ts`, `tools-reglages.ts`, `tools-etendus.ts`. Demander à Rafba si elle tourne encore avant d'y toucher.
- PR ouvertes hors de ce chantier, à ne pas merger sans Rafba [V] : #823, #796, #762, #526, #375, #282, #187.

---

## 10. Recettes et pièges

- **Nouvel outil d'écriture** = verbe dans `src/lib/lumiVerbes.ts` + libellé de chaque paramètre dans `libelles-cartes.ts` + scénario dans `scripts/qa/executer-outils-staging.mts` + complément de carte si l'effet n'est pas dans les arguments. Quatre tests de couverture l'exigent ; description d'un outil de lot ≤ 300 caractères ASCII.
- Lectures réelles sur staging : `PORT=3012 node --env-file=.env.local --import tsx scripts/qa/lire-outils-lots.mts` (API locale sur ce port ; les outils qui appellent une route échouent sans elle).
- CI requise : « Lint · Test · Build », « RLS cross-tenant isolation », « Lumi (npm run test:lumi) ».
- Après un merge : `gh api repos/olivier27stp-max/lumeeeeeeeeee/commits/<sha>/status` jusqu'à `success`, puis `/api/health` et `/api/billing/plans` à 200.
- Migration : fichier dans `supabase/migrations/`, `npm run db:apply -- <fichier>` (staging), tester, `npm run db:apply:prod -- <fichier>`, puis `npm run check:broken-objects` et `npm run check:db-coherence`. Jamais par le tableau de bord Supabase.
- Vocabulaire : « devis / job / visite » dans l'app, « soumission / travaux / rendez-vous » côté client (`LUMI_GLOSSARY.md`).
- Pièges vécus : un heredoc bash avale les barres obliques inverses (écrire les scripts dans un fichier) ; les fichiers mélangent LF et CRLF (garder la fin de ligne du fichier) ; un test qui expire à 10 s sous charge passe seul ; un `.cmd` lancé en détaché ne survit pas à un redémarrage du poste.
