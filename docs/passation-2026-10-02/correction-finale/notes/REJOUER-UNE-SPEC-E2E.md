# Rejouer UNE spec Playwright de la session fd contre sa propre pile et ses propres serveurs

Les 1 058 specs de fd (`e2e/automations/**`) prouvent chaque ligne des triages
(`D:/lume-uiaudit/sorties/triage/*.md`, index `D:/lume-uiaudit/sorties/echecs-tries.md`).
Décompte de départ : 822 verts, 236 rouges `@defaut` — actions 34, déclencheurs 28, éditeur 49, liste 49,
modèles 49, rôles 27. Garde de base en mode étendu : 10 / 20.

Où sont les fichiers : branche `qa/audit-auto-lot6` (PR à venir) ; en attendant, en LECTURE SEULE dans
`D:/lume-uiaudit/wt-lumi`. Fd seule écrit dans `e2e/automations/**` et `scripts/qa/automations-e2e/**`.

## La commande (serveurs DÉJÀ démarrés par l'agent ; rien n'est démarré ni arrêté par le banc)
Depuis un arbre qui contient `e2e/automations/` :

```
VITE_SUPABASE_URL=http://127.0.0.1:44921 \
VITE_SUPABASE_ANON_KEY=<clé anon de lumefinal : .env.local du worktree> \
SUPABASE_SERVICE_ROLE_KEY=<clé de service de lumefinal : .env.local du worktree> \
E2E_BASE=http://127.0.0.1:<port Vite de l'agent> \
E2E_JEU=<lettre de l'agent> E2E_WORKERS=1 \
E2E_SORTIES=D:/lume-final/sorties/e2e-<lettre> \
PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers \
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts \
  editeur/12-enregistrement.spec.ts --project=bureau -g "429"
```

## Conditions pour que le résultat vaille quelque chose
1. L'adresse du proxy est en `127.0.0.1` ou `localhost` (le banc refuse le reste).
2. Vite proxifie `/api` vers l'API de l'agent, lancée avec `LUME_TACHES_DE_FOND=off`, `BAC_A_SABLE_EN_TEST=1`, aucun
   fournisseur réel — c'est ce que fait `node D:/lume-final/outils/serveurs.mjs <worktree> <portApi> <portVite>`.
3. La base porte la migration 20261007300000 et les tables `plans` / `role_permission_defaults` (c'est le cas de
   `lumefinal`). Le repère du moteur (`automation_evenements_base`, type `__mise_en_service__`) doit exister avant le
   premier test du moteur, sinon le premier événement est classé « antérieur à la mise en service ».
4. UN jeu par agent (`E2E_JEU`) : deux agents sur le même jeu se marchent dessus.
5. Le dossier « roles » veut son jeu : `node scripts/qa/automations-e2e/preparer-jeu-roles.mjs <jeu>` — il vise la pile
   de fd (ports 48999 / 48300) tant qu'on ne change pas `PILE` dans son `local.mjs`.
6. Deux pièges : le serveur garde en mémoire les droits d'un membre 60 s et un drapeau 30 s ; les textos sont reportés
   hors 8 h – 20 h (heure de Montréal) — un test qui attend un texto envoyé tombe le soir.
