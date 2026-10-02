# E2E de la section Automatisations

1 058 tests Playwright, un par élément de `AUTOMATIONS_UI_MAP.md` et par parcours : liste, bibliothèque de
modèles et messages, éditeur, déclencheurs, actions, rôles (interface, API directe, base directe).

## Où ça tourne

Sur une **pile locale jetable** — jamais staging, jamais la prod (staging est tombé deux fois sous ces tests
le 2026-10-01 ; le banc refuse toute adresse qui n'est pas `127.0.0.1`).

```bash
# 1. Une fois : monte Postgres + GoTrue + PostgREST + Realtime (Docker), schéma = supabase/baseline + migrations.
#    Les deux tables de référence (`plans`, `role_permission_defaults`) viennent de la semence du dépôt
#    (scripts/qa/automations-e2e/reference.sql) ; aucune donnée de client n'entre dans la pile.
#    Pour les prendre plutôt dans une sauvegarde récente de la prod : E2E_SAUVEGARDE=../lume-backups/prod-….dump
bash scripts/qa/automations-e2e/pile.sh

# 2. La passe complète (≈ 2 h à un worker ; prépare d'abord le jeu de bureaux du dossier « roles »).
npm run test:automations:e2e:local

# Un dossier, un fichier, un test :
node scripts/qa/automations-e2e/lancer.mjs liste/ --project=bureau
node scripts/qa/automations-e2e/lancer.mjs editeur/12-enregistrement.spec.ts --project=bureau -g "429"

# Le verdict d'une passe (le code de sortie de Playwright ne suffit pas : les tests @defaut sont rouges exprès) :
node scripts/qa/automations-e2e/bilan.mjs <E2E_SORTIES>/resultats.json            # rouge si un test sans marque est rouge ou un @defaut vert
node scripts/qa/automations-e2e/bilan.mjs <E2E_SORTIES>/resultats.json --zero-defaut   # « prêt pour le launch » : plus aucun défaut, rien de non joué

# Fin de séance : arrête les conteneurs (rien n'est supprimé).
bash scripts/qa/automations-e2e/pile.sh arreter
```

Variables utiles : `E2E_SORTIES` (captures, traces, JSON — **hors du dépôt**, sinon Vite recharge en boucle),
`E2E_JEU` (un jeu de bureaux de test par personne ou par agent), `E2E_WORKERS` (1 par défaut ; à 2, préparer aussi
`node scripts/qa/automations-e2e/preparer-jeu-roles.mjs roles1`), `E2E_PORT_PROXY` / `E2E_PORT_API` /
`E2E_PORT_VITE` (un second jeu de serveurs à côté d'une passe en cours), `PLAYWRIGHT_BROWSERS_PATH`.

Contre des serveurs déjà démarrés (une autre pile locale) : poser soi-même `VITE_SUPABASE_URL` (le proxy local),
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_BASE` (l'adresse de Vite), puis
`node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts <fichier> --project=bureau`.
L'API doit tourner sans tâche de fond (`LUME_TACHES_DE_FOND=off`), avec `BAC_A_SABLE_EN_TEST=1` et aucun fournisseur réel.

## Règles

- Le **moniteur** écoute la console et le réseau pendant chaque test : une erreur de console, une exception,
  une réponse 4xx / 5xx non déclarée font échouer le test, même si toutes ses attentes passent.
- Un test marqué **`@defaut`** affirme le comportement ATTENDU pour un défaut constaté et reste **rouge** tant
  que le défaut existe. On ne l'affaiblit pas, on ne le désactive pas (`skip`, `fixme`, `fail`, `retries` interdits).
  Le défaut corrigé, le test passe : on retire la marque, rien d'autre.
- Les fiches de `_tri/` décrivent chaque défaut ouvert (écran, geste, ce qu'on voit, ce qu'on devrait voir,
  spec et ligne). État au 2026-10-02 : 822 verts, 236 rouges `@defaut`.
- Un test ne dépend ni de l'heure (les textos respectent la fenêtre 8 h – 20 h), ni de ce qu'un autre test a
  laissé : une liste « égale à celle du bureau » se compare à la base au moment du test.
- Le serveur garde les droits d'un membre 60 s et un drapeau 30 s : attendre l'état, pas un délai fixe.

## Limites connues

Pas de stockage de fichiers ni de clé d'IA dans la pile (les réponses de Lumi sont simulées), aucun envoi réel
(bac à sable). Seul le projet « bureau » (Chromium 1440 × 900) a été lancé en entier ; les projets iPad,
téléphone, Firefox et WebKit de `playwright.config.ts` filtrent sur `@matrice`.
