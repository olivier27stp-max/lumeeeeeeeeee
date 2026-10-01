# LUMI_READINESS — Lumi et l'agent de support sont-ils prêts pour le 26 octobre ?

État au 2026-10-01, fin de journée. Tout ce qui est chiffré ici a été mesuré **en production**, dans des bureaux de test (aucun vrai client, tous les envois simulés), et jugé par du code — aucun modèle ne note un autre modèle.

## Verdict

**Pas prêt aujourd'hui. Prêt pour le 26 octobre si trois choses sont faites avant — et aucune des trois n'est dans le code de Lumi.**

Lumi lui-même tient. Il réussit 93,7 % des 221 demandes du jeu d'évaluation (81,3 % le matin même). Les tests de sécurité passent. Une conversation de 50 tours garde ce qu'on lui a dit au début. La cause des « Lumi n'a pas pu répondre » est trouvée, corrigée et rejouée en prod sans plantage. L'agent de support donne les bons prix et le bon contenu des forfaits, transfère quand il le faut et n'agit jamais dans le CRM.

Ce qui bloque le lancement :

1. **La base de production est petite.** Huit conversations Lumi en même temps l'ont couchée pendant 65 minutes le 1er octobre (section « La panne » plus bas). Depuis, un garde-fou gratuit est en place : Lumi ne mène plus que quatre conversations à la fois, les suivantes attendent leur place. Il reste à passer la base au format au-dessus (2 Go au lieu de 1, environ 5 $ de plus par mois) et à poser une alerte de disponibilité. C'est la condition qui pèse le plus.
2. **Le plafond de la plateforme, 50 $ par jour pour tous les clients réunis**, met Lumi en pause pour tout le monde quand il est atteint. Rien à payer tant qu'il n'est pas atteint ; à relever quand le nombre de clients actifs le justifie (il laisse environ 3 800 demandes par jour).
3. **Une passe complète à rejouer d'un seul tenant**, une fois la base grossie. Celle d'aujourd'hui a été coupée en deux par la panne, quatre correctifs sont arrivés après elle, et les tests critiques ont tourné avec le modèle de repli. Une heure de mesure, à faire demain.

Une quatrième décision est légale plutôt que technique : aucune purge des conversations n'existe (Loi 25).

## Résultats par phase

| Phase | Ce qui était demandé | Résultat | Détail |
|---|---|---|---|
| 0 — Filet de sécurité | Sauvegarde, bureau de test, zéro envoi réel | **PASS** | Sauvegarde de la base faite avant de commencer. Trois bureaux de test en prod, inscrits au bac à sable des envois. Le canari a trouvé un trou (certaines routes laissaient partir un vrai envoi depuis un bureau de test) : corrigé avant toute conversation, canari rejoué vert. Aucun envoi réel n'est parti. |
| 1 — Inventaire | `LUMI_INVENTORY.md` | **PASS** | Étages de Lumi, 240 outils, prompts, caches, plafonds, 73 risques listés. |
| 2 — Mesure | Instrumentation, jeu d'évaluation ≥ 150 cas, point de départ | **PASS** | 227 cas (`evals/lumi/cas`), chaque tour tracé (fin du modèle, appels, outils, premier mot). `LUMI_BASELINE.md`. |
| 3 — Tests critiques | Isolation, rôles, mémoire, injection, actions sensibles, exécution unique, exactitude, crédits, Loi 25 | **65 PASS · 1 FAIL · 4 non couverts · 1 à relire** (71 tests) | Le seul échec est une décision à prendre : aucune purge des conversations n'existe (Loi 25). Voir « Ce qui n'a pas pu être testé ». |
| 4 — Robustesse des conversations | 50 tours, références, revirements, coupures, deux appareils, entrées bizarres, vocal, pannes | **37 PASS · 0 FAIL · 3 non couverts** (40 tests) | Un échec trouvé, corrigé et rejoué en prod : la dictée d'un silence inventait une phrase. La conversation de 50 tours passe sans erreur ; ce qui est dit aux tours 3 et 4 est encore honoré aux tours 47 et 48. Non couverts : bruit et accent dans de vrais enregistrements (il n'y en a pas), panne du fournisseur du modèle (elle ne se provoque pas). |
| 5 — Cohérence | Mêmes mots partout, agent de support, Lumi ↔ automatisations | **PASS, avec des écarts connus** | `LUMI_GLOSSARY.md` + 4 tests de vocabulaire (12 écarts connus, marqués). Support : 93 tests en prod, 85 PASS, 2 FAIL, 6 à relire par un humain. Les deux échecs donnent la bonne page mais pas le nom exact du bouton (« Changer » la période du classement ; ce que le client peut faire d'une soumission reçue). Prix, forfaits, fonctions qui n'existent pas, transfert à un humain, refus d'agir dans le CRM, injection, langue : aucun échec. Automatisations (session voisine, `AUTOMATIONS_TEST_REPORT.md`) : 710 cas, 697 PASS, 0 FAIL, 13 non couverts ; les 40 cas Lumi ↔ automatisations passent. |
| 6 — Coût | `LUMI_COST_REPORT.md` | **PASS** | Un tour d'agent : 1,57 ¢ → 1,30 ¢ à caches chauds, pendant que la qualité montait. Aucune optimisation livrée au prix de la qualité. |
| 7 — Boucle de correction | Cause → correctif → test → tout rejouer | **PASS pour la phase 4 · une décision en attente pour la phase 3** | Phase 4 : 0 échec. Phase 3 : le seul échec restant (aucune purge des conversations) demande ta décision, pas un correctif. Chaque correctif a son test de régression ; ceux trouvés par les batteries y sont rejoués. Limite : le jeu complet n'a pas été rejoué d'un seul tenant après les derniers correctifs (condition 3 du verdict). |
| 8 — CI et rapport | `npm run test:lumi`, ce rapport | **PASS** (une action de ta part, voir la décision 12) | `npm run test:lumi` : environ 1 700 tests sans réseau + les batteries de prod à la demande, un seul flux à la fois ; rapport JSON et markdown. Job CI « Lumi (npm run test:lumi) » en place ; il ne bloque une fusion que si tu le déclares obligatoire dans GitHub. |

## Ce que Lumi réussit, en chiffres

Même jeu de 221 demandes, joué trois fois dans la journée :

| | Départ (16 h 15 UTC) | Après les lots 2 à 5 (18 h 42) | Fin de journée (22 h 13) |
|---|---:|---:|---:|
| Réussite | 81,3 % | 90,5 % | **93,7 %** |
| Bon outil appelé | 85,5 % | 94,1 % | **95,0 %** |
| Actions sensibles (78 cas) | 87,2 % | 92,3 % | **96,2 %** |
| Réponses sans modèle (aide écrite, raccourcis) | 68,0 % | 90,0 % | **90,5 %** |
| Injection, extraction des consignes, hors-sujet | 100 % | 100 % | 100 % |
| Tours plantés | 0 | 4 | 4 (0 au rejeu, après correctif) |
| Coût moyen d'une demande | — | 1,105 ¢ | ≈ 1,2 ¢ |

La troisième passe a été coupée par la panne : 145 demandes jouées avant, 80 rejouées après, une seule à la fois. Elle tourne sur le jeu d'outils d'avant les 30 nouveaux outils livrés le soir même (#875), dont l'effet n'est pas mesuré.

- **Quand le modèle répond, il réussit 95,8 % du temps** (191 demandes). Les réponses sans modèle : 90,5 %.
- **Les 14 échecs** : 4 plantages d'une même cause, corrigée depuis ; 8 choix d'outil ou de formulation du modèle (un nom d'outil visible dans une réponse, un devis relu au lieu d'être dupliqué, « payant » lu comme rentabilité) ; 2 réponses d'aide incomplètes.
- **Les 4 demandes plantées, rejouées en prod après les correctifs** : aucune ne plante, 3 réussissent. La quatrième cherche « Nathalie Coté » et ne trouve pas la fiche « Nathalie Côté » : la recherche par nom dépend encore de l'accent tapé. En comptant ce rejeu, la passe serait à 95,0 % ; je garde 93,7 %, le résultat de la passe elle-même.
- **Les demandes à plusieurs actions restent le point faible** : 9 sur 13 dans la passe. Trois des quatre échecs étaient le plantage corrigé.

## Bugs trouvés et corrigés

Tous en production. Un commit par correctif ; chaque correctif a son test.

### Sécurité et confidentialité

| Ce qui se passait | Cause | Commit |
|---|---|---|
| Un technicien pouvait lire et modifier la mémoire de Lumi de toute l'entreprise par l'API. | Route sans permission. | `cd3ce0ed` |
| Un technicien lisait les questions posées à Lumi par le propriétaire, et le journal des actions des autres. | Deux tables lisibles par tout membre. | `8e2d2c57` |
| Un membre à qui on avait retiré Lumi pouvait encore lancer les actions rapides et changer son mode de confirmation. | Trois routes de Lumi sans droit déclaré. | `7411f024` |
| Lumi par texto ne vérifiait ni le droit, ni le plafond, ni les outils permis par le rôle, et ne débitait rien. | Chemin texto écrit à part de celui de l'app. | `494c09ad` |
| Un technicien recevait une carte « supprimer le client ». | Les cartes préparées par le code ne passaient par aucun filtre de rôle ; et le modèle peut appeler un outil qu'on ne lui a pas donné. | `9d433710`, `a2f9d4cb` |
| Lumi proposait une carte sur l'identifiant d'une fiche d'une AUTRE entreprise (rien ne bougeait, mais la carte existait). | Une cible introuvable n'arrêtait pas la carte. | `9d433710` |
| Le micro servait tout compte connecté, même sans Lumi, même à zéro crédit. | Route de dictée hors de la table des permissions. | `f3971dae` |
| Aucune limite de débit sur Lumi en production (173 tours en une heure pour un compte, zéro refus). | La limite n'existait que si Redis était branché ; il ne l'est pas. | `d94f2685` |
| Le journal d'analyse gardait les courriels et téléphones dictés à Lumi. | L'énoncé était normalisé, pas masqué. | `4734747b` |
| Les envois d'un bureau de test pouvaient partir pour de vrai sur certaines routes. | Le contexte « bureau au bac à sable » se perdait en cours de requête. | `7c7d3adb` |
| Une réponse d'aide pouvait être mémorisée pour TOUTES les entreprises alors qu'elle reprenait un nom ou un chiffre d'un compte. | Filtre du cache commun trop faible. | `43715003` |
| Une demande d'humain depuis un bureau de test ouvrait un vrai canal Slack chez l'équipe ; le résumé quotidien listait les conversations de test. | Le bac à sable ne couvrait pas Slack. | `74bbf4a7`, `ab52a581` |

### Exactitude

| Ce qui se passait | Cause | Commit |
|---|---|---|
| « Combien de clients ai-je au total ? » → « Aucune limite, dans tous les forfaits. » | L'aide écrite passait avant la lecture de la base. | `13dc88ce` |
| « Combien j'ai encaissé en septembre ? » → 0,00 $ (vrai chiffre : 989,85 $). | Un raccourci gratuit ignorait la période demandée. | `8093d246` |
| « Crée un job à 240 $ » : la carte affichait 240 $, l'exécution aurait créé un job à 0 $. | La carte était bâtie sur des arguments que l'exécution retire. | `ffb0df02` |
| Reprendre une ancienne conversation pouvait faire agir Lumi sur la fiche d'un autre client. | Les repères internes des fiches étaient communs à toutes les conversations d'une personne et repartaient à zéro après un déploiement. | `833b0a5f`, `92d88b41` |
| « Marque la facture 8888 payée » (elle n'existe pas) → une carte. | L'erreur de recherche du numéro était ignorée. | `9d433710` |
| « Comment je mets le formulaire de demande sur mon site web » → « ça sort de ce que je peux voir ». | Le routeur classait hors-sujet une fonction documentée. | `28325d5c` |
| La dictée d'un silence revenait avec une phrase inventée (« Ok, affiche-moi la liste des clients qui ont une facture en retard. »). | Devant un audio vide, le modèle de transcription invente ; rien ne mesurait le niveau sonore côté serveur. | `3548a377` |

### Fiabilité des conversations

| Ce qui se passait | Cause | Commit |
|---|---|---|
| Une réponse coupée passait pour terminée ; une action coupée restait dans l'historique et cassait la conversation. | La raison de fin du modèle n'était pas traitée. | `7411f024`, `ff34fca7` |
| Une conversation ouverte par le briefing du matin était refusée au message suivant (73 briefings en prod, 0 réponse possible). | Historique commençant par l'assistant. | `7411f024` |
| Un déploiement pendant une réponse laissait une bulle à moitié écrite, sans message. | L'app ne distinguait pas un flux fermé d'un flux terminé. | `5ba40e5b` |
| Au palier restreint, une question à deux lectures finissait en erreur, sans réponse. | Limite d'étapes sans appel de conclusion. | `0a32ea84` |
| Deux « Confirmer » simultanés (ou un message pendant une confirmation) laissaient deux résultats pour la même carte. | Aucun verrou par conversation. | `b5ff8286`, `3908ca1d` |
| Un refus du modèle ou un tour inachevé était tracé « ok ». | La trace ne lisait pas l'issue du tour. | `7411f024`, `5ad09a41` |
| Quand le plafond de la plateforme arrêtait un tour, le client lisait « tes crédits sont épuisés ». | Un seul message pour deux plafonds. | `aeadd1c7` |
| Une surcharge passagère du modèle n'était jamais reprise : le tour finissait en « Lumi n'a pas pu répondre ». | Aucune reprise après une erreur annoncée dans le flux. | `ecff0846`, `9b991e77` |
| Des tours finissaient en « Lumi n'a pas pu répondre » : 4 sur 221, puis 4 sur 221 encore — toujours des demandes à deux sujets (« texte à Nathalie pis mets sa job en cours »). Je les avais d'abord attribués à une surcharge du modèle ; la cause enregistrée au journal disait autre chose. | Le modèle demande un outil de Lume et une recherche d'outil dans la même réponse ; la recherche, jamais lancée, restait en suspens et l'appel suivant était refusé (erreur 400). Trouvé grâce à la forme de la conversation, que la trace enregistre depuis le premier essai de correctif. | `6a8b2ffa` |
| Même refus possible quand le fournisseur met un tour en pause pendant une recherche d'outil (pas observé, corrigé par précaution : c'était ma première hypothèse). | La suite du tour était rangée dans un second message. | `af1e2a32` |
| À cache froid — après un déploiement, ou cinq minutes sans demande —, Lumi répondait « confirme-moi au prochain message » au lieu de proposer l'action. | Le plafond de coût du tour comptait l'écriture du cache au démarrage ; il retirait les outils dès la deuxième étape. | `84505af8` |
| Un repère interne (« ref2 ») apparaissait dans le texte d'une réponse. | Rien ne filtrait le texte du modèle. | `9a4dca4c` |
| Dans une longue conversation, ce que la personne avait dit au début était oublié, et le cache réécrit à chaque tour. | Coupe nette à 60 messages, qui avançait à chaque tour. | `38238f9e` |
| Quand le plafond de coût retirait ses outils au modèle, il annonçait une action qu'il ne pouvait plus faire. | Le modèle n'était pas averti du retrait. | `8bbbd356` |

### Cohérence

| Ce qui se passait | Cause | Commit |
|---|---|---|
| Lumi vouvoyait quand il servait un article d'aide, puis tutoyait au message suivant. | Articles partagés avec le support, une seule voix. | `e43cf321` |
| Question en anglais sur un compte en français → réponse en français (Lumi et support). | Les réponses sans modèle suivaient la langue du compte. | `d3bc6170`, `a0c5d7bb` |
| Une question en anglais recevait un paragraphe FRANÇAIS du centre d'aide, suivi d'une relance en anglais (Lumi et support). | L'aide directe sert des passages écrits en français seulement. | `d41372ab` |
| « Ton rôle ne te donne pas accès à les paiements. » | Libellé collé après « à ». | `9f4cd5a4` |
| « · both », « · email », « · sms » ; noms d'automatisations en anglais. | Valeurs de la base affichées telles quelles. | `e4cf95a6`, `8031b505` |
| « Devis supprimé » à l'écran. | Accents doublement échappés. | `5ba857af` |
| L'agent du site annonçait des fonctions dans le mauvais forfait. | Prompt jamais réaligné sur la page Tarifs. | `d4fdb9e4` |
| « Désolé, je n'ai pas réussi à répondre. Réessayez. » | Message d'échec au « vous ». | `bf72538a` |
| Support : « je veux parler à quelqu'un », écrit en toutes lettres, n'était transmis que si le modèle le décidait. | Seul le bouton déclenchait le transfert. | `a0c5d7bb` |
| Support : « c'est combien, le forfait Autopilot ? » → pas de prix. | Aucun article de prix dans la FAQ. | `8b165e8e` |
| Support : « le porte-à-porte est inclus dans quel forfait ? » → « Scale et Autopilot » (faux : Autopilot seulement) ; « combien de bureaux inclus ? » → la grille des prix. | L'assistant n'avait aucun fait écrit sur le contenu des forfaits ; l'article des prix répondait à toute question avec « combien » et « forfait ». | `d950c130`, `413b3050` |

### Coût

| Ce qui se passait | Cause | Commit |
|---|---|---|
| Dès que la minute changeait, toute la conversation était réécrite en cache (2 088 → 9 103 tokens écrits par tour). | L'heure était dans le bloc mis en cache. | `91489639` |

## Coût : avant, après, et par client

Détail complet dans `LUMI_COST_REPORT.md`.

| | Avant | Après |
|---|---:|---:|
| Un tour d'agent (Sonnet), caches chauds, même jeu de demandes | 1,57 ¢ | 1,30 ¢ |
| Une demande moyenne (agent + réponses gratuites) | — | ≈ 1,2 ¢ |
| Conversation de 7 000 tokens : écriture en cache par tour | ≈ 1,75 ¢ | ≈ 0,14 ¢ |
| Tours plantés payés pour rien | 4 sur 221 | 4 (0 au rejeu, après correctif) |
| Une question au support servie par le modèle | — | 1,0 à 1,5 ¢ |

**Par client**, avec 1 000 crédits par mois (30 $ de coût réel) :

| Rythme | Coût par demande | Demandes dans le mois |
|---|---:|---:|
| Demandes isolées, caches froids (la production d'aujourd'hui) | 3,6 ¢ | ≈ 830 |
| Usage soutenu, caches chauds | 1,1 ¢ | ≈ 2 700 |

La seule entreprise active a dépensé 0,65 $ en 30 jours, soit 2 % de son allocation.

**Ce qui coûte encore** : le démarrage à froid. Quand personne n'a parlé à Lumi d'un sujet depuis cinq minutes, la première demande sur ce sujet réécrit de 13 000 à 21 000 tokens : 4 à 6 ¢. Mesuré sur la conversation de 50 tours : 37,7 ¢ pour 17 tours d'agent. Avec plusieurs clients actifs en même temps, ce préfixe est partagé et reste chaud ; aujourd'hui, avec une seule entreprise, presque chaque demande le paie. Choisir entre un cache de 5 minutes et d'une heure demande du vrai trafic : à remesurer deux semaines après le lancement.

## La panne du 1er octobre : ce que les tests ont coûté à la prod

De 20 h 36 à 21 h 41 UTC (16 h 36 à 17 h 41, heure de Montréal), la base de production n'a plus répondu : l'app s'affichait, plus rien ne chargeait. Elle est revenue après le redémarrage du projet Supabase que tu as approuvé, sans perte de données.

- **Ce qui tournait** : ma passe de 221 demandes (cinq conversations Lumi en même temps), deux batteries du support, une conversation longue, et la passe au navigateur d'une session voisine. Premier ralentissement au lancement (20 h 23), effondrement après dix minutes de charge soutenue.
- **Cause probable, non prouvée** : la base tourne sur la plus petite machine de Supabase (aucune option de puissance). Les journaux montrent des requêtes banales à 12–19 secondes juste avant la coupure.
- **Ce que ça dit pour le lancement** : huit conversations Lumi en même temps ont suffi. Je ne sais pas combien de clients il faut pour y arriver en usage réel ; je sais que la marge est faible. Voir la décision 1.
- **Ce que j'ai changé** : plus aucune batterie en parallèle contre la prod — un seul flux à la fois, la santé de la base relue avant chaque morceau, arrêt au-dessus de 1,5 seconde. La passe a été reprise comme ça. Et côté produit, Lumi ne mène plus que quatre tours d'agent en même temps (`LUMI_TOURS_SIMULTANES`) : au-delà, un tour attend sa place jusqu'à 20 secondes, puis la personne lit « je suis très sollicité, réessaie dans une minute ». Un pic de Lumi ralentit Lumi, plus tout le CRM.
- **Deux fautes de ma part** : j'ai lancé cinq lots en parallèle sur une prod dont une session voisine avait signalé deux saturations plus tôt ; et, avant ta réponse, j'ai annoncé à une autre session que je redémarrerais la base de moi-même — je l'ai retiré avant d'agir. Ta réponse est arrivée dans deux sessions à la fois : deux appels de redémarrage sont partis à sept secondes d'écart.

## Risques restants

- **La base de production** (décision 1) : le garde-fou borne la charge de Lumi, pas celle du reste de l'app. Tant que la base reste à 1 Go, une pointe d'usage ailleurs (import, automatisations en rafale) peut encore la mettre à genoux.
- **Quatre correctifs livrés après la dernière passe** : le plantage sur la recherche d'outil (`6a8b2ffa`), le plafond du tour à cache froid (`84505af8`), la réponse en anglais (`d41372ab`), le contenu des forfaits (`d950c130`, `413b3050`). Chacun est testé et rejoué en prod sur ses cas ; aucun n'a vu les 221 demandes.
- **Les 30 outils livrés le soir du 1er octobre (#875) ne sont pas mesurés.** Un interrupteur les retire sans toucher au code (`LUMI_OUTILS_LOTS=0` sur Railway). Ils alourdissent aussi le démarrage à froid de cinq sujets (+0,2 à +0,8 ¢).
- **Le plafond de coût d'un tour ne borne plus le premier appel à froid** : seule la taille du préfixe et de la conversation le fait. C'est le prix du correctif `84505af8` ; le coût réel reste débité en entier.
- **Recherche d'un client par son nom** : « Coté » ne trouve pas « Côté » selon ce que le modèle tape.
- **Demandes à plusieurs actions** : 9 sur 13 réussies avant les correctifs ; à remesurer.
- **Choix d'outil du modèle** : environ 4 % des demandes partent sur un outil voisin du bon.
- **Un nom d'outil peut apparaître dans une réponse** (2 cas sur 221) : détecté par le correcteur, pas filtré.
- **Support** : deux réponses sur 49 donnent la bonne page sans le nom exact du bouton ; le modèle répond parfois sans ouvrir la documentation.
- **Plafond d'une conversation** (décision 4) : atteint au 50e tour de la conversation longue.
- **Déploiements** : chacun vide les limites de débit et les caches tenus en mémoire.
- **Agent externe (MCP)** : n'applique pas la validation des paramètres de Lumi.

## Ce qui n'a pas pu être testé

| Quoi | Pourquoi | Ce qui le couvre en attendant |
|---|---|---|
| Blocage à zéro crédit, et course entre deux sessions au dernier crédit, **en prod** | Il faudrait épuiser un bureau : soit changer son forfait, soit écrire une fausse ligne de consommation dans le grand livre. Les deux touchent au système de crédits : je ne l'ai pas fait sans ton accord (décision 11). | Tests hors réseau de la réservation de budget (verrou en base). |
| Bruit réel et accent québécois **dans un enregistrement** | Aucun enregistrement de vraies voix dans le dépôt, ni transcription de référence. | Le québécois ÉCRIT (119 cas) et les transcriptions abîmées (nom déformé, phrase coupée, montant ambigu) passent : Lumi demande au lieu d'agir. |
| Panne du fournisseur du modèle (429, surcharge, délai) | Elle ne se provoque pas de l'extérieur sans casser le service pour tous. | Reprise automatique testée hors réseau. Aucune vraie surcharge observée le 2026-10-01 : les plantages que je lui avais attribués avaient une autre cause. |
| Retrait du droit Lumi à un compte, en prod | Les quatre rôles standards ont le droit ; la batterie ne modifie pas les permissions d'un compte partagé. | Vérifié hors réseau. |
| Tests critiques avec le modèle principal | Le jour de la passe, le bureau de test était au palier restreint : c'est le modèle de repli (Haiku) qui a répondu. Les protections testées (isolation, rôles, exécution unique) sont dans le code, pas dans le modèle. | À rejouer en Sonnet : `npm run test:lumi -- --prod --bureau zz` (le palier se lève à minuit, heure de Montréal). |
| Agent externe (MCP) | Hors périmètre de cette passe, sauf les repères de fiches. | Il n'applique pas encore la validation des paramètres de Lumi. |

## Décisions qui t'attendent

1. **La machine de la base de production.** Elle a 1 Go de mémoire, partagé avec l'API, l'authentification et le temps réel. La panne du 1er octobre vient très probablement de là, comme celle du 28 septembre. Le garde-fou de Lumi (quatre tours à la fois) réduit le risque sans rien coûter ; passer au format « Small » (2 Go) coûte environ 15 $ par mois au lieu de 10, avec deux minutes de coupure au changement. À faire avant le 26 octobre, avec une alerte de disponibilité : aujourd'hui, personne n'est prévenu quand la base tombe.
2. **Conservation des conversations de Lumi (Loi 25).** Aucune purge n'existe : ni tâche planifiée, ni fonction. Il faut une durée (12 mois ?) ; supprimer des données demande ton accord. C'est le seul test critique encore en échec.
3. **Plafond de la plateforme : 50 $ par jour pour tous les clients réunis** (≈ 3 800 tours). Au-delà, Lumi est en pause pour tout le monde jusqu'à minuit. À relever avant le lancement.
4. **Plafond d'une conversation : 40 ¢.** Réglé le 16 septembre, quand une conversation coûtait au plus 11,7 ¢. Mesuré le 2026-10-01 : à caches froids, une conversation atteint 40,5 ¢ au 16e tour d'agent ; Lumi répond alors « ouvre une nouvelle conversation ». Je recommande 120 ¢ (variable Railway `LUMI_PLAFOND_CONVERSATION_CENTS`, aucun déploiement de code) : la garde quotidienne et les crédits restent les vrais plafonds.
5. **Limites de débit générales.** Redis n'est pas branché en prod : les limites de connexion, d'envois et des pages publiques ne jouent pas. Lumi et la dictée ont maintenant une limite en mémoire ; le chat de support, non. Brancher Upstash, ou étendre le repli en mémoire à tout ?
6. **Dictée : la débiter en crédits, ou non ?** Elle coûte ≈ 0,5 à 0,9 ¢ et n'entre pas au grand livre (la base refuse la source « voix »). La brancher change ce que le client voit de ses crédits.
7. **« Payant » : revenu ou rentabilité ?** « Mes clients les plus payants » → rentabilité ; « ma job la plus payante » → revenu. Une seule lecture à choisir.
8. **Lumi doit-il refuser de retenir un code d'alarme ?**
9. **Arrêt gracieux du serveur.** Chaque déploiement coupe les réponses en cours (le client voit maintenant un message clair). Le corriger touche l'image Docker.
10. **Écarts entre le site et la base** (non touchés) : Scale est à 347 $ partout (ta consigne disait 340) ; Minimum annonce 3 utilisateurs sur le site, 2 en base ; les vidéos de formation sont à Autopilot sur le site, à Scale en base ; la FAQ de la page Tarifs dit « rabais annuel de 15 % » alors que les forfaits font 10 / 15 / 30 %.
11. **Éprouver le blocage à zéro crédit en prod** : une ligne de consommation fictive d'environ 25 $ dans le grand livre d'un bureau de test, puis son remboursement. Ton accord, et je le fais.
12. **Rendre le job « Lumi (npm run test:lumi) » obligatoire** dans la protection de branche de GitHub : c'est ce qui bloque une fusion quand un test critique casse.
13. **Noms de clients dans le journal d'analyse de Lumi** : courriels et téléphones sont masqués, les noms non.
14. **#823** : migration appliquée en prod (mémoire de Lumi lisible par tout le bureau), toujours absente de `main`.

## Relancer les tests

```
npm run test:lumi                                # ≈ 1 700 tests, sans réseau, 2 minutes — c'est ce que la CI joue
npm run test:lumi -- --prod --bureau eval3       # + tests critiques, robustesse et 221 demandes en prod (≈ 4 $, 1 h 30)
```

Une passe en prod par bureau de test et par jour : au-delà de 4,50 $ dans la journée, le bureau passe au modèle de repli et la mesure ne vaut plus rien. La commande n'envoie qu'un flux à la fois et s'arrête si la base de prod met plus de 1,5 seconde à répondre.

Rapports de la journée : `evals/lumi/resultats/` (tests critiques, robustesse, support, les trois passes).
