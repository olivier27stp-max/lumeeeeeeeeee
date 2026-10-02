# Mesures en production — 2026-10-01 (lecture seule)

Notes de travail pour `LUMI_BASELINE.md` et `LUMI_COST_REPORT.md`. Chaque mesure dit sa requête.

## C2 — le cache de la conversation saute dès que la minute change (CONFIRMÉ)

Source : `lumi_traces`, étage 6 (agent), Sonnet, conversations d'au moins 3 tours, 20 derniers jours. Colonnes : écart depuis le tour précédent (s), sous-agent, tokens d'entrée, écriture cache 5 min, écriture cache 1 h, lecture cache, sortie, coût (¢).

Conversation `c4f444` (11 tours, 22 à 38 s entre les tours) — écriture 5 min par tour :
2 088 → 3 635 → 4 813 → 6 251 → 7 097 → 7 192 → 7 392 → 7 545 → **1 789** → 9 103 → **1 207**.

L'écriture 5 min est le point de cache glissant sur les messages. Elle vaut la taille de TOUTE la conversation à chaque tour (elle croît de façon monotone), sauf aux tours 9 et 11 où elle retombe à ~1 500 : ce sont les tours partis dans la même minute d'horloge que le précédent. Le bloc système variable porte l'heure à la minute (`temps.ts`) et précède les messages : quand la minute change, le préfixe change et les messages ne sont plus relus.

Conséquence : à rythme humain (plus d'une minute entre deux messages), chaque tour réécrit toute la conversation à 1,25 × le tarif d'entrée au lieu de la relire à 0,1 ×. Pour une conversation de 7 000 tokens : ≈ 1,75 ¢ d'écriture contre ≈ 0,14 ¢ de lecture, à chaque message.

Piste (phase 6B, à mesurer contre la baseline) : garder dans le bloc système variable ce qui est stable pendant une conversation (entreprise, prénom, souvenirs, rôle) ; déplacer l'heure, les indices d'outils et le repérage dans un bloc de texte placé APRÈS le point de cache du dernier message utilisateur, et ne pas le sauvegarder dans l'historique.

## Changement de sous-agent = réécriture du préfixe

Mêmes données : chaque passage d'un sous-agent à un autre écrit un nouveau préfixe (colonne écriture 1 h à l'époque : facturation 16 066 à 21 555 tokens, planification 15 565, equipe 12 632, clients 12 792, devis 11 124), soit 6 à 9 ¢ le tour. Conversation `c4f444` : 5 changements de sous-agent en 11 tours = 5 réécritures.

## Dictée non débitée (S7 — CONFIRMÉ par les données)

- `ai_usage_source_check` (prod) : `lumi, support, migration, briefing, routeur, cache, automatisations`. Pas de `voix`.
- `lumi_traces` : 2 lignes `origine = 'voix'` en 7 jours ; `ai_usage` : aucune ligne de transcription (aucun modèle Gemini) sur 5 jours.
- La dictée du 2026-09-30 13:20 (Coquin lavage, 0,47 ¢ en trace) n'apparaît dans aucun grand livre.

## Réchauffeur de cache (C1 — NON confirmé)

`ai_usage` : aucune ligne `source = 'cache'` en 5 jours. Soit le réchauffeur est coupé en production (`LUMI_CACHE_CHAUD_MINUTES=0`), soit ses appels ne sont pas journalisés. À trancher en lisant les variables Railway ou les journaux du serveur.

## Plafond journalier (R4)

`lumi_traces` : 0 ligne `action = 'budget_epuise'` en 7 jours (465 traces). Jamais atteint sur la période ; la valeur réglée en production reste inconnue.

## Volume et coût (5 derniers jours, `ai_usage`, source `lumi`)

| Jour | Appels | Coût | Écriture cache | Lecture cache |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-01 (jusqu'à 14:30 UTC, surtout des passes de test) | 154 | 87,7 ¢ | 176 298 | 1 633 944 |
| 2026-09-30 | 17 | 47,6 ¢ | 70 903 | 153 313 |
