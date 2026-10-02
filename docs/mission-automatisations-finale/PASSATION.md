# Passation — mission « correction finale de la page Automatisations » de Lume

Rédigée le 2026-10-02 vers 13:15 UTC par la session Claude Code qui coordonnait la mission (ex-« 98 », puis « bf »),
au moment où le quota hebdomadaire du compte de Rafba a coupé les quatre agents en plein travail.

Légende : **[V]** vérifié par une commande ou un fichier au moment d'écrire · **[R]** rapporté dans la conversation
(par un agent ou une autre session), pas revérifié · **[À V]** à vérifier · **[P]** proposé, pas fait.

---

## 1. Résumé en deux minutes

- **Projet** : Lume CRM (SaaS pour entreprises de services ; Vite + React 19 + Express + Supabase ; déployé par
  Railway à chaque fusion sur `main`). Dépôt `github.com/olivier27stp-max/lumeeeeeeeeee` [V].
- **Tâche** : dernière passe de correction, « one-shot », sur la page Automatisations et tout ce qui y touche (y compris
  l'agent IA Lumi), avant le lancement du **26 octobre 2026**. Texte intégral de la demande : `D:/lume-final/MISSION.md` [V].
- **Résultat attendu** : tout fonctionne, est cohérent, prouvé par des tests, déployé ; un rapport final
  `AUTOMATIONS_FINAL_REPORT.md` avec un verdict « prêt / pas prêt ».
- **État** : la phase de correction par domaine est bien avancée mais **rien de cette mission n'est sur `main` ni en
  prod**. **Toutes les branches sont poussées sur GitHub** depuis 13:35 UTC (§ 7) — le travail est récupérable de
  n'importe quel poste. Une branche d'intégration
  (`mission/automatisations-finale`) réunit déjà une partie du travail ; trois branches d'agents (moteur,
  statistiques/liste, ciblage/doublons/champs) ne sont pas encore intégrées.
- **Blocage principal** : (1) quatre agents ont été coupés en plein travail : leur dernier morceau est commité tel
  quel, marqué `wip(…)`, **non vérifié** ; (2) trois branches d'agents ne sont pas encore intégrées ; (3) aucune
  migration de base n'est encore appliquée (staging ni prod).
- **Prochaine action précise** : récupérer les branches (§ 7), relire les quatre commits `wip`, puis lancer la suite
  complète sur `mission/automatisations-finale` pour avoir un point de départ vérifié (§ 10).

---

## 2. Contexte et demande

### La demande (explicite, résumée — le texte exact est dans `MISSION.md`)
Corriger définitivement la page Automatisations. Organisation imposée : un coordinateur, des sous-agents par domaine
qui ne touchent jamais les mêmes fichiers en même temps, et à la fin un agent **indépendant** qui n'a rien corrigé et
essaie de tout casser. Priorités (chaque bloc à 100 % avant le suivant) :

| Bloc | Contenu |
|---|---|
| Phase 0 | Faire passer les suites existantes ; carte complète `AUTOMATIONS_MAP.md` |
| P1 | (1) Lumi dit avoir modifié une automatisation mais rien ne change — un seul modèle de données, relecture en base, la page reflète sans recharger, 30+ demandes FR/EN prouvées en base ET à l'écran ; (2) les automatisations partent vraiment en prod ; (3) Lumi tient une vraie conversation (20+ scénarios) ; (4) statistiques justes ; (5) historique et journaux (rôles, filtres, historique des modifications, isolation, rétention Loi 25) |
| P2 | (6) « Qui est ciblé » ; (7) doublons : avertir + un seul envoi (fenêtre 24 h) ; (8) « Insérer un champ » |
| P3 | (9) revalidation avant chaque envoi différé ; (10) activation sans effet rétroactif ; (11) heures d'envoi 8 h–20 h + changement d'heure du 1er nov. 2026 ; (12) réponses / STOP ; (13) fiche modifiée ou supprimée en cours ; (14) envois en masse (300 factures) ; (15) modifier une automatisation active ; (16) langue / contenu / expéditeur |
| P4 | Coûts API de Lumi : mesurer, optimiser sans baisser la qualité, crédits exacts, tableau avant/après, projection vs l'allocation de 30 $ |
| P5 | (17) plus simple : phrase-résumé écrite par le code, « Tester avec un client », recettes ; (18) grosses automatisations : plusieurs déclencheurs (OU), validation bloquante, avertissement > 25 étapes, éditeur fluide à 50+ nœuds |
| P6 | Migration vers le modèle unifié : essai à blanc par entreprise, **attendre l'accord de Rafba** avant les vraies ; retirer le code mort ; ne pas supprimer de tables ; RLS ; typecheck/lint/build propres |
| P7–P8 | Audit utilisateur complet au navigateur + régression ; boucle de correction jusqu'à 100 % |
| P9 | Tests permanents (`e2e/automations/`, `npm run test:automations:all` en JSON + markdown, bloquant pour le déploiement), déploiement, vérification en PROD dans le bureau de test, `AUTOMATIONS_KB.md` |
| P10 | Vérification indépendante |
| Rapport | `AUTOMATIONS_FINAL_REPORT.md` |

### Règles imposées par Rafba (toujours en vigueur)
- Tous les tests dans un **bureau de test dédié**, données fictives, **tous les envois (textos, courriels) vers un
  faux fournisseur** ; un « canari » le prouve avant de commencer. Si un envoi réel passe : tout arrêter et le dire.
- Avant toute modification de base : sauvegarde complète + commit de l'état. Un commit par correctif.
- **Demander avant** : migration destructive, migration qui touche les automatisations de vraies entreprises,
  suppression de données, Stripe/facturation, toute action sur une vraie entreprise.
- Interdit : affaiblir ou désactiver un test pour le faire passer ; une économie de coût qui baisse la qualité.
- Tester comme un vrai utilisateur (Playwright) pour tout ce qui est écran ; ne jamais conclure en lisant le code.

### Règles du dépôt (CLAUDE.md, à lire en entier)
Secrets uniquement dans `.env.local` ; jamais de SQL en prod hors de `supabase/migrations/` ; staging d'abord, prod
ensuite ; une seule session à la fois sur le schéma ; après une modification de base : `npm run check:broken-objects`,
`check:db-coherence`, `check:schema-refs` ; suppressions logiques (`deleted_at`) ; pousser via une branche fraîche
depuis `origin/main`.

### Règles apprises pendant la mission (mémoire du poste)
- **Jamais de suite complète contre la prod ni staging** : deux pannes de base le 2026-10-01 en sont venues. Les tests
  lourds tournent sur une **pile Docker locale**. La prod = vérifications ciblées, un seul flux à la fois, santé lue
  avant, prévenir les autres sessions.
- Poste partagé par plusieurs sessions Claude : `--maxWorkers=2`, ne jamais tuer `node.exe` en masse (par PID exact
  seulement), ne pas toucher PM2, Docker `stop` seulement.
- Pas de `git stash` dans un worktree (pile partagée) ; écrire les scripts avec l'outil d'écriture (les heredocs bash
  mangent les barres obliques inverses) ; respecter les fins de ligne CRLF des fichiers qui en ont.

### Décisions prises pendant la mission [R, consignées dans `D:/lume-final/JOURNAL.md`]
- **Source unique d'une automatisation = `steps`** (le parcours) ; `actions` (ancien format à plat) est recopié du
  parcours à chaque écriture, jamais lu quand `steps` est un tableau ; le serveur refuse une règle publiée sans étape.
- Plafond de fréquence et doublon = issue **« ignorée »**, le parcours continue.
- Statistiques sur 7 / 30 / 90 jours ; historique des modifications gardé **12 mois**.
- Activation **sans effet rétroactif** (pas d'option « inclure l'existant » pour l'instant).
- Modifier une automatisation active : l'exécution en cours suit la version courante à l'étape suivante, garde son
  échéance déjà fixée, s'arrête proprement si son étape a été retirée.
- Deux langues d'un message : texte principal = langue d'envoi du bureau ; l'autre langue dans un bloc replié ;
  « La retirer » cochée d'office, jamais bloquant ; un avis « La version anglaise sera retirée » près du bouton.
- Nom d'une copie de modèle = langue de l'**interface** ; ses messages = langue d'envoi du bureau ; « (2) »
  seulement si une automatisation vivante porte déjà ce nom.
- Le sélecteur FR / EN reste dans la liste ; il doit rester synchronisé à l'écran avec la carte des Réglages globaux.
- STOP / désabonnement **toujours** respectés, drapeau « par canal » ou non (E-11).
- Pas de bouton « Demander à Lumi » dans l'éditeur (il a déjà « Construire avec Lumi »).
- « fais-en une job » sans date → Lumi convertit le devis sans demander s'il faut planifier.

### Décisions encore ouvertes, à poser à Rafba
| Sujet | Question |
|---|---|
| Unification (P6) | Convertir les règles à l'ancien format de **Coquin lavage** et **Vision Lavage** (vraies entreprises), ou les bureaux de test d'abord ? Résultat de l'essai à blanc au § 6.4. |
| E-52 | Langue par client (colonne `clients.langue`, migration) : hors périmètre pour l'instant |
| F-04 | Une génération Lumi refusée doit-elle être facturée en crédits ? |
| B-17 | Plusieurs déclencheurs par automatisation (demandé par le point 18) : à construire |
| D-07 | La purge des vieilles tâches closes supprime des données de vraies entreprises |
| D-08 / S-03 | L'effacement d'un client (Loi 25) laisse son numéro et ses textes dans les journaux d'automatisation : migration S-03 à relire |
| `FEATURE_GUARD` | Sa valeur sur Railway (défaut « log ») |
| M-01 | La migration « date d'activation » remplit une colonne sur chaque règle active de chaque entreprise |

---

## 3. Architecture utile pour reprendre

- **Front** : React 19, Vite, TypeScript strict, Tailwind. Écrans : liste `src/pages/Automations.tsx`, vue d'ensemble
  `src/pages/AutomationsApercu.tsx`, éditeur `src/pages/AutomationBuilderPage.tsx` + `src/components/automations/*`.
  Appels d'API par `src/lib/*Api.ts` uniquement.
- **Serveur** : Express (`server/`, port 3002). Routes `server/routes/automation-*.ts` ; droits par route dans
  `server/lib/route-permissions.ts` ; moteur `server/lib/automationEngine.ts`, actions `server/lib/actions/index.ts`,
  planificateur `server/lib/scheduler.ts`, événements en base lus toutes les 15 s par `server/lib/evenementsBase.ts`.
- **Base** : Supabase. Prod `bbzcuzqfgsdvjsymfwmr`, staging `boylnjjlhexljmddmjyg`. Multi-entreprise par `org_id` +
  RLS (`member_has_permission`). Tables clés : `automation_rules` (deux représentations `steps` / `actions`),
  `automation_scheduled_tasks`, `automation_execution_logs` (90 jours), `automation_evenements_base`,
  bac à sable des envois `orgs_envois_simules` / `envois_simules`. Garde en base `trg_automation_rules_garde`.
- **Lumi** : clavardage `POST /api/lumi/chat` puis `POST /api/lumi/execute` (une écriture n'est jamais faite sans
  carte, sauf liste blanche) ; outils dans `server/lib/agent/` ; panneau « Construire avec Lumi » =
  `POST /api/automations/rules/generer` (`server/lib/lumi/generer-parcours.ts`) ; version du prompt
  `server/lib/lumi/version.ts` (une empreinte testée).
- **Carte complète, vérifiée dans le code** : `AUTOMATIONS_MAP.md` à la racine de la branche d'intégration
  (28 déclencheurs avec leur producteur réel, 44 routes et leur droit, 15 outils Lumi, comptes de la prod) [V].

---

## 4. Où est le travail — l'atelier `D:/lume-final/`

Tout l'état de la mission est sur le disque `D:` du PC de Rafba, hors du dépôt principal :

| Chemin | Contenu |
|---|---|
| `MISSION.md` | la demande, texte intégral |
| `JOURNAL.md` | **mémoire de travail chronologique — à lire en premier** (décisions, avancement, qui fait quoi) |
| `REGISTRE.md` | tous les constats (A-, B-, D-, E-, F-, …) avec leur statut — **pas tenu à jour depuis la coupure du matin** : les fichiers `notes/*-corrections.md` font foi |
| `notes/` | constats et cartes par domaine (`A-`, `B-`, `D-`, `E-`), comptes rendus de correction (`L-`, `U-`, `T-`, `M-`, `S-corrections.md`), `P-branchements.md` (666 lignes : comment brancher le ciblage, les doublons et les champs), `REVUE-migrations.md`, `DURCISSEMENT-ecritures.md`, migrations proposées `M-migrations-proposees/`, `S-migrations-proposees/` |
| `outils/` | pile Docker locale (`pile.sh`), proxy (`proxy.mjs`), démarrage des serveurs d'un arbre (`serveurs.mjs <arbre> <portApi> <portVite>`) |
| `sorties/` | journaux de tests, essais à blanc (`unification-local/`, `unification-prod/`) |
| `env.reel` | **copie du vrai `.env.local` — secret, ne jamais l'afficher ni le commiter** |
| `wt`, `wt-u`, `wt-b`, `wt-d`, `wt-p`, … | worktrees git (§ 8) |

---

## 5. Inventaire du travail

### 5.1 Branche d'intégration `mission/automatisations-finale` (arbre `D:/lume-final/wt`, tête **76afbb79**) [V]
Contient, fusionnés :

| Domaine (agent) | Ce qui est corrigé | Détail |
|---|---|---|
| L — Lumi ↔ automatisations | Le bug n° 1 (Lumi dit avoir modifié, rien ne change) : cause prouvée = un brouillon périmé dans `PanneauEtape` ; outils `get_automation`, `update_automation_from_text` ; chaque outil relit la base ; accès unique aux étapes `server/lib/automations-etapes.ts` ; porte d'écriture `server/lib/automations-ecriture.ts` ; contexte de page ; version de prompt v2026-10-02.1 | `notes/L-corrections.md`. Mesures avec le vrai modèle [R] : 30/30 demandes, 20/20 scénarios vérifiés en base, `qa:construire-lumi` 123/123 |
| U — éditeur, actions, déclencheurs | 30 défauts majeurs + régression du « Précédent », S-14, garde de version (409 `modifiee_ailleurs`), règle des deux langues (composant partagé `AutreVersionMessage`), avis de retrait sous le pli, carte « en cours d'ajout », reflet `actions` des copies | `notes/U-corrections.md`. Revérifié au navigateur par la session des specs [R] : actions 163 verts / 20 défauts connus / 0 régression ; déclencheurs 109 / 14 / 0 ; éditeur 150 / 35 / 1 (la régression, corrigée depuis par c7e282f8, non revérifiée) |
| T — modèles et messages | 49 lignes de tri : la route `PATCH /api/automations/rules/:id/messages` (le navigateur n'écrit plus le texte en base), bibliothèque de modèles, réglages globaux | `notes/T-corrections.md` |
| E — enquête ciblage/doublons/champs | tests rouges + prototypes (pas de correctif) | `notes/E-conception.md` |
| F — coûts de Lumi | scripts de mesure + tests de constats | `notes/F-constats.md`, `F-mesures.md` |
| Specs e2e adaptées | commit fd657d81 de la session des specs (28 fichiers sous `e2e/automations/`) | à fusionner sur `main` **avec** les correctifs, jamais avant |
| `main` | jusqu'à #904 inclus | #905 de la session 86 est arrivé après [R] |

Commits du coordinateur sur cette branche (tous [V] dans `git log`) :
`038d2fe8` droit de la route des messages ; `974b38c0` devis-08 (Lumi convertit sans demander) ;
`f03fc014` script d'essai à blanc de l'unification ; `ed827ab0` **`npm run test:automations:all`** ;
`9ed536bc` + suivant : `AUTOMATIONS_MAP.md` et ses comptes ; `7f79f10c` modifier une automatisation / changer la
langue = toujours une carte ; commit suivant : Lumi n'appelle plus les routes d'événements vides (faux
« automatisations non déclenchées ») ; `npm run lint` avec 6 Go de mémoire (tsc mourait à 4 Go) ;
`b98f52d9` une seule règle de reflet `actions` + le pack de base recopie le parcours entier ; dernier : test
`lumi-outils-terrain` mis à la nouvelle règle.

### 5.2 Branches d'agents NON intégrées [V]

| Branche (arbre) | Tête | Contenu | Note |
|---|---|---|---|
| `mission/auto-finale-b` (`wt-b`) — agent M, moteur | abcb4c05 | 40 commits : B-01 à B-24 (revalidation avant envoi, fiches à la corbeille, rendez-vous déplacé, activation non rétroactive, heures d'envoi, étalement des envois en masse, modification d'une automatisation active, fusion de fiches, rattrapage « Date atteinte », surveillance du tick…), E-11 (STOP), A-21 (courriel en texte brut), plafond = « ignoré », **B-20 retrait de l'ancien système `automations` du planificateur**, preuve des deux langues sur le vrai moteur | `notes/M-corrections.md` ; 5 migrations PROPOSÉES `notes/M-migrations-proposees/` |
| `mission/auto-finale-d` (`wt-d`) — agent S, statistiques/historique/journaux + lot « liste » | 80a9f758 | 54 commits : statistiques calculées en base, historique des modifications, journaux paginés, défauts de la liste | `notes/S-corrections.md` ; 3 migrations PROPOSÉES `notes/S-migrations-proposees/`. **Les deux patchs de T pour `Automations.tsx` / `AutomationsApercu.tsx` sont-ils posés ? [À V]** (les 4 tests `tests/automations-finale/t/a-reporter-vue-ensemble` étaient rouges à 13:00) |
| `mission/auto-finale-p` (`wt-p`) — agent P, phase 1 | e096f5ba | 12 commits, **fichiers neufs seulement** : cœur du ciblage + schéma, `ciblageOk` + compteur « Touche X clients », garde anti-doublon, avertissement de doublon, catalogue unique de variables, phrase-résumé, contrôles de publication, section « Qui est ciblé », palette « Insérer un champ », routes ciblage / conflits / « Tester avec un client » (non montées) | `notes/P-branchements.md` = la phase 2 : où brancher tout ça dans le moteur, l'éditeur, la liste, la validation, Lumi |

### 5.3 Ce qui n'est PAS fait
- Phase 2 de P (branchements) ; plusieurs déclencheurs par automatisation (B-17) ; validation à 30 étapes vs moteur à
  50 (la mission veut 50+ nœuds).
- **Durcissement des écritures** [P] : plan dans `notes/DURCISSEMENT-ecritures.md` (une seule porte d'écriture en
  rôle de service + `revoke insert, update, delete on automation_rules from authenticated, anon` ; `client_tags` et
  `automation_webhooks` aussi). Inclut le repli `update({ is_active: false })` de
  `server/lib/agent/tools-lot-entreprise.ts` (≈ l. 456 ; la session 86 a accepté de ne pas y toucher).
- **Aucune migration appliquée** — ni staging ni prod. Aucune n'est encore dans `supabase/migrations/` [V].
- Unification `steps` / `actions` (P6) : essai à blanc fait, conversion non faite (accord requis).
- Rejeu de `npm run qa:lumi` (≈ 2,30 $) et du jeu d'évaluation (cas devis-08) avant la prod.
- Étages « pile locale » et « e2e » de `test:automations:all` jamais joués ; job de CI (six tranches `--shard=i/6`) non écrit.
- Mineurs restants de U ; P7 (audit complet), P9 (déploiement, vérification en prod, `AUTOMATIONS_KB.md`), P10
  (agent indépendant), rapport final ; `npm run carte:empreinte` à la fin ; régénérer `supabase/baseline/` et
  `SCHEMA_SNAPSHOT.md` après les migrations.

### 5.4 Essai à blanc de l'unification, en PROD (lecture seule, 12:35 UTC) [V]
685 règles, 14 bureaux. 547 à l'ancien format (386 publiées), dont **537 convertibles sans perte** ; les 10 autres =
préréglage retiré « Estimate Follow-Up (3 days) » sur `estimate.sent` (jamais émis). 41 copies `actions` périmées.
Coquin lavage : 40 à plat, 40/40 convertibles, **110 envois en attente** sur ces règles. Vision Lavage : 39 à plat,
38/39. Détail : `D:/lume-final/sorties/unification-prod/unification-essai.md` (contient des messages
d'entreprises : ne pas commiter). Avant toute conversion, une preuve était demandée à M : règle à plat avec envoi en
attente, convertie → l'envoi part à la même heure, même texte, une fois. **Ce test existe, non commité, jamais
lancé** (§ 7).

### 5.5 Résultats de tests connus
| Quand / où | Résultat | Statut |
|---|---|---|
| Suite complète, intégration à 038d2fe8 | 8 126 verts / 36 rouges, tous expliqués (25 attendus « à reporter », 4 chez U depuis corrigés, 1 empreinte, 6 délais sous charge verts rejoués seuls) | [V] |
| `test:automations:all --sans-base`, à 22b85158 | unitaires 3 186 / 3 186 ; composants 451 / 476 (25 « à reporter ») | [V] |
| Suite complète chez U à f70cb08d | 632 fichiers verts, 3 rouges (vue d'ensemble = S ; empreinte ; `lumi-outils-terrain` = corrigé depuis par le coordinateur) | [R] |
| `npm run lint` après b98f52d9 | aucune erreur affichée, code de sortie non capturé | [À V] |
| Suite complète à 76afbb79 (tête actuelle) | **jamais lancée** | [À V] |

---

## 6. Point d'arrêt exact

- **Dernière action du coordinateur** : fusion de la branche de U (f70cb08d) et de `main` (#904) dans l'intégration →
  76afbb79 ; consignes envoyées à U (avis de retrait dans `EmailPreviewEditor.tsx` et `SettingsMessaging.tsx`, test
  instable `t/reglages-messagerie` « A-19 » à rendre robuste, puis mineurs).
- **Puis** : les quatre agents (U, M, S, P) se sont arrêtés vers 13:00 UTC sur « weekly limit » — quota du compte.
  Chacun était au milieu de quelque chose :

| Arbre | Travail laissé en cours — commité depuis en `wip(…)` et poussé, NON vérifié [V] | Ce que l'agent faisait [R, dernière phrase de l'agent] |
|---|---|---|
| `wt-u` | `src/components/automations/PanneauEtape.tsx`, `tests/automations-finale/u/panneau-etape.test.tsx` (+73 lignes) | un mineur de l'éditeur ; « je mets à jour le fichier de notes » |
| `wt-b` | `tests/automations-finale/b/m-30-conversion-a-plat.test.ts` (non suivi) | **la preuve de conversion** : « premier passage, pour voir ce que fait le moteur aujourd'hui » — jamais lancée |
| `wt-d` | `tests/automations-finale/d/ui/20-ecrans-contre-base.preuve.ts`, `30-volume-plafonds.preuve.ts` (modifiés), `97-mesure-appels.preuve.ts` (non suivi) | preuves au navigateur des écrans de statistiques |
| `wt-p` | `scripts/qa/finale/p/`, `tsconfig.p.json` (non suivis) | « un script de mesure qui fait tourner le compteur sous une vraie session de propriétaire » |

- **Processus** : piles Docker `lumefinal-*` (la mienne) et `lumeautoe2e-*` (la session des specs) actives [V] ; le
  proxy local 44921 s'est arrêté (limite de temps) — à relancer : `node D:/lume-final/outils/proxy.mjs` en arrière-plan.
  Des serveurs API/Vite d'agents peuvent tourner sur les ports 3489-3499 / 5489-5499 [À V].
- Les scripts d'aide du coordinateur pour lire la prod en lecture seule (`q.mjs`, `sante.mjs`, `exporter-regles.mjs`)
  étaient dans le répertoire temporaire de la session, qui n'est plus disponible [À V] : à réécrire si besoin (appel
  `POST https://api.supabase.com/v1/projects/<ref>/database/query/read-only` avec `SUPABASE_ACCESS_TOKEN`).

---

## 7. Git — état et récupération (TOUT est poussé) [V]

Dépôt : `github.com/olivier27stp-max/lumeeeeeeeeee`. Poussé le 2026-10-02 vers 13:35 UTC, vérifié par
`git ls-remote` :

| Branche sur GitHub | Tête | Contenu |
|---|---|---|
| `mission/automatisations-finale` | 76afbb79 | **l'intégration** : L, U (jusqu'à f70cb08d), T, E, F, specs e2e adaptées, `main` jusqu'à #904, commits du coordinateur |
| `mission/auto-finale-b` | 0e67399f | agent M (moteur), 40 commits non intégrés + `wip` : preuve de conversion jamais lancée |
| `mission/auto-finale-d` | 86b64f89 | agent S (statistiques, historique, journaux, liste), 54 commits non intégrés + `wip` : preuves au navigateur |
| `mission/auto-finale-p` | 0a4e658b | agent P (ciblage, doublons, champs — phase 1, fichiers neufs) + `wip` : script de mesure |
| `mission/auto-finale-u` | 03ea5342 | agent U : f70cb08d (intégré) + `wip` : un mineur de PanneauEtape (non intégré) |
| `mission/automatisations-finale-passation` | voir `git log` | **l'atelier** dans `docs/mission-automatisations-finale/` : MISSION.md, JOURNAL.md, REGISTRE.md, cette passation, `notes/` (constats, corrections, migrations proposées, plan de branchement), `outils/` (pile Docker locale). Branche de documentation : **ne jamais la fusionner sur `main`** |
| `qa/specs-lot-u` | fd657d81 | specs e2e de la session des tests (déjà dans l'intégration) |

Les branches `mission/auto-finale-{a,e,f,t}` ne sont pas poussées : elles sont entièrement contenues dans l'intégration.

**Les quatre commits `wip(…)`** (un par branche d'agent) sont le dernier travail de chaque agent, commité tel quel
au moment de la coupure : non relu, non testé. Les relire avant de s'en servir ; on peut les annuler sans perte
(`git revert`).

**Rien n'est déployé.** Railway ne déploie que `main` ; ces branches ne déclenchent rien. **Ne rien fusionner sur
`main`** avant la fin de l'intégration et une suite complète verte ; les specs e2e adaptées doivent arriver sur `main`
dans la même PR que les correctifs.

### Récupérer le travail sur un autre poste
```bash
git clone https://github.com/olivier27stp-max/lumeeeeeeeeee.git lume && cd lume
npm ci
# L'atelier (à lire d'abord) :
git worktree add ../lume-passation origin/mission/automatisations-finale-passation
#   → ../lume-passation/docs/mission-automatisations-finale/PASSATION.md, JOURNAL.md, MISSION.md, notes/
# L'intégration (là où on travaille) :
git worktree add -b mission/automatisations-finale ../lume-integration origin/mission/automatisations-finale
# Les branches d'agents à intégrer :
git fetch origin mission/auto-finale-b mission/auto-finale-d mission/auto-finale-p mission/auto-finale-u
```
Sur le PC de Rafba, les arbres `D:/lume-final/wt*` existent toujours et pointent sur les mêmes branches.

### Chemins de cette passation
Les chemins `D:/lume-final/...` cités dans les notes sont ceux du PC de Rafba. Sur un autre poste :
`D:/lume-final/notes/X` = `docs/mission-automatisations-finale/notes/X` de la branche de passation ;
`D:/lume-final/outils/` = `docs/mission-automatisations-finale/outils/` (scripts écrits pour ce PC : ports et chemins
à adapter) ; `D:/lume-final/sorties/` n'est PAS poussé (journaux de tests, et un export de la prod qui contient des
messages d'entreprises) ; `env.reel` n'est PAS poussé (secret).

## 8. Environnement et secrets

- Variables nécessaires (valeurs à demander à Rafba, jamais dans le chat ni un commit) : `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
  `SUPABASE_URL_PROD`, `SUPABASE_SERVICE_ROLE_KEY_PROD`, `SUPABASE_PROJECT_REF_PROD`, `ANTHROPIC_API_KEY`, `API_PORT=3002`.
  `.env.local` local pointe sur **staging**, jamais sur la prod.
- La pile Docker locale (`D:/lume-final/outils/pile.sh`, et celle du dépôt `scripts/qa/automations-e2e/pile.sh` qui se
  monte sans copie de la prod depuis #900) a ses propres secrets jetables : aucun accès réel.

---

## 9. Autres sessions qui travaillent en même temps

| Session | Rôle | À savoir |
|---|---|---|
| lumeeeeeeeeee-9a (ex-« fd ») | tenait les specs Playwright `e2e/automations/**` et la pile `lumeautoe2e` | **arrêtée à 13:20 UTC**, a écrit sa propre passation : `C:/Users/Rafba/lumeeeeeeeeee/PASSATION_AUDIT_AUTOMATISATIONS.md` (à lire avec celle-ci). Elle n'a PAS revérifié 76afbb79 ni le lot « modèles ». Sa pile `lumeautoe2e-*` tourne encore (`bash scripts/qa/automations-e2e/pile.sh arreter` pour l'arrêter, rien n'est supprimé). `e2e/automations/**` reste réservé à la session de tests qui reprendra |
| lumeeeeeeeeee-86 (ex-« a1 ») | outils et cartes de Lumi | fusionne sur `main` (#904, #905) ; prévient avant chaque fusion |
| lumeeeeeeeeee-90 (ex-« f1 ») | mission fiabilité de Lumi | passes en prod dans « ZZ QA Champs » |

Ces sessions sont sur le compte de Rafba et s'arrêteront aussi quand son quota sera épuisé. **Un seul flux contre la
prod à la fois**, et une seule session qui touche le schéma.

---

## 10. Comment reprendre, dans l'ordre

1. Lire `CLAUDE.md`, `D:/lume-final/MISSION.md`, la fin de `D:/lume-final/JOURNAL.md`, puis cette passation.
2. Récupérer les branches (§ 7) ; relire les quatre commits `wip`.
3. Monter une pile locale (`bash scripts/qa/automations-e2e/pile.sh`, sans copie de la prod depuis #900) ; lancer la suite complète sur l'intégration (`npx vitest run
   --maxWorkers=2`) et `npm run lint` pour avoir un point de départ vérifié.
4. Intégrer M (`wt-b`) puis S (`wt-d`) dans `mission/automatisations-finale`, un à la fois, suite verte après chacun.
   S : vérifier les patchs de T (tests `t/a-reporter-vue-ensemble`). Prévenir la session 9a avec la nouvelle tête.
5. Lancer la preuve de conversion `m-30-conversion-a-plat` ; si verte, montrer l'essai à blanc à Rafba et demander
   l'accord pour les vraies entreprises.
6. Migrations M-01..M-05, S-01..S-03 : appliquer les retouches de `notes/REVUE-migrations.md`, les copier dans
   `supabase/migrations/` (`202610080000NN_…`), pile locale → staging (`npm run db:apply`) → les trois checks →
   prod (`npm run db:apply:prod`). Montrer à Rafba celles qui touchent de vraies entreprises (M-01, S-03).
7. Phase 2 de P selon `notes/P-branchements.md` ; plusieurs déclencheurs (B-17) ; durcissement des écritures.
8. `test:automations:all` complet sur la pile locale, CI, `qa:lumi`, PR vers `main`, vérification en prod dans le
   bureau de test, `AUTOMATIONS_KB.md`, agent indépendant, `AUTOMATIONS_FINAL_REPORT.md`.

---

## 11. Message à coller dans la nouvelle session Claude Code

> Tu reprends la mission « correction finale de la page Automatisations » de Lume (lancement le 26 octobre). Le
> travail précédent est sur GitHub, dépôt `olivier27stp-max/lumeeeeeeeeee`, rien n'est sur `main` :
> - documentation et état exact : branche `mission/automatisations-finale-passation`, dossier
>   `docs/mission-automatisations-finale/` — lis dans l'ordre `PASSATION.md`, `MISSION.md` (la demande complète),
>   la fin de `JOURNAL.md`, puis les `notes/*-corrections.md` du domaine que tu touches ;
> - code intégré : branche `mission/automatisations-finale` ; branches d'agents à intégrer : `mission/auto-finale-b`
>   (moteur), `mission/auto-finale-d` (statistiques et liste), `mission/auto-finale-p` (ciblage, doublons, champs),
>   `mission/auto-finale-u` (un dernier commit `wip`).
> Lis aussi `CLAUDE.md` à la racine et respecte-le. Ne crois rien sur parole : vérifie l'état git avant d'agir ; les
> commits `wip(…)` sont non vérifiés.
> Première tâche : récupère les branches dans des worktrees (§ 7 de la passation), lance la suite complète
> (`npx vitest run --maxWorkers=2`) et `npm run lint` sur `mission/automatisations-finale`, et donne-moi le résultat.
> Ensuite, suis le § 10 : intégrer M, puis S, un à la fois, suite verte après chacun.
> Règles : rien contre la prod ni staging sans me demander ; tests lourds sur une pile Docker locale seulement ; aucune
> fusion sur `main` ; aucune migration appliquée, et aucune action sur une vraie entreprise (Coquin lavage, Vision
> Lavage), sans mon accord ; un commit par correctif, et pousse ta branche de travail régulièrement pour ne rien perdre.
