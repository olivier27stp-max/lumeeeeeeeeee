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
| **F7** — consentement | Une relance commerciale (`cross_sell_30d`, `seasonal_reminder_6m`, `lost_lead_reengagement`) ne part pas sans consentement du client ; la demande d'avis compte dans le plafond de fréquence | **CORRIGÉ** — PR #439 (2026-09-19, le verrou) puis PR #468 (2026-09-23) : les DEUX bases légales de la LCAP sont acceptées (exprès + tacite : 2 ans après un contrat, 6 mois après une demande), une carte sur la fiche client permet de saisir l'exprès, et chaque envoi journalise la base retenue dans `consents` (la charge de la preuve appartient à l'expéditeur). |
| **F6** — interrupteur d'arrêt | `AUTOMATIONS_ENABLED=false` → aucun événement traité, la file reste intacte | **CORRIGÉ le 2026-09-23** — `server/lib/automations-interrupteur.ts`, branché dans `handleEvent` et `processScheduledTasks`. Les deux tests T12.3 sont passés au VERT. |
| **F11/F13** — plafonds | Au-delà du plafond quotidien, les SMS sont retenus et reportés, jamais envoyés ; à 80 % une notification prévient l'administrateur | **ÉCARTÉ le 2026-09-23** — le scénario testé n'existe pas dans le produit, et le plafond serait un mauvais produit. Voir ci-dessous. |
| **F3, F5, F9, F18** — idempotence, reprise, outbox, destinataire | Voir les intitulés des tests | **non vérifié** |

`AUTOMATIONS_AUDIT.md` annonce plusieurs de ces failles comme « corrigé (M2) /
(M5) ». **Ce n'est pas le cas dans le code de `main`** au 2026-09-19 : ces
correctifs ont été planifiés ou faits sur une branche qui n'a jamais été
fusionnée. C'est précisément ce qu'un test exécutable évite, là où un document
affirme sans preuve.

⚠️ **F7 méritait une décision, pas juste un ticket** — et il l'a eue : voir le
tableau ci-dessus. Le risque légal (LCAP, loi 25) est traité.

## Pourquoi F11/F13 est ÉCARTÉ et non « à faire » (2026-09-23)

Le test simule 200 `lead.created` émis à la main, puis exige qu'un plafond
quotidien retienne les SMS au-delà d'une limite. **Les deux moitiés de cette
exigence sont fausses**, pour des raisons différentes.

**1. La rafale de 200 leads n'existe dans aucun chemin réel.** Vérifié :

- l'import de migration n'émet **aucun** événement — il écrit directement en
  base (`server/lib/migration/importer.ts`, `admin.from('clients')`), donc il
  ne déclenche aucune automatisation ;
- et même s'il en émettait, `server/lib/migration/gel-communications.ts` gèle
  toutes les communications du bureau dès le début d'un import final : aucun
  courriel, aucun SMS, aucune automatisation ne part vers ses clients tant que
  l'admin n'a pas cliqué « Activer le compte ». La garde s'applique **au
  destinataire**, dans les fonctions d'envoi elles-mêmes ;
- les vrais `lead.created` viennent de `server/routes/leads.ts` (saisie
  manuelle) et `server/routes/request-forms.ts` (un client remplit un
  formulaire) — **un à la fois**.

**2. Un plafond de volume serait un mauvais produit.** Ces SMS partent d'un
entrepreneur vers **ses propres clients**, et c'est lui qui les paie. Lui dire
« tu as atteint ta limite de messages à tes clients » serait radin et
injustifiable : ce n'est ni notre coût, ni notre business.

Ce qui protège réellement de l'emballement existe déjà : le **kill switch F6**
(`AUTOMATIONS_ENABLED=false`) arrête tout en une variable, sans perdre la file.

**Si ce test redevient pertinent un jour**, ce sera parce qu'un chemin réel
produit des rafales (un webhook entrant, une synchronisation externe). À ce
moment-là, la bonne réponse sera d'**étaler dans le temps** — tout part, mais
assez lentement pour qu'un humain puisse réagir — et non de refuser des envois.

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
