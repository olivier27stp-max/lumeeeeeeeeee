# LUMI_COST_REPORT — ce que coûte Lumi, et ce qui a été fait pour que ça coûte moins

État au 2026-10-01. Tous les montants sont en cents US de coût d'inférence réel, relus dans le grand livre (`ai_usage`) et dans les traces (`lumi_traces`) de la production. Le client, lui, ne voit que des crédits (1 crédit = 3 ¢ de coût réel ; 1 000 crédits par mois avec Autopilot, soit 30 $).

## Ce qu'il faut retenir

- **Une demande à Lumi coûte 1,1 ¢ en moyenne quand les caches sont chauds** (passe de 221 demandes : 2,44 $). Un tour d'agent : 1,30 ¢. Une réponse sans modèle : 0 ¢.
- **À faible trafic, le même tour coûte 3,6 ¢** : c'est le vrai chiffre de la production aujourd'hui (18 tours d'agent en 30 jours, une seule entreprise). La différence, c'est l'écriture du préfixe en cache, payée à chaque fois qu'une personne revient après plus de cinq minutes.
- **Avec 30 $ par mois, un client a entre 830 et 2 700 demandes** selon son rythme. Personne n'en est proche : la seule entreprise active a dépensé 0,65 $ en 30 jours.
- **Aucune optimisation n'a été livrée au prix de la qualité.** Le score est passé de 81,3 % à 90,5 % pendant que le coût d'un tour d'agent passait de 1,57 ¢ à 1,30 ¢.
- **Le poste qui reste à réduire : le démarrage à froid.** Trois pistes mesurées mais pas livrées (durée du cache adaptée au rythme, résultats d'outils bornés, réchauffage) — voir « Ce qui reste ».

## Où va l'argent d'un tour

Mesuré en production le 2026-10-01 (session voisine, 57 demandes) :

| Poste | Part du coût d'un tour d'agent |
|---|---:|
| Écriture en cache (préfixe des outils et du prompt, conversation) | 56 % |
| Lecture en cache | 32 % |
| Sortie (la réponse) | 11 % |
| Entrée hors cache | 1 % |

Le préfixe (prompt stable + outils du sujet) pèse de 7 600 à 17 000 tokens selon le sujet :

| Sujet (sous-agent) | Tokens d'outils |
|---|---:|
| Jeu de base | 3 070 |
| Communications | 3 519 |
| Rapports | 4 932 |
| Devis | 6 864 |
| Équipe | 8 062 |
| Terrain | 8 204 |
| Clients | 9 128 |
| Planification | 11 805 |
| Facturation | 12 707 |

Prompt stable : 4 567 tokens. Une demande isolée, cache froid : 3 à 5 ¢. La même, cache chaud : 0,6 à 1,3 ¢.

## Avant / après, par optimisation

| Optimisation | Ce qu'elle change | Coût | Qualité | Latence |
|---|---|---|---|---|
| **Cache de la conversation** (`91489639`) | L'heure était dans le bloc mis en cache : dès que la minute changeait, toute la conversation était réécrite (2 088 → 9 103 tokens écrits par tour, mesuré sur 11 tours) au lieu d'être relue au dixième du prix. L'heure et les repères du tour passent après le point de cache. | Conversation de 7 000 tokens : ≈ 1,75 ¢ d'écriture par tour → ≈ 0,14 ¢ de lecture. Part relue en cache : 88,2 % → 91,6 %. | inchangée | inchangée |
| **Repérage des fiches avant le modèle** (#845, #848, session voisine) | Les clients, jobs et factures nommés dans la demande sont trouvés par le code et donnés au modèle : une recherche de moins, donc souvent un appel de moins. 74 % des actions faisaient au moins une recherche. | Une action avec recherche : 1,15–1,31 ¢ ; sans : 0,56–0,63 ¢. | en hausse (moins de recherches ratées) | un appel de moins |
| **Sujet par règle pour les ordres sans ambiguïté** (#853, session voisine) | Une règle par mots-clés donne le même sujet que le routeur dans 96,2 % des cas où elle tranche (64 % des demandes). | ≈ −0,1 ¢ par demande | inchangée | −0,7 s |
| **Hors-sujet servi par le routeur** | Le vrai hors-sujet ne descend plus au gros modèle. Garde-fou ajouté le 2026-10-01 : jamais pour un sujet que le centre d'aide documente. | 0,15 ¢ au lieu d'un tour complet | corrigée (une question d'aide était refusée à tort) | 2,7 s |
| **Aide écrite d'abord** | Une question « comment faire » reçoit l'article écrit à la main, sans modèle. Corrigée le 2026-10-01 : jamais pour une question sur les données du compte. | 0 ¢ | 68 % → 90 % pour l'étage sans modèle | 1,5 s |
| **Appel de conclusion à la limite d'étapes** (`0a32ea84`) | Au palier restreint, un tour à deux lectures finissait en erreur après avoir payé deux appels. | +1 appel court, seulement pour les tours qui échouaient | 6 tours sans réponse → 0 | — |
| **Reprise sur surcharge du modèle** (lot 6) | Un tour planté payait ses appels pour rien et laissait une réservation ouverte 5 minutes. | 0 à 2 appels repris, rarement | 4 tours plantés sur 221 → repris | +0,7 à 2,7 s sur ces tours |

Résultat mesuré sur le même jeu de 221 demandes, tour d'agent Sonnet : **1,57 ¢ → 1,30 ¢**, pendant que la réussite passait de 87,3 % à 92,5 %.

## Part du trafic servie sans le gros modèle

| Source | Sans modèle | Routeur seul | Agent |
|---|---:|---:|---:|
| Passe d'évaluation (221 demandes variées) | 9,0 % | 4,5 % | 86,5 % |
| Vraie production, 30 jours (25 tours, une entreprise) | 28 % | 0 % | 72 % |

Le jeu d'évaluation est fait pour éprouver le modèle ; la vraie production pose plus de questions courantes (« mes jobs demain », « mes retards »). Les caches de réponses (exact et par ressemblance) ont servi 5 tours en 30 jours : leur gain est nul à ce trafic.

## Ce que coûte un client

Avec 1 000 crédits (30 $ de coût réel) par mois :

| Rythme | Coût moyen par demande | Demandes avant d'épuiser le mois |
|---|---:|---:|
| Demandes isolées, caches froids (la production d'aujourd'hui) | 3,6 ¢ | ≈ 830 |
| Usage soutenu, caches chauds (mesuré sur la passe) | 1,1 ¢ | ≈ 2 700 |
| Conversation de travail de 10 tours, une demande par minute | à mesurer (batterie de robustesse) | — |

- Consommation réelle observée : 65 ¢ en 30 jours pour la seule entreprise active, soit 2 % de son allocation.
- Garde-fous de dépense en place : palier « économe » à 70 % du mois, « restreint » à 90 % ou dès 15 % du mois brûlés en un jour (modèle de repli, deux étapes), arrêt à 100 % ; plafond par tour ; plafond par conversation (40 ¢) ; plafond de la plateforme (50 $ par jour et par source, tous clients réunis).
- **Risque à surveiller au lancement** : le plafond de la plateforme est commun à tous les clients. À 1,3 ¢ le tour, 50 $ font ≈ 3 800 tours par jour pour l'ensemble des entreprises ; au-delà, tout le monde est en pause jusqu'à minuit. À relever avec le nombre de clients.

## Voix

| Poste | Coût | Remarque |
|---|---:|---|
| Dictée (parole → texte), Gemini 2.5 Pro | ≈ 0,94 ¢ par dictée de 60 s (0,47 ¢ mesuré sur une dictée réelle) | **Jamais débitée au client** : la base refuse la source « voix » dans le grand livre. Décision à prendre (voir LUMI_READINESS). Bornée depuis le lot 5 : droit Lumi, forfait, 60 dictées par personne et par heure. |
| Lecture à voix haute (texte → parole) | 0 ¢ | Synthèse vocale du navigateur, aucun appel payant. |
| Cache audio des phrases fixes | sans objet | Rien à mettre en cache : la synthèse est locale. |

## Optimisations rejetées, et pourquoi

| Piste | Mesure | Raison du rejet |
|---|---|---|
| Garder 3 à 5 outils chargés et chercher les autres à la demande (`tool_search` + `defer_loading` pour tout) | Les définitions trouvées sont insérées AVANT le prompt : 27 000 à 30 000 tokens relus au plein tarif, 6 à 7 ¢ le tour. Un prédicteur de « noyau » tombe juste dans 10 % des cas et manque l'outil dans 20 %. | Plus cher ET moins fiable. Le découpage par sujet (un jeu d'outils par sous-agent, le reste différé) fait mieux. |
| Haiku pour les lectures simples | Un cache par modèle : deux écritures à froid au lieu d'une à faible trafic. Haiku ne met rien en cache sous 4 096 tokens. La passe contaminée donne la mesure de qualité : 79,4 % pour Haiku contre 87,3 % pour Sonnet sur les mêmes demandes. | Baisse de qualité mesurée ; gain de coût nul au trafic actuel. Haiku reste le modèle de repli des paliers dégradés et du routeur. |
| Raccourcir le prompt stable | 4 567 tokens : rôle 551, sécurité 389, choix d'outil 785, consignes de présentation 1 803. Lu en cache au dixième du prix. | Presque rien à gagner (≈ 0,05 ¢ par tour), et chaque phrase retirée est une règle de qualité en moins. |
| Raccourcir les descriptions d'outils | La moitié des tokens d'outils est la structure des schémas. Facturation : 12 464 → 10 418 avec des descriptions d'une phrase. | Gain maximal ≈ 15 %, risque réel sur le choix d'outil (le premier poste d'échec restant). |
| Plus de raccourcis de lecture sans modèle | L'étage sans modèle était à 68 % de réussite sur la passe de référence : il répondait à côté dès qu'une question portait une période, un filtre ou un nom. | Abandonné tant que de vraies questions répétées ne le justifient pas. Un chiffre faux gratuit coûte plus cher qu'un tour. |
| Préfixe du nom d'outil par domaine (`client_`, `job_`…) | Non mesuré. | Renommer 250 outils casse l'historique des conversations, le MCP des clients et une grande partie des tests, pour un gain de choix d'outil non démontré. Le découpage par sujet joue déjà ce rôle. |
| Outil `load_guide` (guides chargés à la demande) | — | Existe sous une autre forme : `search_help` charge la doc à la demande, et le prompt ne porte aucun guide métier. |

## Ce qui reste (mesuré, pas livré)

| Piste | Gain attendu | Pourquoi pas encore |
|---|---|---|
| Durée de cache adaptée au rythme : écrire le préfixe pour 1 h quand la personne revient entre 5 et 60 minutes | Regret borné à 0,75 × le préfixe par épisode ; gain 1,15 × le préfixe à chaque retour dans l'heure. C'est exactement le cas de la production (3,6 ¢ le tour). | À livrer derrière une mesure avant / après sur la passe ; touche le chemin le plus sensible au coût. |
| Borner les résultats d'outils (PR #831, ouverte par une autre session) | Vise l'écriture de la conversation : 28 % du coût des appels à chaud. | PR à reprendre et à mesurer contre la passe. |
| Réchauffage du cache (désactivé en production) | Supprime le démarrage à froid pour un sujet. | Coûte en continu ; ne se justifie qu'avec un trafic régulier. Deux tests figent l'ancien réglage par défaut : à changer en connaissance de cause. |
| Résumés précalculés (briefing du matin, rapports) par traitement différé à moitié prix | Le briefing existe déjà sans modèle (gabarit). | Sans objet aujourd'hui. |
| Résultats d'outils plus compacts, calculs faits en base | Déjà en place : listes compactées (−35 à −45 %), vieux résultats purgés, rentabilité calculée en SQL. | — |

## Agent de support

- Trois étages sans modèle avant le modèle : FAQ écrite (29 articles), recherche dans le centre d'aide, cache par ressemblance (par entreprise, et commun pour les réponses tirées de la seule documentation).
- Aucune demande de support d'un vrai client dans les traces des 30 derniers jours : pas de coût mesurable en production. La batterie d'évaluation du support donnera le coût par question (en cours).
- Le support ne consomme pas les crédits du client.

## Sources

- `ai_usage` et `lumi_traces`, production, lecture seule, 2026-10-01.
- Passes d'évaluation : `evals/lumi/resultats/baseline-A/` et `apres-lot5-eval2/` (branche `mission/lumi-evals`).
- Mesures de la session voisine (prompt, outils, routeur) : `docs/audits/outils-lumi/rapport-prod-2026-10-01.md`.
