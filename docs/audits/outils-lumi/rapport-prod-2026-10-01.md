# Lumi en prod : qualité et coût, mesurés le 2026-10-01

Lumi a été mesuré sur la vraie prod, levier par levier, sur 57 demandes dans l'org de test « ZZ QA Champs (banc de test) ». En fin de journée : 56 demandes bien traitées sur 57 au juge (la 57e est une bonne réponse), 27 actions sur 27, aucun faux « c'est fait », et une action coûte 0,60 ¢ au lieu de 1,03 ¢ le matin.

Ce rapport dit ce qui a été mesuré, ce qui a été gardé, ce qui a été écarté et pourquoi, et ce qui reste.

## Comment c'est mesuré

- **Où :** `https://lumecrm.net`, org de test, compte `qa.map.owner@lume.test`.
- **Sans risque :** le compte passe en mode « demander » pendant la passe. Lumi propose la carte, rien ne s'exécute, rien ne part.
- **Cas :** `evals/lumi-tools/cas-prod/prod.json` — 24 lectures, 27 actions, 6 demandes ambiguës ou à refuser. 25 de ces cas sont sensibles (argent, envoi au client, suppression). Ils visent les fiches réelles de l'org de test.
- **Coût :** relu dans `ai_usage` par conversation, routeur compris.
- **Limite :** la prod accepte 60 tours Lumi par heure et par personne. Une passe prend environ 18 minutes.

```
node --env-file=.env.local --import tsx evals/lumi-tools/run.mts --prod \
  --org <id de l'org de test> --compte <courriel du compte de test> --sortie <fichier.json>
node evals/lumi-tools/comparer.mjs <avant.json> <après.json> [--reponses]
```

`--prod` refuse une org dont le nom ne dit pas QA, TEST ou banc, et refuse `--forfait` et `--budget`.

## Résultats, passe par passe

| Passe | Code en prod | Bons | Actions | Coût moyen d'une action | Coût moyen, toutes demandes |
|---|---|---|---|---|---|
| Départ | #822 | 53 / 54 | 23 / 24 | 1,03 ¢ | 1,37 ¢ |
| Repérage | #845 | 50 / 54 | 22 / 24 | 0,73 ¢ | 1,21 ¢ |
| Consignes propres à Lumi | #848 + #850 | 55 / 57 | 27 / 27 | 0,71 ¢ | 1,22 ¢ |
| Sujet par règle | #853 | 56 / 57 | 27 / 27 | 0,60 ¢ | 1,19 ¢ |

Aucune passe n'a produit de faux « c'est fait ». Fichiers : `evals/lumi-tools/resultats/prod-2026-10-01*.json`.

Le coût des lectures n'a pas bougé (1,7 à 1,9 ¢) : aucun des leviers ne les vise.

### Ce que chaque levier a fait

- **Repérage (#845, #848).** Le code trouve la fiche citée dans la demande (numéro de devis, de facture, de job ; « Prénom Nom » d'un client ; prénom d'un membre) et la donne au modèle. Les actions précédées d'une recherche passent de 15 sur 23 à 1 sur 23. La première version a causé deux reculs, corrigés dans #848 : Lumi demandait l'adresse courriel au lieu de la chercher, et proposait de supprimer un prospect quand on disait « le client ».
- **Consignes propres à Lumi (#850).** Le prompt disait à la fois « la carte est le oui » et « attends un OUI avant tout envoi » (règle écrite pour le MCP, qui n'a pas de carte). Lumi a maintenant sa variante. Effet : qualité, pas coût.
- **Sujet par règle (#853).** Pour un ordre dont le vocabulaire ne désigne qu'un sujet, une règle choisit le jeu d'outils sans appeler le routeur. Hors ligne, sur 377 ordres : la règle en tranche 260 et charge le bon jeu dans 259 cas ; le routeur, sur les mêmes cas, 218 sur 238. L'écart venait d'un défaut corrigé au passage : pour « supprime la job 48 », le routeur choisissait la fiche du job, l'action était écartée et le sujet perdu.

### Défauts trouvés en lisant les réponses

| Défaut | État |
|---|---|
| « Le client m'a payé la facture n° 1 » recevait une réponse de FAQ sans rapport | corrigé (#845) |
| Un texto dicté entre guillemets partait avec ses guillemets | corrigé (PR de ce rapport) |
| « Tes 1 meilleurs clients » | corrigé (PR de ce rapport) |
| Une question d'aide a reçu une réponse de mémoire, sans consulter le centre d'aide (une fois sur trois passes) | ouvert |
| « Je lance la suppression » écrit à côté d'une carte qui attend encore la confirmation | ouvert |
| Un redéploiement coupe en silence une réponse en cours : ni texte, ni erreur | ouvert, côté fiabilité (#856 en brouillon) |

### L'exécution, prouvée une fois

Les passes ne font que proposer. Pour prouver qu'une carte bâtie sans recherche s'exécute :

- 4 essais à blanc (`decision: dry_run`) sur suppression de soumission, courriel, facture, statut de job : garde et validation passées, aucune écriture.
- 1 vraie confirmation : une note interne sur une fiche de test, retrouvée en base.

## Où part l'argent en prod

Mesuré sur la passe « repérage » (54 demandes, 65 ¢) :

| Poste | Part |
|---|---|
| Écriture du préfixe à froid (8 écritures de 7 000 à 18 000 tokens) | 39 % |
| Appels à chaud (0,51 ¢ en moyenne) | 49 % |
| Routeur | 12 % |

Un appel à chaud se décompose en lecture du préfixe (54 %), écriture de la conversation (28 %) et sortie (18 %).

Le préfixe est le prompt stable (4 567 tokens) plus les outils du sujet : de 1 500 tokens (mémoire) à 12 500 (facturation). Il est en cache 5 minutes, avec une entrée par sujet. Une demande isolée paie donc l'écriture complète : 3 à 5 ¢. La même demande à chaud coûte 0,6 à 1,3 ¢.

À faible trafic, presque chaque demande est froide. C'est le premier poste de coût, et aucun levier d'aujourd'hui ne le touche.

## Leviers écartés, avec la mesure

| Levier | Pourquoi il est écarté |
|---|---|
| Raccourcir le prompt stable | Déjà compacté. Rien de significatif à retirer sans perdre une règle. |
| Raccourcir les descriptions d'outils | La moitié des tokens d'outils est la structure des schémas. Facturation : 12 464 tokens pleins, 6 622 sans aucune description. Réécrire les textes rapporte au mieux 15 %, avec un risque sur le choix d'outil. |
| Charger seulement le noyau d'un sujet | La prédiction « cette demande n'a pas besoin d'un outil rare » se trompait dans 20 % des cas. Et un outil chargé par recherche s'insère avant le prompt : 6 à 7 ¢ le tour (mesure du 2026-09-16, `sous-agents.ts`). |
| Haiku pour les lectures | Les caches sont par modèle. Une lecture puis une action sur le même sujet paieraient deux écritures à froid. À revoir quand le cache sera chaud en continu. |

## Ce qui reste

1. **Cache de la conversation.** Le bloc variable du prompt (heure à la minute, indices, repérage) précède les messages : la conversation est réécrite à chaque tour. PR #852, session fiabilité.
2. **Durée du cache selon le trafic.** Écrire en 1 heure un préfixe qui vient d'être réutilisé entre 5 et 60 minutes plus tard, sinon rester à 5 minutes. Aucun risque de qualité ; pas mesurable sans vrai trafic.
3. **Arrêt gracieux du serveur**, pour qu'un déploiement ne coupe plus une réponse.
4. **Trois mauvais choix d'outil connus** (vus sur staging) : deux demandes sur les modèles de courriel lisent les modèles de facture ; un renvoi de lien de paiement en crée un nouveau.
5. **Avec du vrai trafic :** coder en raccourci les 20 questions les plus fréquentes (`lumi_traces.enonce_normalise`), et remesurer Haiku pour les lectures.

## Ce qui n'est pas garanti

- 57 cas dans une org de test ne couvrent pas les 248 outils. Les outils rares n'ont été mesurés que sur staging (459 cas, passe arrêtée à 294).
- Aucun client réel n'a encore utilisé Lumi. Les demandes réelles seront plus variées.
- Les coûts mesurés dépendent de l'état du cache pendant la passe. Deux passes ne se comparent que si aucun déploiement n'est tombé au milieu.
