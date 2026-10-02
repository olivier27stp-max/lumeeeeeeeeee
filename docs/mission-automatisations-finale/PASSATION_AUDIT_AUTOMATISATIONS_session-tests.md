# Passation — Audit des écrans « Automatisations » de Lume (sessions du 1er et 2 octobre 2026)

Rédigé le 2026-10-02 vers 20 h 15 UTC par la session Claude Code qui tenait cette mission (nommée « fd », puis « 9a »).
Destinataire : la personne qui reprend le travail avec Claude Code sur un autre compte.

**Légende** — **[V]** vérifié par une commande au moment d'écrire ce document · **[R]** rapporté dans la conversation
(vrai au moment où c'était fait, pas revérifié ce soir) · **[À vérifier]** incertain · **[P]** proposé, pas fait.

**Limite** : la première partie de la conversation (1er octobre, avant ≈ 20 h UTC) n'existe plus que sous forme de
résumé. Les faits de cette période viennent du résumé, du dépôt et des notes de l'atelier ; les détails fins (ordre
exact des commandes, messages d'erreur) ne sont pas tous reconstituables.

---

## 1. Résumé exécutif

- **Projet** : Lume CRM (SaaS pour entreprises de services). Dépôt GitHub `olivier27stp-max/lumeeeeeeeeee`. Le merge
  sur `main` déploie la prod (`lumecrm.net`) via Railway.
- **Objectif de la mission** : faire un audit *utilisateur* exhaustif de la section Automatisations (modèle :
  Workflows de GoHighLevel) et de ce qui y est relié, corriger, et laisser des tests de bout en bout permanents —
  pour pouvoir dire, avant le **launch du 26 octobre**, que chaque bouton et chaque parcours fonctionnent.
- **État** :
  - 9 PR de cette mission sont **mergées et en prod** **[V]** (#859 → #900, détail § 6), plus une migration de garde
    en base appliquée sur staging et prod **[R]**.
  - **1 058 tests Playwright** sont dans le dépôt (`e2e/automations/`) avec une pile Docker locale pour les jouer
    **[V]**. Sur `main` : 822 verts, 236 rouges marqués `@defaut` **[R]**. Un rouge `@defaut` décrit un défaut
    connu du produit, pas une erreur du test.
  - Une **autre session** (« bf », ex-« 98 ») corrige ces défauts dans le produit. Elle seule écrit dans les écrans ;
    cette mission revérifie ses correctifs au navigateur. Premier lot (30 défauts majeurs) revérifié : tous fermés,
    une régression trouvée (corrigée depuis selon bf **[R]**, pas revérifiée).
- **Principal blocage** : le travail en cours de bf est sur des branches **locales à ce PC**
  (`mission/automatisations-finale` n'est pas sur GitHub **[V]**). Sur une autre machine, la suite dépend de ce que bf
  pousse ou merge.
- **Verdict actuel pour le launch** **[R]** : *pas prêt* à dire « chaque bouton fonctionne » (environ 220 défauts
  décrits, en cours de correction). Rien de ce qui est en prod n'est cassé par les lots de cette mission.
- **Prochaine action précise** : revérifier, au navigateur et sur la pile locale, le lot suivant de bf (régression du
  « Précédent » + mineurs de l'éditeur, puis lot « modèles et messages », puis liste et rôles), avec la méthode du § 10.

---

## 2. Contexte et intention de départ

### Demande de Rafba (1er octobre) — explicite
Mission en 8 phases : carte de chaque élément (`AUTOMATIONS_UI_MAP.md`), tournée « chaque bouton », parcours, cas
limites, appareils (1440 / iPad 1024 et 768 en priorité / mobile 375) × Chromium / WebKit / Firefox × rôles × FR / EN,
Lumi, cohérence, corrections, tests permanents dans `e2e/automations/`, rapport `AUTOMATIONS_UI_AUDIT.md` avec un
verdict pour le launch du 26 octobre. Règles posées par Rafba :
- agir comme un **vrai utilisateur** (vrai navigateur), ne pas conclure « ça marche » en lisant le code ;
- tout dans un **bureau de test**, données fictives, **tous les envois simulés** (bac à sable) ; si un envoi réel passe,
  tout arrêter et le dire ;
- avant de modifier le code : sauvegarde de la base + commit ; ensuite **un commit par correctif** ;
- **demander avant** : migration destructive, suppression de données, Stripe / facturation, action sur un vrai bureau ;
- **interdit d'affaiblir ou de désactiver un test** pour le faire passer ;
- fonction de base manquante → l'implémenter ; nouvelle fonctionnalité → la lister sans la bâtir.

### Messages de Rafba ensuite
- « corrige, puis il y a beaucoup de bugs dans l'automatisation… après ça, je peux dire » → **Rafba devait envoyer sa
  propre liste de bugs. Elle n'est jamais arrivée.**
- « pour moi live automatisations ne marche absolument pas mieux que hier » → priorité à ce qu'il vit **en prod**.
- Consigne permanente (mémoire) : tests **en prod**, dans un bureau de test en bac à sable, **jamais sur staging** ;
  migrations toujours staging d'abord, puis prod.
- « finis tt » → tout faire : garde en base, onglet renommé, confirmation du texte d'exemple, retrait des bureaux de
  test de staging.
- « tres long », puis la demande de cette passation.

### Décisions prises en cours de route
- Après la **panne de la base de prod du 1er octobre (20 h 36 → 21 h 41 UTC)**, survenue pendant que trois sessions
  testaient la prod en même temps, les sessions ont convenu : contre la prod, **un seul flux à la fois**, lire
  `https://lumecrm.net/api/health` avant et pendant, arrêter si `db_ms` > 1 500 ms, **aucun merge pendant la passe
  d'une autre session**, aucun redémarrage du projet Supabase sans l'accord de Rafba pour cette panne-là.
- Les 1 058 tests ne tournent **ni sur staging (tombé deux fois sous leur charge) ni en prod** : sur une base locale
  jetable.
- **Répartition avec la session bf** (mission « correction finale » donnée par Rafba le 1er octobre au soir) :
  bf écrit les écrans (`src/pages/Automations*.tsx`, `src/components/automations/**`, `src/lib/automation*.ts`,
  `server/routes/automation-*.ts`), le moteur, les statistiques, et tient le schéma. **Cette mission écrit seule** :
  `e2e/automations/**`, `scripts/qa/automations-e2e/**`, `scripts/qa/automations-prod/**`,
  `scripts/qa/verifier-garde-automatisations.mjs`, `AUTOMATIONS_UI_AUDIT.md`, `AUTOMATIONS_UI_MAP.md`.
- Comportements décidés avec bf (les specs les affirment) : une étape choisie dans le tiroir n'entre dans le parcours
  qu'à « Enregistrer » de son panneau ; le panneau d'étape désactive « Enregistrer » sur une saisie invalide, celui du
  déclencheur garde le bouton et écrit le refus ; un conflit de version donne 409 « modifiée ailleurs » + « Recharger » ;
  la version anglaise d'un message est dans un bloc replié, « La retirer » coché d'office ou « La garder telle
  quelle », jamais de blocage ; le sélecteur FR / EN de la liste reste si la carte des Réglages dit que c'est le même
  réglage ; le nom d'une copie de modèle suit la langue de l'interface.

### Hors périmètre
Lumi dans le clavardage de l'app (autre mission, session « 90 »), les outils de Lumi (session « 86 »), Twilio / textos
réels (bloqués par Trust Hub, pas par le code), Stripe.

---

## 3. Architecture utile

- **Frontend** : React 19, Vite, TypeScript strict, Tailwind, React Router. Pages en `React.lazy`.
- **Backend** : Express (`server/`), port 3002 en dev ; appels du navigateur via `src/lib/*Api.ts`.
- **Base** : Supabase (PostgreSQL + Auth + Realtime). Prod `bbzcuzqfgsdvjsymfwmr`, staging `boylnjjlhexljmddmjyg`.
  Multi-bureaux : chaque table porte `org_id`, la RLS vérifie l'adhésion **active** et les permissions de la page
  Rôles (`member_has_permission`). `getServiceClient()` (rôle de service) contourne la RLS : toute écriture faite avec
  lui doit filtrer `org_id` elle-même.
- **Automatisations** : table `automation_rules` (déclencheur, `steps` = parcours exécuté, `actions` = reflet,
  `is_active` = publiée). Moteur : `server/lib/automationEngine.ts`, `server/lib/evenementsBase.ts`. Envois en bac à
  sable pour les bureaux inscrits dans `orgs_envois_simules` (copie dans `envois_simules`).
- **Garde en base (cette mission)** : déclencheur `trg_automation_rules_garde`
  (`supabase/migrations/20261007300000_automation_rules_garde.sql`). Il lit `current_user` (pas le jeton) : une
  session d'utilisateur (`authenticated`) ne peut plus publier en direct, se déclarer « fournie », changer de bureau,
  purger hors corbeille ni supprimer ; le rôle de service et les fonctions SECURITY DEFINER passent. La publication
  depuis l'app passe par `activerApresEcritureUtilisateur()` / `changerPublication()` de
  `server/lib/automations-publication.ts`. Retour arrière : `drop trigger trg_automation_rules_garde on public.automation_rules;`.
- **Migrations** : fichier dans `supabase/migrations/`, `npm run db:apply -- <fichier>` (staging) puis
  `npm run db:apply:prod -- <fichier>` ; ensuite `npm run check:broken-objects` et `npm run check:db-coherence`.
- **Pile locale des tests** (`scripts/qa/automations-e2e/`) : Postgres + GoTrue + PostgREST + Realtime en Docker
  (conteneurs `lumeautoe2e-*`, ports 48432 / 48999 / 48300 / 48400), proxy façon Kong (48421), API Express et Vite
  démarrés par chaque commande. Schéma = `supabase/baseline/` + migrations ajoutées depuis la dernière régénération ;
  forfaits et permissions par défaut = `reference.sql`. Aucune donnée de client. Le banc refuse toute adresse qui
  n'est pas `127.0.0.1`.

---

## 4. Inventaire du travail fait par cette mission

### 4.1 PR mergées — toutes **[V]** sur `main`

| PR | Contenu | Mergée (UTC) |
|---|---|---|
| #859 lot 1 | Échap sur les menus, écran d'une automatisation neuve, corbeille non éditable, étape visée en menu, menu ⋮ en portail, aperçu de courriel fidèle, palette de variables | 10-01 17:32 |
| #866 lot 1b | diagnostic sans identifiants, pas de mur de vente sur forfait illisible, fausse alerte « variable inexistante » | 10-01 18:00 |
| #870 lot 2 | 45 constats : liste, éditeur, bibliothèque de modèles, refus de permission lisibles (`server/lib/refus-permission.ts`), anglais | 10-01 18:56 |
| #876 lot 3 | tablette (liste repliée par paliers, barre du haut, cibles tactiles) | 10-01 19:18 |
| #881 lot 4 | causes d'échec traduites (`raisonEchecListe` dans `src/lib/automationJournauxApi.ts`) | 10-01 20:03 |
| #878 | livrables : `AUTOMATIONS_UI_MAP.md`, `AUTOMATIONS_UI_AUDIT.md`, `scripts/qa/automations-prod/`, `npm run test:automations:e2e` | 10-01 20:14 |
| #889 lot 5 | onglet « Prêtes à publier », confirmation « Publier avec le texte d'exemple ? », « publiée » écrite par le serveur, migration de garde | 10-01 22:31 |
| #898 lot 6 | les 1 058 tests (`e2e/automations/`), pile locale, fiches de défauts `e2e/automations/_tri/`, rapport réécrit, `80-publication.mjs`, mode `--etendue` du script de garde | 10-02 01:45 |
| #900 lot 7 | `scripts/qa/automations-e2e/reference.sql` (semence) et `bilan.mjs` (verdict d'une passe) | 10-02 11:57 |

### 4.2 Base de données
- Migration `20261007300000_automation_rules_garde.sql` : appliquée staging 10-01 22:35, prod 10-01 22:36 **[R]**.
  Preuve : `node --env-file=.env.local scripts/qa/verifier-garde-automatisations.mjs [--prod]` → 16/16 sur staging et
  prod **[R]** (7/16 avant). Publication à l'écran vérifiée en prod après (3/3) **[R]**. Le fichier est sur main **[V]**.
- 16 bureaux de test de staging « [TEST] QA Automatisations A/B (liste|modeles|editeur|declencheurs|actions|roles|uiaudit|uiaudit1) »
  mis à la corbeille (`deleted_at`) et leurs règles désactivées, rien d'effacé **[R]**.

### 4.3 Vérifications sur le vrai site **[R]**
`npm run test:automations:e2e` (scripts `scripts/qa/automations-prod/*.mjs`, bureau de prod « Grok Audit (TEST) »,
envois en bac à sable) : **68 / 68** le 1er octobre de 23 h 21 à 23 h 31 UTC, un script à la fois.

### 4.4 Les tests de bout en bout
- Première passe (10-01 soir) : 565 verts / 489 rouges bruts. Puis **tri échec par échec** par dossier (défaut du
  produit / spec périmée / environnement / test fragile) et relance : sur `main`, **822 verts, 236 rouges `@defaut`**
  **[R]** (chiffres dans `AUTOMATIONS_UI_AUDIT.md` § 2 et `e2e/automations/README.md`).
- Fiches de tri (un défaut par ligne : écran, geste, ce qu'on voit, ce qu'on devrait voir, spec et ligne) :
  `e2e/automations/_tri/{actions,declencheurs,editeur,liste,modeles,roles}.md` **[V]** dans le dépôt. C'est la liste
  de travail de bf.
- `node scripts/qa/automations-e2e/bilan.mjs <resultats.json> [--zero-defaut]` : verdict d'une passe (rouge si un
  test sans marque est rouge ou si un `@defaut` passe ; `--zero-defaut` = mode « prêt pour le launch »).

### 4.5 Revérification du premier lot de bf (branche `mission/auto-finale-u` à `a80b2c25`) **[R]**

| Dossier | Tests | Verts | Rouges `@defaut` | Rouges sans marque |
|---|---|---|---|---|
| actions | 183 | 163 | 20 | 0 |
| déclencheurs | 123 | 109 | 14 | 0 |
| éditeur | 186 | 150 | 35 | 1 (régression du « Précédent », `editeur/11-dialogues-gardes-panneaux:125`) |

30 défauts majeurs sur 30 fermés, 6 mineurs du même coup. Les specs adaptées sont sur la branche
**`qa/specs-lot-u`, commit `fd657d81`** — **[V] poussée sur GitHub**. Elles ne valent qu'avec les correctifs de bf :
**ne pas les merger seules sur main** (elles y seraient rouges). bf dit les avoir prises par cherry-pick dans sa
branche d'intégration (`77b966b2`) **[R]**.

### 4.6 Ce qui n'est PAS de cette mission
Le checkout principal `C:\Users\Rafba\lumeeeeeeeeee` est sur un vieux commit (`d93cc822`, très en retard sur main) avec
156 fichiers modifiés **[V]** : ce sont des modifications d'autres sessions ou de Rafba. **Ne pas travailler dedans,
ne pas le nettoyer.** Travailler dans un worktree neuf depuis `origin/main`.

---

## 5. Point d'arrêt exact

- **Dernière action** : revérification du lot de bf finie (§ 4.5), specs poussées (`qa/specs-lot-u`), compte rendu
  envoyé à bf. Plus rien ne tournait ensuite.
- **Dernier message reçu de bf (≈ 13 h UTC le 10-02)** **[R]** : tout est intégré dans `mission/automatisations-finale`,
  tête **`76afbb79`** (avec main jusqu'à #904) : `c7e282f8` corrige la régression du « Précédent », `ee99f9b0` S-14,
  `0582d5bf` composant partagé de version anglaise (retirée ou gardée EN ENTIER, objet + message), `b8ece8b6` ligne
  « La version anglaise sera retirée. » près d'« Enregistrer », `36d64232` carte « En cours d'ajout — pas encore
  enregistrée », `68239982` + `7b625878` (`actions` reflet du parcours), `f70cb08d` refus du déclencheur écrit dès la
  saisie. Specs à adapter : `D:/lume-final/notes/U-corrections.md`, section « Après les majeurs ». **Le lot « modèles »
  attend encore les patchs de son agent S** (Automations.tsx, Aperçu) — ne pas le prendre avant son signal.
- **Ce que j'allais faire** : revérifier l'éditeur sur `76afbb79` (facultatif selon bf), puis le lot « modèles »
  (table `D:/lume-final/notes/T-corrections.md`), puis liste et rôles.
- **Branche `mission/automatisations-finale`** : elle existe dans le dépôt local de ce PC (worktree `D:/lume-final/wt`,
  tête `76afbb79` **[V]**) mais **pas sur GitHub** **[V]**. Sur `origin`, `mission/auto-finale-u` est à `a80b2c25`
  alors que le local est à `f70cb08d` **[V]**.
- **Processus encore actifs** **[V]** : les 4 conteneurs `lumeautoe2e-*` tournent (prêtés à bf, qui devait dire « je la
  prends » / « je la rends »). Aucun serveur de cette mission n'écoute. Pour les arrêter (rien n'est supprimé) :
  `bash scripts/qa/automations-e2e/pile.sh arreter` ; pour les relancer : `… pile.sh demarrer`.
  **Attention** : `pile.sh` sans argument RECRÉE la pile et efface tout ce que la base locale contient.

---

## 6. Git — où est le code

| Quoi | Où | Sur GitHub ? |
|---|---|---|
| Tout le travail livré | `main` (`f8d3eed8` au moment d'écrire) | **[V]** oui |
| Specs adaptées au lot U | branche `qa/specs-lot-u` (`fd657d81`) | **[V]** oui — à fusionner AVEC les correctifs de bf |
| Branches des PR mergées | `fix/audit-auto-lot5`, `qa/audit-auto-lot6`, `qa/audit-auto-lot7` | **[V]** oui (déjà sur main, à supprimer quand on veut) |
| Correctifs en cours de bf | `mission/automatisations-finale` (`76afbb79`), `mission/auto-finale-*` | **[V]** local seulement, sauf `mission/auto-finale-u` à `a80b2c25` |

Aucune PR ouverte de cette mission **[V]**. Rien de non commité dans `D:/lume-uiaudit/wt-lumi` ni `wt-verif` **[V]**.

**Atelier local (ce PC seulement, non transférable par GitHub)** — `D:/lume-uiaudit/` :
- `wt-lumi` (branche `qa/audit-auto-lot7`, déjà mergée) et `wt-verif` (branche `qa/specs-lot-u`) : worktrees utiles ;
  `node_modules` y sont des jonctions vers `D:/lume-uiaudit/wt/node_modules`.
- `wt` et `wt-e2e` : **anciens**, avec des copies non suivies des specs, dépassées par main — ne pas s'en servir.
- `notes/BRIEF-TRI.md`, `notes/BRIEF-VERIF.md` : consignes données aux sous-agents (réutilisables telles quelles).
- `sorties/` : résultats des passes, fiches de tri d'origine, `echecs-tries.md`, captures.
- `outils/` : petits scripts de l'atelier (`sante-staging.mjs`, `prod/sante-supabase.mjs` — lecture seule ;
  `staging-bureaux-test.mjs` ; `resume-echecs.mjs` ; `attendre-ci.sh <PR>` ; `attendre-deploiement.sh <sha>`).
- `pw-browsers/` : navigateurs Playwright.

**Secrets** : jamais dans le chat ni dans un commit. Ils sont dans `.env.local` (non suivi) : `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF`, `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_URL_PROD`, `SUPABASE_SERVICE_ROLE_KEY_PROD`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Les obtenir de Rafba (ou du tableau de
bord Supabase / Railway s'il donne l'accès). La pile locale n'en a pas besoin (elle signe ses propres clés).

---

## 7. Ce qui fonctionne, ce qui reste incertain

- **Fonctionne [R]** : tout ce qui est listé au § 4.1 en prod ; la garde en base (16/16) ; la passe du vrai site
  (68/68) ; la pile locale et les 1 058 tests ; `bilan.mjs` essayé sur deux rapports réels.
- **Incertain** :
  - Les correctifs de bf après `a80b2c25` (régression du « Précédent », S-14, etc.) : **non revérifiés** par cette
    mission **[À vérifier]**.
  - La matrice d'appareils de la passe complète : seul le projet « bureau » (Chromium 1440 × 900) a tourné. iPad,
    téléphone, Firefox, WebKit jamais lancés en entier **[V]** (prêts dans `e2e/automations/playwright.config.ts`).
  - `pile.sh` sur un runner Linux : jamais joué **[À vérifier]**.
  - La stabilité d'une passe à l'autre : une seule relance complète par dossier.
  - Valeur de `FEATURE_GUARD` en prod (Railway) : inconnue **[À vérifier]**.
  - Les pannes de prod du 1er octobre : cause non établie. La base est passée au format « Small » (2 Go) le 10-02 à
    03 h 47 UTC, avec l'accord de Rafba **[R]**.

---

## 8. Ce qu'il reste à faire

**Pour cette mission (tests et vérification)**
1. Revérifier au navigateur chaque lot de bf, dans cet ordre : éditeur sur `76afbb79` (régression + mineurs), lot
   « modèles et messages » (quand bf le dit prêt), liste, rôles. Méthode au § 10.
2. Après chaque lot : retirer les `@defaut` des défauts fermés, adapter les specs aux comportements décidés (jamais
   affaiblir), commiter `e2e/automations/**` seul sur une branche, la passer à bf pour qu'elle parte **avec** ses
   correctifs.
3. Quand bf aura fermé les écritures directes (une seule porte d'écriture serveur, puis
   `revoke insert, update, delete on automation_rules from authenticated, anon`) : rejouer
   `scripts/qa/verifier-garde-automatisations.mjs --etendue` (aujourd'hui 10/20 ; attendu 20/20), sur la pile locale,
   staging, puis prod.
4. Mettre à jour `AUTOMATIONS_UI_AUDIT.md` (verdict, chiffres) à la fin, et refaire la passe du vrai site
   (`npm run test:automations:e2e`, un script à la fois, après accord des autres sessions).
5. Jouer au moins une fois la matrice d'appareils (`--project=ipad-paysage`, etc. ; les tests marqués `@matrice`).

**À faire par bf (pas par cette mission)** : corriger les 194 défauts restants (lot U compris), régénérer
`supabase/baseline/` et `SCHEMA_SNAPSHOT.md` à la fin (la baseline a ≥ 77 migrations de retard), le job de CI
(six tranches `--shard`) et `npm run test:automations:all`.

**Décisions qui appartiennent à Rafba**
- Sa liste de bugs (jamais reçue).
- Corriger le texte anglais « New lead… » déjà semé dans les bureaux existants (roles-13) : c'est une migration de
  données sur de vrais bureaux → son accord d'abord.
- Le nom « Anniversaire client » (part 12 mois après la création de la fiche, pas à l'anniversaire — liste-12).

**Restes connus, mineurs** : verrou de session de supabase-js « Lock broken by another request… » (P-001) ; titre
anglais « Workflows list » (P-002) ; la table des gardes de l'API ne reconnaît pas un identifiant court comme
paramètre ; `check:db-coherence` signale 4 écarts sans rapport (fonctions de commissions et QuickBooks non exécutables
par une session).

---

## 9. Risques et pièges

- **Ne jamais lancer de tests sur staging** (tombé deux fois) ; contre la prod, un seul flux, santé lue avant ; ne pas
  merger pendant la passe d'une autre session ; ne jamais redémarrer le projet Supabase sans l'accord de Rafba.
- **Un merge sur main = un déploiement en prod** (Railway). Vérifier `git diff --stat origin/main...HEAD` avant tout
  push (des PR ont déjà failli annuler des dizaines de fichiers).
- **Les specs de `qa/specs-lot-u` sont rouges sur main sans les correctifs de bf.**
- **La garde en base** : toute nouvelle route qui publie une automatisation doit passer par le rôle de service, sinon
  42501.
- Plusieurs sessions Claude tournent sur ce poste : arrêter ses processus **par PID exact**, jamais
  `taskkill /IM node.exe` ; ne jamais `git stash` (pile partagée entre worktrees).
- Sorties de Playwright **hors du dépôt** (`E2E_SORTIES`), sinon Vite recharge en boucle.
- Ne pas écrire de scripts en heredoc bash (les `\` sont mangés) : utiliser un fichier.
- Le disque C: est plein à 99 % (≈ 5-6 Go libres) : travailler sur D:.
- Pièges du banc : textos reportés hors 8 h – 20 h (heure de Montréal) ; le serveur garde les droits d'un membre 60 s
  et un drapeau 30 s ; « Réglages › Entreprise » renomme le bureau (le banc remet le nom) ; une tâche de fond de
  Claude Code est tuée après 2 h.

---

## 10. Comment reprendre

**Si la reprise se fait sur ce PC** (même session Windows) — tout l'atelier est là :
```bash
cd D:/lume-uiaudit/wt-verif
git fetch origin
git merge --no-edit mission/automatisations-finale      # la tête que bf annonce (branche locale de ce dépôt)
bash scripts/qa/automations-e2e/pile.sh demarrer          # si les conteneurs sont arrêtés
E2E_PORT_PROXY=48423 E2E_PORT_API=48304 E2E_PORT_VITE=5195 \
PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/verif-editeur \
E2E_JEU=editeur E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs editeur/ --project=bureau
node scripts/qa/automations-e2e/bilan.mjs D:/lume-uiaudit/sorties/verif-editeur/resultats.json
```
Une commande à la fois. Chaque `lancer.mjs` démarre et arrête ses propres serveurs sur les ports donnés.
Consignes détaillées pour un sous-agent : `D:/lume-uiaudit/notes/BRIEF-VERIF.md`.

**Si la reprise se fait sur une autre machine** :
```bash
git clone https://github.com/olivier27stp-max/lumeeeeeeeeee.git && cd lumeeeeeeeeee && npm ci
npx playwright install chromium
bash scripts/qa/automations-e2e/pile.sh                   # Docker requis ; ≈ 5 min la 1re fois, ≈ 3 Go d'images
node scripts/qa/automations-e2e/preparer-jeu-roles.mjs
node scripts/qa/automations-e2e/lancer.mjs actions/ --project=bureau   # sorties hors du dépôt : E2E_SORTIES=…
```
Mode d'emploi complet : `e2e/automations/README.md`. Les correctifs en cours de bf ne seront visibles que lorsqu'elle
les aura poussés ou mergés — **demander à Rafba qui tient cette session** et où sont ses branches.

**Fichiers à lire en premier** : `CLAUDE.md` (règles du projet), `AUTOMATIONS_UI_AUDIT.md`, `e2e/automations/README.md`,
`e2e/automations/_tri/*.md`, puis (sur ce PC) `D:/lume-final/notes/U-corrections.md` et `T-corrections.md`.

---

## 11. Message de départ pour la nouvelle session Claude Code

> Tu reprends la mission « audit des écrans Automatisations » de Lume CRM. Lis d'abord `CLAUDE.md`, puis
> `PASSATION_AUDIT_AUTOMATISATIONS.md` (à la racine du checkout principal), `AUTOMATIONS_UI_AUDIT.md` et
> `e2e/automations/README.md`. Ton rôle : tenir les tests de bout en bout (`e2e/automations/**`, tu es le seul à y
> écrire) et revérifier au vrai navigateur, sur la pile locale, les correctifs que la session « correction finale »
> pousse — tu ne modifies pas les écrans du produit. Ne lance aucun test sur staging ; contre la prod, un seul flux, avec
> l'accord des autres sessions. Avant toute action : `git fetch`, vérifie quelles branches existent sur GitHub
> (`git ls-remote --heads origin`), et confirme avec moi quel lot revérifier. N'affaiblis jamais un test ; un test
> `@defaut` rouge décrit un défaut connu, et sa marque ne se retire que quand il passe.
