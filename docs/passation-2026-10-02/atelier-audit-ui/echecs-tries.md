# Échecs triés — E2E de la section Automatisations (2026-10-02, 01 h 30 UTC)

Passe complète sur la pile locale, puis tri et relance dossier par dossier. Détail : un fichier par dossier dans
`D:/lume-uiaudit/sorties/triage/` (les mêmes entrent dans le dépôt sous `e2e/automations/_tri/`).

| Dossier | Tests | Verts | Rouges `@defaut` (défaut du produit) | Défauts distincts | Fiche |
|---|---|---|---|---|---|
| banc + moteur | 6 | 6 | 0 | 0 | — |
| actions | 177 | 143 | 34 | 27 | `triage/actions.md` |
| declencheurs | 123 | 95 | 28 | 28 | `triage/declencheurs.md` |
| editeur | 184 | 135 | 49 | ≈ 47 | `triage/editeur.md` |
| liste | 205 | 156 | 49 | 41 | `triage/liste.md` |
| modeles | 222 | 173 | 49 | ≈ 49 | `triage/modeles.md` |
| roles | 141 | 114 | 27 | 27 | `triage/roles.md` |
| **Total** | **1 058** | **822** | **236** | **≈ 220** | |

- Aucun test rouge sans marque `@defaut` ; aucun `@defaut` vert. 81 marques retirées (défauts corrigés par les lots 1 à 5).
- Specs réparées parce que le produit avait changé exprès : 5 (actions) + 13 (déclencheurs) + 20 (éditeur) + 23 (liste) + 69 (modèles) + 13 (rôles).
- Environnement : 3 échecs de poste rejoués verts (2 × `ERR_NO_BUFFER_SPACE`, 1 × verrou de session « Lock broken… ») ;
  `[BANC-010]` dépendait de l'heure (texto reporté hors 8 h – 20 h) : passé à un courriel immédiat.
- Le 95 / 28 des déclencheurs est déduit (96 / 27 relancé, puis un test remis en `@defaut` sur décision de la session 98).
- Écritures directes en base : `node scripts/qa/verifier-garde-automatisations.mjs` 16/16 ; `--etendue` (état visé) 10/20.
