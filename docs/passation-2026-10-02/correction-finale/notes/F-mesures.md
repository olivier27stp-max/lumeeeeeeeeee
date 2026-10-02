# F — Mesures : ce que coûte Lumi sur les automatisations

Agent F, 2026-10-01. Vrai modèle, pile locale (`lumefinal-*`), API locale du worktree `wt-f` (ports 3496 et 5496), bureaux « [TEST] QA Automatisations A/B (f) ». Aucune requête vers la prod ni staging.

Tous les montants sont en cents US de coût réel d'inférence, relus dans le grand livre (`ai_usage`) de la base locale après chaque appel. 1 crédit = 3 ¢. Le coût général de Lumi est déjà établi dans `LUMI_COST_REPORT.md` et `LUMI_BASELINE.md` : ce document les cite et mesure ce qui leur manque pour les automatisations.

Dépense totale de mes mesures : **1,37 $** (0,41 $ par l'API locale, 0,96 $ par les essais comparés), sur un plafond de 6 $.

## 1. Ce qu'il faut retenir

- **Deux chemins, deux prix.** La même conversation de six tours sur une automatisation coûte **3,56 ¢ dans le panneau « Construire avec Lumi » de l'éditeur** et **9,75 ¢ dans le clavardage de Lumi** (2,7 fois plus), en 24 s contre 62 s.
- **L'objectif de 80 % de lecture en cache est tenu** en multi-tours : 92,0 % (clavardage), 93,1 % (panneau).
- **Le débit de crédits est exact** sur les deux chemins : 46 lignes du grand livre, écart maximal entre le coût recalculé depuis les tokens et le coût écrit : 0,00004 ¢ ; crédits débités = coût ÷ 3 ¢ au micro-crédit près.
- **Dans le panneau, 75 % du coût est de la sortie** (le parcours entier réécrit à chaque tour, même pour une question). **Dans le clavardage, 48 % est de l'écriture en cache** et 28 % du coût total part dans une génération imbriquée que ni la trace ni les plafonds ne voient.
- **Activer, mettre en pause, renommer coûtent 0 ¢** par les boutons de l'interface et par la phrase exacte « Active l'automatisation X » ; « active-la » dans une conversation coûte 0,70 ¢.
- **Le panneau ne sait pas modifier les deux plus grosses automatisations du pack de base** (17 et 23 étapes) : la demande échoue et coûte 3,4 à 3,6 ¢ à l'entreprise (constat F-03).
- **Un usage « automatisations » plausible consomme 0,7 % à 27 % de l'allocation mensuelle** (1 000 crédits = 30 $ US de coût réel).

## 2. Ce qui est déjà instrumenté, par chemin

| Donnée | Clavardage (`/api/lumi/chat`, puis `/api/lumi/execute`) | Panneau de l'éditeur (`POST /api/automations/rules/generer`) |
|---|---|---|
| Tokens d'entrée, lus en cache, sortie | `lumi_traces` (par tour) et `ai_usage` (par appel) | `ai_usage` seulement |
| Écriture en cache 5 min / 1 h | `lumi_traces.cache_5m`, `cache_1h` ; total seul dans `ai_usage` | total seul dans `ai_usage` (toujours 5 min ici) |
| Modèle | oui (trace : celui du dernier appel) | oui (`ai_usage`) |
| Outils chargés | `params.mesure.outils_charges` (33 avec le sujet « rapports », 15 au jeu de base) | sans objet (aucun outil) |
| Outils appelés | `outils` = les lectures ; l'écriture proposée est dans `action` ; une écriture exécutée d'office n'apparaît pas (U7 : la trace porte `{list_automations}`, pas `rename_automation_rule`) | aucun journal |
| Latence | `duree_ms` (hors routeur), `params.mesure.premier_token_ms` | **rien** |
| Coût réel | `ai_usage` complet ; `lumi_traces.cost_cents` exclut le routeur (0,155 à 0,168 ¢ par tour) et la génération imbriquée (jusqu'à 3,25 ¢) | `ai_usage` complet ; **aucune ligne dans `lumi_traces`** |
| Rattachement | `conversation_id` partout, sauf la génération imbriquée (`conversation_id` nul) | `conversation_id` nul ; aucun lien avec l'automatisation ouverte |
| Résultat, échec | `resultat`, `params.mesure.stop_reason` | **rien** : un refus 422 ne laisse qu'une ligne dans les journaux du serveur |
| Débit de crédits | exact | exact (source `automatisations`) |
| Plafonds | par tour (6 ¢), par conversation (40 ¢), journalier de plateforme — tous aveugles à la génération imbriquée | budget de l'entreprise seulement (réservation) ; aucun plafond de plateforme |

Écarts relevés par la passe (script `mesurer.mts`, note automatique sur chaque ligne) :
- 16 lignes du grand livre sur 16 de source `automatisations` sont **sans conversation** ;
- 11 appels du panneau sur 11 : **aucune ligne dans `lumi_traces`** ;
- création par le clavardage : la trace du tour dit 0,626 ¢, le grand livre 3,579 ¢ (U2) ; 1,002 ¢ contre 4,421 ¢ (C1, tour 4).

## 3. Baseline — demandes unitaires

Une demande = le message, puis le clic sur Confirmer quand une carte est proposée. Cache chaud, sauf U1 (premier appel de la passe : 11 722 tokens de préfixe écrits, soit 2,93 ¢ de démarrage à froid).

| Demande | Chemin | Coût (¢) | Crédits | Entrée | Cache lu | Cache écrit (5 min) | Sortie | Lu en cache | Latence (s) | Modèles | Appels | Outils chargés | Carte ou outils |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| U1 Créer une automatisation simple | clavardage | 3,646 | 1,215 | 743 | 12 786 | 11 722 | 467 | 50,6 % | 5,9 | Haiku 4.5 + Sonnet 5 | 3 | 33 | `create_automation_from_text` |
| U2 Créer un gros parcours (2 conditions) | clavardage | 3,579 | 1,193 | 887 | 23 922 | 668 | 2 920 | 93,9 % | 24,8 | Haiku 4.5 + Sonnet 5 | 3 | 33 | `create_automation_from_text` |
| U3 Changer le texto | clavardage | 1,309 | 0,436 | 918 | 29 613 | 1 826 | 235 | 91,5 % | 5,1 | Haiku 4.5 + Sonnet 5 | 3 | 33 | `update_automation_sms_body` |
| U4 Changer l'objet et le corps du courriel | clavardage | 1,379 | 0,460 | 937 | 29 641 | 1 854 | 296 | 91,4 % | 4,8 | Haiku 4.5 + Sonnet 5 | 3 | 33 | `update_automation_message` |
| U5 Activer (« Active l'automatisation X ») | clavardage | 0 | 0 | 0 | 0 | 0 | 0 | — | 0,4 | aucun | 0 | — | action directe, `toggle_automation_rule` |
| U6 Mettre en pause | clavardage | 0 | 0 | 0 | 0 | 0 | 0 | — | 0,6 | aucun | 0 | — | action directe, `toggle_automation_rule` |
| U7 Renommer | clavardage | 1,695 | 0,565 | 1 096 | 42 509 | 2 092 | 257 | 93,0 % | 5,6 | Haiku 4.5 + Sonnet 5 | 4 | 33 | exécuté sans carte |
| U8 « Explique-moi ce que fait X » | clavardage | 1,328 | 0,443 | 937 | 29 573 | 1 816 | 250 | 91,5 % | 4,8 | Haiku 4.5 + Sonnet 5 | 3 | 33 | `list_automations` (réponse sans contenu, F-15) |
| P1 Créer une automatisation simple | panneau | 0,438 | 0,146 | 37 | 6 058 | 0 | 309 | 99,4 % | 2,8 | Sonnet 5 | 1 | — | — |
| P2 Créer un gros parcours | panneau | 1,067 | 0,356 | 120 | 6 058 | 0 | 922 | 98,1 % | 7,7 | Sonnet 5 | 1 | — | — |
| P3 Changer le texto | panneau | 0,644 | 0,215 | 408 | 6 058 | 0 | 441 | 93,7 % | 3,9 | Sonnet 5 | 1 | — | — |
| P4 Changer l'objet et le corps du courriel | panneau | 0,561 | 0,187 | 435 | 6 058 | 0 | 353 | 93,3 % | 3,0 | Sonnet 5 | 1 | — | — |
| P8 « Explique-moi ce que fait cette automatisation » | panneau | 0,654 | 0,218 | 375 | 6 058 | 0 | 458 | 94,2 % | 4,0 | Sonnet 5 | 1 | — | — |

Dans le panneau, activer, mettre en pause et renommer sont des boutons : `PATCH /api/automations/rules/:id` et `POST …/publication`, 0 appel au modèle, 0,02 à 0,2 s (vérifié : aucune ligne `ai_usage` ni `lumi_traces`).

Remarques :
- **U2 contre P2 : la même demande, 3,58 ¢ contre 1,07 ¢.** Dans le clavardage, l'outil de création relance le générateur du panneau au moment de Confirmer : cette génération imbriquée a sorti 2 640 tokens (2,79 ¢, 21 s) là où le panneau en a sorti 922 pour la même phrase. L'écart est de la réflexion du modèle, que rien ne borne (F-05).
- **U3, U4, U7, U8 : le premier appel de l'agent ne sert qu'à retrouver l'automatisation par son nom** (`list_automations`, 0,44 à 0,47 ¢, 1 170 tokens de résultat).
- **Le routeur (Haiku) est appelé à chaque message** : 0,155 à 0,168 ¢, 1,1 à 1,7 s.

## 4. Baseline — conversations de 6 tours

Même enchaînement sur les deux chemins : « change le message » → « plus court » → « ajoute un délai de 3 jours » → « seulement pour les clients avec l'étiquette commercial » → « explique-moi ce qu'elle fait » → « active-la ».

### Clavardage de Lumi

| Tour | Coût (¢) | Crédits | Entrée | Cache lu | Cache écrit | Sortie | Lu en cache | Latence (s) | Appels | Outils chargés | Ce qui s'est passé |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 change le message | 1,453 | 0,484 | 884 | 29 581 | 1 736 | 406 | 91,9 % | 6,2 | 3 | 33 | carte `update_automation_sms_body`, confirmée |
| 2 plus court | 0,701 | 0,234 | 534 | 19 600 | 565 | 220 | 94,7 % | 3,7 | 2 | 33 | carte, confirmée |
| 3 ajoute un délai de 3 jours | 1,605 | 0,535 | 1 811 | 25 258 | 2 432 | 287 | 85,6 % | 5,2 | 2 | **15** | « il faut refaire la règle au complet » ; le routeur hésite (0,72), le jeu d'outils change |
| 4 seulement l'étiquette commercial | 4,421 | 1,474 | 896 | 26 223 | 1 532 | 3 501 | 91,5 % | 37,1 | 3 | 33 | **crée une NOUVELLE automatisation**, sans le filtre (F-14) ; génération imbriquée 3,25 ¢ |
| 5 explique-moi ce qu'elle fait | 0,872 | 0,291 | 528 | 21 697 | 819 | 286 | 94,2 % | 5,0 | 2 | 33 | explique la nouvelle, dit que le filtre n'a pas pu être posé |
| 6 active-la | 0,701 | 0,234 | 707 | 22 516 | 204 | 227 | 96,1 % | 4,7 | 2 | 33 | carte `toggle_automation_rule`, confirmée : la nouvelle part à TOUS les clients |
| **Total** | **9,752** | **3,252** | 5 360 | 144 875 | 7 288 | 4 927 | **92,0 %** | **61,9** | 14 | | |

### Panneau « Construire avec Lumi »

| Tour | Coût (¢) | Crédits | Entrée | Cache lu | Cache écrit | Sortie | Lu en cache | Latence (s) | Ce qui s'est passé |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 change le message | 0,381 | 0,127 | 189 | 6 058 | 0 | 222 | 97,0 % | 2,8 | texto réécrit |
| 2 plus court | 0,606 | 0,202 | 456 | 6 058 | 0 | 394 | 93,0 % | 4,3 | texto raccourci |
| 3 ajoute un délai de 3 jours | 0,649 | 0,216 | 538 | 6 058 | 0 | 420 | 91,8 % | 4,5 | attente ajoutée |
| 4 seulement l'étiquette commercial | 0,768 | 0,256 | 629 | 6 058 | 0 | 521 | 90,6 % | 5,6 | refus (à tort, F-18) ; le parcours entier est réécrit quand même |
| 5 explique-moi ce qu'elle fait | 0,469 | 0,156 | 443 | 6 058 | 0 | 259 | 93,2 % | 2,7 | explication juste ; parcours réécrit |
| 6 active-la | 0,687 | 0,229 | 421 | 6 058 | 0 | 482 | 93,5 % | 4,5 | « fais-le avec le bouton » ; parcours réécrit |
| **Total** | **3,560** | **1,186** | 2 676 | 36 348 | 0 | 2 298 | **93,1 %** | **24,4** | |

## 5. Où part le coût

Sur toute la passe de baseline et l’épreuve des gros parcours (46 appels, 36,65 ¢ dans le bureau A) :

| Poste | Appels | Coût (¢) | Entrée plein tarif | Lecture en cache | Écriture en cache | Sortie |
|---|---:|---:|---:|---:|---:|---:|
| Agent du clavardage (Sonnet 5) | 18 | 14,32 | 0,94 (7 %) | 4,28 (30 %) | 6,82 (48 %) | 2,28 (16 %) |
| Panneau de l'éditeur (Sonnet 5) | 13 | 13,96 | 1,90 (14 %) | 1,58 (11 %) | 0 | **10,48 (75 %)** |
| Génération imbriquée dans le clavardage (Sonnet 5) | 3 | 6,45 | 0,07 | 0,36 | 0 | **6,03 (93 %)** |
| Routeur (Haiku 4.5) | 12 | 1,92 | 0,59 | 0,81 | 0 | 0,52 |

Sur le chemin du clavardage (22,69 ¢) : agent 63 %, génération imbriquée 28 %, routeur 8,4 %. L'écriture en cache de l'agent comprend le démarrage à froid de U1 (2,93 ¢) ; sans lui : 3,89 ¢.

### Tailles de ce qui part au modèle (comptage gratuit, script `compter.mts`)

| Élément | Tokens |
|---|---:|
| Prompt système de « Construire avec Lumi » (`consignes()`), français / anglais | 6 056 / 5 706 |
| Prompt système de l'agent, bloc stable / bloc variable avec le sujet « rapports » | 4 544 / 399 |
| Jeu d'outils chargé avec le sujet « rapports » (33 outils, dont les 13 d'automatisation) | 6 275 |
| Les 13 outils d'automatisation ensemble (165 à 342 chacun) | 2 663 |
| Jeu de base (15 outils) | 3 188 |
| Préfixe lu en cache par un appel de l'agent, sujet « rapports » (mesuré) | 11 136 |

Le prompt du panneau ne dépend que de la langue : le même bloc est relu en cache pour toutes les entreprises (6 058 tokens lus dès mon premier appel, écrits par une autre session). Aucun contenu variable avant le point de cache.

### Le parcours ouvert, tel qu'il est envoyé au panneau à chaque tour

Le panneau reçoit le JSON complet du parcours à chaque tour (pas un résumé), coupé à 6 000 caractères, et doit le réécrire en entier dans sa réponse (plafond de sortie : 4 000 tokens). Le clavardage, lui, ne reçoit aucun contexte de page.

| Parcours | Étapes | Caractères | Coupé à 6 000 ? | Étapes lisibles dans l'envoi | Tokens envoyés | Tokens du parcours entier | Tokens de la réponse attendue | Dépasse 4 000 ? |
|---|---:|---:|---|---:|---:|---:|---:|---|
| Synthétique, messages courts | 5 | 1 029 | non | 5 | 502 | 466 | 638 | non |
| Synthétique, messages courts | 15 | 3 025 | non | 15 | 1 398 | 1 362 | 1 754 | non |
| Synthétique, messages courts | 30 | 5 886 | non | 30 | 2 676 | 2 640 | 3 360 | non |
| « Dépôt — demande et rappel » (pack de base) | 6 | 2 509 | non | 6 | 1 128 | 1 092 | 1 327 | non |
| « Rendez-vous — confirmation et rappels » (pack) | 10 | 4 778 | non | 10 | 2 162 | 2 126 | 2 506 | non |
| « Nouveau prospect — bienvenue et suivis » (pack) | 11 | 4 859 | non | 11 | 2 150 | 2 114 | 2 519 | non |
| « Relance de facture — 3, 7, 14 et 30 jours » (pack) | 17 | 8 278 | **oui** | 14 | 2 714 | 3 675 | 4 273 | **oui** |
| « Relance de devis — 1, 2, 5, 10 et 30 jours » (pack) | 23 | 8 741 | **oui** | 17 | 2 707 | 3 876 | 4 599 | **oui** |
| Le parcours de 23 étapes prolongé à 30 (maximum accepté) | 30 | 11 770 | **oui** | 17 | 2 707 | 5 215 | 6 095 | **oui** |

Épreuve réelle (script `gros-parcours.mts`, « Change le premier délai à 2 jours. ») :

| Parcours | Étapes | Réponse | Étapes rendues | Sortie (tokens) | Coût (¢) | Crédits débités | Latence (s) |
|---|---:|---|---:|---:|---:|---:|---:|
| Relance de facture — 3, 7, 14 et 30 jours | 17 | 422 « Lumi a proposé un parcours que le moteur ne saurait pas exécuter » | 0 | 2 746 | 3,414 | 1,138 | 17,4 |
| Relance de devis — 1, 2, 5, 10 et 30 jours | 23 | 422, même message | 0 | 2 953 | 3,619 | 1,206 | 18,3 |

Journal du serveur : « le champ Objet est obligatoire », « l'étape e16 renvoie vers e18, qui n'existe pas » — le modèle a reçu un parcours coupé au milieu d'une étape.

### Résultats d'outils d'automatisation, tels que donnés au modèle (script `resultats-outils.mts`)

| Outil | Tokens du résultat | Tokens des arguments |
|---|---:|---:|
| `list_automations` (40 automatisations, table compacte) | 1 123 à 1 184 | 2 |
| `create_automation_from_text` | 409 à 585 | 111 |
| `update_automation_message` | 259 | 92 |
| `update_automation_sms_body` | 235 à 271 | 80 |
| `rename_automation_rule` | 206 | 28 |
| `toggle_automation_rule` | 172 à 180 | 26 |

Les écritures rendent un reçu court, jamais toute l'automatisation. Seul `list_automations` pèse : il rend toujours toute la liste, sans filtre par nom.

## 6. Essais comparés sur l'appel du panneau (script `ab-generer.mts`)

Huit demandes fixes, deux passes, jugées par du code (JSON lisible, validation du moteur, variables connues, puis 3 à 6 contrôles propres à chaque demande). Coût « à chaud » : le prompt système lu en cache, pour comparer sans effet d'ordre. Une première passe a été écartée : mes contrôles comparaient au parcours brut au lieu du parcours validé (fichier `f-ab-generer-passe0-controles-trop-stricts.json`).

| Variante | Essais | Réussis | « Actuel » sur les mêmes cas | Coût à chaud (¢) | « Actuel », mêmes cas (¢) | Sortie moyenne | dont réflexion | Latence (s) | « Actuel » (s) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Actuel (ni `thinking` ni `effort` précisés) | 16 | 14 | — | 0,926 | — | 730 | 154 | 5,8 | — |
| Effort bas (`thinking: adaptive`, `effort: low`) | 16 | 15 | 14 | 0,729 | 0,926 | 533 | 0 | 4,2 | 5,8 |
| Effort moyen | 16 | 15 | 14 | 0,729 | 0,926 | 533 | 5 | 4,3 | 5,8 |
| Haiku 4.5 (demandes de structure et questions seulement) | 8 | 8 | 8 | 0,263 | 0,945 | 335 | 0 | 2,8 | 5,3 |
| Question sans réécriture du parcours (`"steps": null`) | 4 | 4 | 4 | 0,520 | 1,316 | 218 | 51 | 2,7 | 7,3 |

Par demande (coût à chaud · tokens de sortie · latence · réussis) :

| Demande | Actuel | Effort bas | Effort moyen | Haiku 4.5 | Sans réécriture |
|---|---|---|---|---|---|
| Créer, simple | 0,407 ¢ · 279 · 2,7 s · 0/2 | 0,379 ¢ · 250 · 2,5 s · 2/2 | 0,412 ¢ · 283 · 2,7 s · 2/2 | — | — |
| Créer, gros parcours | 1,347 ¢ · 1 202 · 9,4 s · 2/2 | 0,966 ¢ · 821 · 6,4 s · 2/2 | 0,884 ¢ · 739 · 6,1 s · 1/2 | — | — |
| Rappel de rendez-vous la veille | 0,385 ¢ · 258 · 2,4 s · 2/2 | 0,389 ¢ · 262 · 2,6 s · 2/2 | 0,384 ¢ · 257 · 2,4 s · 2/2 | — | — |
| « Plus court » (rédaction) | 1,491 ¢ · 1 291 · 10,4 s · 2/2 | 0,561 ¢ · 362 · 3,1 s · 2/2 | 0,606 ¢ · 407 · 3,7 s · 2/2 | — | — |
| Changer un délai | 0,582 ¢ · 383 · 3,3 s · 2/2 | 0,582 ¢ · 383 · 3,1 s · 2/2 | 0,582 ¢ · 383 · 3,1 s · 2/2 | 0,279 ¢ · 400 · 2,7 s · 2/2 | — |
| Ajouter un filtre de montant | 0,564 ¢ · 399 · 3,5 s · 2/2 | 0,434 ¢ · 269 · 2,6 s · 2/2 | 0,458 ¢ · 293 · 2,8 s · 2/2 | 0,233 ¢ · 336 · 3,1 s · 2/2 | — |
| Expliquer (4 étapes) | 0,687 ¢ · 488 · 4,2 s · 2/2 | 0,671 ¢ · 471 · 4,1 s · 1/2 | 0,660 ¢ · 460 · 3,9 s · 2/2 | 0,314 ¢ · 471 · 3,2 s · 2/2 | 0,401 ¢ · 201 · 2,5 s · 2/2 |
| Question (15 étapes) | 1,945 ¢ · 1 541 · 10,3 s · 2/2 | 1,851 ¢ · 1 447 · 9,3 s · 2/2 | 1,846 ¢ · 1 442 · 9,6 s · 2/2 | 0,225 ¢ · 135 · 2,0 s · 2/2 | 0,639 ¢ · 234 · 3,0 s · 2/2 |

Lecture :
- **La réflexion non bornée fait 21 % de la sortie de l'appel actuel**, concentrée sur 7 appels sur 16 (jusqu'à 984 tokens). En conditions réelles elle monte plus haut : 2 640 tokens de sortie pour U2, 3 200 environ pour le tour 4 de la conversation (une automatisation de 2 étapes : 3,25 ¢ et 30 s).
- **Les échecs ne distinguent pas les variantes.** « Actuel » : deux textos de relance sans le lien du devis. « Effort bas » : une explication juste, mais qui dit « texte le client » au lieu de « texto » (mon contrôle par mot est trop strict). « Effort moyen » : un JSON illisible (le code relance alors une fois).
- **16 essais par variante, c'est peu** : ces chiffres disent qu'aucune baisse de qualité n'apparaît, pas qu'il n'y en a aucune. À confirmer avec la batterie existante `npm run qa:construire-lumi` (conversations de correction, vouvoiement, variables) avant de livrer.
- **Haiku** rend ici 8 sur 8 sur les demandes de structure et les questions, mais c'est un échantillon de 8, et le code note une mesure contraire sur la rédaction (2026-09-30, `generer-parcours.ts:32-42` : textes plats, ouverture retirée). Sur la question à 15 étapes, Haiku n'a pas réécrit le parcours de lui-même, d'où son prix.
- Toutes les variantes, « actuel » compris, écrivent parfois « s'il n'a toujours pas réagi » pour une attente simple : l'explication invente une condition qui n'existe pas. Hors de mon domaine, noté pour l'agent chargé de Lumi.

## 7. Recherche d'outils : état actuel (script `recherche-outils.mts`)

API relancée avec `LUMI_ROUTEUR=off` : chaque tour part avec le jeu de base (15 outils), les outils d'automatisation sont différés et trouvés par `tool_search_tool_regex`.

| Demande | Sujet « rapports » chargé (routeur actif) | Jeu de base + recherche d'outils |
|---|---|---|
| Changer le texto | 1,309 ¢ · 3 appels (dont le routeur) · 5,1 s | 1,549 ¢ · 2 appels · 4,9 s |
| Renommer | 1,695 ¢ · 4 appels · 5,6 s | 1,706 ¢ · 3 appels · 6,8 s |

Détail du premier appel avec recherche : 1 158 tokens d'entrée au plein tarif, 16 408 lus en cache, 310 écrits. Appel suivant : 238 au plein tarif, 8 359 lus en cache. **La recherche d'outils ne casse plus le cache du prompt** : le préfixe est relu en cache après la découverte. Le commentaire de `server/lib/lumi/sous-agents.ts:37-43` (27 000 à 30 000 tokens relus au plein tarif, mesure du 2026-09-16) ne décrit plus le comportement d'aujourd'hui ; celui de `orchestrateur.ts:20-28` est juste. Pour autant la recherche n'apporte rien ici : même prix, un appel de recherche en plus.

## 8. Crédits

### Débit contre coût réel (46 lignes, bureau A)

| Source | Modèle | Lignes | Coût écrit (¢) | Coût recalculé depuis les tokens (¢) | Écart maximal par ligne (¢) | Micro-crédits débités | Micro-crédits attendus (coût ÷ 3 ¢) |
|---|---|---:|---:|---:|---:|---:|---:|
| `automatisations` | Sonnet 5 | 16 | 20,4118 | 20,4112 | 0,00004 | 6 803 934 | 6 803 933 |
| `lumi` | Haiku 4.5 (routeur) | 12 | 1,9149 | 1,9147 | 0,00002 | 638 301 | 638 300 |
| `lumi` | Sonnet 5 | 18 | 14,3191 | 14,3191 | 0,00004 | 4 773 033 | 4 773 033 |

Par ligne, le débit égale l'arrondi de coût × 1 000 000 ÷ 3 dans tous les cas (écart maximal : 0). Les 12 lignes du routeur n'ont pas d'identifiant de requête : elles ne sont pas protégées contre un double débit en cas de rejeu.

### Solde affiché contre solde en base (script `ecran.mts`, vrai navigateur)

| Bureau | À l'écran (page Lumi) | En base | Accord |
|---|---|---|---|
| A | « 987 / 1 000 crédits Lumi · renouvellement le 1 nov. » | 12 215 268 micro-crédits utilisés, soit 987 restants | oui |
| B, épuisé | « 0 / 1 000 crédits Lumi · renouvellement le 1 nov. » | 1 533 385 200 micro-crédits utilisés | oui |

L'API rend « utilisés 12, restants 987 » : les deux nombres sont arrondis vers le bas, leur somme fait 999. L'écran n'affiche que les restants et le total.

### Blocage à zéro (script `credits.mts`, bureau B)

| Dépense du bureau | Crédits vus | Création par le clavardage | Création par le panneau | Action rapide « Active l'automatisation X » |
|---|---|---|---|---|
| 3 100 ¢ (les 1 000 crédits sont consommés) | 0 restant, palier « épuisé » | « Tes crédits Lumi sont épuisés jusqu'au 1er novembre. Les actions rapides et le reste de Lume marchent toujours. » — mais **1 appel au routeur, 0,156 ¢ débité** | **parcours généré, 0,354 ¢ débité** (voir l'anomalie d'atelier ci-dessous) | carte servie, 0 appel |
| 4 600 ¢ | 0 restant | même message ; encore 0,156 ¢ débité pour le routeur | 422 « Le budget Lumi du mois est atteint. Le parcours peut être construit à la main avec le « + ». » — 0 appel, 0 ¢, brouillon vide retiré | carte servie, 0 appel |

À l'écran, bureau épuisé : bandeau « Tes crédits Lumi sont épuisés jusqu'au 1 nov. Les actions rapides et tout le reste de Lume fonctionnent toujours. », champ de saisie désactivé (« Crédits Lumi épuisés jusqu'au 1 nov. »). Dans l'éditeur d'automatisations : le champ reste actif, et le refus arrive dans une bulle après le clic, avec le mot « budget ».

### Montants en dollars

Aucun montant (« $ », « ¢ », « cents », « dollars ») dans : la page Lumi, la liste des automatisations, l'éditeur ouvert sur « Construire avec Lumi » (texte du panneau : « Déduit de tes crédits Lumi »), les flux de `/api/lumi/chat`, les réponses de `/api/automations/rules/generer`, les messages d'épuisement. Le champ `cout_cents` déclaré dans `src/lib/automationBuilderApi.ts:337` n'est jamais rempli par le serveur.

### L'allocation réelle

| Forfait | `includes_ai` | `lumi_credits_mensuels` | `ai_monthly_budget_cents` (ancienne colonne) |
|---|---|---:|---:|
| starter | non | 0 | 0 |
| pro | non | 0 | 0 |
| autopilot | oui | 1 000 | 4 500 |

1 000 crédits × 3 ¢ (`lumi_credit_taux`, version 2026-10) = 3 000 ¢ : **l'allocation est bien de 30 $ US de coût réel par période**. L'ancienne colonne dit encore 45 $ ; `server/lib/lumi/briefing.ts:223-226` la lit toujours pour savoir quels bureaux reçoivent le briefing.

## 9. Projection : coût mensuel par entreprise pour un usage « automatisations »

Coûts unitaires retenus (mesurés, cache chaud) :

| Geste | Panneau | Clavardage |
|---|---:|---:|
| Créer une automatisation | 0,44 ¢ (simple) à 1,07 ¢ (grosse) | 3,6 ¢ (0,6 à 1,0 ¢ de tour d'agent, 0,16 ¢ de routeur, 0,4 à 3,3 ¢ de génération imbriquée) |
| Modifier un message | 0,56 à 0,64 ¢ | 1,31 à 1,45 ¢ (premier message), 0,70 ¢ (suite de conversation) |
| Conversation de 6 tours | 3,56 ¢ | 9,75 ¢ |
| Activer, mettre en pause, renommer | 0 ¢ (boutons) | 0 ¢ (phrase exacte) à 0,70 ¢ (« active-la ») ; renommer 1,70 ¢ |
| Reprise après plus de 5 minutes sans appel | +1,39 ¢ (6 058 tokens réécrits — calculé, non observé : une autre session tenait le cache chaud) | +2,93 ¢ (11 722 tokens réécrits — mesuré, U1) |

Hypothèses (les miennes, à discuter) :

| Profil | Créations | Modifications | Conversations de 6 tours | Reprises à froid | Par le panneau | Par le clavardage | Part des 30 $ |
|---|---:|---:|---:|---:|---:|---:|---:|
| Entreprise installée (retouches) | 2 | 6 | 2 | 6 | 21 ¢ (7 crédits) | 52 ¢ (17 crédits) | 0,7 à 1,7 % |
| Mois de mise en place | 10, dont 3 grosses | 30 | 8 | 15 | 74 ¢ (25 crédits) | 198 ¢ (66 crédits) | 2,5 à 6,6 % |
| Usage intensif (plusieurs bureaux, tout refait) | 40 | 150 | 30 | 60 | 305 ¢ (102 crédits) | 815 ¢ (272 crédits) | 10 à 27 % |

Calcul du profil « mise en place », panneau : 7 × 0,44 + 3 × 1,07 + 30 × 0,60 + 8 × 3,56 + 15 × 1,39 = 73,6 ¢ ; clavardage : 10 × 3,6 + 30 × 1,35 + 8 × 9,75 + 15 × 2,93 = 198,5 ¢.

Avec 30 $, une entreprise peut tenir environ 840 conversations de 6 tours dans le panneau, ou 300 dans le clavardage. Les automatisations seules n'approchent pas l'allocation ; le reste de Lumi coûte 1,1 à 3,6 ¢ la demande (`LUMI_COST_REPORT.md`).

Deux garde-fous à connaître :
- la garde quotidienne de l'entreprise (15 % du mois, soit 150 crédits ou 4,50 $ par jour) ferait passer au modèle de repli une journée de mise en place d'environ 46 conversations par le clavardage ;
- un essai raté sur un gros parcours coûte 3,4 à 3,6 ¢ à chaque fois (F-03) : dix essais valent une conversation complète du clavardage, pour rien.

## 10. Anomalies d'atelier (pour le coordinateur, pas des défauts du produit)

1. **La pile locale porte l'ANCIENNE fonction `reserve_ai_budget`** (budget en dollars de 45 $, mois civil, support compté). Cause : `supabase/migrations/proposed/20261005100000_lumi_credits.down-reference.sql`, un fichier marqué « NE PAS APPLIQUER », figure en dernière ligne de `sorties/migrations-post-baseline.txt` et a ramené quatre fonctions (`reserve_ai_budget`, `lumi_depense_du_mois`, `lumi_periode_courante()`, `settle_ai_budget`) à leur définition du 2026-09-30. Conséquence : sur cette pile, le panneau n'est bloqué qu'à 45 $ alors que l'écran dit « 0 crédit » dès 30 $. Tout test de crédits ou de budget joué sur la pile locale est faussé tant que les définitions de `20261005200000_lumi_credits.sql` et `20261005500000_lumi_credits_rendus.sql` n'ont pas été réappliquées. Je n'ai pas touché au schéma partagé.
2. **`outils/env-local.mjs` écrit une `PAYMENTS_ENCRYPTION_KEY` en hexadécimal** (64 caractères) : l'API refuse de démarrer (« Expected 32 bytes, got 48 »). J'ai remplacé la valeur dans `wt-f/.env.local` par une clé locale jetable en base64. `wt-b/.env.local` avait encore l'ancienne valeur au moment de ma vérification.
3. **`outils/serveurs.mjs` laisse Vite tourner quand l'API plante au démarrage** : le port reste pris par un Vite orphelin (je l'ai arrêté par son PID).
4. La pile locale n'a pas de service temps réel : chaque page affiche des erreurs de WebSocket dans la console. Attendu ici, à ne pas compter comme défaut.

## 11. Ce que je n'ai pas pu mesurer

- **Le comportement réel de la prod à zéro crédit pour le panneau** : il dépend de la version de `reserve_ai_budget` en prod, que je n'ai pas le droit de lire. À vérifier en lecture seule : la définition de la fonction contient-elle `lumi_credits_mensuels` ?
- **Le démarrage à froid du panneau** : calculé (1,39 ¢), jamais observé, d'autres sessions tenant le cache chaud avec la même clé.
- **La qualité des optimisations proposées au-delà de 16 essais** : la batterie `qa:construire-lumi` n'a pas été rejouée (elle appelle le code du produit, que je ne modifie pas).
- **L'effet sur la qualité** du repérage des automatisations par le code, du sujet par règle et du sous-agent conservé : ces trois pistes demandent une modification du produit pour être éprouvées. Leur gain de coût est mesuré, leur effet sur la qualité ne l'est pas.
- **L'anglais** : toutes les mesures sont en français.
- **Les paliers dégradés** (Haiku à 70 % du budget) sur les demandes d'automatisation.

## 12. Fichiers

Scripts (worktree `wt-f`, `scripts/qa/finale/f/`) : `commun.mts`, `mesurer.mts`, `compter.mts`, `ab-generer.mts`, `gros-parcours.mts`, `resultats-outils.mts`, `recherche-outils.mts`, `credits.mts`, `ecran.mts`.

Sorties brutes (`D:/lume-final/sorties/`) : `f-mesures.json`, `f-tailles.json`, `f-ab-generer.json` et `.log`, `f-gros-parcours.json`, `f-resultats-outils.json`, `f-recherche-outils.json`, `f-credits.json`, `f-ecran.json`, captures `f-ecran-*.png`.
