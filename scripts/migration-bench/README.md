# Banc d'essai de la migration assistée

Rejoue le parcours complet (invitation → fichiers → correspondances →
employés/gabarits → dry-run → approbation → import final → vérité terrain →
rollback) contre la **prod déployée**, dans un workspace jetable détruit à la
fin. Le jeu de données contient 10 pièges qui verrouillent chaque garantie
(doublons internes, homonymes, dates JJ/MM, solde partiel, etc.).

```bash
node scripts/migration-bench/gen-trap-dataset.mjs /tmp/trap-dataset
node scripts/migration-bench/e2e-trap.mjs /tmp/trap-dataset
```

Prérequis : clé service prod dans `~/Downloads/lume-crm/.env.local`
(`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) ; le compte
`olivier27stp@gmail.com` doit être dans `PLATFORM_ADMIN_IDS`.

À lancer après TOUT changement du pipeline de migration (`server/lib/migration/`,
`server/routes/migration-*`), une fois le déploiement Railway en ligne.
Historique : ce banc a attrapé 9 vrais bugs avant le premier client réel
(courses d'upload, NOT NULL de prod, contraintes de statut, fuite maxBodySize,
loterie de primaire de doublon, trous de catalogue…).

Hors vitest volontairement (dépend de la prod) — les tests unitaires du
pipeline vivent dans `tests/migration/`.
