# Tests en quarantaine — ils échouent EXPRÈS

Ces tests décrivent le comportement **attendu** des automatisations. Ils
échouent parce que le code ne le fait pas encore. Chaque échec est une faille
documentée, pas un test cassé : les intitulés portent la mention
`ROUGE ATTENDU (F…)` avec le numéro de la faille.

Ils sont **exclus de la CI** (`vitest.config.ts` → `exclude`). Une CI rouge en
permanence ne signale plus rien : on perdrait la capacité de voir les vraies
régressions. Ils restent versionnés pour deux raisons — ne pas perdre 3 000
lignes de travail, et garder la liste des bugs sous une forme exécutable
plutôt qu'un document qui vieillit.

## Les lancer

```bash
npm run test:quarantaine
```

Au dernier passage (2026-09-19, contre `origin/main`) : **47 échecs, 149
réussites, 34 ignorés** sur 230 cas. Les tests d'intégration s'ignorent
d'eux-mêmes sans base de données — branchés sur staging, ils s'ajoutent au
décompte.

Les réussites comptent autant que les échecs : elles décrivent ce qui marche
déjà et protègent contre une régression le jour où on corrigera le reste.

## D'où ils viennent

Audit des automatisations du 2026-09-13 (mission en lecture seule, style
Viktor). Les tests ont été écrits pendant l'audit, en même temps que
`AUTOMATIONS_AUDIT.md`, `AUTOMATIONS_MAP.md` et `AUTOMATIONS_TEST_PLAN.md`
(à la racine du dépôt). Ils dormaient depuis dans un dossier de travail non
versionné.

## Failles couvertes

Vingt-deux failles sont référencées (F1 à F26). Les quatre vérifiées dans le
code le 2026-09-19 :

| Faille | Ce que le test attend | État vérifié |
|---|---|---|
| **F7** — consentement | Une relance commerciale (`cross_sell_30d`, `seasonal_reminder_6m`, `lost_lead_reengagement`) ne part pas sans consentement du client ; la demande d'avis compte dans le plafond de fréquence | **non corrigé** — aucune notion de consentement marketing côté serveur (`grep` sur `marketing_consent` : rien) |
| **F6** — interrupteur d'arrêt | `AUTOMATIONS_ENABLED=false` → aucun événement traité, la file reste intacte | **CORRIGÉ le 2026-09-23** — `server/lib/automations-interrupteur.ts`, branché dans `handleEvent` et `processScheduledTasks`. Les deux tests T12.3 sont passés au VERT. |
| **F11/F13** — plafonds | Au-delà du plafond quotidien, les SMS sont retenus et reportés, jamais envoyés ; à 80 % une notification prévient l'administrateur | **non vérifié** |
| **F3, F5, F9, F18** — idempotence, reprise, outbox, destinataire | Voir les intitulés des tests | **non vérifié** |

`AUTOMATIONS_AUDIT.md` annonce plusieurs de ces failles comme « corrigé (M2) /
(M5) ». **Ce n'est pas le cas dans le code de `main`** au 2026-09-19 : ces
correctifs ont été planifiés ou faits sur une branche qui n'a jamais été
fusionnée. C'est précisément ce qu'un test exécutable évite, là où un document
affirme sans preuve.

⚠️ **F7 mérite une décision, pas juste un ticket** : des relances commerciales
envoyées sans consentement, c'est un risque légal (LCAP au Canada, loi 25 au
Québec), pas seulement un défaut de qualité.

## Comment sortir un test de quarantaine

1. Corriger la faille dans le code.
2. Lancer `npm run test:quarantaine` : le test passe au vert.
3. Déplacer le fichier de `tests/quarantaine/automation/` vers
   `tests/automation/` (ou `automation-integration/`) — il entre alors dans la
   CI et protège la correction contre une régression.
4. Retirer sa ligne du tableau ci-dessus.

Le jour où le dossier est vide, le supprimer avec l'exclusion dans
`vitest.config.ts`.

## Contenu

- `automation/` — tests unitaires (moteur, conditions, idempotence, temps,
  permissions, conformité, coût/volume, erreurs, perf, isolation entre
  entreprises) + `golden/` (instantanés de référence)
- `automation-integration/` — les mêmes thèmes contre une vraie base
- `_enregistreur.ts`, `_fixtures.ts` — utilitaires partagés
