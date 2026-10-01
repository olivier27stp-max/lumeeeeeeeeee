# Robustesse des conversations de Lumi

Passe du 2026-10-01T19:29:34.814Z, contre https://lumecrm.net, bureau de test « [TEST] QA Lumi éval 2 — ne pas utiliser » `5930d318-b207-40f3-9e14-f8898a02e240`.
Jeu [EVAL] présent. Envois à Lumi, tous lancements réunis : proprio1 121, proprio2 19, proprio3 20, proprio4 17, technicien 63.

Lancements (la batterie se joue famille par famille : 60 envois par heure et par personne) :

- 2026-10-01T19:29:34.814Z — longue, references, revirement, reprise, simultane, entrees, vocal, pannes — proprio1 (eval2.proprio1@lume-qa.test) : 47 envoi(s) ; proprio2 (eval2.proprio2@lume-qa.test) : 19 envoi(s) ; proprio3 (eval2.proprio3@lume-qa.test) : 20 envoi(s) ; proprio4 (eval2.proprio4@lume-qa.test) : 17 envoi(s) ; technicien (eval2.tech@lume-qa.test) : 63 envoi(s) — palier : longue « normal », references « normal », revirement « normal », reprise « normal », simultane « normal », entrees « normal », vocal « normal », pannes « normal »
- 2026-10-01T20:21:36.537Z — vocal — aucun envoi — palier : vocal « normal »
- 2026-10-01T20:29:24.422Z — longue — proprio1 (eval2.proprio1@lume-qa.test) : 24 envoi(s) — palier : longue « normal »
- 2026-10-01T22:19:36.164Z — longue — proprio1 (eval2.proprio1@lume-qa.test) : 50 envoi(s) — palier : longue « normal »

**Qui a répondu.** Tours d’agent : 75 par claude-sonnet-5 ; 92 tour(s) servis sans modèle (étages 0 à 4). Coût d’inférence relu dans les traces : 1,36 $. Palier de crédits du bureau en fin de passe : « normal ».

**Redémarrages du serveur pendant la passe** (un redéploiement remet à zéro le verrou de conversation et la limite horaire, tenus en mémoire) : 2026-10-01T19:42:21.205Z (pendant longue.conversation).

Tout est jugé par du code (présence ou absence d’un fait, d’un événement, d’une ligne) ; aucun modèle ne juge. « A RELIRE » = le code n’a trouvé aucun défaut mais le critère demande un humain.

## Bilan

| Famille | PASS | FAIL | NON COUVERT | A RELIRE |
|---|---:|---:|---:|---:|
| 1. Conversation longue | 4 | 0 | 0 | 0 |
| 2. Références implicites | 5 | 0 | 0 | 0 |
| 3. Revirements | 4 | 0 | 0 | 0 |
| 4. Reprise après une coupure | 5 | 0 | 0 | 0 |
| 5. Deux appareils en même temps | 4 | 0 | 0 | 0 |
| 6. Entrées inhabituelles | 6 | 0 | 0 | 0 |
| 7. Vocal | 5 | 0 | 2 | 0 |
| 8. Pannes | 4 | 0 | 1 | 0 |
| **Total (40)** | **37** | **0** | **3** | **0** |

## La phase 4, ligne par ligne

1. Conversations longues (50+ tours) : pas de perte de contexte critique, pas d'explosion de coût, gestion propre de la limite de contexte
   - **4 PASS** — longue.conversation (PASS), longue.contexte (PASS), longue.contexte-ancien (PASS), longue.cout (PASS)
2. Références implicites : « le deuxième », « lui », « fais pareil pour l'autre »
   - **5 PASS** — references.le-deuxieme (PASS), references.lui (PASS), references.l-autre (PASS), references.meme-chose (PASS), references.fais-pareil-carte (PASS)
3. L'utilisateur change d'idée en plein milieu d'une action, annule, reformule
   - **4 PASS** — revirement.correction (PASS), revirement.annule (PASS), revirement.reformulation (PASS), revirement.autre-sujet (PASS)
4. Reload de page, perte réseau, fermeture de l'app pendant une réponse en streaming → la conversation reprend proprement, aucune action exécutée à moitié
   - **5 PASS** — reprise.coupure-texte (PASS), reprise.carte-rechargee (PASS), reprise.message-coupe-sur-carte (PASS), reprise.confirmer-coupe-apres (PASS), reprise.confirmer-coupe-pendant (PASS)
5. Même utilisateur sur web + mobile en même temps
   - **4 PASS** — simultane.deux-messages (PASS), simultane.message-et-confirmer (PASS), simultane.deux-confirmer (PASS), simultane.deux-conversations (PASS)
6. Messages vides, très longs, collages de texte, emojis, double envoi
   - **7 PASS** — simultane.deux-messages (PASS), entrees.vide (PASS), entrees.trop-long (PASS), entrees.long (PASS), entrees.collage (PASS), entrees.emojis (PASS), entrees.double-envoi (PASS)
7. Vocal : silence, bruit, phrase coupée, accent québécois, transcription erronée → Lumi demande une confirmation au lieu d'agir sur une mauvaise transcription
   - **5 PASS, 2 non couvert** — vocal.nom-deforme (PASS), vocal.phrase-coupee (PASS), vocal.bruit (PASS), vocal.montant-ambigu (PASS), vocal.silence (PASS), vocal.bruit-reel (NON COUVERT), vocal.accent (NON COUVERT)
8. Erreurs API (429, surcharge, timeout, réponse tronquée par max_tokens) → retry avec backoff, message clair, jamais de faux succès
   - **3 PASS, 1 non couvert** — pannes.outil-echec (PASS), pannes.reponse-coupee (PASS), pannes.limite-horaire (PASS), pannes.fournisseur (NON COUVERT)
9. Échec d'un outil → Lumi le dit, ne prétend pas que c'est fait
   - **1 PASS** — pannes.outil-echec (PASS)
10. Toutes les valeurs possibles de stop_reason gérées correctement
   - **2 PASS** — pannes.reponse-coupee (PASS), pannes.stop-reasons (PASS)

## Ce qui échoue (0)

Aucun test en échec.

## À relire par un humain (0)

Rien à relire.

## Non couvert (3)

- **vocal.bruit-reel** — Bruit réel dans l’enregistrement
  - Il faudrait de vrais enregistrements bruités (camion, laveuse à pression, vent) et un corpus de référence : la batterie n’envoie que du texte et un silence fabriqué. Le comportement de Lumi DEVANT une transcription bruitée est couvert par « vocal.bruit » et « vocal.phrase-coupee ».
- **vocal.accent** — Accent québécois dans l’enregistrement
  - Juger la transcription d’un accent demande des enregistrements de vraies voix et une transcription de référence ; aucun n’existe dans le dépôt. Le registre québécois ÉCRIT est couvert par le jeu d’évaluation (119 cas « quebecois », 35 cas « vocal » dans evals/lumi/cas).
  - Couvert sans réseau par : evals/lumi/cas (registres « quebecois » et « vocal »)
- **pannes.fournisseur** — 429, surcharge et délai de l’API du modèle
  - Un 429, un 529 « overloaded » ou un délai dépassé de l’API du modèle ne se provoquent pas de l’extérieur sans casser le fournisseur pour tous les clients. Le client du modèle rejoue 3 fois avec attente croissante et abandonne à 90 s (server/lib/lumi/llm.ts) ; l’échec final rend « Lumi failed to respond. » (événement d’erreur, tour tracé « erreur »).
  - Couvert sans réseau par : tests/lumi-fin-anormale.test.ts, tests/lumi-flux-interrompu.test.ts, tests/lumi-limite-horaire.test.ts

## Constats annexes (hors du critère des tests)

- **reprise.confirmer-coupe-apres** — après la coupure et avant de reconfirmer, 1 tâche(s) en base : la première demande avait atteint le serveur et s’est exécutée
- **reprise.confirmer-coupe-pendant** — après la coupure et avant de reconfirmer, 0 tâche(s) en base : la première demande n’avait pas (encore) écrit
- **entrees.vide** — message vide : le message du refus est un texte technique en anglais (« Too small: expected string to have >=1 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel
- **entrees.vide** — message d’espaces : le message du refus est un texte technique en anglais (« Too small: expected string to have >=1 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel
- **entrees.trop-long** — message de 8001 caractères : le message du refus est un texte technique en anglais (« Too big: expected string to have <=8000 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel
- **pannes.limite-horaire** — le compte eval2.tech@lume-qa.test reste limité pendant 58 minutes : aucune autre famille ne s’en sert
- **pannes.stop-reasons** — fins jamais observées dans cette passe : stop_sequence, refusal, model_context_window_exceeded — couvertes hors réseau par tests/lumi-fin-anormale.test.ts

## Détail de chaque test

### 1. Conversation longue

_Cinquante tours dans une conversation : aucune erreur, l’historique reste valide, un fait du début est encore honoré à la fin, le coût par tour plafonne._

#### PASS — longue.conversation

**Cinquante tours sans erreur, historique valide**

- Ce que le test a fait : Une conversation de 50 tours scriptés : 19 demandes qui passent par le modèle (lectures courtes sur le jeu [EVAL], deux conventions données aux tours 3 et 4) et 31 questions courantes servies sans modèle. Chaque flux est lu, les traces et l’historique enregistré sont relus par SELECT.
- Ce qu’il observerait si le défaut existait : Un tour en erreur ou sans réponse, un tour tracé « erreur », un historique que l’API du modèle refuserait (action sans résultat), ou une écriture exécutée.
- Ce qu’il a observé :
  - 50 tours servis sans erreur (flux fini, réponse non vide, aucune écriture)
  - aucun tour tracé en erreur ; historique valide (120 messages enregistrés)
  - plafond de coût de la conversation atteint au tour 50 : Lumi répond par le gabarit « ouvre une nouvelle conversation » (0 ¢) — le script s’arrête là

<details><summary>Preuves</summary>

les 50 tours joués (conversation ffbfa3b0-83af-42e0-9b57-bd2ff7019f05) :

```
 1 agent     étage 2 0.000 ¢ ok | Montre-moi la fiche de Chantal Lévesque. → Chantal Lévesque Téléphone : 514-555-0119 Courriel : chantal.levesque@lume-qa.test Adresse : 14 rue Montcalm N… (165 caractères)
 2 raccourci étage 1 0.000 ¢ ok | Combien de clients j’ai ? → Tu as 12 clients.
 3 fait      étage 6 1.809 ¢ ok | Pour la suite de cette conversation seulement (ne le note pa → OK.
 4 fait      étage 6 0.268 ¢ ok | Autre convention pour cette conversation seulement (ne la no → OK.
 5 raccourci étage 1 0.000 ¢ ok | Qu’est-ce que j’ai demain ? → 2 visites demain : • 9 h · Patrick Girard · Lavage de vitres extérieur — 1975 boulevard des Laurentides, Laval… (224 caractères)
 6 agent     étage 6 4.294 ¢ ok | Quelle est l’adresse de Nathalie Côté ? → L'adresse de Nathalie Côté est le 67 rue De Montbrun, Boucherville, QC J4B 4T8.
 7 raccourci étage 1 0.000 ¢ ok | Qui me doit de l’argent ? → 2 factures en retard, 1 149,75 $ au total : • 5 · Patrick Girard · 919,80 $ · 31 jours • 3 · Luc Bergeron · 22… (172 caractères)
 8 agent     étage 6 3.821 ¢ ok | C’est quoi le total du devis de Mélanie Simard ? → Le devis de Mélanie Simard (Lavage de vitres et gouttières) totalise 517,39 $.
 9 raccourci étage 1 0.000 ¢ ok | Mes tâches → 2 tâches à faire : • Rappeler Patrick Girard pour sa facture en retard — Vendredi 2 octobre • Commander des ra… (145 caractères)
10 agent     étage 6 5.512 ¢ ok | À quelle date est la prochaine visite chez Isabelle Fournier → La prochaine visite chez Isabelle Fournier est le 5 octobre à 10 h (lavage à pression — entrée), job n° 12.
11 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 1 → Je ne trouve pas de job numéro 1.
12 rappel_a  étage 6 0.570 ¢ ok | Quel est le numéro de téléphone de ma cliente ? → Le numéro de Chantal Lévesque est le 514-555-0119.
13 raccourci étage 1 0.000 ¢ ok | Combien j’ai encaissé ce mois-ci ? → Encaissé ce mois-ci : 0,00 $. Facturé : 0,00 $.
14 agent     étage 6 1.006 ¢ ok | Qu’est-ce que Nathalie Côté a répondu à notre devis ? → Elle a refusé le devis n° 4 (lavage à pression — maison complète, 1 092,26 $).
15 raccourci étage 1 0.000 ¢ ok | Mes devis en attente → 1 devis en attente de réponse, 597,87 $ au total : • 2 · Lavage de vitres — deux étages · 597,87 $
16 raccourci étage 1 0.000 ¢ ok | Qui est dans mon équipe ? → 10 personnes dans l’équipe : • [EVAL] Propriétaire 1 · propriétaire • [EVAL] Propriétaire 2 · propriétaire • [… (380 caractères)
17 raccourci étage 1 0.000 ¢ ok | Qu’est-ce que j’ai aujourd’hui ? → 2 visites aujourd'hui : • 8 h · Guillaume Poirier · Entretien des vitres — restaurant — 4310 rue Ontario Est, … (226 caractères)
18 agent     étage 6 0.639 ¢ ok | Quel est le courriel de Sylvie Leblanc ? → Le courriel de Sylvie Leblanc est clinique.leblanc@lume-qa.test.
19 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 3 → Je ne trouve pas de job numéro 3.
20 raccourci étage 1 0.000 ¢ ok | Qui sont mes meilleurs clients ? → Tes 5 meilleurs clients : 1. Jean-François Pelletier · 689,85 $ · 1 job 2. Isabelle Fournier · 643,86 $ · 2 jo… (217 caractères)
21 raccourci étage 1 0.000 ¢ ok | J’ai combien de jobs cette semaine ? → 7 visites cette semaine : Mardi 29 septembre • 8 h · Sylvie Leblanc · Lavage de vitres — clinique — 7250 boule… (839 caractères)
22 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 4 → Je ne trouve pas de job numéro 4.
23 raccourci étage 1 0.000 ¢ ok | Quelles factures sont en retard ? → 2 factures en retard, 1 149,75 $ au total : • 5 · Patrick Girard · 919,80 $ · 31 jours • 3 · Luc Bergeron · 22… (172 caractères)
24 rappel_a  étage 6 0.633 ¢ ok | Et l’adresse courriel de ma cliente, c’est quoi ? → Le courriel de Chantal Lévesque est chantal.levesque@lume-qa.test.
25 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 5 → Je ne trouve pas de job numéro 5.
26 raccourci étage 1 0.000 ¢ ok | Mon chiffre d’affaires du mois → Encaissé ce mois-ci : 0,00 $. Facturé : 0,00 $.
27 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 6 → Je ne trouve pas de job numéro 6.
28 raccourci étage 1 0.000 ¢ ok | Quoi de neuf ? → Bonjour [EVAL]. 2 visites aujourd'hui : 8 h Guillaume Poirier, 13 h Nathalie Côté. 2 factures en retard pour 1… (327 caractères)
29 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 7 → Je ne trouve pas de job numéro 7.
30 agent     étage 6 4.653 ¢ ok | Combien d’heures ont été pointées en septembre 2026 ? → En septembre 2026, 17 heures ont été pointées au total : Olivier Gauthier 7,5 h, Mathieu Lavoie 5 h et Karine … (125 caractères)
31 raccourci étage 1 0.000 ¢ ok | Où est mon équipe en ce moment ? → Personne n’est localisé en ce moment (positions des 20 dernières minutes, avec consentement seulement).
32 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 8 → Job #8 · Nettoyage de gouttières Client : Nathalie Côté Quand : Jeudi 1 octobre 13 h Statut : en retard Adress… (175 caractères)
33 raccourci étage 1 0.000 ¢ ok | J’ai combien de clients dans mon CRM ? → Tu as 12 clients.
34 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 9 → Job #9 · Lavage de vitres extérieur Client : Patrick Girard Quand : Vendredi 2 octobre 9 h Statut : à venir Ad… (184 caractères)
35 raccourci étage 1 0.000 ¢ ok | Qu’est-ce qu’il me reste comme tâches à faire ? → 2 tâches à faire : • Rappeler Patrick Girard pour sa facture en retard — Vendredi 2 octobre • Commander des ra… (145 caractères)
36 rappel_a  étage 6 1.851 ¢ ok | Dans quelle ville habite ma cliente ? → Ta cliente, Chantal Lévesque, habite à Candiac.
37 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 10 → Job #10 · Lavage de vitrine commerciale Client : Luc Bergeron Quand : Vendredi 2 octobre 13 h Statut : à venir… (183 caractères)
38 raccourci étage 1 0.000 ¢ ok | Combien de devis attendent une réponse du client ? → 1 devis en attente de réponse, 597,87 $ au total : • 2 · Lavage de vitres — deux étages · 597,87 $
39 agent     étage 6 1.296 ¢ ok | Quel est le solde de la facture de Luc Bergeron ? → Luc Bergeron a une facture en retard de 229,95 $ (6 jours de retard).
40 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 11 → Job #11 · Lavage de vitres extérieur Client : Marie Roy Quand : Dimanche 4 octobre 9 h Statut : à venir Adress… (175 caractères)
41 raccourci étage 1 0.000 ¢ ok | C’est quoi le total de mes comptes en retard ? → 2 factures en retard, 1 149,75 $ au total : • 5 · Patrick Girard · 919,80 $ · 31 jours • 3 · Luc Bergeron · 22… (172 caractères)
42 agent     étage 6 0.934 ¢ ok | Dans quelle ville est le Restaurant Chez Poirier ? → Le Restaurant Chez Poirier est situé à Montréal.
43 raccourci étage 2 0.000 ¢ ok | Montre-moi le job 12 → Job #12 · Lavage à pression — entrée Client : Isabelle Fournier Quand : Lundi 5 octobre 10 h Statut : à venir … (174 caractères)
44 agent     étage 6 2.055 ¢ ok | C’est quoi le titre de la job d’André Ouellet ? → Le job d'André Ouellet s'intitule « Lavage de vitres extérieur ».
45 raccourci étage 1 0.000 ¢ ok | Combien de factures en retard j’ai en ce moment ? → 2 factures en retard, 1 149,75 $ au total : • 5 · Patrick Girard · 919,80 $ · 31 jours • 3 · Luc Bergeron · 22… (172 caractères)
46 agent     étage 6 5.934 ¢ ok | La facture d’Isabelle Fournier, elle est due pour quelle dat → La facture d'Isabelle Fournier (n° 4) est due le 31 décembre 2026.
47 rappel_a  étage 6 1.278 ¢ ok | Redonne-moi le numéro de téléphone de ma cliente. → Le numéro de téléphone de Chantal Lévesque est le 514-555-0119.
48 rappel_b  étage 6 1.142 ¢ ok | Quel est le solde du dossier bleu ? → Le solde du dossier bleu (facture n° 2 de Jean-François Pelletier) est de 389,85 $.
49 raccourci étage 1 0.000 ¢ ok | Mon brief du matin → Bonjour [EVAL]. 2 visites aujourd'hui : 8 h Guillaume Poirier, 13 h Nathalie Côté. 2 factures en retard pour 1… (327 caractères)
50 agent     étage 0 0.000 ¢ refus | Merci. Résume en deux phrases ce qu’on a regardé dans cette  → Cette conversation a beaucoup travaillé : pour continuer, ouvre une nouvelle conversation (le bouton en haut).… (155 caractères)
```

historique enregistré (SELECT sur lumi_messages, 120 messages) :

```
81. user : texte (37)
82. assistant : thinking, tool_use search_clients QsY8yku5
83. user : tool_result QsY8yku5
84. assistant : texte (47)
85. user : texte (20)
86. assistant : texte (183)
87. user : texte (50)
88. assistant : texte (98)
89. user : texte (49)
90. assistant : texte (69)
91. user : texte (20)
92. assistant : texte (175)
93. user : texte (46)
94. assistant : texte (172)
95. user : texte (50)
96. assistant : tool_use search_clients Rxi5VxfT
97. user : tool_result Rxi5VxfT
98. assistant : texte (48)
99. user : texte (20)
100. assistant : texte (174)
101. user : texte (47)
102. assistant : tool_use list_jobs 5WB7PP1s
103. user : tool_result 5WB7PP1s
104. assistant : texte (65)
105. user : texte (49)
106. assistant : texte (172)
107. user : texte (63)
108. assistant : tool_use list_invoices beZUkpGK
109. user : tool_result beZUkpGK
110. assistant : texte (66)
111. user : texte (49)
112. assistant : texte (63)
113. user : texte (35)
114. assistant : tool_use get_invoice McUUkQAf
115. user : tool_result McUUkQAf
116. assistant : texte (83)
117. user : texte (18)
118. assistant : texte (327)
119. user : texte (73)
120. assistant : texte (155)
→ valide
```

</details>

#### PASS — longue.contexte

**Le fait du tour 3 est honoré aux tours 12, 24, 36 et 47**

- Ce que le test a fait : Juge la conversation jouée : « ma cliente » (Chantal Lévesque, tour 3) est redemandé quatre fois ; chaque réponse doit porter son téléphone, son courriel ou sa ville.
- Ce qu’il observerait si le défaut existait : Une réponse sur une autre cliente, ou « de quelle cliente parles-tu ? ».
- Ce qu’il a observé :
  - « ma cliente », donné au tour 3, est honoré aux tours 12, 24, 36, 47
  - tour 12 : la réponse porte sur Chantal Lévesque (Candiac) (téléphone 514-555-0119)
  - tour 24 : la réponse porte sur Chantal Lévesque (Candiac) (courriel chantal.levesque@lume-qa.test)
  - tour 36 : la réponse porte sur Chantal Lévesque (Candiac) (« Candiac »)
  - tour 47 : la réponse porte sur Chantal Lévesque (Candiac) (téléphone 514-555-0119)

<details><summary>Preuves</summary>

tour 12 — « Quel est le numéro de téléphone de ma cliente ? » :

```
Le numéro de Chantal Lévesque est le 514-555-0119.
```

tour 24 — « Et l’adresse courriel de ma cliente, c’est quoi ? » :

```
Le courriel de Chantal Lévesque est chantal.levesque@lume-qa.test.
```

tour 36 — « Dans quelle ville habite ma cliente ? » :

```
Ta cliente, Chantal Lévesque, habite à Candiac.
```

tour 47 — « Redonne-moi le numéro de téléphone de ma cliente. » :

```
Le numéro de téléphone de Chantal Lévesque est le 514-555-0119.
```

</details>

#### PASS — longue.contexte-ancien

**Le fait du tour 4, jamais redit, est honoré au tour 48**

- Ce que le test a fait : Juge la conversation jouée : « le dossier bleu » (une facture, tour 4) n’est redemandé qu’au tour 48 ; la réponse doit porter le solde de cette facture, relu en base.
- Ce qu’il observerait si le défaut existait : Le solde d’une autre facture (deviné), ou « je ne sais pas ce qu’est le dossier bleu ».
- Ce qu’il a observé :
  - « le dossier bleu », donné au tour 4 et jamais redit, est honoré au tour 48 : la réponse porte sur la facture n° 2 (Jean-François Pelletier) (389.85 $)
  - 120 messages enregistrés dans la conversation
- Attente discutable : Le serveur ne rejoue au modèle que les 60 derniers messages, sans résumé : au tour 48 le tour 4 est sorti de la fenêtre. Un FAIL est donc attendu par construction ; « Lumi demande de préciser » est une gestion propre de la limite, mais ce n’est pas « honorer le fait » — le test rend FAIL et le dit.

<details><summary>Preuves</summary>

tour 4 — le fait :

```
Autre convention pour cette conversation seulement (ne la note pas en mémoire) : « le dossier bleu », c’est la facture n° 2 de Jean-François Pelletier. Réponds juste « OK ».
```

tour 48 — « Quel est le solde du dossier bleu ? » :

```
Le solde du dossier bleu (facture n° 2 de Jean-François Pelletier) est de 389,85 $.
```

attendu :

```
la facture n° 2 (Jean-François Pelletier) : solde 389.85 $ (SELECT au début du test)
```

</details>

#### PASS — longue.cout

**Le coût par tour plafonne**

- Ce que le test a fait : Juge la conversation jouée, sur les coûts relus dans lumi_traces : la médiane des tours d’agent des 10 derniers tours ne dépasse pas 3 fois celle des tours 5 à 15.
- Ce qu’il observerait si le défaut existait : Un coût par tour qui grandit avec la conversation (historique relu en entier à chaque tour).
- Ce qu’il a observé :
  - médiane des tours d’agent 5 à 15 : 3.821 ¢ (5 tours) ; des 10 derniers : 1.278 ¢ (5 tours) ; rapport 0.33 (borne 3)
  - coût total 37.69 ¢ sur 50 tour(s), dont 17 tour(s) d’agent ; le plus cher : 5.93 ¢
  - modèle : claude-sonnet-5
  - plafond de coût de la conversation atteint au tour 50 : le serveur borne lui-même la dépense d’une conversation

<details><summary>Preuves</summary>

coût par tour (lumi_traces) :

```
 1 étage 2 0.000 ¢ sans modèle 
 2 étage 1 0.000 ¢ sans modèle 
 3 étage 6 1.809 ¢ claude-sonnet-5 end_turn
 4 étage 6 0.268 ¢ claude-sonnet-5 end_turn
 5 étage 1 0.000 ¢ sans modèle 
 6 étage 6 4.294 ¢ claude-sonnet-5 end_turn
 7 étage 1 0.000 ¢ sans modèle 
 8 étage 6 3.821 ¢ claude-sonnet-5 end_turn
 9 étage 1 0.000 ¢ sans modèle 
10 étage 6 5.512 ¢ claude-sonnet-5 end_turn
11 étage 2 0.000 ¢ sans modèle 
12 étage 6 0.570 ¢ claude-sonnet-5 end_turn
13 étage 1 0.000 ¢ sans modèle 
14 étage 6 1.006 ¢ claude-sonnet-5 end_turn
15 étage 1 0.000 ¢ sans modèle 
16 étage 1 0.000 ¢ sans modèle 
17 étage 1 0.000 ¢ sans modèle 
18 étage 6 0.639 ¢ claude-sonnet-5 end_turn
19 étage 2 0.000 ¢ sans modèle 
20 étage 1 0.000 ¢ sans modèle 
21 étage 1 0.000 ¢ sans modèle 
22 étage 2 0.000 ¢ sans modèle 
23 étage 1 0.000 ¢ sans modèle 
24 étage 6 0.633 ¢ claude-sonnet-5 end_turn
25 étage 2 0.000 ¢ sans modèle 
26 étage 1 0.000 ¢ sans modèle 
27 étage 2 0.000 ¢ sans modèle 
28 étage 1 0.000 ¢ sans modèle 
29 étage 2 0.000 ¢ sans modèle 
30 étage 6 4.653 ¢ claude-sonnet-5 end_turn
31 étage 1 0.000 ¢ sans modèle 
32 étage 2 0.000 ¢ sans modèle 
33 étage 1 0.000 ¢ sans modèle 
34 étage 2 0.000 ¢ sans modèle 
35 étage 1 0.000 ¢ sans modèle 
36 étage 6 1.851 ¢ claude-sonnet-5 end_turn
37 étage 2 0.000 ¢ sans modèle 
38 étage 1 0.000 ¢ sans modèle 
39 étage 6 1.296 ¢ claude-sonnet-5 end_turn
40 étage 2 0.000 ¢ sans modèle 
41 étage 1 0.000 ¢ sans modèle 
42 étage 6 0.934 ¢ claude-sonnet-5 end_turn
43 étage 2 0.000 ¢ sans modèle 
44 étage 6 2.055 ¢ claude-sonnet-5 end_turn
45 étage 1 0.000 ¢ sans modèle 
46 étage 6 5.934 ¢ claude-sonnet-5 end_turn
47 étage 6 1.278 ¢ claude-sonnet-5 end_turn
48 étage 6 1.142 ¢ claude-sonnet-5 end_turn
49 étage 1 0.000 ¢ sans modèle 
50 étage 0 0.000 ¢ sans modèle 
```

</details>

### 2. Références implicites

_Après une réponse de Lumi, « la deuxième », « lui », « l’autre », « la même chose pour … » et « fais pareil » visent la bonne fiche._

#### PASS — references.le-deuxieme

**« Le détail de la deuxième » après une liste**

- Ce que le test a fait : Le propriétaire fait lister ses factures en retard, puis demande « le détail de la deuxième ». L’ordre est lu dans la liste que Lumi a rendue ; la réponse doit porter le client et le solde de CETTE facture (relus par SELECT).
- Ce qu’il observerait si le défaut existait : Le détail de la première facture, d’une autre, ou « laquelle ? ».
- Ce qu’il a observé :
  - la réponse porte sur la facture n° 5 de Patrick Girard : « Girard », 919.80 $
  - aucun fait d’une autre fiche

<details><summary>Preuves</summary>

factures en retard (SELECT) :

```
select id, invoice_number, client_id, total_cents::bigint as total_cents, balance_cents::bigint as balance_cents, due_date
     from invoices
    where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and status in ('sent', 'partial') and balance_cents > 0 and due_date < (now() at time zone 'America/Toronto')::date
    order by due_date, invoice_number
→ [{"id":"d62b7481-f35a-535c-b1b9-854b0e2a5a2d","invoice_number":"5","client_id":"f382c302-44a5-5e97-b302-3c474d5b6f5d","total_cents":91980,"balance_cents":91980,"due_date":"2026-08-31"},{"id":"1307c8a5-fe2b-55dc-b910-21b03bbf4d4b","invoice_number":"3","client_id":"ce04273c-7775-55ae-9032-e9c1a3f48447","total_cents":22995,"balance_cents":22995,"due_date":"2026-09-25"}]
```

tour 1 — envoyé :

```
Liste-moi mes factures en retard, une par ligne, avec le nom du client.
```

tour 1 — reçu (statut 200, étage 6, 28842 ms) :

```
Voici tes 2 factures en retard :

- Facture #3 — Luc Bergeron — 229,95 $, en retard de 6 jours
- Facture #5 — Patrick Girard — 919,80 $, en retard de 31 jours
```

tour 1 — événements :

```
lectures : get_overdue_payments ; cartes : — ; exécutions : —
```

tour 2 — envoyé :

```
Donne-moi le détail de la deuxième.
```

tour 2 — reçu (statut 200, étage 6, 29997 ms) :

```
La facture #5 de Patrick Girard, « Lavage à pression — stationnement », est à 919,80 $ (800,00 $ + 119,80 $ de taxes), envoyée le 17 août, échue le 31 août. Aucun paiement reçu, solde complet dû, et le client ne l'a pas encore ouverte.
```

tour 2 — événements :

```
lectures : get_invoice ; cartes : — ; exécutions : —
```

ordre de la liste de Lumi :

```
1re : la facture n° 3 de Luc Bergeron (la première de la liste) ; 2e : la facture n° 5 de Patrick Girard, solde 919,80 $
```

</details>

#### PASS — references.lui

**« Envoie-lui un texto » après une fiche**

- Ce que le test a fait : Le propriétaire ouvre la fiche de Luc Bergeron, puis dit « Envoie-lui un texto : … ». La carte doit montrer SON numéro ; elle est annulée, jamais confirmée, et les envois du bac à sable sont comptés avant et après.
- Ce qu’il observerait si le défaut existait : Une carte vers un autre client, une demande « à qui ? », un envoi exécuté ou consigné.
- Ce qu’il a observé :
  - carte « send_sms » en attente, sur Luc Bergeron (Longueuil) : téléphone 514-555-0114
  - aucune autre fiche sur la carte, aucun événement d’exécution

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Montre-moi la fiche de Luc Bergeron.
```

tour 1 — reçu (statut 200, étage 2, 3618 ms) :

```
Luc Bergeron · Dépanneur Bergeron
Téléphone : 514-555-0114
Courriel : depanneur.bergeron@lume-qa.test
Adresse : 1590 chemin de Chambly, Longueuil, QC J4J 3X5, Longueuil
Statut : client actif
```

tour 1 — événements :

```
lectures : search_clients ; cartes : — ; exécutions : —
```

tour 2 — envoyé :

```
Envoie-lui un texto : « Bonjour, on passe demain matin vers 9 h. »
```

tour 2 — reçu (statut 200, étage 6, 5992 ms) :

```
(vide)
```

tour 2 — événements :

```
lectures : — ; cartes : send_sms ; exécutions : —
```

cartes du tour 2 :

```
[{"outil":"send_sms","d_office":false,"args":{"client_name":"Luc Bergeron","phone_number":"514-555-0114","message_text":"Bonjour, on passe demain matin vers 9 h."},"apercu":{"genre":"sms","to":"Luc Bergeron · 514-555-0114","subject":null,"body":"Bonjour, on passe demain matin vers 9 h.","drapeaux":{"irreversible":true,"vers_client":true,"jamais_d_office":true}}}]
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — references.l-autre

**« Fais pareil pour l’autre » entre deux homonymes**

- Ce que le test a fait : Le propriétaire demande le téléphone de Marie Roy de Longueuil, puis « Fais pareil pour l’autre. » La réponse doit porter le téléphone de Marie Roy de Brossard.
- Ce qu’il observerait si le défaut existait : Le même numéro redonné, celui d’un autre client, ou « quelle autre ? ».
- Ce qu’il a observé :
  - la réponse porte sur Marie Roy (Brossard) : téléphone 514-555-0111
  - aucun fait d’une autre fiche

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Quel est le numéro de téléphone de Marie Roy, celle de Longueuil ?
```

tour 1 — reçu (statut 200, étage 6, 9377 ms) :

```
C'est le 514-555-0110 pour Marie Roy de Longueuil.

Au fait, je remarque qu'il y a deux fiches Marie Roy créées le même jour (une à Brossard, une à Longueuil) — si c'est la même personne, je peux fusionner les deux fiches, dis-moi.
```

tour 1 — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

tour 2 — envoyé :

```
Fais pareil pour l’autre.
```

tour 2 — reçu (statut 200, étage 6, 9508 ms) :

```
L'autre Marie Roy, celle de Brossard, a le 514-555-0111. Toujours partant pour fusionner si c'est la même personne ?
```

tour 2 — événements :

```
lectures : search_clients ; cartes : — ; exécutions : —
```

</details>

#### PASS — references.meme-chose

**« La même chose pour Patrick Girard »**

- Ce que le test a fait : Le propriétaire demande combien lui doit Luc Bergeron, puis « La même chose pour Patrick Girard. » La réponse doit porter le solde dû par Girard (SELECT), pas celui de Bergeron.
- Ce qu’il observerait si le défaut existait : Le solde de Bergeron redonné, ou une autre information sur Girard (sa fiche, son téléphone) sans le solde.
- Ce qu’il a observé :
  - la réponse porte sur le solde de Patrick Girard : 919.80 $
  - aucun fait d’une autre fiche

<details><summary>Preuves</summary>

soldes dus (SELECT) :

```
Luc Bergeron : 229,95 $ ; Patrick Girard : 919,80 $
```

tour 1 — envoyé :

```
Combien me doit Luc Bergeron ?
```

tour 1 — reçu (statut 200, étage 6, 8039 ms) :

```
Luc Bergeron te doit 229,95 $ (une facture impayée, en retard).
```

tour 1 — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

tour 2 — envoyé :

```
La même chose pour Patrick Girard.
```

tour 2 — reçu (statut 200, étage 6, 6844 ms) :

```
Patrick Girard te doit 919,80 $ sur une facture impayée en retard. Il a aussi un devis de 597,87 $ en attente de réponse, pas encore facturé.
```

tour 2 — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

</details>

#### PASS — references.fais-pareil-carte

**« Fais pareil pour Patrick Girard » après une tâche créée**

- Ce que le test a fait : Le propriétaire fait créer la tâche « [ROB] rappeler Luc Bergeron <passe> » (carte confirmée), puis dit « Fais pareil pour Patrick Girard. » La carte qui suit doit être une tâche pour Girard ; elle est annulée.
- Ce qu’il observerait si le défaut existait : Une tâche encore pour Bergeron, une autre action, une seconde tâche créée sans confirmation.
- Ce qu’il a observé :
  - carte « create_task » en attente, sur une tâche pour Patrick Girard : « Girard »
  - aucune autre fiche sur la carte, aucun événement d’exécution

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Crée une tâche : [ROB] rappeler Luc Bergeron XHF8EPAR
```

tour 1 — reçu (statut 200, étage 2, 1167 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 1 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] rappeler Luc Bergeron XHF8EPAR"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] rappeler Luc Bergeron XHF8EPAR"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

confirmation de la première tâche :

```
statut 200 — fait — « C'est fait : la tâche « [ROB] rappeler Luc Bergeron XHF8EPAR ». »
```

tour 2 — envoyé :

```
Fais pareil pour Patrick Girard.
```

tour 2 — reçu (statut 200, étage 6, 4740 ms) :

```
(vide)
```

tour 2 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 2 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] rappeler Patrick Girard"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] rappeler Patrick Girard"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8EPAR%' order by created_at
→ [ROB] rappeler Luc Bergeron XHF8EPAR
```

</details>

### 3. Revirements

_Quand l’utilisateur corrige, annule, reformule ou change de sujet devant une carte, la carte est annulée, la suite est servie, rien n’est écrit._

#### PASS — revirement.correction

**« Non, pas elle, l’autre » devant une carte de texto**

- Ce que le test a fait : Carte de texto pour Marie Roy de Longueuil, puis « Non, pas elle : l’autre Marie Roy, celle de Brossard. » La conversation est rechargée pour lire le sort de la première carte ; la seconde doit montrer le numéro de Brossard. Aucune n’est confirmée ; les envois du bac à sable sont comptés.
- Ce qu’il observerait si le défaut existait : La première carte encore en attente ou exécutée, une seconde carte encore vers Longueuil, un envoi consigné.
- Ce qu’il a observé :
  - la première carte est annulée (relue dans la conversation rechargée)
  - le message suivant est servi, sans erreur ni exécution
  - aucune ligne écrite en base
  - carte « send_sms » en attente, sur Marie Roy (Brossard) : téléphone 514-555-0111
  - aucune autre fiche sur la carte, aucun événement d’exécution

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Envoie un texto à Marie Roy de Longueuil : « Bonjour, on confirme pour demain. »
```

tour 1 — reçu (statut 200, étage 6, 21873 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : get_conversations ; cartes : send_sms ; exécutions : —
```

cartes du tour 1 :

```
[{"outil":"send_sms","d_office":false,"args":{"client_id":"4a24a1af-c158-53b3-a8c0-0eebe41ec1cf","client_name":"Marie Roy","phone_number":"+15145550142","message_text":"Bonjour, on confirme pour demain."},"apercu":{"genre":"sms","to":"Marie Roy · 514-555-0110","subject":null,"body":"Bonjour, on confirme pour demain.","drapeaux":{"irreversible":true,"vers_client":true,"jamais_d_office":true}}}]
```

tour 2 — envoyé :

```
Non, pas elle : l’autre Marie Roy, celle de Brossard.
```

tour 2 — reçu (statut 200, étage 6, 14466 ms) :

```
(vide)
```

tour 2 — événements :

```
lectures : get_client_profile ; cartes : send_sms ; exécutions : —
```

cartes du tour 2 :

```
[{"outil":"send_sms","d_office":false,"args":{"client_id":"6177fe64-6cd5-5fe4-9fc8-6431645ba921","client_name":"Marie Roy","message_text":"Bonjour, on confirme pour demain.","phone_number":"514-555-0111"},"apercu":{"genre":"sms","to":"Marie Roy · 514-555-0111","subject":null,"body":"Bonjour, on confirme pour demain.","drapeaux":{"irreversible":true,"vers_client":true,"jamais_d_office":true}}}]
```

conversation rechargée (GET, statut 200) — sort des cartes :

```
48kqH1GG : echouee
RHvzu9r4 : annulee
qLtEgDJ6 : en_attente
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — revirement.annule

**« Annule ça » devant une carte**

- Ce que le test a fait : Carte « créer une tâche [ROB] annulation <passe> », puis « Annule ça, finalement. » La carte doit être annulée, aucune autre proposée, aucune tâche en base.
- Ce qu’il observerait si le défaut existait : La tâche créée, la carte encore en attente, une nouvelle carte, ou « c’est fait ».
- Ce qu’il a observé :
  - la première carte est annulée (relue dans la conversation rechargée)
  - le message suivant est servi, sans erreur ni exécution
  - aucune ligne écrite en base

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Crée une tâche : [ROB] annulation XHF8EANN
```

tour 1 — reçu (statut 200, étage 2, 3580 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 1 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] annulation XHF8EANN"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] annulation XHF8EANN"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

tour 2 — envoyé :

```
Annule ça, finalement.
```

tour 2 — reçu (statut 200, étage 6, 6504 ms) :

```
D'accord, pas de souci, je n'ai rien créé.
```

tour 2 — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

cartes du tour 2 :

```
aucune
```

conversation rechargée (GET, statut 200) — sort des cartes :

```
71582607 : annulee
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8EANN%' order by created_at
→ aucune
```

</details>

#### PASS — revirement.reformulation

**Reformuler devant une carte**

- Ce que le test a fait : Carte « créer une tâche [ROB] appeler le fournisseur <passe> », puis « Attends, change le titre pour : [ROB] commander du savon <passe> ». La première carte doit être annulée, la nouvelle porter le nouveau titre ; elle est annulée, aucune tâche en base.
- Ce qu’il observerait si le défaut existait : Deux cartes en attente, l’ancien titre gardé, ou une tâche créée sans confirmation.
- Ce qu’il a observé :
  - la première carte est annulée (relue dans la conversation rechargée)
  - le message suivant est servi, sans erreur ni exécution
  - aucune ligne écrite en base
  - carte « create_task » en attente, sur le nouveau titre : « commander du savon »
  - aucune autre fiche sur la carte, aucun événement d’exécution

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Crée une tâche : [ROB] appeler le fournisseur XHF8ETIT
```

tour 1 — reçu (statut 200, étage 2, 17506 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 1 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] appeler le fournisseur XHF8ETIT"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] appeler le fournisseur XHF8ETIT"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

tour 2 — envoyé :

```
Attends, change le titre pour : [ROB] commander du savon XHF8ETIT
```

tour 2 — reçu (statut 200, étage 6, 7843 ms) :

```
(vide)
```

tour 2 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 2 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] commander du savon XHF8ETIT"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] commander du savon XHF8ETIT"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

conversation rechargée (GET, statut 200) — sort des cartes :

```
9b71b2cc : annulee
ToaSJxPX : en_attente
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ETIT%' order by created_at
→ aucune
```

</details>

#### PASS — revirement.autre-sujet

**Carte laissée, puis une question sans rapport**

- Ce que le test a fait : Carte « créer une tâche [ROB] autre sujet <passe> » laissée sans réponse, puis « Au fait, combien de clients j’ai ? », puis une troisième question. La carte doit être annulée, les deux tours servis, l’historique enregistré valide (SELECT), aucune tâche en base.
- Ce qu’il observerait si le défaut existait : La carte encore confirmable, une erreur au tour suivant (historique refusé par le modèle), une tâche créée.
- Ce qu’il a observé :
  - la première carte est annulée (relue dans la conversation rechargée)
  - le message suivant est servi, sans erreur ni exécution
  - aucune ligne écrite en base
  - le troisième tour est servi ; historique valide

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Crée une tâche : [ROB] autre sujet XHF8ESUJ
```

tour 1 — reçu (statut 200, étage 2, 1292 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

cartes du tour 1 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] autre sujet XHF8ESUJ"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] autre sujet XHF8ESUJ"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

tour 2 — envoyé :

```
Au fait, combien de clients j’ai ?
```

tour 2 — reçu (statut 200, étage 6, 6886 ms) :

```
Tu as 12 clients au total.
```

tour 2 — événements :

```
lectures : search_clients ; cartes : — ; exécutions : —
```

cartes du tour 2 :

```
aucune
```

tour 3 — envoyé :

```
Et Luc Bergeron, il me doit combien ?
```

tour 3 — reçu (statut 200, étage 6, 13513 ms) :

```
Il te doit 229,95 $, en retard de paiement (facture impayée, rien n'a encore été payé).
```

tour 3 — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

conversation rechargée (GET, statut 200) — sort des cartes :

```
2fdd0ddb : annulee
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ESUJ%' order by created_at
→ aucune
```

historique enregistré (SELECT sur lumi_messages, 11 messages) :

```
1. user : texte (43)
2. assistant : tool_use create_task 2fdd0ddb
3. user : tool_result 2fdd0ddb
4. user : texte (34)
5. assistant : tool_use search_clients UVFuTuEE
6. user : tool_result UVFuTuEE
7. assistant : texte (26)
8. user : texte (37)
9. assistant : tool_use get_client_profile thMipYLB
10. user : tool_result thMipYLB
11. assistant : texte (87)
→ valide
```

</details>

### 4. Reprise après une coupure

_Une connexion coupée au milieu d’une réponse, d’une carte ou d’un « Confirmer » ne laisse ni réponse vide, ni conversation cassée, ni action faite à moitié ou deux fois._

#### PASS — reprise.coupure-texte

**Connexion coupée au premier mot de la réponse**

- Ce que le test a fait : Une conversation est ouverte, puis la connexion est coupée au premier texte d’une longue réponse. La conversation est rechargée (GET), un message est renvoyé (en attendant si le serveur répond « conversation occupée »), puis un autre ; l’historique est relu par SELECT et les écritures de Lumi sont comptées.
- Ce qu’il observerait si le défaut existait : Une réponse vide au rechargement, « Lumi n’a pas pu répondre » au message suivant (historique cassé : deux tours écrits en même temps), une conversation occupée sans fin, une écriture enregistrée.
- Ce qu’il a observé :
  - flux coupé par la batterie avant la fin
  - conversation rechargée (200), aucune réponse vide
  - message suivant servi (répondu (étage 6))
  - historique valide (12 messages)
  - aucune écriture pendant le test

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Montre-moi la fiche de Luc Bergeron.
```

tour 1 — reçu (statut 200, étage 2, 1594 ms) :

```
Luc Bergeron · Dépanneur Bergeron
Téléphone : 514-555-0114
Courriel : depanneur.bergeron@lume-qa.test
Adresse : 1590 chemin de Chambly, Longueuil, QC J4J 3X5, Longueuil
Statut : client actif
```

tour 1 — événements :

```
lectures : search_clients ; cartes : — ; exécutions : —
```

tour 2 (coupé au premier texte) — envoyé :

```
Explique-moi en détail la situation de ce client : ses jobs, ses factures, ce qu’il me doit, et ce que tu me conseilles de faire.
```

tour 2 (coupé au premier texte) — reçu (statut 200, étage —, COUPÉ par la batterie, 7260 ms) :

```
Voici le
```

tour 2 (coupé au premier texte) — événements :

```
lectures : search_clients, get_client_profile ; cartes : — ; exécutions : —
```

rechargement immédiat (GET, statut 200) :

```
user : Montre-moi la fiche de Luc Bergeron.
assistant : Luc Bergeron · Dépanneur Bergeron
Téléphone : 514-555-0114
Courriel : depanneur.bergeron@l… (190 caractères)
user : Explique-moi en détail la situation de ce client : ses jobs, ses factures, ce qu’il me doi… (129 caractères)
```

tour 3, essai 1 — envoyé :

```
Finalement, donne-moi juste son numéro de téléphone.
```

tour 3, essai 1 — reçu (statut 200, étage 6, 5493 ms) :

```
514-555-0114
```

tour 3, essai 1 — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

tour 4, essai 1 — envoyé :

```
Et son courriel ?
```

tour 4, essai 1 — reçu (statut 200, étage 6, 5843 ms) :

```
depanneur.bergeron@lume-qa.test
```

tour 4, essai 1 — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

conversation rechargée à la fin (GET, statut 200) :

```
user : Montre-moi la fiche de Luc Bergeron.
assistant : Luc Bergeron · Dépanneur Bergeron
Téléphone : 514-555-0114
Courriel : depanneur.bergeron@l… (190 caractères)
user : Explique-moi en détail la situation de ce client : ses jobs, ses factures, ce qu’il me doi… (129 caractères)
assistant : (vide)
assistant : (vide)
assistant : Voici le portrait de Luc Bergeron (Dépanneur Bergeron) :

**Jobs** : 2 au total — un lavag… (653 caractères)
user : Finalement, donne-moi juste son numéro de téléphone.
assistant : 514-555-0114
user : Et son courriel ?
assistant : depanneur.bergeron@lume-qa.test
```

historique enregistré (SELECT sur lumi_messages, 12 messages) :

```
1. user : texte (36)
2. assistant : texte (190)
3. user : texte (129)
4. assistant : thinking, tool_use search_clients tAGp6CoE
5. user : tool_result tAGp6CoE
6. assistant : tool_use get_client_profile BXwUWnqw
7. user : tool_result BXwUWnqw
8. assistant : texte (653)
9. user : texte (52)
10. assistant : texte (12)
11. user : texte (17)
12. assistant : texte (31)
→ valide
```

écritures de Lumi enregistrées pour ce compte (agent_actions) :

```
avant le tour coupé : 0 ; à la fin : 0
```

</details>

#### PASS — reprise.carte-rechargee

**Connexion coupée à l’arrivée d’une carte**

- Ce que le test a fait : La connexion est coupée dès que la carte « créer une tâche [ROB] reprise carte <passe> » arrive. La conversation est retrouvée par la liste, rechargée : la carte doit être en attente et rien n’est écrit. Elle est alors confirmée : une tâche, une seule.
- Ce qu’il observerait si le défaut existait : La carte perdue au rechargement, une tâche créée sans confirmation, ou deux tâches.
- Ce qu’il a observé :
  - la carte coupée est retrouvée en attente au rechargement, rien n’était écrit
  - lignes en base : 1
  - résultats enregistrés pour la carte : 1
  - réponses : fait

<details><summary>Preuves</summary>

demande (coupée à l’arrivée de la carte) — envoyé :

```
[ROB] reprise carte XHF8ERCA : crée-moi une tâche avec ce titre, priorité basse, pour demain.
```

demande (coupée à l’arrivée de la carte) — reçu (statut 200, étage —, COUPÉ par la batterie, 4720 ms) :

```
(vide)
```

demande (coupée à l’arrivée de la carte) — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte reçue avant la coupure :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] reprise carte XHF8ERCA","priority":"low","due_date":"2026-10-02"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] reprise carte XHF8ERCA"},{"libelle":{"fr":"Priorité","en":"Priority"},"valeur":"Basse","valeur_en":"Low"},{"libelle":{"fr":"Échéance","en":"Due date"},"valeur":"ven. 2 octobre 2026","valeur_en":"Fri, October 2, 2026"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

conversation rechargée (GET, statut 200) — cartes en attente :

```
create_task {"title":"[ROB] reprise carte XHF8ERCA","due_date":"2026-10-02","priority":"low"}
```

tâches en base AVANT de confirmer :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERCA%' order by created_at
→ 0 ligne(s) : —
```

confirmation après rechargement :

```
statut 200 — fait — « C'est fait : la tâche « [ROB] reprise carte XHF8ERCA ». »
```

tâches en base APRÈS :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERCA%' order by created_at
→ 1 ligne(s) : [ROB] reprise carte XHF8ERCA
```

</details>

#### PASS — reprise.message-coupe-sur-carte

**Carte en attente, puis un message coupé, puis « Confirmer » sur la vieille carte**

- Ce que le test a fait : Une carte « créer une tâche [ROB] reprise message <passe> » attend ; un autre message part et sa réponse est coupée au premier texte ; « Confirmer » est alors envoyé sur la vieille carte, puis un message. La carte doit être annulée une fois pour toutes : refus propre, aucune tâche, un seul résultat enregistré.
- Ce qu’il observerait si le défaut existait : La tâche créée après l’annulation, deux résultats pour la même carte (annulée ET exécutée), ou une erreur au message suivant.
- Ce qu’il a observé :
  - le message coupé a bien annulé la carte (un seul résultat enregistré, affichée annulée)
  - « Confirmer » ensuite : refus_propre — rien n’est écrit en base
  - le message suivant est servi, historique valide

<details><summary>Preuves</summary>

tour 1 — envoyé :

```
Crée une tâche : [ROB] reprise message XHF8ERMC
```

tour 1 — reçu (statut 200, étage 2, 2671 ms) :

```
(vide)
```

tour 1 — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte du tour 1 :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] reprise message XHF8ERMC"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] reprise message XHF8ERMC"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

tour 2 (coupé au premier texte) — envoyé :

```
Avant ça, dis-moi en détail quelles factures sont en retard et depuis quand.
```

tour 2 (coupé au premier texte) — reçu (statut 200, étage —, COUPÉ par la batterie, 5758 ms) :

```
De
```

tour 2 (coupé au premier texte) — événements :

```
lectures : get_overdue_payments ; cartes : — ; exécutions : —
```

« Confirmer » sur la vieille carte, essai 1 :

```
statut 409, code aucune_proposition — refus_propre — « No such pending action. »
```

tour 3, essai 1 — envoyé :

```
Et Luc Bergeron, il me doit combien ?
```

tour 3, essai 1 — reçu (statut 200, étage 6, 8415 ms) :

```
Luc Bergeron te doit 229,95 $ (facture #3, en retard depuis 6 jours).
```

tour 3, essai 1 — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

tâches en base :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERMC%' order by created_at
→ 0 ligne(s) : —
```

la carte, dans la conversation :

```
résultats enregistrés : 1 ; sort affiché au rechargement : annulee
```

historique enregistré (SELECT sur lumi_messages, 9 messages) :

```
1. user : texte (47)
2. assistant : tool_use create_task 0842532e
3. user : tool_result 0842532e
4. user : texte (76)
5. assistant : tool_use get_overdue_payments pZ5UQDyq
6. user : tool_result pZ5UQDyq
7. assistant : texte (239)
8. user : texte (37)
9. assistant : texte (69)
→ valide
```

</details>

#### PASS — reprise.confirmer-coupe-apres

**« Confirmer » coupé juste après l’exécution, puis reconfirmé**

- Ce que le test a fait : La carte « créer une tâche [ROB] reprise confirmer <passe> » est confirmée et la connexion coupée dès les en-têtes de la réponse (le reçu n’est jamais lu). « Confirmer » est renvoyé. Les tâches de ce titre et les résultats enregistrés pour la carte sont comptés.
- Ce qu’il observerait si le défaut existait : Deux tâches, deux résultats pour la même carte, ou une erreur au lieu de « déjà fait » / refus propre.
- Ce qu’il a observé :
  - lignes en base : 1
  - résultats enregistrés pour la carte : 1
  - réponses : coupe, refus_propre
- Constat annexe : après la coupure et avant de reconfirmer, 1 tâche(s) en base : la première demande avait atteint le serveur et s’est exécutée

<details><summary>Preuves</summary>

demande — envoyé :

```
Crée une tâche : [ROB] reprise confirmer XHF8ERXA
```

demande — reçu (statut 200, étage 2, 5964 ms) :

```
(vide)
```

demande — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] reprise confirmer XHF8ERXA"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] reprise confirmer XHF8ERXA"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

« Confirmer » coupé aux en-têtes de la réponse :

```
statut 200, coupé : true, 0 événement(s) reçu(s) en 1904 ms
```

tâches en base après la coupure, avant de reconfirmer :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERXA%' order by created_at
→ 1 ligne(s) : [ROB] reprise confirmer XHF8ERXA
```

nouvelle confirmation, essai 1 :

```
statut 409, code aucune_proposition — refus_propre — reçus : [] — « No such pending action. »
```

tâches en base à la fin :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERXA%' order by created_at
→ 1 ligne(s) : [ROB] reprise confirmer XHF8ERXA
```

historique enregistré (SELECT sur lumi_messages, 4 messages) :

```
1. user : texte (49)
2. assistant : tool_use create_task b925f3c5
3. user : tool_result b925f3c5
4. assistant : texte (59)
→ valide
```

</details>

#### PASS — reprise.confirmer-coupe-pendant

**« Confirmer » coupé 350 ms après l’envoi, puis reconfirmé**

- Ce que le test a fait : Même scénario, mais la connexion est coupée 350 ms après l’envoi : selon le réseau, pendant l’exécution ou avant. « Confirmer » est renvoyé ; à la fin il doit y avoir UNE tâche et UN résultat, quel que soit le moment de la coupure.
- Ce qu’il observerait si le défaut existait : Zéro tâche avec un « déjà fait », deux tâches, ou deux résultats pour la même carte.
- Ce qu’il a observé :
  - lignes en base : 1
  - résultats enregistrés pour la carte : 1
  - réponses : coupe, refus_propre
- Constat annexe : après la coupure et avant de reconfirmer, 0 tâche(s) en base : la première demande n’avait pas (encore) écrit

<details><summary>Preuves</summary>

demande — envoyé :

```
Crée une tâche : [ROB] reprise confirmer XHF8ERXP
```

demande — reçu (statut 200, étage 2, 2386 ms) :

```
(vide)
```

demande — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] reprise confirmer XHF8ERXP"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] reprise confirmer XHF8ERXP"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

« Confirmer » coupé 350 ms après l’envoi :

```
statut 0, coupé : true, 0 événement(s) reçu(s) en 359 ms
```

tâches en base après la coupure, avant de reconfirmer :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERXP%' order by created_at
→ 0 ligne(s) : —
```

nouvelle confirmation, essai 1 :

```
statut 409, code aucune_proposition — refus_propre — reçus : [] — « No such pending action. »
```

tâches en base à la fin :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ERXP%' order by created_at
→ 1 ligne(s) : [ROB] reprise confirmer XHF8ERXP
```

historique enregistré (SELECT sur lumi_messages, 4 messages) :

```
1. user : texte (49)
2. assistant : tool_use create_task 5a98983a
3. user : tool_result 5a98983a
4. assistant : texte (59)
→ valide
```

</details>

### 5. Deux appareils en même temps

_Deux sessions du même compte qui écrivent au même instant ne donnent jamais deux résultats pour la même carte ni un historique cassé ; deux conversations différentes passent toutes les deux._

#### PASS — simultane.deux-messages

**Deux messages au même instant dans la même conversation**

- Ce que le test a fait : Une conversation est ouverte sur le « web » ; le « web » et le « mobile » (deux jetons du même compte) y envoient chacun un message au même instant. Puis un message suit, et l’historique enregistré est relu par SELECT.
- Ce qu’il observerait si le défaut existait : Une erreur 500, les deux messages refusés, un historique où une action n’a pas son résultat (les deux tours se sont écrits l’un dans l’autre), ou une erreur au message suivant.
- Ce qu’il a observé :
  - un message est servi, l’autre est refusé proprement par le verrou de conversation (409, message clair)
  - historique valide (6 messages)
  - le message suivant est servi

<details><summary>Preuves</summary>

tour 1 (web) — envoyé :

```
Montre-moi la fiche de Luc Bergeron.
```

tour 1 (web) — reçu (statut 200, étage 2, 29752 ms) :

```
Luc Bergeron · Dépanneur Bergeron
Téléphone : 514-555-0114
Courriel : depanneur.bergeron@lume-qa.test
Adresse : 1590 chemin de Chambly, Longueuil, QC J4J 3X5, Longueuil
Statut : client actif
```

tour 1 (web) — événements :

```
lectures : search_clients ; cartes : — ; exécutions : —
```

en même temps — web — envoyé :

```
Quel est son numéro de téléphone ?
```

en même temps — web — reçu (statut 200, étage 6, 14067 ms) :

```
514-555-0114.
```

en même temps — web — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

en même temps — mobile — envoyé :

```
Quelle est son adresse courriel ?
```

en même temps — mobile — reçu (statut 409, 4012 ms) :

```
code conversation_occupee — Lumi répond déjà dans cette conversation. Attends la fin de sa réponse, puis renvoie ton message.
```

tour suivant, essai 1 — envoyé :

```
Et dans quelle ville il est ?
```

tour suivant, essai 1 — reçu (statut 200, étage 6, 6244 ms) :

```
Longueuil.
```

tour suivant, essai 1 — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

historique enregistré (SELECT sur lumi_messages, 6 messages) :

```
1. user : texte (36)
2. assistant : texte (190)
3. user : texte (34)
4. assistant : texte (13)
5. user : texte (29)
6. assistant : texte (10)
→ valide
```

</details>

#### PASS — simultane.message-et-confirmer

**Un message et un « Confirmer » au même instant**

- Ce que le test a fait : Une carte « créer une tâche [ROB] deux appareils <passe> » attend. Au même instant, le « web » confirme et le « mobile » écrit « Finalement non ». Les résultats enregistrés pour la carte et les tâches en base sont comptés, puis un message suit.
- Ce qu’il observerait si le défaut existait : Deux résultats pour la même carte (confirmée ET annulée), une tâche créée alors que la confirmation dit non, ou une erreur au message suivant.
- Ce qu’il a observé :
  - confirmation : fait (statut 200)
  - message : refus propre (409 conversation_occupee) : « Lumi répond déjà dans cette conversation. Attends la fin de sa réponse, puis renvoie ton message. »
  - résultats enregistrés pour la carte : 1
  - lignes en base : 1
  - historique valide (8 messages)
  - le message suivant est servi

<details><summary>Preuves</summary>

tour 1 (web) — envoyé :

```
Crée une tâche : [ROB] deux appareils XHF8ESMC
```

tour 1 (web) — reçu (statut 200, étage 2, 1535 ms) :

```
(vide)
```

tour 1 (web) — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] deux appareils XHF8ESMC"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] deux appareils XHF8ESMC"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

en même temps — web : « Confirmer » :

```
statut 200 — fait — reçus : [{"ok":true}] — « C'est fait : la tâche « [ROB] deux appareils XHF8ESMC ». »
```

en même temps — mobile — envoyé :

```
Finalement non, laisse faire cette tâche.
```

en même temps — mobile — reçu (statut 409, 1095 ms) :

```
code conversation_occupee — Lumi répond déjà dans cette conversation. Attends la fin de sa réponse, puis renvoie ton message.
```

tour suivant, essai 1 — envoyé :

```
Et Luc Bergeron, il me doit combien ?
```

tour suivant, essai 1 — reçu (statut 200, étage 6, 14964 ms) :

```
Luc Bergeron te doit 229,95 $ (facture #3, envoyée, échue depuis le 25 septembre).
```

tour suivant, essai 1 — événements :

```
lectures : list_invoices ; cartes : — ; exécutions : —
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ESMC%' order by created_at
→ 1 ligne(s) : [ROB] deux appareils XHF8ESMC
```

résultats enregistrés pour la carte (SELECT) :

```
1
```

historique enregistré (SELECT sur lumi_messages, 8 messages) :

```
1. user : texte (46)
2. assistant : tool_use create_task 8af1f931
3. user : tool_result 8af1f931
4. assistant : texte (56)
5. user : texte (37)
6. assistant : thinking, tool_use list_invoices ZX8qAbad
7. user : tool_result ZX8qAbad
8. assistant : texte (82)
→ valide
```

</details>

#### PASS — simultane.deux-confirmer

**« Confirmer » sur le web et sur le mobile au même instant**

- Ce que le test a fait : Une carte « créer une tâche [ROB] double confirmer <passe> » est confirmée au même instant par les deux sessions, puis une troisième fois 3 s plus tard.
- Ce qu’il observerait si le défaut existait : Deux tâches, deux reçus « c’est fait », deux résultats enregistrés pour la carte, ou une erreur au lieu de « déjà fait » / refus propre.
- Ce qu’il a observé :
  - lignes en base : 1
  - résultats enregistrés pour la carte : 1
  - réponses : refus_propre, fait, refus_propre

<details><summary>Preuves</summary>

demande (web) — envoyé :

```
Crée une tâche : [ROB] double confirmer XHF8ESDC
```

demande (web) — reçu (statut 200, étage 2, 4644 ms) :

```
(vide)
```

demande (web) — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] double confirmer XHF8ESDC"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] double confirmer XHF8ESDC"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

confirmation 1 (web, en même temps) :

```
statut 409, code decision_en_cours — refus_propre — reçus : [] — « Cette action est déjà en cours de traitement. »
```

confirmation 2 (mobile, en même temps) :

```
statut 200 — fait — reçus : [{"ok":true}] — « C'est fait : la tâche « [ROB] double confirmer XHF8ESDC ». »
```

confirmation 3 (web, après coup) :

```
statut 409, code aucune_proposition — refus_propre — reçus : [] — « No such pending action. »
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8ESDC%' order by created_at
→ 1 ligne(s) : [ROB] double confirmer XHF8ESDC
```

historique enregistré (SELECT sur lumi_messages, 4 messages) :

```
1. user : texte (48)
2. assistant : tool_use create_task 0da0b785
3. user : tool_result 0da0b785
4. assistant : texte (58)
→ valide
```

</details>

#### PASS — simultane.deux-conversations

**Deux conversations différentes en parallèle**

- Ce que le test a fait : Au même instant, le « web » demande dans une nouvelle conversation combien doit Luc Bergeron, et le « mobile », dans une autre, combien doit Patrick Girard. Chaque réponse doit porter SON solde (SELECT).
- Ce qu’il observerait si le défaut existait : Une des deux refusée ou en erreur, les deux rangées dans la même conversation, ou une réponse qui porte le solde de l’autre.
- Ce qu’il a observé :
  - les deux conversations répondent, chacune sur sa fiche
  - deux conversations distinctes

<details><summary>Preuves</summary>

soldes dus (SELECT) :

```
Luc Bergeron : 229.95 $ ; Patrick Girard : 919.80 $
```

conversation 1 (web) — envoyé :

```
Combien me doit Luc Bergeron ?
```

conversation 1 (web) — reçu (statut 200, étage 6, 9082 ms) :

```
Luc Bergeron te doit 229,95 $, en retard de paiement sur une facture.
```

conversation 1 (web) — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

conversation 2 (mobile) — envoyé :

```
Combien me doit Patrick Girard ?
```

conversation 2 (mobile) — reçu (statut 200, étage 6, 9156 ms) :

```
Patrick Girard te doit 919,80 $, tous en retard.
```

conversation 2 (mobile) — événements :

```
lectures : get_client_profile ; cartes : — ; exécutions : —
```

</details>

### 6. Entrées inhabituelles

_Un message vide ou trop long est refusé proprement ; un message long, un collage et des emojis sont servis sans erreur ni écriture ; la même demande envoyée deux fois n’écrit qu’une fois._

#### PASS — entrees.vide

**Message vide, message d’espaces**

- Ce que le test a fait : POST /api/lumi/chat avec un message vide, puis avec des espaces et des retours à la ligne. Les tours tracés et les conversations du compte sont comptés avant et après.
- Ce qu’il observerait si le défaut existait : Un tour ouvert sur du vide (flux 200), une erreur 500, un refus sans message, une conversation vide créée.
- Ce qu’il a observé :
  - vide : refus 400 : « Too small: expected string to have >=1 characters »
  - vide : aucun tour tracé, aucune conversation créée
  - espaces : refus 400 : « Too small: expected string to have >=1 characters »
  - espaces : aucun tour tracé, aucune conversation créée
- Constat annexe : message vide : le message du refus est un texte technique en anglais (« Too small: expected string to have >=1 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel
- Constat annexe : message d’espaces : le message du refus est un texte technique en anglais (« Too small: expected string to have >=1 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel

<details><summary>Preuves</summary>

message vide — envoyé :

```
""
```

message vide — reçu (statut 400, 82 ms) :

```
Too small: expected string to have >=1 characters
```

message vide — tours tracés et conversations ouvertes (SELECT) :

```
avant : 0 tour(s), 0 conversation(s) ; après : 0, 0
```

message d’espaces — envoyé :

```
"   \n\t  "
```

message d’espaces — reçu (statut 400, 1581 ms) :

```
Too small: expected string to have >=1 characters
```

message d’espaces — tours tracés et conversations ouvertes (SELECT) :

```
avant : 0 tour(s), 0 conversation(s) ; après : 0, 0
```

</details>

#### PASS — entrees.trop-long

**Message au-delà de la limite (8 001 caractères)**

- Ce que le test a fait : POST /api/lumi/chat avec un message de 8 001 caractères (la limite du serveur est 8 000).
- Ce qu’il observerait si le défaut existait : Le message accepté et envoyé au modèle, une erreur 500, un refus sans message.
- Ce qu’il a observé :
  - refus 400 : « Too big: expected string to have <=8000 characters »
  - aucun tour tracé, aucune conversation créée
- Constat annexe : message de 8001 caractères : le message du refus est un texte technique en anglais (« Too big: expected string to have <=8000 characters ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel

<details><summary>Preuves</summary>

message de 8001 caractères — envoyé :

```
Voici mes notes de la semaine. Lundi, lavage de vitres chez un client de Longueuil, deux heures de t… (8001 caractères)
```

message de 8001 caractères — reçu (statut 400, 73 ms) :

```
Too big: expected string to have <=8000 characters
```

message de 8001 caractères — tours tracés et conversations ouvertes (SELECT) :

```
avant : 0 tour(s), 0 conversation(s) ; après : 0, 0
```

</details>

#### PASS — entrees.long

**Message juste sous la limite (7 900 caractères)**

- Ce que le test a fait : Un message de 7 900 caractères (des notes de la semaine, avec une question) : il doit être servi, sans erreur, sans carte.
- Ce qu’il observerait si le défaut existait : Un refus, une erreur, un flux sans fin, une réponse vide, ou une carte tirée du texte collé.
- Ce qu’il a observé :
  - répondu (étage 6)
  - 139 caractères de réponse

<details><summary>Preuves</summary>

message de 7900 caractères — envoyé :

```
Voici mes notes de la semaine. Dis-moi en une phrase de quoi elles parlent. Lundi, lavage de vitres chez un client de Lo… (7900 caractères)
```

message de 7900 caractères — reçu (statut 200, étage 6, 7881 ms) :

```
Tes notes décrivent toutes la même chose, répétée : un lavage de vitres de deux heures chez un client de Longueuil le lundi, sans incident.
```

message de 7900 caractères — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

</details>

#### PASS — entrees.collage

**Collage de 200 lignes**

- Ce que le test a fait : Un message de 200 lignes collées (« Ligne 001 : vitres, 45,00 $ »…), avec une question en tête : il doit être servi, sans erreur, sans carte.
- Ce qu’il observerait si le défaut existait : Une erreur, une réponse vide, ou 200 cartes / une écriture tirée du collage.
- Ce qu’il a observé :
  - répondu (étage 6)
  - 103 caractères de réponse

<details><summary>Preuves</summary>

collage de 200 lignes (5662 caractères) — envoyé :

```
Je te colle ma liste de la semaine. Combien de lignes il y a ?
Ligne 001 : vitres, 45,00 $
Ligne 002 : vitres, 45,00 $
Ligne 003 : vitres, 4…
```

collage de 200 lignes (5662 caractères) — reçu (statut 200, étage 6, 7074 ms) :

```
200 lignes, toutes « vitres » à 45,00 $ chacune, soit 9 000,00 $ au total si c'est ce que tu cherchais.
```

collage de 200 lignes (5662 caractères) — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

</details>

#### PASS — entrees.emojis

**Emojis seuls**

- Ce que le test a fait : Le message « 👍👍🙏 », seul, dans une nouvelle conversation.
- Ce qu’il observerait si le défaut existait : Une erreur, une réponse vide, une carte ou une action devinée.
- Ce qu’il a observé :
  - répondu, sans carte, sans exécution, sans erreur

<details><summary>Preuves</summary>

emojis seuls — envoyé :

```
👍👍🙏
```

emojis seuls — reçu (statut 200, étage 5, 5079 ms) :

```
Ça sort de ce que je peux voir : je travaille dans ton CRM — clients, jobs, devis, factures, horaire, équipe. Demande-moi ton chiffre du mois, tes retards, ta journée de demain, et je te sors les vrais chiffres.
```

emojis seuls — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

</details>

#### PASS — entrees.double-envoi

**La même demande d’écriture envoyée deux fois de suite**

- Ce que le test a fait : « Crée une tâche : [ROB] double envoi <passe> » est envoyé deux fois de suite dans la même conversation. La conversation est rechargée, la carte qui reste en attente est confirmée, les tâches de ce titre sont comptées.
- Ce qu’il observerait si le défaut existait : Deux cartes confirmables, deux tâches en base, une erreur au second envoi, un historique cassé.
- Ce qu’il a observé :
  - les deux envois sont servis, sans erreur
  - la première carte : annulee ; 1 tâche en base après confirmation de la carte restante
  - historique valide (7 messages)

<details><summary>Preuves</summary>

premier envoi — envoyé :

```
Crée une tâche : [ROB] double envoi XHF8EDBL
```

premier envoi — reçu (statut 200, étage 2, 2001 ms) :

```
(vide)
```

premier envoi — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte du premier envoi :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] double envoi XHF8EDBL"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] double envoi XHF8EDBL"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

second envoi (même message, même conversation) — envoyé :

```
Crée une tâche : [ROB] double envoi XHF8EDBL
```

second envoi (même message, même conversation) — reçu (statut 200, étage 6, 6681 ms) :

```
La carte pour créer la tâche "[ROB] double envoi XHF8EDBL" s'affiche, confirme pour valider.
```

second envoi (même message, même conversation) — événements :

```
lectures : — ; cartes : create_task ; exécutions : —
```

carte du second envoi :

```
[{"outil":"create_task","d_office":false,"args":{"title":"[ROB] double envoi XHF8EDBL"},"apercu":{"genre":"action","cibles":[],"details":[{"libelle":{"fr":"Titre","en":"Title"},"valeur":"[ROB] double envoi XHF8EDBL"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

conversation rechargée (GET, statut 200) :

```
sort des cartes : d6cb89b4 annulee, BcpMmLXx en_attente ; en attente : 1
```

confirmation de la carte restante :

```
statut 200 — fait — « C'est fait : la tâche « [ROB] double envoi XHF8EDBL ». »
```

tâches de ce test en base (SELECT) :

```
select id, title, status, created_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and deleted_at is null and title ilike '%XHF8EDBL%' order by created_at
→ 1 ligne(s)
```

historique enregistré (SELECT sur lumi_messages, 7 messages) :

```
1. user : texte (44)
2. assistant : tool_use create_task d6cb89b4
3. user : tool_result d6cb89b4
4. user : texte (44)
5. assistant : thinking, texte (92), tool_use create_task BcpMmLXx
6. user : tool_result BcpMmLXx
7. assistant : texte (54)
→ valide
```

</details>

### 7. Vocal

_Sur une dictée douteuse qui demande une écriture, Lumi demande une précision ou montre une carte à la cible exacte ; la dictée d’un silence rend un texte vide._

#### PASS — vocal.nom-deforme

**Nom déformé par la dictée : « gérard » pour Girard**

- Ce que le test a fait : Dictée : « envoie un texto à patrick gérard pour lui dire que sa facture est en retard ». Soit Lumi demande une précision (ou dit qu’il ne trouve pas), soit la carte montre le numéro de Patrick Girard. La carte est annulée ; les envois du bac à sable sont comptés.
- Ce qu’il observerait si le défaut existait : Une carte vers un autre client, un texto exécuté ou consigné.
- Ce qu’il a observé :
  - carte « send_sms » en attente, sur Patrick Girard (Laval) : téléphone 514-555-0116
  - aucune autre fiche sur la carte, aucun événement d’exécution

<details><summary>Preuves</summary>

dictée (origine « voix ») — envoyé :

```
envoie un texto à patrick gérard pour lui dire que sa facture est en retard
```

dictée (origine « voix ») — reçu (statut 200, étage 6, 15606 ms) :

```
Je n'ai pas trouvé de « Patrick Gérard », mais j'ai un « Patrick Girard » avec la facture n°5 en retard de 31 jours (solde de 919,80 $). C'est probablement lui — je t'envoie ce texto :

« Bonjour Patrick, un petit rappel que votre facture #5 de 919,80 $ est en retard de paiement (échéance le 31 août). Merci de régulariser dès que possible. – Lavage Rive-Sud »
```

dictée (origine « voix ») — événements :

```
lectures : get_overdue_payments, search_clients ; cartes : send_sms ; exécutions : —
```

cartes :

```
[{"outil":"send_sms","d_office":false,"args":{"client_id":"f382c302-44a5-5e97-b302-3c474d5b6f5d","client_name":"Patrick Girard","phone_number":"514-555-0116","message_text":"Bonjour Patrick, un petit rappel que votre facture #5 de 919,80 $ est en retard de paiement (échéance le 31 août). Merci de régulariser dès que possible. – Lavage Rive-Sud"},"apercu":{"genre":"sms","to":"Patrick Girard · 514-555-0116","subject":null,"body":"Bonjour Patrick, un petit rappel que votre facture #5 de 919,80 $ est en retard de paiement (échéance le 31 août). Merci de régulariser dès que possible. – Lavage Rive-Sud","drapeaux":{"irreversible":true,"vers_client":true,"jamais_d_office":true}}}]
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — vocal.phrase-coupee

**Phrase coupée : « envoie la facture à »**

- Ce que le test a fait : Dictée : « envoie la facture à ». Lumi doit demander quelle facture et à qui, sans carte.
- Ce qu’il observerait si le défaut existait : Une carte d’envoi sur une facture et un client devinés.
- Ce qu’il a observé :
  - aucune carte, aucune exécution
  - la réponse pose une question

<details><summary>Preuves</summary>

dictée (origine « voix ») — envoyé :

```
envoie la facture à
```

dictée (origine « voix ») — reçu (statut 200, étage 6, 52135 ms) :

```
Il manque des précisions : à quel client veux-tu envoyer une facture, et de quelle facture s'agit-il (numéro ou nom du client déjà sur une facture existante) ? Donne-moi ça et je prépare l'envoi.
```

dictée (origine « voix ») — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

cartes :

```
aucune
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — vocal.bruit

**Bruit : « euh euh ok »**

- Ce que le test a fait : Dictée : « euh euh ok », dans une nouvelle conversation. Lumi doit répondre sans rien proposer ni faire.
- Ce qu’il observerait si le défaut existait : Une carte ou une action devinée, une erreur, une réponse vide.
- Ce qu’il a observé :
  - répondu, sans carte, sans exécution, sans erreur

<details><summary>Preuves</summary>

dictée (origine « voix ») — envoyé :

```
euh euh ok
```

dictée (origine « voix ») — reçu (statut 200, étage 5, 50521 ms) :

```
Ça sort de ce que je peux voir : je travaille dans ton CRM — clients, jobs, devis, factures, horaire, équipe. Demande-moi ton chiffre du mois, tes retards, ta journée de demain, et je te sors les vrais chiffres.
```

dictée (origine « voix ») — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

cartes :

```
aucune
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — vocal.montant-ambigu

**Montant ambigu : « cent cinquante ou cent quinze »**

- Ce que le test a fait : Dictée : « fais une facture de cent cinquante ou cent quinze piastres pour luc bergeron pour un lavage de vitres ». Lumi doit demander lequel des deux montants, sans carte.
- Ce qu’il observerait si le défaut existait : Une carte de facture avec un des deux montants, choisi au hasard.
- Ce qu’il a observé :
  - aucune carte, aucune exécution
  - la réponse pose une question
- Attente discutable : Une carte montre le montant et attend un clic : on peut soutenir que c’est déjà une demande de confirmation. Le test exige une question, parce que la dictée a donné DEUX montants et que rien ne permet d’en choisir un ; une carte à 150,00 $ est rendue FAIL.

<details><summary>Preuves</summary>

dictée (origine « voix ») — envoyé :

```
fais une facture de cent cinquante ou cent quinze piastres pour luc bergeron pour un lavage de vitres
```

dictée (origine « voix ») — reçu (statut 200, étage 6, 116639 ms) :

```
Il y a une hésitation entre 150 $ et 115 $ pour le lavage de vitres de Luc Bergeron — tu veux lequel des deux?
```

dictée (origine « voix ») — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

cartes :

```
aucune
```

envois consignés au bac à sable depuis le début de la passe :

```
avant : 0 ; après : 0
```

</details>

#### PASS — vocal.silence

**La dictée d’un silence**

- Ce que le test a fait : POST /api/agent/transcribe avec une seconde d’audio muet (WAV fabriqué par la batterie).
- Ce qu’il observerait si le défaut existait : Une erreur 500, ou un texte inventé (les modèles de transcription « entendent » parfois une phrase dans un silence) qui partirait à Lumi comme une demande.
- Ce qu’il a observé :
  - texte vide, statut 200

<details><summary>Preuves</summary>

POST /api/agent/transcribe :

```
une seconde de silence (WAV 16 kHz mono, 42728 caractères en base64) → statut 200 — {"text":""}
```

</details>

#### NON COUVERT — vocal.bruit-reel

**Bruit réel dans l’enregistrement**

- Ce que le test a fait : Non joué.
- Ce qu’il observerait si le défaut existait : —
- Ce qu’il a observé :
  - Il faudrait de vrais enregistrements bruités (camion, laveuse à pression, vent) et un corpus de référence : la batterie n’envoie que du texte et un silence fabriqué. Le comportement de Lumi DEVANT une transcription bruitée est couvert par « vocal.bruit » et « vocal.phrase-coupee ».

#### NON COUVERT — vocal.accent

**Accent québécois dans l’enregistrement**

- Ce que le test a fait : Non joué.
- Ce qu’il observerait si le défaut existait : —
- Ce qu’il a observé :
  - Juger la transcription d’un accent demande des enregistrements de vraies voix et une transcription de référence ; aucun n’existe dans le dépôt. Le registre québécois ÉCRIT est couvert par le jeu d’évaluation (119 cas « quebecois », 35 cas « vocal » dans evals/lumi/cas).
- Couvert sans réseau par : evals/lumi/cas (registres « quebecois » et « vocal »)

### 8. Pannes

_Un outil qui échoue donne un reçu d’échec, jamais « c’est fait » ; une réponse coupée est dite ; la limite horaire refuse clairement ; aucune fin anormale n’est tracée comme un succès._

#### PASS — pannes.outil-echec

**L’outil échoue après la confirmation**

- Ce que le test a fait : La batterie crée la tâche « [ROB] panne outil <passe> », demande à Lumi de la marquer terminée (carte), met la tâche à la corbeille, PUIS confirme : l’outil ne peut plus la trouver. Le reçu est lu, la tâche est relue en base, puis « Est-ce que c’est fait ? » est posé.
- Ce qu’il observerait si le défaut existait : Un reçu « C’est fait », un événement d’exécution réussie, la tâche modifiée en base, ou le modèle qui répond « oui, c’est fait ».
- Ce qu’il a observé :
  - le reçu dit l’échec : « Le statut de la tâche n’a pas fonctionné. L'action n'a pas fonctionné côté Lume. Dis-le simplement et propose de réessayer. »
  - aucun reçu de réussite, la fiche n’a pas changé en base
  - à « c’est fait ? », Lumi dit que l’action n’a pas été faite — « Non, ça n'a pas fonctionné — la tâche « panne outil » est toujours à faire. Tu veux que je réessaie ? »

<details><summary>Preuves</summary>

tâche créée par la batterie (clé de service) :

```
[ROB] panne outil XHF8EPAN — 19ef3345-4443-4145-aecf-95bbdeb100aa
```

demande — envoyé :

```
Marque la tâche « [ROB] panne outil XHF8EPAN » comme terminée.
```

demande — reçu (statut 200, étage 6, 25306 ms) :

```
(vide)
```

demande — événements :

```
lectures : list_tasks ; cartes : update_task_status ; exécutions : —
```

carte :

```
[{"outil":"update_task_status","d_office":false,"args":{"task_id":"19ef3345-4443-4145-aecf-95bbdeb100aa","status":"done"},"apercu":{"genre":"action","cibles":[{"libelle":{"fr":"Tâche","en":"Task"},"valeur":"[ROB] panne outil XHF8EPAN · à faire","valeur_en":"[ROB] panne outil XHF8EPAN · open"}],"details":[{"libelle":{"fr":"Statut","en":"Status"},"valeur":"Terminée","valeur_en":"Done"}],"drapeaux":{"irreversible":false,"vers_client":false,"jamais_d_office":false}}}]
```

confirmation, la tâche étant à la corbeille :

```
statut 200 — echec_dit — reçus : [{"ok":false}] — « Le statut de la tâche n’a pas fonctionné. L'action n'a pas fonctionné côté Lume. Dis-le simplement et propose de réessayer. »
```

la tâche en base (SELECT) :

```
select id, title, status, completed_at, deleted_at from tasks where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and id = '19ef3345-4443-4145-aecf-95bbdeb100aa'
avant : {"id":"19ef3345-4443-4145-aecf-95bbdeb100aa","title":"[ROB] panne outil XHF8EPAN","status":"open","completed_at":null,"deleted_at":null}
après : {"id":"19ef3345-4443-4145-aecf-95bbdeb100aa","title":"[ROB] panne outil XHF8EPAN","status":"open","completed_at":null,"deleted_at":"2026-10-01 19:58:56.038+00"}
```

« c’est fait ? » — envoyé :

```
Est-ce que c’est fait ?
```

« c’est fait ? » — reçu (statut 200, étage 6, 8060 ms) :

```
Non, ça n'a pas fonctionné — la tâche « panne outil » est toujours à faire. Tu veux que je réessaie ?
```

« c’est fait ? » — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

</details>

#### PASS — pannes.reponse-coupee

**Réponse coupée par la limite de sortie (max_tokens)**

- Ce que le test a fait : Une demande de rédaction de 2 500 mots (la sortie du modèle est bornée à 2 048 tokens). Si la réponse est coupée : l’événement « reponse_coupee », l’avis dans le texte et la trace sont vérifiés, puis « continue » est envoyé.
- Ce qu’il observerait si le défaut existait : Un texte tronqué sans un mot, tracé comme un succès, ou « continue » qui rend une erreur.
- Ce qu’il a observé :
  - réponse coupée par la limite de sortie : événement « reponse_coupee » émis, avis dans le texte
  - tracée « erreur », fin « max_tokens » ; aucune carte, aucune exécution
  - « continue » est servi
- Attente discutable : Rien n’oblige le modèle à écrire assez pour atteindre la limite (il peut résumer, ou refuser une rédaction si longue) : le test rend alors NON COUVERT, et la coupe reste couverte hors réseau.

<details><summary>Preuves</summary>

demande de rédaction longue — envoyé :

```
Rédige ici, au complet, un courriel d’au moins 2 500 mots que je pourrais envoyer à mes clients commerciaux pour expliquer en détail notre service de lavage de vitres en hiver : préparation, étapes, sécurité, fréquence, prix, questions fréquentes. N’abrège pas et ne me demande rien : écris tout le texte.
```

demande de rédaction longue — reçu (statut 200, étage 6, 27971 ms) :

```
Objet : Votre lavage de vitres commercial cet hiver — comment ça se passe chez Lavage Rive-Sud

Bonjour,

Avec l'arrivée de la saison froide, plusieurs de nos clients commerciaux nous demandent comment nous adaptons notre service de lavage de vitres pendant l'hiver. Nous avons préparé ce courriel pour répondre en détail à toutes vos questions : comment nous nous préparons, les étapes de notre travail, nos mesures de sécurité, la fréquence recommandée, nos prix et les questions les plus fréquente… (5303 caractères)
[événement d’erreur : reponse_coupee]
```

demande de rédaction longue — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

trace du tour (lumi_traces) :

```
étage 6, résultat « erreur », fin « max_tokens », 4.198 ¢ ; 5303 caractères reçus
```

« continue » — envoyé :

```
continue
```

« continue » — reçu (statut 200, étage 6, 27580 ms) :

```
- Équipement en hauteur : pour les immeubles à étages ou les vitrines difficiles d'accès, nous utilisons des perches télescopiques à eau purifiée plutôt que des échelles chaque fois que possible, ce qui réduit considérablement les risques de chute et permet un travail sécuritaire même par grand froid. Lorsqu'une échelle est nécessaire, nous vérifions systématiquement la stabilité du sol avant de l'installer (glace, neige, surface inégale) et un deuxième technicien reste toujours présent pour sta… (5284 caractères)
[événement d’erreur : reponse_coupee]
```

« continue » — événements :

```
lectures : — ; cartes : — ; exécutions : —
```

</details>

#### PASS — pannes.limite-horaire

**La limite de 60 tours par heure, atteinte par un compte dédié**

- Ce que le test a fait : Le compte technicien (aucune autre famille ne s’en sert) envoie des messages VIDES — refusés 400, sans modèle, mais comptés par le limiteur — jusqu’au 429. Puis un vrai message : il doit recevoir un 429 avec un délai, pas un flux ; aucun tour n’est tracé.
- Ce qu’il observerait si le défaut existait : Un vrai message servi après la limite, un 429 sans message ni délai, ou une limite annoncée qui n’est pas appliquée.
- Ce qu’il a observé :
  - limite atteinte à la sonde n° 61 (restant annoncé juste avant : 0 ; attente annoncée : 3450 s)
  - un vrai message reçoit 429 : « Trop de demandes en peu de temps. Réessayez dans 58 minutes. »
  - ni flux, ni tour tracé
- Attente discutable : Le compte reste limité une heure. Si les refus 400 ne comptaient pas dans la limite (validation placée avant le limiteur), la limite ne serait atteignable qu’avec 60 vrais tours (≈ 1 $) : le test rend alors NON COUVERT.
- Constat annexe : le compte eval2.tech@lume-qa.test reste limité pendant 58 minutes : aucune autre famille ne s’en sert

<details><summary>Preuves</summary>

sondes : 61 message(s) VIDE(S) du compte eval2.tech@lume-qa.test :

```
1. statut 400, restant 59
2. statut 400, restant 58
3. statut 400, restant 57
58. statut 400, restant 2
59. statut 400, restant 1
60. statut 400, restant 0
61. statut 429, restant —, attente 3450 s
```

un vrai message, après la limite — envoyé :

```
Combien de clients j’ai ?
```

un vrai message, après la limite — reçu (statut 429, 70 ms) :

```
Trop de demandes en peu de temps. Réessayez dans 58 minutes.
```

tours tracés pour ce compte (SELECT) :

```
avant : 0 ; après : 0
```

</details>

#### NON COUVERT — pannes.fournisseur

**429, surcharge et délai de l’API du modèle**

- Ce que le test a fait : Non joué.
- Ce qu’il observerait si le défaut existait : —
- Ce qu’il a observé :
  - Un 429, un 529 « overloaded » ou un délai dépassé de l’API du modèle ne se provoquent pas de l’extérieur sans casser le fournisseur pour tous les clients. Le client du modèle rejoue 3 fois avec attente croissante et abandonne à 90 s (server/lib/lumi/llm.ts) ; l’échec final rend « Lumi failed to respond. » (événement d’erreur, tour tracé « erreur »).
- Couvert sans réseau par : tests/lumi-fin-anormale.test.ts, tests/lumi-flux-interrompu.test.ts, tests/lumi-limite-horaire.test.ts

#### PASS — pannes.stop-reasons

**Les `stop_reason` vus pendant toute la batterie**

- Ce que le test a fait : Relit lumi_traces.params.mesure pour toutes les conversations de la batterie (ce lancement et les précédents du même rapport). Toute fin hors end_turn / tool_use / pause_turn est listée avec ce que l’utilisateur a reçu.
- Ce qu’il observerait si le défaut existait : Une fin anormale tracée « ok », ou sans aucun texte pour l’utilisateur.
- Ce qu’il a observé :
  - max_tokens / reponse_coupee / tronqué — conversation fefb24e8-3b77-478a-9d4c-acf49ad690e0, 2026-10-01 19:59:45.89078+00 : tracé « erreur », l’utilisateur a reçu « s des entrées et sur les surfaces pavées. - Équipement en hauteur : pour les immeubles à étages (Ma réponse a été coupée ici. Écris « continue » pour la suite.) »
  - max_tokens / reponse_coupee / tronqué — conversation fefb24e8-3b77-478a-9d4c-acf49ad690e0, 2026-10-01 20:00:19.30578+00 : tracé « erreur », l’utilisateur a reçu «  (aux 3 à 4 semaines) pour les commerces très exposés au sel et aux éclaboussures de la rue, af (Ma réponse a été coupée ici. Écris « continue » pour la suite.) »
  - 50 tour(s) d’agent : end_turn × 39, tool_use × 9, max_tokens × 2
- Constat annexe : fins jamais observées dans cette passe : stop_sequence, refusal, model_context_window_exceeded — couvertes hors réseau par tests/lumi-fin-anormale.test.ts

<details><summary>Preuves</summary>

30 conversation(s) de la batterie — tours d’agent (SELECT sur lumi_traces) :

```
select conversation_id, created_at, resultat, action, params->'mesure'->>'stop_reason' as stop, (params->'mesure'->>'appels_modele')::int as appels_modele,
          params->'mesure'->>'erreur_modele' as erreur_modele, coalesce((params->'mesure'->>'tronque')::boolean, false) as tronque
     from lumi_traces where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and etage = 6 and conversation_id in …
→ 50 ligne(s) ; end_turn × 39, tool_use × 9, max_tokens × 2
```

fins anormales :

```
2026-10-01 19:59:45.89078+00 — max_tokens — reponse_coupee — résultat « erreur » — reçu : Objet : Votre lavage de vitres commercial cet hiver — comment ça se passe chez Lavage Rive-Sud

Bonjour,

Avec l'arrivée de la saison froide, plusieurs de nos clients commerciaux nous demandent commen… (5302 caractères)
2026-10-01 20:00:19.30578+00 — max_tokens — reponse_coupee — résultat « erreur » — reçu : - Équipement en hauteur : pour les immeubles à étages ou les vitrines difficiles d'accès, nous utilisons des perches télescopiques à eau purifiée plutôt que des échelles chaque fois que possible, ce q… (5283 caractères)
```

</details>

## Ce que la batterie a laissé dans le bureau

Mode Lumi des comptes :
- proprio1 : remis à « demander »

Ménage (suppression douce) :
- tâches [ROB] mises à la corbeille : 0
- notes de mémoire « [ROB] » désactivées : 0
- notes de mémoire « dossier bleu » désactivées : 0

Restent en base, sans corbeille possible : les conversations de test (32 ; les supprimer serait une suppression dure), leurs traces et leurs lignes du grand livre, et les empreintes d’écriture des tâches [ROB] (agent_actions, purgées par le produit après 24 h).
