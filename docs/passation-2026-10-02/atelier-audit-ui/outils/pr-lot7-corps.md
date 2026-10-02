Deux outils qui manquaient pour faire des E2E des automatisations une commande bloquante (`npm run test:automations:all`, en préparation dans la mission « correction finale »). **Aucun fichier du produit, aucune spec.**

## 1. La pile locale se monte sans sauvegarde de la prod — `scripts/qa/automations-e2e/reference.sql`
`pile.sh` avait besoin d'un fichier de sauvegarde de la prod (hors dépôt) pour charger les deux tables de référence que `supabase/baseline/` ne contient pas. La semence est maintenant dans le dépôt : 3 forfaits (identifiants Stripe retirés, colonnes à NULL) et les 38 permissions par défaut des rôles. `pile.sh` la charge d'office quand `E2E_SAUVEGARDE` est absent ; la pile se monte donc sur un autre poste ou sur un runner de CI.

Vérifié : chargée dans des tables temporaires d'une transaction annulée — 3 forfaits, 0 identifiant Stripe, 38 permissions, 0 écart avec la base locale.

## 2. Le verdict d'une passe — `scripts/qa/automations-e2e/bilan.mjs`
Les tests marqués `@defaut` sont rouges exprès (ils affirment le comportement attendu d'un défaut connu) : le code de sortie de Playwright ne dit rien d'une passe. `bilan.mjs` lit le rapport JSON (`<E2E_SORTIES>/resultats.json`) et tranche :

- **ROUGE** si un test sans marque est rouge, si un `@defaut` est vert (la marque doit être retirée), ou si rien n'a été joué ;
- les rouges `@defaut` sont comptés et listés à part ;
- `--zero-defaut` (« prêt pour le launch ») : tout défaut encore ouvert bloque, et tout test non joué aussi — jamais compté vert.

Écrit `bilan.json` et `BILAN.md`, par dossier, pannes d'environnement distinguées.

Vérifié sur deux rapports réels : la première passe complète du 1er octobre (1 054 tests → ROUGE : 233 rouges sans marque, 56 `@defaut` verts) et la relance triée du dossier « liste » (205 tests → VERT en mode ordinaire, 49 défauts connus ; ROUGE avec `--zero-defaut`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
