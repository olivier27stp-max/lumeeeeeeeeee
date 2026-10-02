# Brief commun des agents — mission « correction finale Automatisations »

Tu es un sous-agent d'enquête et de test. Le coordinateur (session 98) te donne UN domaine. Lis d'abord
`D:/lume-final/MISSION.md` (le texte de Rafba — la partie qui concerne ton domaine est citée dans ta consigne)
et `D:/lume-final/JOURNAL.md` (atelier, zones, acquis).

## Ce que tu produis
1. `D:/lume-final/notes/<LETTRE>-constats.md` : un constat par défaut ou par manque, au format ci-dessous.
2. Des tests qui PROUVENT chaque constat (un test rouge aujourd'hui, qui deviendra vert une fois corrigé), dans
   TON worktree, dans des fichiers NEUFS seulement (voir « Zones »).
3. Un dernier message court : ce que tu as établi, ce que tu n'as pas pu vérifier, les fichiers créés.

Format d'un constat :
```
### <LETTRE>-<nn> — <titre en une phrase, ce qui ne va pas pour l'utilisateur>
- Point de la mission : <1 à 18, P4, P6, P7>
- Gravité : bloquant | majeur | mineur | cosmétique
- Ce qu'on voit : <symptôme, comme un utilisateur le vivrait>
- Reproduction : <étapes exactes, ou commande>
- Preuve : <test (chemin::titre) ou sortie relevée — jamais « j'ai lu le code »>
- Cause racine : <fichier:ligne, mécanisme>
- Correctif proposé : <quoi changer, dans QUELS fichiers> (ne l'applique pas)
- Risque / à décider par Rafba : <s'il y en a>
```
Un constat sans preuve exécutée est marqué « NON VÉRIFIÉ » en tête. Ne conclus jamais « ça marche » en lisant
seulement le code : fais tourner.

## Phase actuelle : ENQUÊTE. Tu ne corriges RIEN dans le code du produit.
Tu n'écris que : ton fichier de constats, des tests NEUFS, des scripts de mesure NEUFS. Aucune modification d'un
fichier existant de `server/`, `src/`, `supabase/`. Les corrections seront réparties ensuite par zones de fichiers.

## Atelier
- Ton worktree : `D:/lume-final/wt-<lettre>` (branche `mission/auto-finale-<lettre>`, partie de origin/main).
  `node_modules` y est installé ; `.env.local` y vise la PILE LOCALE.
- Pile locale (Docker `lumefinal-*`, déjà en marche, schéma = prod) : PostgREST `http://localhost:49300`, GoTrue
  `http://localhost:49999`, proxy façon Supabase `http://localhost:44921` (c'est `VITE_SUPABASE_URL`), Postgres
  `postgres://supabase_admin:lumefinal-local-pw@localhost:49432/postgres`.
  SQL direct : `MSYS_NO_PATHCONV=1 docker exec -i -u postgres lumefinal-db psql -U supabase_admin -d postgres -c "…"`.
- Bureaux de test : `QA_AUTO_SUFFIXE=<lettre>` devant chaque commande → TES bureaux « [TEST] QA Automatisations A/B
  (<lettre>) », créés par `npx tsx --env-file=.env.local scripts/qa/bureau-test-automatisations.mts`. Jamais ceux
  d'un autre agent, jamais les bureaux sans suffixe (le coordinateur).
- Harnais existant (à réutiliser, ne pas réinventer) : `tests/automations-suite/harnais/` (`moteur.ts` : vrai
  moteur en processus, `envoisSimules`, `traiterFile` ; `bureau-test.ts` : comptes, `sessionDe` ; `navigateur.ts`
  et `serveurs-ui.ts` : vrai navigateur). Exemples : `tests/automations-suite/integration/*.test.ts`, `ui/*.test.ts`.
- Lancer des tests : `QA_AUTO_SUFFIXE=<lettre> node scripts/qa/test-automatisations.mjs <fichier(s)>` (intégration)
  ou `npx vitest run --maxWorkers=2 --config vitest.automations.config.ts --project unitaires <fichier>`.
- Vrai navigateur : `node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-<lettre> <portApi> <portVite> [--lumi]`
  (à lancer en arrière-plan ; tes ports sont dans ta consigne). Playwright est dans node_modules
  (`PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers` si chromium manque). Connexion : lien magique par
  `sessionDe` (voir `harnais/navigateur.ts`).
- Lumi avec le VRAI modèle : la clé Anthropic est dans `.env.local` (pile locale). Ne mocke jamais le modèle pour
  juger la qualité. Garde les passes courtes : chaque appel coûte.

## Interdits
- AUCUNE requête d'écriture vers la prod ni staging. Aucune suite, aucune charge vers la prod ni staging (deux
  pannes le 2026-10-01). Lecture seule de la prod UNIQUEMENT si ta consigne le demande, par
  `node --env-file=D:/lume-final/env.reel "C:/Users/Rafba/AppData/Local/Temp/claude/c--Users-Rafba-lumeeeeeeeeee/ba12dd82-e7f2-4844-ade1-7588d9f77902/scratchpad/q.mjs" prod "<select …>"`
  — comptes agrégés, jamais de donnée de client dans tes notes, une requête à la fois.
- N'affiche jamais un secret (`env.reel`, clés). Ne commite jamais `.env.local`.
- Poste partagé : `--maxWorkers=2`, jamais la suite complète, jamais `taskkill /IM node.exe` ; arrête TES
  serveurs par PID quand tu as fini. Pas de `git stash`. Pas de `sleep` en boucle au premier plan.
- Ne désactive ni n'affaiblis aucun test existant.
- Ne pousse rien (`git push`), n'ouvre pas de PR : commite seulement dans ta branche.

## Zones (qui écrit où)
- Autres sessions Claude, à ne pas toucher : `e2e/automations/**`, `scripts/qa/automations-e2e/**`,
  `scripts/qa/automations-prod/**`, `AUTOMATIONS_UI_*.md` (session fd) ; `server/lib/agent/tools-lot-*.ts`,
  `complements-cartes.ts`, `apercu-action.ts`, `libelles-cartes.ts`, `outils-domaines.ts`, `registre.ts`,
  `server/lib/lumi/topics.ts`, `sujet-par-regle.ts`, `src/lib/lumiVerbes.ts` (session a1) ;
  `server/lib/lumi/orchestrateur.ts`, `historique.ts`, `server/routes/lumi.ts`, `evals/lumi/**` (session f1).
- Tes tests neufs : `tests/automations-finale/<lettre>/…` (crée le dossier). Tes scripts : `scripts/qa/finale/<lettre>/…`.

## Documents à connaître (dans ton worktree)
`AUTOMATIONS_INVENTORY.md` (inventaire tiré du code), `AUTOMATIONS_TEST_REPORT.md` (80 défauts déjà corrigés, ce
qui n'est pas testé), `AUTOMATIONS_TEST_MATRIX.md`, `AUTOMATIONS_UI_MAP.md` et `AUTOMATIONS_UI_AUDIT.md` (tournée
d'interface, 68 constats), `LUMI_INVENTORY.md`, `LUMI_COST_REPORT.md`, `LUMI_BASELINE.md`, `LUMI_GLOSSARY.md`,
`CLAUDE.md` (règles du dépôt). Ne refais pas ce qui y est déjà établi : cite-le et va plus loin.

## Langue
Notes, constats, commentaires et noms de tests en français (comme le dépôt). Phrases complètes, pas de jargon.
