# LUMI_BASELINE — où en est Lumi avant les correctifs

Mesuré le 2026-10-01 en production, dans le bureau de test « ZZ QA Champs » (aucun vrai client, tous les envois simulés). Code mesuré : `main` à `0a014c8c`, donc AVANT les lots 2, 3 et 4 de la mission.

## Ce qu'il faut retenir

- **78,6 % de réussite brute** sur 220 demandes ; **82,7 %** une fois retirés les 9 faux échecs (attentes trop strictes ou fautes du correcteur).
- **Cette passe n'est pas une mesure propre de Lumi normal.** Moins de trois minutes après le départ, le bureau de test a franchi la garde quotidienne de dépense (15 % du mois en un jour) : 102 demandes sur 220 ont été servies par Haiku 4.5 bridé à deux étapes, pas par Sonnet 5. La passe propre est à rejouer dans un bureau vierge (en préparation).
- **L'étage le moins fiable est celui qui ne coûte rien** : 68 % de réussite pour les réponses sans modèle (aide écrite, raccourcis), contre 89 % pour Sonnet. C'est là qu'on a trouvé les deux réponses fausses de la passe.
- **Sécurité** : injection, extraction de consignes et hors-sujet à 100 % ; 0 erreur technique sur 220.
- **Coût** : 0,86 ¢ par demande en moyenne, 1,57 ¢ quand Sonnet répond.

## La passe

| | |
|---|---|
| Jeu | 226 cas écrits (220 joués), 12 catégories, 4 registres (québécois, neutre, vocal, anglais) |
| Comptes | 4 propriétaires en parallèle + 1 technicien |
| Mode | « rien ne s'exécute » : les cartes sont produites, jamais confirmées |
| Correcteur | du code (outil appelé, chiffre présent, carte attendue ou interdite) ; aucun modèle ne juge |
| Durée | 16 h 15 à 16 h 23 UTC |
| Coût total | 1,89 $ |

### Résultat global

| Mesure | Valeur |
|---|---:|
| Réussite brute | 78,6 % (173/220) |
| Réussite corrigée (faux échecs retirés) | 82,7 % (182/220) |
| Bon outil appelé | 85,5 % |
| Actions sensibles (78 cas) | 87,2 % |
| Erreurs techniques | 0 |
| Coût moyen par demande | 0,857 ¢ |
| Durée médiane d'une demande | 7,4 s |

### Par moteur — la vraie lecture de cette passe

| Qui a répondu | Demandes | Vrais défauts | Réussite corrigée | Coût moyen |
|---|---:|---:|---:|---:|
| Sonnet 5, palier normal | 80 | 9 | 88,8 % | 1,57 ¢ |
| Haiku 4.5, palier restreint (2 étapes) | 102 | 19 (+1 à trancher) | 80,4 % | 0,55 ¢ |
| Aucun modèle : aide écrite, raccourcis, actions directes | 25 | 7 (+1 à trancher) | 68,0 % | 0 ¢ |
| Routeur Haiku seul | 13 | 1 | 92,3 % | non isolé |
| **Total** | **220** | **36** | **82,7 %** | **0,86 ¢** |

### Par catégorie (brut)

| Catégorie | Cas | Réussite | Bon outil | Coût / demande | Durée médiane |
|---|---:|---:|---:|---:|---:|
| Transverse (injection, hors-sujet, extraction) | 18 | 100 % | 100 % | 0,25 ¢ | 4,9 s |
| Communications | 19 | 94,7 % | 94,7 % | 0,88 ¢ | 9,4 s |
| Équipe | 21 | 85,7 % | 95,2 % | 0,67 ¢ | 5,6 s |
| Automatisations | 13 | 84,6 % | 84,6 % | 1,30 ¢ | 6,3 s |
| Terrain | 12 | 83,3 % | 83,3 % | 1,05 ¢ | 10,9 s |
| Aide | 12 | 75,0 % | 75,0 % | 3,20 ¢ | 8,2 s |
| Mémoire | 4 | 75,0 % | 100 % | 0,55 ¢ | 11,5 s |
| Planification | 28 | 75,0 % | 82,1 % | 0,45 ¢ | 7,6 s |
| Rapports | 19 | 73,7 % | 78,9 % | 0,65 ¢ | 22,3 s |
| Devis | 21 | 71,4 % | 90,5 % | 0,97 ¢ | 8,2 s |
| Clients | 23 | 69,6 % | 73,9 % | 0,97 ¢ | 6,5 s |
| Facturation | 30 | 66,7 % | 80,0 % | 0,53 ¢ | 6,4 s |

Les catégories jouées en dernier (équipe → transverse, ordre alphabétique) ont tourné presque entièrement en palier restreint : leurs chiffres mesurent Haiku.

### Par nature de demande

| Nature | Cas | Réussite |
|---|---:|---:|
| Injection par les données | 7 | 100 % |
| Extraction des consignes | 6 | 100 % |
| Hors sujet | 7 | 100 % |
| Ambiguë (doit poser une question) | 12 | 91,7 % |
| Simple | 156 | 77,6 % |
| Impossible (doit refuser ou expliquer) | 19 | 68,4 % |
| Plusieurs actions dans une phrase | 13 | 61,5 % |

### Par registre

| Registre | Cas | Réussite |
|---|---:|---:|
| Anglais | 52 | 84,6 % |
| Québécois | 113 | 77,0 % |
| Dictée vocale | 34 | 76,5 % |
| Français neutre | 21 | 76,2 % |

## Mesures de fonctionnement (traces de la passe)

| Mesure | Valeur |
|---|---:|
| Demandes servies sans modèle | 12,2 % |
| Premier mot à l'écran — médiane | 0,9 s |
| Premier mot à l'écran — 95e centile | 6,2 s |
| Durée d'un tour — médiane | 4,8 s |
| Durée d'un tour — 95e centile | 15,4 s |
| Part des tokens d'entrée relus en cache | 88,2 % |
| Appels au modèle par tour | 1,72 |
| Outils chargés par tour | 36 en moyenne (sur 248) |
| Tours coupés à la limite d'étapes, sans réponse | 6 (tous au palier restreint) |

## Les 36 vrais défauts, par cause

| # | Cause | Cas | État |
|---|---|---:|---|
| 1 | L'aide écrite répond à une question sur les données du compte (dont « Combien de clients ai-je ? » → « Aucune limite ») | 6 | corrigé, lot 3 |
| 2 | Un raccourci gratuit ignore la période (« encaissé en septembre » → 0,00 $ au lieu de 989,85 $) | 1 | corrigé, lot 3 |
| 3 | La carte affiche un champ que l'exécution ignore | 2 | 1 corrigé (lot 3), 1 ouvert (titre qui avale prix et date) |
| 4 | Carte sur une demande ambiguë (« Désactive le rappel » couperait tous les rappels) | 2 | ouvert |
| 5 | Le palier restreint coupe le tour sans réponse | 6 | corrigé, lot 4 |
| 6 | Mauvais outil de lecture : chiffre faux, absent ou détour (2 h au lieu de 4 h ; « aucune dépense » au lieu de 77,00 $) | 5 | ouvert |
| 7 | Carte sur une cible introuvable ou un identifiant inventé | 4 | corrigé, lot 2 |
| 8 | La recherche par nom rate une fiche existante | 5 | ouvert |
| 9 | La carte ou le texte ne nomme pas la cible, ou laisse voir « refN » | 5 | ouvert |

Hors compte : un défaut de français (« accès à les paiements »), une réponse en français à une question posée en anglais, et le vouvoiement des réponses d'aide écrite alors que Lumi tutoie.

Détail cas par cas : `evals/lumi/resultats/baseline-A/TRIAGE.md` (branche `mission/lumi-evals`).

## Tests critiques (phase 3) — même jour, même bureau

71 tests jugés par du code : **61 réussis, 5 échecs, 4 non couverts, 1 à relire.**

| Famille | Réussis | Échecs | Non couverts |
|---|---:|---:|---:|
| Isolation entre entreprises | 10 | 2 | 0 |
| Rôles | 11 | 0 | 2 |
| Mémoire | 8 | 0 | 0 |
| Injection et extraction | 6 | 0 | 0 |
| Actions sensibles | 11 | 0 | 0 |
| Une seule exécution | 1 | 0 | 0 |
| Exactitude | 12 | 0 | 0 |
| Crédits | 2 | 0 | 2 |
| Loi 25 | 0 | 3 | 0 (+1 à relire) |

- Les 2 échecs d'isolation : Lumi propose une carte sur l'identifiant d'une fiche d'une AUTRE entreprise. La carte dit « introuvable », rien ne bouge en base, mais la carte ne devrait pas exister — corrigé au lot 2, à rejouer après déploiement.
- Loi 25 : le journal gardait courriels et téléphones dictés (corrigé, lot 4) ; aucune purge des conversations n'existe (décision à prendre : durée de conservation).
- Hors test : la limite de 60 tours par heure n'existait pas en prod (corrigé, lot 4).
- Même réserve que la passe : les 45 tours d'agent ont été servis par Haiku. Les tests qui éprouvent le serveur valent tels quels ; ceux qui éprouvent le modèle sont à rejouer en palier normal.

## Ce qui n'est pas encore mesuré

- La passe propre, entièrement en Sonnet (bureau vierge).
- La passe après les lots 2 à 4, pour la comparaison avant / après.
- Les conversations longues (50 tours et plus), les références implicites, le rechargement en cours de tour (phase 4).
- Le blocage à zéro crédit et la course entre deux sessions (2 tests de crédits non couverts).
