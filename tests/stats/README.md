# Tests de la page Statistiques (/insights)

Audit du 2026-09-30 : voir `STATS_AUDIT.md` à la racine.

Tout se joue sur une **stack Supabase locale et jetable** (Docker). Jamais staging, jamais la prod.

```bash
# 1. Stack locale : Postgres Supabase + GoTrue + PostgREST (max_rows = 1000 comme la prod)
bash scripts/qa/stats-stack.sh
# 2. Droits identiques à la prod (sinon anon exécute tout — artefact de la baseline)
node --env-file=.env.local scripts/qa/stats-acl-prod.mjs
# 3. Jeu de données : T1 (mesuré), T2 (ne doit jamais apparaître), T3 (vide), T4 (volumineux)
node scripts/qa/stats-fixture.mjs --volume
# 4. (facultatif) migration proposée, appliquée EN LOCAL pour la valider
docker exec -i -u postgres lumestats-db psql -U supabase_admin -d postgres \
  < supabase/migrations/proposed/20261004300000_statistiques_fuseau_encaisse_roles.sql

export STATS_DB_URL=postgres://supabase_admin:lumestats-local-pw@localhost:47432/postgres
npx vitest run tests/stats                       # exactitude, sécurité, parité Lumi
STATS_PERF=1 npx vitest run tests/stats/performance.integration.test.ts
npx playwright test -c tests/stats/e2e/playwright.config.ts   # E2E, 3 largeurs
```

| Fichier | Vérifie |
|---|---|
| `oracle.ts` | la valeur JUSTE de chaque chiffre, en SQL indépendant (fuseau du tenant, remboursements, imports) |
| `exactitude.integration.test.ts` | chaque carte, par son vrai module `src/lib`, à travers PostgREST = oracle, 7 périodes + tenant vide |
| `securite.integration.test.ts` | isolation entre entreprises (p_org trafiqué), rôles de la page Rôles, anonyme, service_role |
| `lumi-parite.integration.test.ts` | les outils de Lumi donnent les mêmes chiffres que la page (midi ET 21 h, serveur en UTC) |
| `performance.integration.test.ts` | p50/p95 des appels, chargement, changement de période, troncatures, EXPLAIN ANALYZE (RLS active) |
| `e2e/statistiques.spec.ts` | écran = oracle, chaque contrôle, FR/EN, 3 largeurs, états, cache, captures de régression |
| `../statistiques-unitaires.test.tsx` | (CI) période le soir, pagination, rendu des mois à Montréal |

Sans `STATS_DB_URL`, les tests d'intégration sont ignorés : la CI ne les lance pas.
`it.fails` = écart connu et documenté (le test préviendra quand il sera corrigé).
