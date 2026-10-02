Trouvé en lisant (en lecture seule) les journaux d'automatisation des bureaux réels en prod : des causes d'échec écrites par le moteur en anglais — « Review requests are disabled in Settings → Customer reviews. », « A review request was already sent to this client in the last 7 days. », « No org owner found to own the task »…

La liste et l'onglet « Journaux » de l'éditeur avaient **chacun leur traducteur**, tous deux incomplets. Dans l'onglet Journaux, une cause non reconnue sortait en anglais brut ; dans la liste, elle disparaissait (compteur seul).

## Ce qui change
- Les deux traducteurs connaissent maintenant les 14 messages anglais que le moteur peut écrire (demandes d'avis désactivées, déjà envoyée, ni courriel ni téléphone, propriétaire introuvable, élément disparu…), en français et en anglais lisible.
- Le traducteur de la liste quitte la page pour `src/lib/automationJournauxApi.ts`, à côté de son jumeau.
- **Le moteur n'est pas touché** : son classement « à réessayer / définitif » et des tests de la suite s'appuient sur ces textes.

## Test
`tests/automation/raisons-echec-traduites.test.ts` relit le source du moteur : tout littéral `error: '…'` en anglais doit être traduit par les deux traducteurs. Un message ajouté au moteur sans sa traduction fait échouer le test. Rouge avant (6 causes non traduites dans Journaux), vert après (41 tests).

Aucune migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
