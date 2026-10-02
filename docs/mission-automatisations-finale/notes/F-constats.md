# F — Constats : coûts API de Lumi, côté automatisations

Agent F, 2026-10-01. Les chiffres viennent de `D:/lume-final/notes/F-mesures.md` (vrai modèle, pile locale). Les chemins de fichiers sont ceux du worktree `D:/lume-final/wt-f`. Rien n'a été modifié dans le produit.

Les deux chemins dont il est question :
- **le clavardage** : la page Lumi (`POST /api/lumi/chat`, puis `POST /api/lumi/execute` au clic sur Confirmer) ;
- **le panneau** : « Construire avec Lumi » dans l'éditeur d'une automatisation (`POST /api/automations/rules/generer`, `server/lib/lumi/generer-parcours.ts`).

Les tests se lancent ainsi : `npx vitest run --maxWorkers=2 tests/automations-finale/f/`. État au 2026-10-01 : 19 rouges (les constats), 8 verts (des garde-fous qui doivent rester verts).

## Sommaire

| Constat | Gravité | En une ligne |
|---|---|---|
| F-01 | majeur | Le panneau ne laisse aucune trace dans `lumi_traces` : ni durée, ni résultat, ni échec |
| F-02 | majeur | Créer par le clavardage cache jusqu'à 78 % du coût : la génération imbriquée échappe à la trace et aux plafonds |
| F-03 | bloquant | Le panneau ne peut modifier aucune des deux grosses automatisations du pack de base ; chaque essai échoue et est débité |
| F-04 | mineur | Une génération refusée par la validation est débitée à l'entreprise |
| F-05 | majeur | La génération ne fixe ni réflexion ni effort : même demande de 1,07 ¢ à 2,79 ¢, de 8 s à 21 s |
| F-06 | majeur | La génération n'entre dans aucun plafond journalier de plateforme |
| F-07 | mineur | Une question ou un refus fait réécrire tout le parcours, payé au prix de la sortie |
| F-08 | mineur | À zéro crédit, l'éditeur parle de « budget du mois », sans date, et ne prévient qu'après le clic |
| F-09 | mineur | À zéro crédit, chaque message au clavardage paie et débite encore le routeur |
| F-10 | majeur, non vérifié en prod | Le blocage à zéro du panneau repose sur une seule fonction en base ; sur la pile locale un bureau épuisé a pu générer |
| F-11 | mineur | Le routeur est appelé à chaque message d'automatisation, la règle gratuite ne tranche jamais |
| F-12 | mineur | Chaque modification par le clavardage paie un appel pour retrouver l'automatisation par son nom |
| F-13 | mineur | Quand le routeur hésite en cours de conversation, le jeu d'outils change et le tour coûte le double |
| F-14 | majeur | Par le clavardage, « ajoute un délai » ou « seulement tel client » crée un doublon sans le filtre, puis l'active |
| F-15 | majeur | « Explique-moi ce que fait l'automatisation X » par le clavardage : réponse vide, clé technique affichée |
| F-16 | mineur | Après Confirmer, le reçu dit « C'est fait : l'action. » |
| F-17 | mineur | Les textos écrits par le clavardage ne suivent pas les règles de rédaction du panneau |
| F-18 | mineur | Le panneau refuse le filtre par étiquette que l'éditeur offre, en parlant en clés techniques |

F-14 à F-18 sortent de mon domaine (qualité de Lumi sur les automatisations) : je les ai vus en mesurant, je les signale avec leur coût.

---

### F-01 — « Construire avec Lumi » ne laisse aucune trace : on ne peut mesurer ni sa durée, ni ses échecs
- Point de la mission : P4
- Gravité : majeur
- Ce qu'on voit : pour le propriétaire, rien. Pour qui suit le coût et la qualité : les 13 générations de ma passe ont coûté 13,96 ¢ et aucune n'apparaît dans `lumi_traces`. Deux d'entre elles ont échoué (HTTP 422) : le seul signe en est une ligne dans les journaux du serveur. Impossible de dire combien de demandes échouent, combien de temps elles prennent, ni ce que les gens demandent.
- Reproduction : `QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/mesurer.mts --seul conv-panneau`, puis `select count(*) from lumi_traces where org_id = '<bureau A f>'` avant et après.
- Preuve : `tests/automations-finale/f/instrumentation-generer.test.ts::F-01 — chaque génération laisse une ligne dans lumi_traces` (rouge) ; sortie de `mesurer.mts` : « AUCUNE ligne dans lumi_traces pour cet appel » sur P1 à P8 et C2-tour1 à tour6.
- Cause racine : `server/lib/lumi/generer-parcours.ts:691-719` écrit `ai_usage` (`journaliserUsage`) et rien d'autre ; aucun appel à `journaliserTrace`. `server/routes/automation-rules.ts:354-545` non plus.
- Correctif proposé : dans `generer-parcours.ts`, une trace par génération (canal `lumi`, action `construire-parcours`, modèle, tokens, coût, durée, résultat `ok` / `refus` / `erreur`, et dans `params` : nombre d'étapes envoyées et rendues, motif du refus, `stop_reason`, second essai ou non). La route ajoute l'identifiant de l'automatisation ouverte.
- Risque / à décider par Rafba : aucun. `lumi_traces` garde l'énoncé normalisé de la demande : même règle de conservation que pour le clavardage.

### F-02 — Créer une automatisation par le clavardage cache l'essentiel du coût : la trace et les plafonds ne voient pas la génération
- Point de la mission : P4
- Gravité : majeur
- Ce qu'on voit : la création d'un gros parcours a coûté 3,58 ¢ à l'entreprise ; la trace du tour en montre 0,63. Au tour 4 de la conversation : 4,42 ¢ débités, 1,00 ¢ dans la trace, et la trace du clic sur Confirmer affiche « 0 ¢, aucun modèle » alors qu'un appel à Sonnet de 3,25 ¢ et 30 s vient de partir. Le plafond par conversation (40 ¢) et le plafond par tour (6 ¢) ne comptent pas cette dépense.
- Reproduction : `mesurer.mts --seul unitaires` (demande U2) ou `--seul conv-clavardage` (tour 4).
- Preuve : `tests/automations-finale/f/instrumentation-generer.test.ts::F-02 — une génération lancée depuis une conversation de Lumi est rattachée à cette conversation` (rouge) ; sortie relevée : « 1 ligne(s) du grand livre SANS conversation (source automatisations, 2.790 ¢) | coût des traces 0.626 ¢ ≠ grand livre 3.579 ¢ » (U2), « 3.252 ¢ … 1.002 ¢ ≠ 4.421 ¢ » (C1-tour4) ; les 3 générations imbriquées font 6,45 ¢ sur les 22,69 ¢ du clavardage (28 %).
- Cause racine : l'outil `create_automation_from_text` (`server/lib/agent/tools-reglages.ts:443-449`) appelle `genererParcours` sans lui passer la conversation ; `generer-parcours.ts:706` écrit `conversationId: null` ; la trace de `/lumi/execute` (`server/routes/lumi.ts:1131-1135`) porte `costCents: 0` et `model: null` en dur. Le commentaire de l'outil (`tools-reglages.ts:388-394`) annonce encore « un aller-retour Haiku, 0,32 ¢ » : c'est Sonnet 5, 0,41 à 3,25 ¢ mesurés.
- Correctif proposé : `genererParcours` accepte `conversationId` et l'écrit dans `ai_usage` ; l'outil le transmet (le contexte d'outil doit porter la conversation) ; la trace de `/lumi/execute` additionne le coût et les tokens des appels faits pendant l'exécution. Fichiers : `server/lib/lumi/generer-parcours.ts`, `server/lib/agent/tools-reglages.ts`, `server/lib/lumi/execution.ts`, `server/routes/lumi.ts` (zone de la session f1).
- Risque / à décider par Rafba : une fois la génération comptée dans la conversation, une conversation de création arrive plus vite au plafond de 40 ¢. C'est le but, mais à savoir.

### F-03 — Le panneau ne peut modifier aucune des deux grosses automatisations du pack de base : la demande échoue, et elle est débitée
- Point de la mission : P4, 18
- Gravité : bloquant
- Ce qu'on voit : j'ouvre « Relance de devis — 1, 2, 5, 10 et 30 jours » (publiée d'office à la création de mon entreprise), j'écris à Lumi « Change le premier délai à 2 jours. ». J'attends 18 secondes, puis je lis « Lumi a proposé un parcours que le moteur ne saurait pas exécuter. Reformule, ou construis-le avec le « + ». ». Rien n'a changé, et 1,2 crédit m'a été débité. Reformuler ne changera rien. Même chose pour « Relance de facture — 3, 7, 14 et 30 jours » (17 s, 1,1 crédit).
- Reproduction : `QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/gros-parcours.mts` (API locale lancée avec `--lumi`).
- Preuve : `tests/automations-finale/f/parcours-envoye-entier.test.ts` — « Relance de devis… », « Relance de facture… » et « un parcours de 30 étapes » (3 rouges) ; `sorties/f-gros-parcours.json` : HTTP 422 deux fois, 3,414 ¢ et 3,619 ¢ débités ; journal de l'API : « le champ « Objet » est obligatoire », « L'étape « e16 » renvoie vers « e18 », qui n'existe pas ».
- Cause racine : `server/lib/lumi/generer-parcours.ts:528` coupe le parcours envoyé au modèle à 6 000 caractères (`JSON.stringify(parcoursActuel).slice(0, 6_000)`). Les deux parcours pèsent 8 278 et 8 741 caractères : le modèle reçoit un JSON coupé au milieu d'une étape (14 étapes lisibles sur 17, 17 sur 23) et renvoie un parcours bancal. Second mur derrière le premier : la réponse doit réécrire tout le parcours, soit 4 273 et 4 599 tokens, au-dessus du plafond de sortie (`MAX_TOKENS = 4_000`, ligne 56). Même sans la coupe, la réponse serait tronquée.
- Correctif proposé : (1) ne plus couper le parcours au caractère : l'envoyer entier (30 étapes font au plus 5 200 tokens d'entrée, soit 1 ¢) ; (2) ne plus faire réécrire tout le parcours pour une modification : le modèle rend seulement les étapes changées, ajoutées ou retirées, et le serveur les applique au parcours à l'écran — sinon relever le plafond de sortie à la taille de 30 étapes (6 100 tokens mesurés) ; (3) au-delà d'une taille que le panneau ne sait pas traiter, refuser AVANT l'appel, sans débit. Fichier : `server/lib/lumi/generer-parcours.ts`.
- Risque / à décider par Rafba : la réponse « étapes modifiées seulement » change le contrat entre le modèle et le serveur : à éprouver sur `npm run qa:construire-lumi`. La variante simple (tout envoyer, plafond de sortie relevé) règle le blocage mais coûte 5 à 7 ¢ par modification d'un gros parcours.

### F-04 — Une génération que le serveur refuse est quand même débitée à l'entreprise
- Point de la mission : P4 (crédits)
- Gravité : mineur
- Ce qu'on voit : je lis « Lumi a proposé un parcours que le moteur ne saurait pas exécuter », rien n'a été construit, et mon compteur de crédits a baissé (1,1 et 1,2 crédit sur les deux essais de F-03).
- Reproduction : celle de F-03 ; ou toute demande dont la proposition est refusée par la validation.
- Preuve : `sorties/f-gros-parcours.json` : `statut_http: 422`, `etapes_rendues: 0`, `credits: 1.138` et `1.206`.
- Cause racine : `generer-parcours.ts:703-717` journalise l'appel avant que la route ne valide la proposition (`server/routes/automation-rules.ts:415-456`) ; aucun retour de crédits sur refus. Le coût est réel pour Lume, le débit suit donc la règle « coût réel ».
- Correctif proposé : à décider. Si Rafba veut qu'un échec de Lumi ne coûte rien au client : inscrire un ajustement dans `lumi_credits_ajustements` (le mécanisme des crédits rendus existe) quand la route répond 422 pour une raison qui tient à Lumi.
- Risque / à décider par Rafba : rendre les crédits ouvre une porte à qui chercherait à faire échouer exprès ; à borner (par exemple cinq retours par jour).

### F-05 — La génération ne fixe ni réflexion ni effort : la même demande coûte de 1,07 ¢ à 2,79 ¢ et prend de 8 à 21 secondes
- Point de la mission : P4 (routage, concision)
- Gravité : majeur
- Ce qu'on voit : la même phrase (« pour les factures en retard : si la facture dépasse 500 $… ») a coûté 1,07 ¢ en 7,7 s dans le panneau et 2,79 ¢ en 21 s par le clavardage. Une automatisation de deux étapes a coûté 3,25 ¢ et fait attendre 30 s (tour 4 de la conversation). « Le texto est trop long, fais-le plus court » : 1,5 ¢ et 10 s, dont les deux tiers en réflexion invisible.
- Reproduction : `npx tsx --env-file=.env.local scripts/qa/finale/f/ab-generer.mts --passes 2`.
- Preuve : `tests/automations-finale/f/instrumentation-generer.test.ts::F-05 — l'appel fixe son niveau d'effort` (rouge) ; `sorties/f-ab-generer.json` : appel actuel 0,926 ¢ et 5,8 s en moyenne, réflexion sur 7 appels sur 16 (jusqu'à 984 tokens, 21 % de la sortie) ; avec `effort: low` : 0,729 ¢ (−21 %), 4,2 s (−28 %), 15 réussites sur 16 contre 14 sur 16.
- Cause racine : `generer-parcours.ts:692-697` appelle `messages.create` sans `thinking` ni `output_config.effort`. Sur Sonnet 5, cela veut dire réflexion adaptative au niveau `high` par défaut ; le reste de Lumi tourne en `low` (`server/lib/lumi/regles-cout.ts:52`).
- Correctif proposé : `thinking: { type: 'adaptive' }` et `output_config: { effort: 'low' }` dans cet appel. Fichier : `server/lib/lumi/generer-parcours.ts`. À livrer après une passe de `npm run qa:construire-lumi` avant et après.
- Risque / à décider par Rafba : 16 essais par variante ne prouvent pas l'absence de baisse de qualité ; la batterie de conversations existante tranchera. Le niveau `medium` donne le même prix que `low` sur mes essais (0,729 ¢).

### F-06 — « Construire avec Lumi » n'entre dans aucun plafond journalier de la plateforme
- Point de la mission : P4
- Gravité : majeur
- Ce qu'on voit : rien aujourd'hui. Le jour où un script ou un client boucle sur le panneau, seul le budget mensuel de CE client l'arrête (30 $) ; le cran d'arrêt en dollars par jour, posé après l'incident du 2026-09-18 pour toutes les autres sources (clavardage, support, migration, voix), ne voit pas ces appels. À l'inverse, ces dépenses ne sont pas comptées non plus dans le compteur du jour que surveille l'exploitant.
- Reproduction : appeler `genererParcours`, puis lire `verifierPlafond(source).depense_cents` pour chaque source.
- Preuve : `tests/automations-finale/f/instrumentation-generer.test.ts::F-06 — la dépense entre dans le plafond journalier de la plateforme` (rouge : aucun compteur ne bouge).
- Cause racine : `generer-parcours.ts` n'appelle ni `verifierPlafond` ni `ajouterDepense` (`server/lib/lumi/plafond-journalier.ts`) ; les autres appelants le font (`server/routes/lumi.ts:434` et `:481`, `server/lib/sms/lumi-sms.ts`, `server/lib/migration/bot.ts:405`).
- Correctif proposé : vérifier le plafond avant l'appel et ajouter la dépense après, sous la source `lumi` ou sous une source `automatisations` à créer. Fichiers : `server/lib/lumi/generer-parcours.ts`, `server/lib/lumi/plafond-journalier.ts`.
- Risque / à décider par Rafba : si la source est `lumi`, une rafale dans le panneau peut mettre le clavardage de tous les clients en pause jusqu'à minuit (`LUMI_COST_REPORT.md` signale déjà que ce plafond est commun). Une source à part évite cet effet.

### F-07 — Une question ou un refus fait réécrire tout le parcours, payé au prix de la sortie
- Point de la mission : P4 (résultats compacts, concision)
- Gravité : mineur
- Ce qu'on voit : « explique-moi ce qu'elle fait » sur un parcours de 15 étapes : 10 secondes d'attente et 1,9 ¢ pour deux phrases. Dans ma conversation du panneau, trois tours sur six (un refus, une explication, « active-la ») n'ont rien changé au parcours et l'ont pourtant réécrit en entier : 1,92 ¢ sur 3,56.
- Reproduction : `ab-generer.mts --variantes actuel,sans-etapes --passes 2`.
- Preuve : `sorties/f-ab-generer.json` : questions avec la consigne actuelle 1,316 ¢ et 7,3 s en moyenne ; avec « "steps": null pour une question » 0,520 ¢ (−60 %) et 2,7 s, 4 réussites sur 4 (explications aussi justes).
- Cause racine : le prompt l'exige (`generer-parcours.ts:427-431` : « renvoie le parcours ACTUEL inchangé ») ; la sortie coûte cinq fois l'entrée.
- Correctif proposé : pour une question, un refus ou une demande incomprise, le modèle rend `"steps": null` et `"modifie": false` ; le serveur garde alors le parcours à l'écran (`generer-parcours.ts`, puis `server/routes/automation-rules.ts` qui doit accepter une réponse sans étapes quand un parcours actuel existe).
- Risque / à décider par Rafba : faible. À couvrir par un test : une réponse sans étapes ne doit jamais vider le canevas.

### F-08 — À zéro crédit, l'éditeur parle de « budget du mois », sans date, et ne prévient qu'après le clic
- Point de la mission : P4 (crédits)
- Gravité : mineur
- Ce qu'on voit : sur la page Lumi, le champ est désactivé et je lis « Tes crédits Lumi sont épuisés jusqu'au 1 nov. ». Dans l'éditeur d'automatisations, le champ de Lumi est actif, je tape ma demande, je clique sur Construire, et une bulle répond « Le budget Lumi du mois est atteint. Le parcours peut être construit à la main avec le « + ». » Un autre mot (« budget ») pour la même chose, pas de date, et « du mois » est faux : la période suit l'anniversaire de l'abonnement.
- Reproduction : `scripts/qa/finale/f/credits.mts` puis `ecran.mts` (bureau B épuisé).
- Preuve : `tests/automations-finale/f/credits-epuises-panneau.test.ts::F-08 — le message parle de CRÉDITS` (rouge) ; `sorties/f-ecran.json` : `bureau_B_editeur.bulles`, `bureau_B_page_lumi` ; capture `sorties/f-ecran-B-editeur-epuise.png`.
- Cause racine : texte en dur dans `generer-parcours.ts:667-674`, alors que `server/lib/lumi/budget.ts:106-113` (`messagePause`) porte le texte commun avec la date. Côté écran, `src/components/automations/ClavardageLumi.tsx` ne reçoit pas l'état des crédits.
- Correctif proposé : réutiliser `messagePause(langue, renouvellement)` dans `generer-parcours.ts` ; dans l'éditeur, lire `/api/lumi/credits` et désactiver le champ avec le même libellé que la page Lumi (`src/pages/AutomationBuilderPage.tsx`, `ClavardageLumi.tsx`).
- Risque / à décider par Rafba : aucun.

### F-09 — À zéro crédit, chaque message au clavardage paie et débite encore un appel au routeur
- Point de la mission : P4 (crédits : rien de facturé à zéro)
- Gravité : mineur
- Ce qu'on voit : mes crédits sont épuisés, Lumi me le dit proprement. Mais chaque message que j'envoie quand même déclenche un appel à Haiku (0,156 ¢) qui est ajouté à ma consommation : le compteur « utilisés » continue de monter au-delà du total.
- Reproduction : `scripts/qa/finale/f/credits.mts`.
- Preuve : `sorties/f-credits.json`, aux deux paliers : `clavardage.appels_modele: 1`, `debite_cents: 0.1556`, texte « Tes crédits Lumi sont épuisés… », trace `budget_epuise` à 0 ¢.
- Cause racine : `server/routes/lumi.ts:842-858` appelle le routeur avant que le tour ne constate le palier « épuisé » (`:427` et suivantes) ; l'appel du routeur ne passe par aucune réservation de budget. Ses lignes de `ai_usage` n'ont pas d'identifiant de requête (12 sur 12 dans ma passe), donc pas de protection contre un double débit.
- Correctif proposé : ne pas appeler le routeur quand `ctx.budget.palier === 'epuise'` ; passer `requestId` au journal du routeur. Fichier : `server/routes/lumi.ts` (zone de la session f1).
- Risque / à décider par Rafba : aucun.

### F-10 — Le blocage à zéro crédit du panneau ne tient qu'à une fonction en base : sur la pile locale, un bureau épuisé a pu générer et être débité
- NON VÉRIFIÉ en production (je n'ai pas le droit de la lire) : prouvé sur la pile locale, qui porte une ancienne version de la fonction (voir F-mesures, « Anomalies d'atelier »).
- Point de la mission : P4 (crédits : blocage propre à zéro)
- Gravité : majeur si la prod porte l'ancienne fonction, mineur sinon
- Ce qu'on voit : mon écran affiche « 0 / 1 000 crédits Lumi », le clavardage refuse. Dans l'éditeur, « Construire avec Lumi » construit quand même le parcours et débite 0,35 ¢. Le panneau ne s'arrête qu'à 45 $ de dépense.
- Reproduction : `scripts/qa/finale/f/credits.mts`, palier 1 (3 100 ¢ dépensés).
- Preuve : `sorties/f-credits.json` → `palier_1_credits_epuises_3100_cents.panneau` : `statut_http: 200`, `etapes: 1`, `debite_cents: 0.3538`, alors que `credits_vus.restants: 0`. Au palier 2 (4 600 ¢) : 422, 0 appel, 0 ¢.
- Cause racine : le clavardage a deux gardes (l'état des crédits calculé par le serveur, `server/lib/lumi/budget.ts:169-243`, puis la réservation en base). Le panneau n'en a qu'une : `reserverBudget` → `reserve_ai_budget` (`generer-parcours.ts:650-674`). Dès que cette fonction et le compteur de crédits ne disent pas la même chose, le panneau continue. Sur la pile locale, la fonction lit encore `plans.ai_monthly_budget_cents` (45 $) au lieu de `lumi_credits_mensuels` × 3 ¢ (30 $).
- Correctif proposé : (1) vérifier en prod, en lecture seule, que la définition de `reserve_ai_budget` contient `lumi_credits_mensuels` ; (2) dans `generer-parcours.ts`, refuser aussi quand `etatBudget(...).palier === 'epuise'`, pour que l'éditeur et l'écran des crédits lisent la même source.
- Risque / à décider par Rafba : aucun pour le correctif ; la vérification en prod est à faire avant le lancement.

### F-11 — Le routeur est appelé à chaque message d'automatisation : la règle gratuite ne tranche jamais
- Point de la mission : P4 (routage)
- Gravité : mineur
- Ce qu'on voit : 1,1 à 1,7 seconde d'attente en plus à chaque message, et 0,156 ¢. Sur le clavardage d'automatisations, le routeur fait 8,4 % du coût (12 appels sur 12 messages passés au modèle).
- Reproduction : `mesurer.mts` ; ou `sujetParRegle('Renomme l’automatisation « Rappel de facture » en « … »')` → `null`.
- Preuve : `tests/automations-finale/f/clavardage-automatisations.test.ts::F-11` (6 rouges) ; `ai_usage` de la passe : 12 lignes Haiku, 1,915 ¢ ; `lumi_traces.params.routeur` : sujet « rapports » 12 fois sur 12 (confiance 0,72 à 0,99).
- Cause racine : `server/lib/lumi/sujet-par-regle.ts:43-48` ne rend un sujet que si UN SEUL vocabulaire est touché. Une demande d'automatisation contient toujours « automatisation » (sujet rapports) et un mot d'un autre sujet : devis, facture, texto, client, visite.
- Correctif proposé : quand le mot « automatisation » (ou « automation », « parcours automatique ») est présent dans un ordre, le sujet est « rapports », quels que soient les autres mots. Fichier : `server/lib/lumi/sujet-par-regle.ts` (zone de la session a1) et son test `tests/lumi-sujet-par-regle.test.ts`.
- Risque / à décider par Rafba : sur mes 12 messages, la règle aurait donné le même sujet que le routeur 12 fois ; l'effet sur les demandes à deux actions (« crée une automatisation ET envoie la facture ») n'est pas mesuré.

### F-12 — Chaque modification par le clavardage paie un appel au modèle juste pour retrouver l'automatisation par son nom
- Point de la mission : P4 (résultats d'outils compacts)
- Gravité : mineur
- Ce qu'on voit : « change le texto de l'automatisation X » coûte 1,31 ¢ au lieu de 0,86 : le premier appel (0,44 à 0,47 ¢, 1,5 s) ne fait que lire toute la liste des automatisations pour y trouver X.
- Reproduction : `mesurer.mts --seul unitaires` (U3, U4, U7, U8).
- Preuve : `ai_usage` de la passe : sur U3, U4, U7 et U8, un premier appel Sonnet de 0,4472, 0,4536, 0,4375 et 0,4702 ¢ qui n'appelle que `list_automations` ; `sorties/f-resultats-outils.json` : le résultat pèse 1 123 à 1 184 tokens pour 40 automatisations, relu ensuite à chaque tour de la conversation.
- Cause racine : `list_automations` (`server/lib/agent/tools-etendus.ts:932-960`) n'a aucun paramètre et rend toute la liste ; le repérage des fiches avant le modèle (`server/lib/lumi/reperage.ts:127`, la mesure #845 citée dans `LUMI_COST_REPORT.md`) couvre les clients, jobs, devis et factures, pas les automatisations.
- Correctif proposé : ajouter les automatisations au repérage (nom cité dans la demande → référence donnée au modèle), ou un paramètre `nom` à `list_automations`. Fichiers : `server/lib/lumi/reperage.ts`, `server/lib/agent/tools-etendus.ts`.
- Risque / à décider par Rafba : gain de coût mesuré (0,45 ¢ par modification, 34 %) ; effet sur la qualité non mesuré pour les automatisations (pour les clients et les jobs, `LUMI_COST_REPORT.md` le donne en hausse).

### F-13 — Quand le routeur hésite en cours de conversation, le jeu d'outils change et le tour coûte le double
- Point de la mission : P4 (cache)
- Gravité : mineur
- Ce qu'on voit : au tour 3 de la conversation (« ajoute un délai de 3 jours »), Lumi répond sans outil pour 1,45 ¢, contre 0,54 à 0,71 ¢ pour les tours voisins : 2 432 tokens réécrits en cache, et les outils d'automatisation ne sont plus chargés.
- Reproduction : `mesurer.mts --seul conv-clavardage`, tour 3.
- Preuve : `lumi_traces` du tour : `outils_charges: 15` (33 aux cinq autres tours), `params.routeur.verdict.confidence: 0.72`, `cost_cents: 1.4470`.
- Cause racine : sous 0,85 de confiance, `sousAgentDepuisVerdict` rend `null` (`server/lib/lumi/sous-agents.ts:71-77`) et le tour repart avec le jeu de base : les outils précèdent le prompt et la conversation dans la requête, donc tout le préfixe change.
- Correctif proposé : en cours de conversation, garder le sujet du tour précédent quand le routeur n'est pas sûr. Fichiers : `server/routes/lumi.ts` (zone f1), `server/lib/lumi/sous-agents.ts`.
- Risque / à décider par Rafba : effet sur la qualité non mesuré ; un vrai changement de sujet en cours de conversation doit toujours pouvoir changer d'outils.

### F-14 — Par le clavardage, « ajoute un délai » ou « seulement pour tel client » crée un doublon sans le filtre demandé, puis l'active
- Point de la mission : 3 (hors de mon domaine, vu en mesurant)
- Gravité : majeur
- Ce qu'on voit : sur « Suivi après visite F », je demande « ajoute un délai de 3 jours » : Lumi répond qu'il faut refaire la règle au complet. Je demande « seulement pour les clients avec l'étiquette commercial » : une carte de création s'affiche, je confirme (37 s, 4,42 ¢). J'ai maintenant DEUX automatisations ; la nouvelle n'a pas le filtre (Lumi le dit au tour suivant). Je dis « active-la » : la nouvelle est activée et écrira à TOUS les clients après chaque job.
- Reproduction : `mesurer.mts --seul conv-clavardage`.
- Preuve : `sorties/f-mesures.json`, C1-tour3 à tour6 ; en base après la passe : « Suivi après visite - clients commercial », `is_active: true`, `conditions: {}`, à côté de « Suivi après visite F » toujours là.
- Cause racine : le clavardage n'a aucun outil pour modifier la structure d'une automatisation existante (ajouter une étape, un délai, un filtre) : seulement créer, réécrire un message, activer, renommer, dupliquer, supprimer (`server/lib/agent/tools-reglages.ts:342-720`, `tools-lot-entreprise.ts`).
- Correctif proposé : un outil « modifier le parcours d'une automatisation » qui passe par `genererParcours` avec le parcours actuel (ce que fait le panneau), et un filtre de déclencheur posé dans `conditions`. À traiter par l'agent chargé de Lumi et des automatisations.
- Risque / à décider par Rafba : tant que l'outil n'existe pas, Lumi devrait refuser et envoyer vers l'éditeur plutôt que créer un doublon.

### F-15 — « Explique-moi ce que fait l'automatisation X » par le clavardage : une réponse vide de contenu, avec une clé technique
- Point de la mission : 3 (hors de mon domaine, vu en mesurant)
- Gravité : majeur
- Ce qu'on voit : « L'automatisation « Relance de soumission F » se déclenche quand une soumission est envoyée (quote.sent), mais elle est actuellement en pause — elle n'envoie rien pour l'instant. » Rien sur les 3 jours d'attente, le texto, les 2 jours, le courriel. 1,33 ¢. Le panneau, lui, répond juste pour 0,65 ¢.
- Reproduction : `mesurer.mts --seul unitaires` (U8).
- Preuve : `sorties/f-mesures.json`, U8 (réponse recopiée ci-dessus), outil appelé : `list_automations` seulement.
- Cause racine : aucun outil ne lit les étapes d'une automatisation ; `list_automations` ne rend que le nom, le déclencheur et l'état (`server/lib/agent/tools-etendus.ts:932-960`), et la clé brute du déclencheur part au modèle.
- Correctif proposé : un outil de lecture « détail d'une automatisation » qui rend la phrase résumé écrite par du code (point 17 de la mission) ; rendre le libellé du déclencheur (« Devis envoyé ») au lieu de sa clé.
- Risque / à décider par Rafba : aucun.

### F-16 — Après Confirmer, le reçu d'une écriture d'automatisation dit « C'est fait : l'action. »
- Point de la mission : 1, 3 (hors de mon domaine, vu en mesurant)
- Gravité : mineur
- Ce qu'on voit : je confirme la création d'une automatisation et je lis « C'est fait : l'action. » Ni son nom, ni le fait qu'elle est créée en pause et n'enverra rien tant que je ne l'active pas.
- Reproduction : `mesurer.mts --seul unitaires` (U1 à U6).
- Preuve : `tests/automations-finale/f/clavardage-automatisations.test.ts::F-16` (5 rouges) ; `sorties/f-mesures.json` : « ⟶ [Confirmer] C'est fait : l'action. » sur U1 à U6.
- Cause racine : `server/lib/lumi/recus.ts:41-61` n'a aucun nom d'action pour les outils d'automatisation, et la branche du succès (`:89`) n'ajoute pas la `note` de l'outil (« Créée EN PAUSE… »).
- Correctif proposé : nommer les outils d'automatisation dans `recus.ts`, reprendre `resultat.name` comme libellé et afficher la note de création.
- Risque / à décider par Rafba : aucun.

### F-17 — Les textos écrits par le clavardage ne suivent pas les règles de rédaction du panneau
- Point de la mission : 16 (hors de mon domaine, vu en mesurant)
- Gravité : mineur
- Ce qu'on voit : pour la même demande (« un texto plus chaleureux »), le panneau écrit « Bonjour [client_first_name], un grand merci d'avoir fait confiance à [company_name]… » ; le clavardage écrit « Merci d'avoir fait appel à nous! 😊 On espère que tout s'est bien passé… » : un émoji, pas d'ouverture au prénom, pas de signature.
- Reproduction : `mesurer.mts`, C1-tour1 et tour2 contre C2-tour1 et tour2.
- Preuve : en base après la passe, étape `e1` de « Suivi après visite F » : `"body": "Merci d'avoir fait appel à nous! 😊 On espère que tout s'est bien passé. Écrivez-nous si besoin, on est là pour vous!"`.
- Cause racine : les règles de rédaction (vouvoiement, ouverture, aucun émoji, 160 caractères, variables connues) vivent dans le prompt du panneau (`generer-parcours.ts:398-424`) ; `update_automation_message` et `update_automation_sms_body` prennent le texte que l'agent a écrit sans elles.
- Correctif proposé : porter ces règles dans la description des deux outils ou dans la consigne du sujet, et valider le texte à l'écriture (variables inconnues, longueur).
- Risque / à décider par Rafba : aucun.

### F-18 — Le panneau refuse un filtre par étiquette que l'éditeur sait poser, et parle en clés techniques
- Point de la mission : 3, 6 (hors de mon domaine, vu en mesurant)
- Gravité : mineur
- Ce qu'on voit : « seulement pour les clients avec l'étiquette commercial » → « Je ne peux pas filtrer sur une étiquette existante ici : la condition « tag » ne fonctionne qu'avec les déclencheurs client.tagged ou client.untagged, pas avec job.completed. » L'éditeur offre pourtant ce réglage (« Seulement si le client a l'étiquette »). 0,77 ¢.
- Reproduction : `mesurer.mts --seul conv-panneau`, tour 4.
- Preuve : `sorties/f-mesures.json`, C2-tour4.
- Cause racine : le prompt du panneau ne connaît que les étapes ; les filtres du déclencheur (`src/lib/automationCatalogue.ts:505-509`, `client_a_etiquette`) vivent dans `conditions`, que `genererParcours` ne rend pas. Le prompt cite les clés brutes des déclencheurs.
- Correctif proposé : que la génération puisse rendre les filtres du déclencheur, et que le texte de refus emploie les libellés de l'écran.
- Risque / à décider par Rafba : aucun.

---

## Pistes de la mission : fait, pertinent, ou à écarter

| Piste | Verdict pour les automatisations | Mesure |
|---|---|---|
| Recherche d'outils, chargement différé | Déjà fait (`LUMI_COST_REPORT.md` : jeu de base de 15 outils, le reste différé, un jeu par sujet). Rien à gagner de plus ici. | Jeu de base + recherche : 1,55 ¢ et 1,71 ¢, contre 1,31 ¢ et 1,70 ¢ avec le sujet chargé. La recherche ne casse plus le cache (8 359 tokens relus après la découverte). |
| Outils d'automatisation regroupés et préfixés `automation_…` | À écarter. | Non mesuré ; le bon outil a été choisi à tous mes tours, et `LUMI_COST_REPORT.md` écarte le renommage (historique, MCP, tests). |
| Cache du prompt, préfixe stable | Déjà fait pour le clavardage (`LUMI_COST_REPORT.md`) ; vérifié pour le panneau : un seul bloc de 6 056 tokens, identique pour toutes les entreprises, en cache 5 minutes. | 92,0 % et 93,1 % de lecture en cache en multi-tours. Mettre aussi les messages du panneau en cache ne rapporterait pas 0,1 ¢ par tour. |
| Contexte de page compact | Clavardage : aucun contexte de page. Panneau : pertinent, voir F-03 et F-07. | Parcours envoyé : 162 à 2 714 tokens ; réponse : 215 à 4 599 tokens. |
| Résultats d'outils compacts | Déjà compacts pour les écritures (172 à 585 tokens). Pertinent pour `list_automations` : F-12. | 1 170 tokens, 0,45 ¢ par modification. |
| Actions simples sans modèle | Déjà fait : boutons de l'interface (0 ¢) et phrase exacte dans le clavardage (0 ¢). | « Active l'automatisation X » : 0 ¢, 0,4 s. « active-la » : 0,70 ¢. Renommer par le clavardage : 1,70 ¢. |
| Routage de modèle | Sonnet 5 partout, Haiku 4.5 pour le routeur. Haiku sur les demandes de structure et les questions du panneau : −72 %, 8 sur 8, mais échantillon de 8 et il faudrait classer la demande avant l'appel : à prouver sur `qa:construire-lumi` avant de proposer. La rédaction reste sur Sonnet (mesure du 2026-09-30 dans le code). | Voir F-mesures §6. |
| `max_tokens` par type de demande | Abaisser le plafond ne fait rien gagner (on paie ce qui est écrit). Le problème est inverse : 4 000 tokens ne suffisent pas à un parcours de 17 étapes (F-03). | 4 273 et 4 599 tokens attendus. |
| Effort et concision | Pertinent : F-05 (−21 %) et F-07 (−60 % sur les questions). | Voir F-mesures §6. |
