### Lecture

Coût mesuré par l'éval (une demande = une conversation neuve, cache de prompt chaud, palier normal), en dollars US pour 1 000 demandes. Une vraie conversation de plusieurs tours coûte davantage par demande ; l'ordre de grandeur relatif, lui, tient.

### Leviers déjà en place (vérifiés, rien à ajouter sans perte)

| Levier | État |
|---|---|
| Cache de prompt | En place (préfixe partagé entre orgs, TTL 5 min depuis #810) |
| Routage en 2 étapes | En place (`LUMI_ROUTEUR=actif` en prod : routeur Haiku, sous-agents à jeu d'outils réduit) |
| Schémas et résultats compacts | En place (résultats en table, vides retirés : −35 à −45 % de tokens sur les listes) |
| Chemins rapides à 0 token | En place (raccourcis, actions directes, caches exact et sémantique) — **resserrés** : ils ne répondent plus à un ordre |
| Plafond de tours | En place (8 étapes par tour, plafond d'écritures par conversation) |
| Modèle moins cher | **Non appliqué** : une passe au palier « restreint » (modèle moins cher, même jeu) a donné ≈ 4 $/1000 mais 72 % d'outil exact contre 82 % — indicatif seulement (code d'une vague antérieure), à re-mesurer proprement avant toute décision. Règle de la mission : aucune optimisation qui baisse l'éval. |

### Effet de l'audit sur le coût

Le coût par demande est quasi stable (+3 % mesuré). Les corrections ajoutent surtout des lectures en BASE (résolution des numéros, aperçus, vérifications), pas des tokens. La seule hausse de tokens est volontaire : un ordre ne reçoit plus une réponse toute faite à 0 ¢ (FAQ, raccourci, cache) — c'était une économie fausse, puisque la réponse était mauvaise.

### Recommandation

Aucun levier de coût supplémentaire n'est recommandé sans une nouvelle passe d'éval qui le valide. Le plus prometteur à tester : un sous-agent à jeu d'outils plus étroit pour les lectures simples (« c'est quoi mes jobs demain »), en gardant le modèle actuel pour tout ce qui écrit.
