# Batterie de l’agent de support

Passe du 2026-10-01T20:27:18.394Z, contre https://lumecrm.net, bureau de test « [TEST] QA Lumi éval 2 — ne pas utiliser » `5930d318-b207-40f3-9e14-f8898a02e240` (forfait Autopilot).
Jeu [EVAL] présent. Appels au chat de support, tous lancements réunis : proprio1 6, proprio2 32, proprio3 6, proprio4 5, tech 5. Réponses du modèle déjà servies au bureau dans les 24 h avant le dernier lancement : 25 (plafond : 60).

La batterie a été jouée en plusieurs lancements :

- 2026-10-01T20:27:18.394Z — kb, cout — proprio1 : 6 appel(s), proprio2 : 6 appel(s), proprio3 : 6 appel(s), proprio4 : 5 appel(s), tech : 5 appel(s)
- 2026-10-01T22:34:46.619Z — kb, cout — proprio2 : 26 appel(s)

Tout est jugé par du code (présence ou absence d’un mot, d’un montant, d’une ligne) ; aucun modèle ne juge. « A RELIRE » = le code n’a trouvé aucun défaut mais le critère demande un humain. « NON COUVERT » = le test n’a pas pu trancher (flux coupé, plafond, limite) ; aucun test n’est rejoué jusqu’à ce qu’il passe.

## Bilan

| Famille | PASS | FAIL | NON COUVERT | A RELIRE |
|---|---:|---:|---:|---:|
| 1. Base de connaissances (« comment faire ») | 46 | 2 | 0 | 0 |
| 4. Escalade vers un humain | 1 | 0 | 0 | 0 |
| 9. Coût | 0 | 0 | 0 | 1 |
| **Total (50)** | **47** | **2** | **0** | **1** |

## Ce qui échoue (2)

- **kb.terrain-classement** — « je veux voir le classement de mes reps pour le mois passé »
  - libellé attendu absent de la réponse : Changer
- **kb.pages-clients-devis** — « mon client recoit quoi quand j'envoie une soumission »
  - libellé attendu absent de la réponse : approuver|signer|téléphone|sans (avoir à créer de )?compte

## À relire par un humain (1)

- **cout.releve** — Relevé du coût et de l’étage de chaque question de la batterie
  - 49 question(s) relevée(s) : 3 sans modèle, 45 par le modèle, 1 sans trace
  - coût total : 65.792 ¢ US pour 88 appel(s) au modèle ; moyenne par question servie par le modèle : 1.462 ¢
  - modèle(s) : claude-sonnet-5 (45)
  - 3 ligne(s) du grand livre dans la fenêtre sans tour de la batterie (ces comptes ont servi ailleurs) : 1.352 ¢, non comptées
  - À trancher : Relevé, pas un verdict : lire le tableau de la section « Coût ».

## Non couvert (0)

Tout est couvert.

## Coût

49 question(s) ayant reçu une réponse : 3 servie(s) sans modèle (6 %), 45 par le modèle, 1 sans trace (transfert direct, ou trace non lue).
Coût total relu dans le grand livre : 65.792 ¢ (0.6579 $ US) pour 88 appel(s) au modèle ; coût moyen d’une question servie par le modèle : 1.462 ¢.
Modèle(s) du grand livre : claude-sonnet-5 (45 question(s)).

| Étage | Questions | Coût |
|---|---:|---:|
| 0 — réponse écrite (FAQ, plusieurs questions, plafond) | 2 | 0.000 ¢ |
| 5 — centre d’aide | 1 | 0.000 ¢ |
| 6 — modèle | 45 | 65.792 ¢ |
| aucune trace (transfert direct ou trace non lue) | 1 | 0.000 ¢ |

| Test | Compte | Étage | Action | Outils | Modèle | Appels | Coût | Durée |
|---|---|---:|---|---|---|---:|---:|---:|
| kb.taches-supprimer | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.416 ¢ | 5411 ms |
| kb.jobs-supprimer | proprio3 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.825 ¢ | 4823 ms |
| kb.calendrier-creer | proprio4 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.853 ¢ | 5244 ms |
| kb.repartition-map | tech | 6 | app | search_help | claude-sonnet-5 | 2 | 0.847 ¢ | 4616 ms |
| kb.clients-archiver | proprio1 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.941 ¢ | 4852 ms |
| kb.demandes-convertir | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.402 ¢ | 4653 ms |
| kb.devis-modele | proprio3 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.007 ¢ | 6243 ms |
| kb.devis-mesure | proprio4 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.560 ¢ | 5649 ms |
| kb.devis-depot | tech | 6 | app | search_help | claude-sonnet-5 | 2 | 2.039 ¢ | 17113 ms |
| kb.messages-texto | proprio1 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.923 ¢ | 11032 ms |
| kb.factures-creer | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.963 ¢ | 12859 ms |
| kb.factures-payee | proprio3 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.993 ¢ | 5062 ms |
| kb.finances-paiements | proprio4 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.862 ¢ | 6200 ms |
| kb.finances-versements | tech | 6 | app | search_help | claude-sonnet-5 | 2 | 1.039 ¢ | 12402 ms |
| kb.finances-csv | proprio1 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.046 ¢ | 7001 ms |
| kb.payments-interrupteurs | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.205 ¢ | 7306 ms |
| kb.payments-pourboires | proprio3 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.121 ¢ | 7780 ms |
| kb.payments-instantanes | proprio4 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.197 ¢ | 17991 ms |
| kb.payments-litiges | tech | 6 | app | search_help, transfer_to_human | claude-sonnet-5 | 3 | 1.818 ¢ | 12550 ms |
| kb.payments-rappels | proprio1 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.052 ¢ | 33887 ms |
| kb.forfait-changer | proprio3 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.857 ¢ | 23848 ms |
| kb.paie-export | tech | 6 | app | search_help | claude-sonnet-5 | 2 | 0.796 ¢ | 25495 ms |
| kb.membres-inviter | proprio1 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.921 ¢ | 30182 ms |
| escalade.canari | proprio2 | — | — | — | — | 0 | — | 1648 ms |
| kb.taxes-region | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.076 ¢ | 6853 ms |
| kb.commissions-voir | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.637 ¢ | 6050 ms |
| kb.roles-permissions | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.041 ¢ | 5348 ms |
| kb.temps-approuver | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.049 ¢ | 5777 ms |
| kb.gps-activer | proprio2 | 5 | aide-directe | /settings/location, /settings/payments, /automations | — | 0 | — | 1476 ms |
| kb.formations-creer | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.933 ¢ | 5991 ms |
| kb.terrain-pin | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.027 ¢ | 4753 ms |
| kb.terrain-pipeline | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.522 ¢ | 4991 ms |
| kb.terrain-classement | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.522 ¢ | 5338 ms |
| kb.terrain-rapports | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.445 ¢ | 4099 ms |
| kb.stats-revenus | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.474 ¢ | 5161 ms |
| kb.profil-langue | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.891 ¢ | 4600 ms |
| kb.entreprise-logo | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.991 ¢ | 5257 ms |
| kb.bureaux-nouveau | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.446 ¢ | 5314 ms |
| kb.produits-service | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.863 ¢ | 4507 ms |
| kb.automatisations-pause | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.926 ¢ | 4861 ms |
| kb.avis-google | proprio2 | 0 | faq:google-reviews | — | — | 0 | — | 1063 ms |
| kb.formulaire-site | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.999 ¢ | 5234 ms |
| kb.securite-2fa | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 0.947 ¢ | 5612 ms |
| kb.connexion-mdp | proprio2 | 0 | faq:forgot-password | — | — | 0 | — | 777 ms |
| kb.pages-clients-devis | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 2.662 ¢ | 8198 ms |
| kb.hors-lume | proprio2 | 6 | app | — | claude-sonnet-5 | 1 | 0.369 ¢ | 3749 ms |
| kb.compte-forfait | proprio2 | 6 | app | — | claude-sonnet-5 | 1 | 0.344 ¢ | 3140 ms |
| kb.compte-paiements | proprio2 | 6 | app | — | claude-sonnet-5 | 1 | 0.379 ¢ | 5306 ms |
| kb.ambigu-taches | proprio2 | 6 | app | search_help | claude-sonnet-5 | 2 | 1.565 ¢ | 5598 ms |

## Détail de chaque test

### 1. Base de connaissances (« comment faire »)

_Le support répond à partir de sa documentation : il cite la bonne page de l’app (route) et le libellé exact du bouton, ne passe pas un « comment faire » à l’équipe, vouvoie, et ne laisse aucun statut anglais brut._

#### PASS — kb.taches-supprimer

**« comment je fais pour effacer une tache que j'ai pu besoin »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/tasks, le libellé Supprimer, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/tasks)
  - cite le libellé attendu (Supprimer)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je fais pour effacer une tache que j'ai pu besoin
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.416 ¢ ; 5411 ms) :

```
Dans Tâches (/tasks), trouvez la tâche en question et cliquez l'icône corbeille « Supprimer » sur sa ligne (ou le menu « … » → « Supprimer »). Pour en effacer plusieurs d'un coup, cochez-les puis « Supprimer ». Attention, c'est immédiat et sans confirmation, donc pas de façon de revenir en arrière après.

Si vous parliez plutôt d'un travail planifié (une job) et non d'une tâche à-faire, dites-le-moi : ça se passe dans Jobs (/jobs), menu « … » → « Supprimer ».

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket b1d7a893-7155-4a5c-aa85-9196270956cd — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.jobs-supprimer

**« c'est où pour supprimer une job au complet »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/jobs, le libellé Supprimer, sans transfert à un humain.
- Compte : proprio3
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/jobs)
  - cite le libellé attendu (Supprimer)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où pour supprimer une job au complet
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.825 ¢ ; 4823 ms) :

```
Pour supprimer une job complètement : allez dans Jobs (/jobs), repérez la ligne de la job visée, cliquez sur le menu « … » puis « Supprimer », et confirmez. Un bouton « Annuler » apparaît quelques secondes après si vous changez d'idée. Notez qu'il n'y a pas d'« Archiver » : les jobs complétées ou annulées se retrouvent automatiquement dans l'onglet « Archivé ».

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 2f24eca8-e184-4776-89e1-0fc851add1ae — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.calendrier-creer

**« comment je cree une job direct dans le calendrier »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/calendar, le libellé Créer, sans transfert à un humain.
- Compte : proprio4
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/calendar)
  - cite le libellé attendu (Créer)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je cree une job direct dans le calendrier
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.853 ¢ ; 5244 ms) :

```
Dans le Calendrier (/calendar), cliquez sur le bouton « + Créer » en haut et choisissez « Job » — vous pouvez aussi la placer directement en cliquant sur un créneau vide de la vue jour/semaine. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket feb35364-795b-47e4-ab9e-43324fee6eed — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.repartition-map

**« c'est où que je vois mes gars sur la map en temps réel »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/dispatch, le libellé répartition, sans transfert à un humain.
- Compte : tech
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/dispatch)
  - cite le libellé attendu (répartition)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où que je vois mes gars sur la map en temps réel
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.847 ¢ ; 4616 ms) :

```
Vous les voyez sur la Carte de répartition (/dispatch) : vos techniciens et vos jobs y apparaissent en temps réel, avec les filtres « Jobs (n) » et « Géofences ». Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 58e4e128-7093-4105-9d37-89b29d653bf3 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.clients-archiver

**« mon client a fermé sa shop, comment je l'archive »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/clients, le libellé Archiver, sans transfert à un humain.
- Compte : proprio1
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/clients)
  - cite le libellé attendu (Archiver)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
mon client a fermé sa shop, comment je l'archive
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.941 ¢ ; 4852 ms) :

```
Pour archiver ce client : ouvrez sa fiche dans Clients (/clients/:id), puis menu « … » → « Archiver ». Ses jobs, factures et devis restent visibles, et vous pourrez le restaurer plus tard depuis Paramètres → Archives (/settings/archives). Si vous vouliez plutôt l'effacer définitivement, c'est dans la fiche → « Modifier » → bouton rouge « Supprimer ».

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket ae9267e0-f107-4bf1-b0fa-d5ac1f6b07b6 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.demandes-convertir

**« j'ai recu une demande par mon formulaire, comment je la change en soumission »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/requests, le libellé Convertir en devis, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/requests)
  - cite le libellé attendu (Convertir en devis)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
j'ai recu une demande par mon formulaire, comment je la change en soumission
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.402 ¢ ; 4653 ms) :

```
Ouvrez la demande concernée dans Demandes (/requests), cliquez dessus pour ouvrir sa fiche (/requests/:id), puis dans le menu « Plus » choisissez « Convertir en devis ». Le devis se crée avec les infos du client déjà pré-remplies.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 2c03cc32-0fc1-4d94-97f8-4344aed30895 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.devis-modele

**« comment je fais un modèle de soumission pour pas tout retaper à chaque fois »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/quotes\/(presets|templates), le libellé Nouveau modèle, sans transfert à un humain.
- Compte : proprio3
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/quotes\/(presets|templates))
  - cite le libellé attendu (Nouveau modèle)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je fais un modèle de soumission pour pas tout retaper à chaque fois
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.007 ¢ ; 6243 ms) :

```
Allez dans Devis → Modèles de devis (/quotes/presets). Cliquez « Nouveau modèle » : vous y entrez titre, description, image de couverture, votre liste de services avec prix/quantités, un texte d'introduction, vos conditions et, si besoin, un dépôt. Une fois sauvegardé, vous pourrez le réutiliser à chaque nouveau devis sans tout retaper.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 19941895-acd6-4056-a6f9-2214ebebf439 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.devis-mesure

**« est-ce que je peux mesurer le terrain sur une carte pour ma soumission »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/quotes(\/:id)?\/measure, le libellé Envoyer au devis|Terminer|Rechercher une adresse, sans transfert à un humain.
- Compte : proprio4
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/quotes(\/:id)?\/measure)
  - cite le libellé attendu (Envoyer au devis|Terminer|Rechercher une adresse)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
est-ce que je peux mesurer le terrain sur une carte pour ma soumission
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.560 ¢ ; 5649 ms) :

```
Oui, tout à fait! Vous pouvez tracer la mesure directement sur une carte : allez dans Devis → « Mesure sur carte » (/quotes/measure, ou depuis une soumission /quotes/:id/measure). Cherchez l'adresse, tracez la surface, cliquez « Terminer », puis « Envoyer au devis » pour que la mesure s'ajoute à votre soumission (vous pouvez aussi garder une capture d'écran).

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 25cdc758-b09f-4e3f-9232-0c51fe2b2516 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.devis-depot

**« je veux demander un dépot de 30% sur mes soumissions, c'est où »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/quotes, le libellé dépôt, sans transfert à un humain.
- Compte : tech
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/quotes)
  - cite le libellé attendu (dépôt)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux demander un dépot de 30% sur mes soumissions, c'est où
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.039 ¢ ; 17113 ms) :

```
Pour exiger un dépôt sur vos devis, deux endroits à régler : d'abord activez « Paiement des devis » dans Paramètres → Lume Payments (/settings/payments), puis dans chaque modèle de devis (Devis → Modèles, /quotes/presets) ou directement sur un devis, réglez le dépôt en pourcentage (30%) ou montant fixe. Comme vous n'avez pas encore de fournisseur de paiement configuré, il faudra d'abord connecter Lume Payments avant que le dépôt puisse être perçu en ligne.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket ea6e1fcb-b163-4f60-99c2-a773d663993f — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.messages-texto

**« comment j'envoie un texto a un client »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/messages, le libellé Nouveau message, sans transfert à un humain.
- Compte : proprio1
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/messages)
  - cite le libellé attendu (Nouveau message)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'envoie un texto a un client
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.923 ¢ ; 11032 ms) :

```
Pour envoyer un texto à un client, allez dans Messages (/messages), cliquez sur « Nouveau message », choisissez le client (ou entrez son numéro), tapez votre texte et cliquez sur « Envoyer ». Assurez-vous d'abord d'avoir activé votre numéro dédié dans Paramètres → Messagerie SMS (/settings/messaging) en cliquant sur « Obtenir mon numéro » si ce n'est pas déjà fait.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 9464751b-e4bc-497b-a509-5c3916c85063 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.factures-creer

**« comment je fais une facture »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/invoices\/new|\/finances|\/quotes, le libellé Nouvelle facture|Convertir en facture, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/invoices\/new|\/finances|\/quotes)
  - cite le libellé attendu (Nouvelle facture|Convertir en facture)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je fais une facture
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.963 ¢ ; 12859 ms) :

```
Pour créer une facture, deux façons simples :

- Depuis un devis approuvé : ouvrez-le dans Devis (/quotes), puis cliquez sur « Convertir en facture ». Les articles, prix et taxes sont repris automatiquement — vérifiez juste la date d'échéance avant d'envoyer.
- Directement sans devis : allez dans Finances → Facturation (/finances) et créez une nouvelle facture à partir de là.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 99cdaf4e-ec99-45e6-9dba-18cd6b41e273 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.factures-payee

**« mon client m'a payé cash, comment je marque sa facture payée »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/finances|\/invoices, le libellé Marquer payée, sans transfert à un humain.
- Compte : proprio3
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/finances|\/invoices)
  - cite le libellé attendu (Marquer payée)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
mon client m'a payé cash, comment je marque sa facture payée
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.993 ¢ ; 5062 ms) :

```
Allez dans Finances → Facturation (/finances), trouvez la facture de ce client, puis cliquez sur le menu « … » → « Marquer payée ». Dans la fenêtre, indiquez le montant payé, choisissez « Comptant » comme méthode de paiement, puis la date de transaction, et confirmez — ça ferme automatiquement le job lié.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket b4bf90df-508b-4774-b013-9f9c10358164 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.finances-paiements

**« c'est où que je vois tous les paiements que j'ai recus ce mois-ci »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/finances, le libellé Paiements, sans transfert à un humain.
- Compte : proprio4
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/finances)
  - cite le libellé attendu (Paiements)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où que je vois tous les paiements que j'ai recus ce mois-ci
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.862 ¢ ; 6200 ms) :

```
Vous pouvez voir tous vos paiements reçus dans Finances → onglet Paiements (/finances). Là, utilisez le filtre « Période » pour ne voir que le mois en cours, et vous pouvez aussi filtrer par statut ou méthode de paiement (carte, comptant, chèque).

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket f87ca29c-ce29-44d4-8940-4197fc4c8a4c — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.finances-versements

**« c'est où que je vois quand l'argent rentre dans mon compte de banque »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/finances, le libellé Versements, sans transfert à un humain.
- Compte : tech
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/finances)
  - cite le libellé attendu (Versements)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où que je vois quand l'argent rentre dans mon compte de banque
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.039 ¢ ; 12402 ms) :

```
Vous verrez ça dans Finances → onglet Versements (/finances) : l'argent qui va à votre compte bancaire y apparaît sous forme de tuiles « Disponible », « En route » et « Déposé », et en cliquant sur une ligne vous avez les détails de chaque versement. Par contre, j'ai vu dans votre dossier qu'aucun fournisseur de paiement (Stripe) n'est encore connecté chez vous — sans ça, il n'y aura pas de versement à afficher. Voulez-vous que je vous explique comment activer les paiements (Lume Payments) ?
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 30b70bd2-7ed6-43c9-8bae-32fe164aaf40 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.finances-csv

**« je veux sortir mes factures en csv pour mon comptable »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/finances, le libellé CSV, sans transfert à un humain.
- Compte : proprio1
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/finances)
  - cite le libellé attendu (CSV)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux sortir mes factures en csv pour mon comptable
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.046 ¢ ; 7001 ms) :

```
Pour sortir vos factures en CSV : allez dans Finances → onglet Facturation (/finances), puis cliquez sur le bouton « CSV » en haut de la liste. Ça télécharge toutes vos factures, prêtes à envoyer à votre comptable.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 0764d087-5129-457f-92c3-c74ab5c4e993 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.payments-interrupteurs

**« je veux fermer le paiement en ligne sur les devis mais le garder sur les factures »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/payments, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/payments)
  - aucun libellé imposé
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux fermer le paiement en ligne sur les devis mais le garder sur les factures
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.205 ¢ ; 7306 ms) :

```
Dans Paramètres → Lume Payments (/settings/payments), section « Paiements du portail client », il y a deux interrupteurs distincts : « Paiement des devis » et « Paiement des factures ». Il suffit de désactiver seulement celui des devis en laissant celui des factures activé - les deux sont indépendants (le bouton « Désactiver les paiements » global coupe les deux en même temps, donc il ne faut pas toucher à celui-là).

À noter : dans votre dossier, aucun fournisseur de paiement n'est encore configuré, donc il faudra d'abord connecter Stripe avant que ces interrupteurs n'aient un effet.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 7898bc16-e78a-452c-9f45-4f4ed8416332 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.payments-pourboires

**« est-ce que mes clients peuvent laisser un pourboire quand ils paient leur facture »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/payments, sans transfert à un humain.
- Compte : proprio3
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/payments)
  - aucun libellé imposé
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
est-ce que mes clients peuvent laisser un pourboire quand ils paient leur facture
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.121 ¢ ; 7780 ms) :

```
Oui, c'est possible : dans Paramètres → Lume Payments (/settings/payments), il y a une option « Pourboires » dans les Réglages avancés — une fois activée, vos clients voient « Ajouter un pourboire (facultatif) » sur la page de paiement de leur facture (/pay/:token). Attention : chez vous aucun fournisseur de paiement en ligne n'est encore connecté, donc il faut d'abord activer Stripe dans cette même page avant que les pourboires (et le paiement en ligne en général) fonctionnent.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 0b157c83-fb59-4fb9-a64e-81c390f7c6dd — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.payments-instantanes

**« je peux tu recevoir mon argent le jour meme au lieu d'attendre le versement »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/payments|\/finances, sans transfert à un humain.
- Compte : proprio4
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/payments|\/finances)
  - aucun libellé imposé
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je peux tu recevoir mon argent le jour meme au lieu d'attendre le versement
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.197 ¢ ; 17991 ms) :

```
Dans Lume Payments (/settings/payments), section « Versements », il y a une option « Versements instantanés » : le bouton « Verser » permet d'envoyer l'argent tout de suite sur une carte de débit, moyennant des frais Stripe, plutôt que d'attendre le versement normal. Il faut d'abord « Configurer » cette carte de débit dans Stripe. Je vois toutefois que vous n'avez pas encore de fournisseur de paiement configuré chez vous — c'est la première étape avant de pouvoir utiliser les versements instantanés. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 4679c574-c7e2-47c9-8aea-cf351073bc49 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.payments-litiges

**« un client a contesté un paiement sur sa carte, je fais quoi »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend transfert toléré.
- Compte : tech
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - aucun libellé imposé
  - transféré à un humain (toléré pour cette question)
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
un client a contesté un paiement sur sa carte, je fais quoi
```

réponse (statut 200, étage 6 — app, outils : search_help, transfer_to_human ; claude-sonnet-5, 3 appel(s), 1.818 ¢ ; 12550 ms) :

```
Je vois dans votre dossier qu'aucun fournisseur de paiement n'est configuré sur votre compte en ce moment, donc une contestation de paiement par carte (chargeback) ne devrait pas venir de Lume Payments — cela mérite une vérification par l'équipe pour comprendre d'où vient ce paiement et comment le traiter. Je transfère votre demande à l'équipe pour qu'elle regarde ça avec vous.
L'équipe a été avisée et devrait vous répondre d'ici 4 heures ouvrables pour vous aider avec cette contestation de paiement.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 8b73da6b-be83-4192-9f14-7ae7a3b1be41 — statut « open », escalated_at 2026-10-01 20:31:41.724+00, motif « Client signale une contestation (chargeback) d'un paiement par carte, alors qu'aucun fournisseur de paiement n'est configuré sur le compte — besoin de vérification par l'équipe. », slack_channel_id NULL, slack_thread_ts NULL
messages système : escalated:email ; champ « escalated » de l’API : true
```

</details>

#### PASS — kb.payments-rappels

**« comment j'active les rappels automatiques pour les factures en retard »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/payments|\/automations, le libellé rappel|relance, sans transfert à un humain.
- Compte : proprio1
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/payments|\/automations)
  - cite le libellé attendu (rappel|relance)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'active les rappels automatiques pour les factures en retard
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.052 ¢ ; 33887 ms) :

```
Pour activer les rappels de paiement sur les factures en retard, allez dans Paramètres → Lume Payments (/settings/payments), section « Rappels de paiement » : activez l'interrupteur, choisissez le délai en jours et le canal (Courriel, ou Courriel + SMS si un numéro texto est configuré). Lume enverra alors automatiquement une relance avec le lien de paiement aux clients en retard. Notez qu'il existe aussi une automatisation prête à l'emploi « Relance de facture » (3, 7, 14 et 30 jours) dans Automatisations (/automations), qu'il faut publier pour qu'elle s'active.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 89b01be0-fbd6-4187-bf53-d6d42420874e — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.taxes-region

**« comment j'ajoute la TPS pis la TVQ sur mes factures »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/taxes, le libellé Ajouter une région, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/taxes)
  - cite le libellé attendu (Ajouter une région)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'ajoute la TPS pis la TVQ sur mes factures
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.076 ¢ ; 6853 ms) :

```
Allez dans Paramètres → Taxes (/settings/taxes), cliquez sur « Ajouter une région », choisissez Québec pour avoir TPS (5 %) et TVQ (9,975 %), puis « Définir par défaut ». Une fois ça fait, ces taxes s'appliqueront automatiquement à vos nouveaux devis, jobs et factures (les documents déjà émis ne changeront pas). Si vous voulez qu'une facture précise soit sans taxes, vous pouvez le préciser au cas par cas directement sur celle-ci.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 606e69a5-9f2a-4fc1-8314-d4ddf84c76b2 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.forfait-changer

**« je veux monter de forfait, je fais ça où »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/billing, le libellé Changer ou rétrograder mon plan|Voir tous les plans|Passer à, transfert toléré.
- Compte : proprio3
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/billing)
  - cite le libellé attendu (Changer ou rétrograder mon plan|Voir tous les plans|Passer à)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux monter de forfait, je fais ça où
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.857 ¢ ; 23848 ms) :

```
Pour monter de forfait, allez dans Paramètres → Forfait & facturation (/settings/billing). Vous y verrez les plans disponibles avec un bouton « Passer à … » — le changement prend effet immédiatement et le montant est ajusté au prorata. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 0ce4f757-4e43-4599-90e3-111e215da08e — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.commissions-voir

**« c'est où que je vois mes commissions du mois »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/commissions, le libellé Mes commissions, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/commissions)
  - cite le libellé attendu (Mes commissions)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où que je vois mes commissions du mois
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.637 ¢ ; 6050 ms) :

```
Pour voir vos commissions du mois, allez dans Finances/Commissions → onglet « Mes commissions » (/commissions). Comme vous êtes owner, vous verrez aussi « Vue d'ensemble » et « Représentants » pour voir celles de toute l'équipe. Les commissions sont calculées sur le montant avant taxes et sont marquées « Gagnée le » une fois la facture payée (sinon c'est une « Estimation »).

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 08cdc038-f5ef-4f8a-8814-d3dc4c8af3fe — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.paie-export

**« comment je sors la paie de mes gars en fichier pour mon comptable »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/payroll, le libellé Exporter, sans transfert à un humain.
- Compte : tech
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/payroll)
  - cite le libellé attendu (Exporter)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je sors la paie de mes gars en fichier pour mon comptable
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.796 ¢ ; 25495 ms) :

```
Vous pouvez faire ça dans Paramètres → Paie (/settings/payroll) : repérez la bonne période de paie, puis cliquez sur « Exporter (QuickBooks CSV) » pour sortir un fichier directement utilisable par votre comptable, sans besoin de confirmation.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket a962ac8e-3e27-4964-a594-9a53b873760d — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.membres-inviter

**« comment j'ajoute un nouvel employé dans lume »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/team, le libellé Inviter un membre, sans transfert à un humain.
- Compte : proprio1
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/team)
  - cite le libellé attendu (Inviter un membre)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'ajoute un nouvel employé dans lume
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.921 ¢ ; 30182 ms) :

```
Pour ajouter un employé, allez dans Paramètres → Membres (/settings/team), puis cliquez sur « Inviter un membre » : entrez son courriel, choisissez son rôle (admin, représentant ou technicien) et sa portée d'accès, puis « Envoyer l'invitation ». La personne recevra un lien par courriel pour créer son compte. À noter : si votre forfait n'a plus de sièges disponibles, un siège supplémentaire vous sera facturé au prorata.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 49ba0dc2-50d2-4aca-ab70-550a5b11513c — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.roles-permissions

**« je veux pas que mes techniciens voient les factures, je fais comment »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/roles, le libellé permission, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/roles)
  - cite le libellé attendu (permission)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux pas que mes techniciens voient les factures, je fais comment
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.041 ¢ ; 5348 ms) :

```
Bonne nouvelle : vos techniciens actuels n'ont déjà pas accès aux montants (factures, soumissions, paiements) — c'est bloqué automatiquement pour le rôle « Technicien », aucune configuration n'est nécessaire. Vous pouvez vérifier les rôles de votre équipe dans Paramètres → Rôles & Permissions (/settings/roles). Si vous voulez qu'un membre précis puisse voir les prix, il faudrait plutôt lui donner le rôle Représentant ou Administrateur.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket f132b244-cffb-4051-9a53-83813aafe658 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.temps-approuver

**« comment j'approuve les heures de mes gars pour la semaine »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/timesheets, le libellé Approuver, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/timesheets)
  - cite le libellé attendu (Approuver)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'approuve les heures de mes gars pour la semaine
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.049 ¢ ; 5777 ms) :

```
Pour approuver les heures de votre équipe, allez dans Feuilles de temps (/timesheets) : choisissez la période de la semaine avec les flèches, sélectionnez les heures voulues, puis cliquez sur « Approuver ». Vous pouvez aussi corriger une entrée avec « Modifier les heures » avant d'approuver, si besoin. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket ced99044-340d-448a-9ec0-0c9697b2c451 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.gps-activer

**« je veux voir où sont mes trucks, comment j'active le gps »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/location, le libellé GPS, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/location)
  - cite le libellé attendu (GPS)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux voir où sont mes trucks, comment j'active le gps
```

réponse (statut 200, étage 5 — aide-directe, outils : /settings/location, /settings/payments, /automations ; aucun appel au modèle dans le grand livre ; 1476 ms) :

```
Localisation GPS (Paramètres → Localisation GPS, /settings/location) : consentement GPS personnel ; pour un propriétaire/admin, interrupteur maître de l'organisation et consentements de l'équipe (Loi 25). Plus d'intégration de traceurs externes.

→ ÉQUIPE & TEMPS — Localisation GPS (/settings/location)

Si ça ne règle pas votre cas, dites-le-moi et je creuse.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 0e874c20-fe9c-48d1-a3c0-d6a2970b8289 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.formations-creer

**« comment je fais une formation pour mes nouveaux employés »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/courses, le libellé Créer une formation, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/courses)
  - cite le libellé attendu (Créer une formation)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je fais une formation pour mes nouveaux employés
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.933 ¢ ; 5991 ms) :

```
Pour créer une formation pour vos nouveaux employés, allez dans Formations (/courses) et cliquez « Créer une formation ». Dans l'éditeur, vous ajoutez des modules et des leçons, puis vous publiez avec la bascule « Publié ». Vos employés pourront ensuite suivre la formation depuis cette même page et vous verrez leur « Progression de l'équipe ».

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 1665d181-017f-42cb-8e36-8cb7fcef0a43 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.terrain-pin

**« comment j'ajoute une adresse sur la map de porte a porte »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/field-sales, le libellé Ajouter un pin, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/field-sales)
  - cite le libellé attendu (Ajouter un pin)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'ajoute une adresse sur la map de porte a porte
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.027 ¢ ; 4753 ms) :

```
Pour ajouter une adresse sur la carte de porte-à-porte, allez dans Map (/field-sales), puis cliquez sur « Ajouter un pin » — vous pouvez aussi utiliser « Rechercher une adresse (⌘K) » pour la localiser directement. Le pin créé peut ensuite être modifié ou lié à un client.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket b7becc15-26b0-400e-9935-c99d4b502b79 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.terrain-pipeline

**« comment je change l'étape d'un deal dans le pipeline »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/pipeline|\/ventes, le libellé glisser, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/pipeline|\/ventes)
  - cite le libellé attendu (glisser)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je change l'étape d'un deal dans le pipeline
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.522 ¢ ; 4991 ms) :

```
Pour changer l'étape d'un deal, allez dans Pipeline de ventes (/ventes), onglet Board. Vous pouvez soit glisser la carte du deal avec la poignée ⠿ vers la colonne de l'étape voulue, soit ouvrir la fiche du deal (clic sur la carte) et changer le champ « Étape » dans « Détails du deal », puis « Enregistrer ». Notez qu'un passage vers « Gagné » ouvre la création de la job, et vers « Perdu » demande une raison.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 404f129c-f6ef-4687-88c5-b0d19b2ad826 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### FAIL — kb.terrain-classement

**« je veux voir le classement de mes reps pour le mois passé »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/leaderboard, le libellé Changer, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - libellé attendu absent de la réponse : Changer

<details><summary>Preuves</summary>

question :

```
je veux voir le classement de mes reps pour le mois passé
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.522 ¢ ; 5338 ms) :

```
Vous pouvez consulter le classement de vos reps à Classement (/leaderboard). Sur cette page, utilisez le filtre de période pour choisir « mois passé » et voir leur positionnement. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 176eb304-9037-4f9d-860d-eccce4cfa680 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.terrain-rapports

**« c'est où les rapports de vente terrain de la semaine »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/d2d-reports, le libellé hebdomadaire|semaine, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/d2d-reports)
  - cite le libellé attendu (hebdomadaire|semaine)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est où les rapports de vente terrain de la semaine
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.445 ¢ ; 4099 ms) :

```
Vous trouverez ça dans Rapports terrain (/d2d-reports), menu « Vente ». Vous pouvez filtrer par jour/semaine/mois, voir le revenu par représentant et l'entonnoir de conversion, et exporter les données — c'est en lecture seule.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 81cf3a24-d3ee-4016-a5a8-ecf5f69dfbc3 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.stats-revenus

**« je veux voir mes revenus des 12 derniers mois »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/insights, le libellé 12 derniers mois, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/insights)
  - cite le libellé attendu (12 derniers mois)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux voir mes revenus des 12 derniers mois
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.474 ¢ ; 5161 ms) :

```
Pour voir vos revenus des 12 derniers mois, allez dans Statistiques (/insights), choisissez « Période » → « 12 derniers mois » dans la barre du haut, et regardez la section Revenu (argent encaissé, taxes incluses). Vous pouvez aussi exporter ces données en CSV depuis cette même page.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket c81ba233-964b-48a9-9e36-029acd82066c — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.profil-langue

**« comment je mets l'app en anglais »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/profile, le libellé English|Langue de l'interface, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/profile)
  - cite le libellé attendu (English|Langue de l'interface)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je mets l'app en anglais
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.891 ¢ ; 4600 ms) :

```
Pour mettre l'app en anglais, allez dans Paramètres → Mon profil (/settings/profile), section « Langue de l'interface », et choisissez « English ». C'est appliqué immédiatement. Notez que la langue des messages envoyés à vos clients (courriels, textos) se règle séparément, dans Paramètres entreprise.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket e6979ba0-b61f-4081-b8f8-fe8765b738da — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.entreprise-logo

**« je veux mettre mon logo sur mes factures »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/company, le libellé logo, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/company)
  - cite le libellé attendu (logo)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
je veux mettre mon logo sur mes factures
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.991 ¢ ; 5257 ms) :

```
Vous pouvez ajouter votre logo dans Paramètres → Paramètres entreprise (/settings/company) : il y a une section pour téléverser le logo, qui s'enregistre automatiquement et s'affiche ensuite sur vos factures, devis et contrats. Vous pouvez aussi y ajuster la couleur de marque en même temps. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 9cd89348-d4b3-48e8-89a5-54d164697a34 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.bureaux-nouveau

**« j'ouvre une 2e succursale, comment j'ajoute un bureau »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/offices, le libellé Nouveau bureau, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/offices)
  - cite le libellé attendu (Nouveau bureau)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
j'ouvre une 2e succursale, comment j'ajoute un bureau
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.446 ¢ ; 5314 ms) :

```
Pour ajouter un 2e bureau, allez dans Paramètres → Bureaux (/settings/offices), puis cliquez sur « Nouveau bureau ». Vous devrez indiquer le nom du bureau et la ville des opérations (obligatoire, pour la météo de l'accueil), les coordonnées restant facultatives. Vous pouvez aussi choisir « Exactement la même configuration » que votre bureau actuel pour gagner du temps, puis « Créer le bureau ».

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 3c3261c5-c946-4b04-9cb6-e50170374ad6 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.produits-service

**« comment j'ajoute un service avec son prix »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/products, le libellé Nouveau service, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/products)
  - cite le libellé attendu (Nouveau service)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment j'ajoute un service avec son prix
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.863 ¢ ; 4507 ms) :

```
Pour ajouter un service avec son prix, allez dans Paramètres → Produits & Services (/settings/products), cliquez sur « Nouveau service », puis entrez le nom, le prix et autres détails, et « Créer le service » (ou « Enregistrer »). Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket ce321f17-69fb-4fc6-9c08-275655ab4e06 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.automatisations-pause

**« comment je mets en pause une automatisation qui envoie trop de courriels »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/automations, le libellé Désactiver|interrupteur, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/automations)
  - cite le libellé attendu (Désactiver|interrupteur)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je mets en pause une automatisation qui envoie trop de courriels
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.926 ¢ ; 4861 ms) :

```
Allez dans Automatisations (/automations), repérez la règle qui envoie trop de courriels dans la liste, puis basculez son interrupteur sur ROUGE (brouillon) : les envois en cours sont annulés et rien ne repart tant qu'elle n'est pas republiée. Si vous voulez juste suspendre temporairement toutes les automatisations d'un coup, utilisez « Tout arrêter » en haut à droite — tout ce qui était prévu reprendra à la réactivation.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 3d884d09-e1cc-471a-9e19-7c19a3bbffa4 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.avis-google

**« comment je demande un avis google apres une job »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/reviews, le libellé avis, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/reviews)
  - cite le libellé attendu (avis)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je demande un avis google apres une job
```

réponse (statut 200, étage 0 — faq:google-reviews, outils : — ; aucun appel au modèle dans le grand livre ; 1063 ms) :

```
Paramètres → Avis clients : activez « Demander un avis à la fin d'un job » et collez le lien de votre fiche Google. À la fin de chaque job, le client reçoit un texto et un courriel avec un lien qui l'amène à choisir Google ou Facebook pour laisser son avis. Pour exclure un client, cochez son champ personnalisé « noreview ». Le message se personnalise au même endroit. (page : /settings/reviews)
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 4a441240-b1f9-4c56-87e4-a137978caf6e — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.formulaire-site

**« comment je mets le formulaire de demande sur mon site web »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/settings\/request-form, le libellé code, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/settings\/request-form)
  - cite le libellé attendu (code)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je mets le formulaire de demande sur mon site web
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.999 ¢ ; 5234 ms) :

```
Vous trouvez ça dans Paramètres → Formulaire de demande (/settings/request-form). Là, vous pouvez personnaliser vos champs, faire un « Aperçu », puis « Enregistrer » — un code d'intégration apparaît avec le bouton « Copier ce code et le coller dans votre site web ». Il suffit de coller ce code à l'endroit voulu sur votre site (dans l'éditeur HTML de votre plateforme web).

Vous pouvez aussi créer plusieurs formulaires différents (« + Nouveau formulaire »), chacun avec son propre lien public, et choisir dans quel pipeline arrivent ses demandes.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket f284b292-9dc1-4754-a605-43241ce3ca09 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.securite-2fa

**« c'est quoi le code qr qu'il me demande quand j'invite quelqu'un »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend le libellé Google Authenticator|6 chiffres|QR, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - cite le libellé attendu (Google Authenticator|6 chiffres|QR)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est quoi le code qr qu'il me demande quand j'invite quelqu'un
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 0.947 ¢ ; 5612 ms) :

```
Je n'ai rien trouvé sur un code QR spécifique dans le processus d'invitation de membre — il est probable que ce code QR concerne la double authentification (2FA), qui s'active souvent via une appli d'authentification en scannant un QR code, et qui peut être demandée lors de la première connexion. Pouvez-vous préciser si ce code QR apparaît sur l'écran de la personne invitée au moment où elle crée son compte (/invite/:token) ? Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket b2367922-a4c9-4cf7-8977-5f354a8d5f86 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.connexion-mdp

**« j'ai oublié mon mot de passe pis je rentre pu »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend la route \/auth|\/reset-password, le libellé Mot de passe oublié, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - cite la route attendue (\/auth|\/reset-password)
  - cite le libellé attendu (Mot de passe oublié)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
j'ai oublié mon mot de passe pis je rentre pu
```

réponse (statut 200, étage 0 — faq:forgot-password, outils : — ; aucun appel au modèle dans le grand livre ; 777 ms) :

```
Sur la page de connexion, cliquez « Mot de passe oublié », entrez votre courriel : vous recevez un lien qui ouvre la page de réinitialisation. Choisissez un nouveau mot de passe et reconnectez-vous. Pas de courriel après quelques minutes ? Vérifiez les indésirables et que l'adresse est bien celle du compte. (page : /auth)
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 6199b271-e1c1-4b2f-8ed6-ddc5a7f66661 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### FAIL — kb.pages-clients-devis

**« mon client recoit quoi quand j'envoie une soumission »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend le libellé approuver|signer|téléphone|sans (avoir à créer de )?compte, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - libellé attendu absent de la réponse : approuver|signer|téléphone|sans (avoir à créer de )?compte

<details><summary>Preuves</summary>

question :

```
mon client recoit quoi quand j'envoie une soumission
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 2.662 ¢ ; 8198 ms) :

```
Quand vous envoyez une soumission (devis), votre client reçoit un lien pour la consulter en ligne, l'ouvrir, et l'accepter (si un dépôt est exigé, le paiement en ligne se fait à l'acceptation, pourvu que « Paiement des devis » soit activé dans Lume Payments). Vous voyez ensuite sur la fiche du devis (/quotes/:id) s'il a été ouvert et combien de fois. Une automatisation par défaut relance aussi votre client (1, 2, 5, 10, 30 jours) tant qu'il n'a pas répondu, et vous notifie dès qu'il l'ouvre.

Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 3f784613-7f9b-482d-bb96-cce5d9268ba7 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.hors-lume

**« est-ce que je peux déduire mon camion dans mes impots »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend le libellé hors|extérieur|pas .{0,40}(Lume|CRM)|comptable|ne (concerne|couvre|relève) pas, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - cite le libellé attendu (hors|extérieur|pas .{0,40}(Lume|CRM)|comptable|ne (concerne|couvre|relève) pas)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
est-ce que je peux déduire mon camion dans mes impots
```

réponse (statut 200, étage 6 — app, outils : — ; claude-sonnet-5, 1 appel(s), 0.369 ¢ ; 3749 ms) :

```
Ça, c'est une question fiscale qui dépasse le cadre de Lume — je ne peux pas vous conseiller là-dessus. Je vous suggère de vérifier avec un comptable ou Revenu Québec/ARC, car ça dépend de votre situation précise. Si vous avez une question sur l'utilisation de Lume, je suis là!
```

ticket (SELECT support_tickets et support_messages) :

```
ticket 973b6d86-05cf-4f26-804f-1122b1efd225 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.compte-forfait

**« c'est quoi mon forfait pis ça se renouvelle quand »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend sans transfert à un humain, et le nom du forfait du bureau (lu dans la base).
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - cite le libellé attendu (Autopilot)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
c'est quoi mon forfait pis ça se renouvelle quand
```

réponse (statut 200, étage 6 — app, outils : — ; claude-sonnet-5, 1 appel(s), 0.344 ¢ ; 3140 ms) :

```
Vous êtes présentement sur le forfait Autopilot, en facturation mensuelle, actif. La période en cours se renouvelle le 2027-10-01. Vous pouvez voir et gérer ça dans Paramètres → Forfait & facturation (/settings/billing).
```

ticket (SELECT support_tickets et support_messages) :

```
ticket b32d9200-62e3-4e86-82df-ae5094a1571f — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.compte-paiements

**« est-ce que lume payments est déja branché sur mon compte »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - aucun libellé imposé
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
est-ce que lume payments est déja branché sur mon compte
```

réponse (statut 200, étage 6 — app, outils : — ; claude-sonnet-5, 1 appel(s), 0.379 ¢ ; 5306 ms) :

```
D'après votre dossier, aucun fournisseur de paiement n'est configuré sur votre compte pour l'instant — Lume Payments n'est donc pas branché. Pour l'activer, allez dans Paramètres → Lume Payments (/settings/payments) et suivez les étapes d'inscription. Si vous avez besoin d'aide pour la configuration, dites-le-moi.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket bdae6c11-4a8c-4633-83fe-7fa29832bb6e — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

#### PASS — kb.ambigu-taches

**« comment je supprime toutes mes taches de la semaine passée »**

- Ce que le test a fait : Un utilisateur pose la question telle quelle au chat de support ; on attend le libellé (tâche[\s\S]*(job|travau))|((job|travau)[\s\S]*tâche)|précis|voulez-vous dire|parlez-vous|s'agit-il, sans transfert à un humain.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.
- Ce qu’il a observé :
  - aucune route imposée
  - cite le libellé attendu ((tâche[\s\S]*(job|travau))|((job|travau)[\s\S]*tâche)|précis|voulez-vous dire|parlez-vous|s'agit-il)
  - pas de transfert
  - vouvoiement, aucun statut brut

<details><summary>Preuves</summary>

question :

```
comment je supprime toutes mes taches de la semaine passée
```

réponse (statut 200, étage 6 — app, outils : search_help ; claude-sonnet-5, 2 appel(s), 1.565 ¢ ; 5598 ms) :

```
Si vous parlez des tâches (à-faire) : allez dans Tâches (/tasks), cochez les cases des tâches visées puis cliquez « Supprimer » (pas de confirmation, suppression immédiate et définitive).

Si vous parlez des jobs planifiées (le travail de la semaine passée) : allez dans Jobs (/jobs), et pour chacune utilisez le menu « … » pour la supprimer ou l'archiver.

Comme vous dites « semaine passée », il n'y a pas de suppression groupée par date — il faut sélectionner manuellement celles visées. Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe.
```

ticket (SELECT support_tickets et support_messages) :

```
ticket dc3f2e99-aaaa-4070-8062-b6c7e8fe7092 — statut « ai », escalated_at NULL, motif NULL, slack_channel_id NULL, slack_thread_ts NULL
messages système : aucun ; champ « escalated » de l’API : false
```

</details>

### 4. Escalade vers un humain

_Une demande d’humain, un bogue, un litige de facturation de l’abonnement ou une question hors de sa connaissance finissent chez l’équipe (ticket escaladé en base, la réponse le dit) — sans rien envoyer dans Slack depuis un bureau de test ; une question de la FAQ, elle, n’escalade pas._

#### PASS — escalade.canari

**Canari : l’escalade d’un bureau de test ne touche pas Slack**

- Ce que le test a fait : Avant toute autre question, un utilisateur demande un humain par le bouton (« humain: true », aucun modèle). On relit le ticket, ses messages système, le bac à sable des envois et les canaux Slack du bureau.
- Compte : proprio2
- Ce qu’il observerait si le défaut existait : Le ticket porterait un fil ou un canal Slack, un message système « escalated:slack », un nouveau canal Slack pour le bureau — ou « escalated:email » sans aucune ligne envois_simules (le courriel serait parti pour vrai). Dans tous ces cas la batterie s’arrête.
- Ce qu’il a observé :
  - ticket escaladé (escalated_at renseigné, statut « open »)
  - slack_thread_ts et slack_channel_id à NULL
  - message système « escalated:email », aucun « escalated:slack »
  - 1 ligne(s) envois_simules écrite(s) pour ce bureau
  - aucun canal Slack créé (0 avant, 0 après)

<details><summary>Preuves</summary>

question :

```
[SUP] Canari de la batterie d’évaluation du support — bureau de test, aucune réponse attendue.
```

réponse (statut 200, étage non lu, outils : — ; aucun appel au modèle dans le grand livre ; 1648 ms) :

```
(aucun texte : transfert direct)
```

ticket (SELECT support_tickets et support_messages) :

```
ticket c04c8eca-a2cd-4dd9-9fdd-83678aec1035 — statut « open », escalated_at 2026-10-01 22:34:48.924+00, motif « Le client a demandé à parler à un humain », slack_channel_id NULL, slack_thread_ts NULL
messages système : escalated:email ; champ « escalated » de l’API : true
```

bac à sable et Slack (SELECT envois_simules, support_slack_channels) :

```
select count(*)::int as envois, coalesce(array_agg(left(coalesce(sujet, ''), 120)), '{}') as sujets from envois_simules
    where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and canal = 'courriel' and created_at >= '2026-10-01T22:34:48.058Z'::timestamptz - interval '2 seconds'
→ {"envois":1,"sujets":["[PRIORITY · Autopilot] [SUP] Canari de la batterie d’évaluation du support — bureau de test, aucune réponse attendue."]}
canaux Slack du bureau : 0 avant, 0 après
```

</details>

### 9. Coût

_Ce que la batterie a coûté et qui a répondu : part des questions servies sans modèle, coût moyen d’une question servie par le modèle, modèle utilisé — relus dans ai_usage et lumi_traces._

#### A RELIRE — cout.releve

**Relevé du coût et de l’étage de chaque question de la batterie**

- Ce que le test a fait : Aucune question n’est posée. On relit le grand livre du support (ai_usage, source « support ») pour les comptes et la fenêtre de la passe, et on rattache chaque ligne au tour qui l’a produite.
- Compte : —
- Ce qu’il observerait si le défaut existait : Sans objet : ce test ne juge pas, il mesure. Le tableau est dans le rapport (section « Coût »).
- Ce qu’il a observé :
  - 49 question(s) relevée(s) : 3 sans modèle, 45 par le modèle, 1 sans trace
  - coût total : 65.792 ¢ US pour 88 appel(s) au modèle ; moyenne par question servie par le modèle : 1.462 ¢
  - modèle(s) : claude-sonnet-5 (45)
  - 3 ligne(s) du grand livre dans la fenêtre sans tour de la batterie (ces comptes ont servi ailleurs) : 1.352 ¢, non comptées
- À relire : Relevé, pas un verdict : lire le tableau de la section « Coût ».

<details><summary>Preuves</summary>

grand livre du support (SELECT ai_usage) :

```
select user_id, model, cost_cents::float8 as cost_cents, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
     from ai_usage where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and source = 'support' and user_id in ('94b880d9-d7d6-4db5-b4f9-3324a20725c4', 'a608b7bf-875b-43ca-9503-f3542b1943ca', '90089844-650e-4821-95ce-6c53579194f3', '28fd989a-3b6e-4f61-8a4e-a269ccec2f95', '352ddde1-0be7-4d12-8e8d-2ae7db8b0014')
      and created_at >= '2026-10-01T20:27:30.272Z'::timestamptz - interval '2 seconds' and created_at <= '2026-10-01T22:40:18.883Z'::timestamptz + interval '5 seconds' order by created_at
→ 91 ligne(s)
```

traces du support (SELECT lumi_traces) :

```
select user_id, enonce_normalise, etage, action, outils, model, cost_cents::float8 as cost_cents, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
     from lumi_traces where org_id = '5930d318-b207-40f3-9e14-f8898a02e240' and canal = 'support' and user_id in ('94b880d9-d7d6-4db5-b4f9-3324a20725c4', 'a608b7bf-875b-43ca-9503-f3542b1943ca', '90089844-650e-4821-95ce-6c53579194f3', '28fd989a-3b6e-4f61-8a4e-a269ccec2f95', '352ddde1-0be7-4d12-8e8d-2ae7db8b0014')
      and created_at >= '2026-10-01T20:27:30.272Z'::timestamptz - interval '5 seconds' and created_at <= '2026-10-01T22:40:18.883Z'::timestamptz + interval '15 seconds' order by created_at
→ 50 trace(s)
```

</details>

## Ce que la batterie a laissé dans le bureau

52 ticket(s) de support ouverts par la batterie, 26 fermé(s) — 26 ENCORE OUVERT(S), à fermer avec `run.mts --fermer`. Aucune suppression : les tickets fermés, leurs messages, leurs traces, les lignes du grand livre et les courriels consignés au bac à sable restent en base.
- encore ouvert : bdbfdfc0-e738-4e34-823a-f4ebc20e3040 (compte proprio1)
- encore ouvert : b1d7a893-7155-4a5c-aa85-9196270956cd (compte proprio2)
- encore ouvert : 2f24eca8-e184-4776-89e1-0fc851add1ae (compte proprio3)
- encore ouvert : feb35364-795b-47e4-ab9e-43324fee6eed (compte proprio4)
- encore ouvert : 58e4e128-7093-4105-9d37-89b29d653bf3 (compte tech)
- encore ouvert : ae9267e0-f107-4bf1-b0fa-d5ac1f6b07b6 (compte proprio1)
- encore ouvert : 2c03cc32-0fc1-4d94-97f8-4344aed30895 (compte proprio2)
- encore ouvert : 19941895-acd6-4056-a6f9-2214ebebf439 (compte proprio3)
- encore ouvert : 25cdc758-b09f-4e3f-9232-0c51fe2b2516 (compte proprio4)
- encore ouvert : ea6e1fcb-b163-4f60-99c2-a773d663993f (compte tech)
- encore ouvert : 9464751b-e4bc-497b-a509-5c3916c85063 (compte proprio1)
- encore ouvert : 99cdaf4e-ec99-45e6-9dba-18cd6b41e273 (compte proprio2)
- encore ouvert : b4bf90df-508b-4774-b013-9f9c10358164 (compte proprio3)
- encore ouvert : f87ca29c-ce29-44d4-8940-4197fc4c8a4c (compte proprio4)
- encore ouvert : 30b70bd2-7ed6-43c9-8bae-32fe164aaf40 (compte tech)
- encore ouvert : 0764d087-5129-457f-92c3-c74ab5c4e993 (compte proprio1)
- encore ouvert : 7898bc16-e78a-452c-9f45-4f4ed8416332 (compte proprio2)
- encore ouvert : 0b157c83-fb59-4fb9-a64e-81c390f7c6dd (compte proprio3)
- encore ouvert : 4679c574-c7e2-47c9-8aea-cf351073bc49 (compte proprio4)
- encore ouvert : 8b73da6b-be83-4192-9f14-7ae7a3b1be41 (compte tech)
- encore ouvert : 89b01be0-fbd6-4187-bf53-d6d42420874e (compte proprio1)
- encore ouvert : 95b32fb7-bc93-45b7-8c27-9d0b48625c79 (compte proprio2)
- encore ouvert : 0ce4f757-4e43-4599-90e3-111e215da08e (compte proprio3)
- encore ouvert : 41fe7ea9-9797-4a6c-9034-84ab17b32f8a (compte proprio4)
- encore ouvert : a962ac8e-3e27-4964-a594-9a53b873760d (compte tech)
- encore ouvert : 49ba0dc2-50d2-4aca-ab70-550a5b11513c (compte proprio1)
