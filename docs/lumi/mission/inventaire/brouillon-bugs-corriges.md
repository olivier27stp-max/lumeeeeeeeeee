# Brouillon — bugs trouvés et corrigés (pour LUMI_READINESS.md), avec les commits de `main`

## Sécurité et confidentialité

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| S1 | Un technicien pouvait lire et modifier la mémoire de Lumi de toute l'entreprise par l'API. | `/api/org-knowledge` sans permission. | `cd3ce0ed` |
| S2 | Un technicien lisait les questions posées à Lumi par le propriétaire, et le journal des actions des autres. | `lumi_traces` et `agent_actions` lisibles par tout membre. | `8e2d2c57` (migration) |
| S3 | Un membre à qui on avait retiré Lumi pouvait encore lancer les actions rapides et changer son mode de confirmation. | Trois routes de Lumi sans droit déclaré. | `7411f024` |
| S4 | Lumi par texto ne vérifiait ni le droit, ni le plafond, ni les outils permis par le rôle, et ne débitait rien. | Chemin texto écrit à part de la route de l'app. | `494c09ad` |
| S5 | Un technicien recevait une carte « supprimer le client ». | Les cartes préparées par le code ne passaient par aucun filtre de rôle ; et le modèle peut appeler un outil qu'on ne lui a pas donné — seul le fait qu'il existe était vérifié. | `9d433710`, `a2f9d4cb` |
| S6 | Lumi proposait une carte sur l'identifiant d'une fiche d'une AUTRE entreprise (rien ne bougeait, mais la carte existait). | Une cible introuvable n'arrêtait pas la carte. | `9d433710` |
| S7 | Le micro (dictée) servait tout compte connecté, même sans Lumi, même à zéro crédit. | Route de transcription hors de la table des permissions. | `f3971dae` |
| S8 | Aucune limite de débit sur Lumi en production (173 tours en une heure pour un compte, zéro refus). | La limite n'existait que si Redis était branché ; il ne l'est pas. | `d94f2685` |
| S9 | Le journal d'analyse gardait les courriels et téléphones dictés à Lumi. | L'énoncé était normalisé, pas masqué. | `4734747b` |
| S10 | Les envois d'un bureau de test pouvaient partir pour de vrai sur certaines routes. | Le contexte « entreprise au bac à sable » ne survivait pas à un `await`. | `7c7d3adb` |
| S11 | Une réponse d'aide de Lumi pouvait être mémorisée pour TOUTES les entreprises alors qu'elle reprenait un nom ou un chiffre d'un compte. | Filtre du cache commun trop faible. | `43715003` |
| S12 | Une demande d'humain depuis un bureau de test ouvrait un vrai canal Slack chez l'équipe. | Le bac à sable ne couvrait pas l'escalade du support. | `74bbf4a7` |

## Exactitude

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| E1 | « Combien de clients ai-je au total ? » → « Aucune limite, dans tous les forfaits. » | L'aide écrite passait avant la lecture de la base. | `13dc88ce` |
| E2 | « Combien j'ai encaissé en septembre ? » → 0,00 $ (vrai chiffre : 989,85 $). | Le routeur choisissait un raccourci gratuit qui ignore la période. | `8093d246` |
| E3 | « Crée un job à 240 $ » : la carte affichait 240 $, l'exécution aurait créé un job à 0 $. | La carte était bâtie sur des arguments que l'exécution retire. | `ffb0df02` |
| E4 | Reprendre une ancienne conversation pouvait faire agir Lumi sur la fiche d'un autre client. | Les références courtes (ref1, ref2…) étaient communes à toutes les conversations d'une personne et repartaient à 1 après un redéploiement. | `833b0a5f`, `92d88b41` (MCP) |
| E5 | « Marque la facture 8888 payée » (elle n'existe pas) → une carte. | L'erreur du résolveur de numéros était ignorée. | `9d433710` |
| E6 | Lumi décrivait un pipeline de ventes qui n'est pas celui de l'écran. | Les outils lisaient l'ancien tableau. | `31ec7b53` (session voisine) |
| E7 | « Comment je mets le formulaire de demande sur mon site web » → « ça sort de ce que je peux voir ». | Le routeur classait hors-sujet une fonction documentée. | `28325d5c` |

## Fiabilité des conversations

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| F1 | Une réponse coupée passait pour terminée ; une action coupée restait dans l'historique et cassait la conversation. | `stop_reason` non traité. | `7411f024`, `ff34fca7` |
| F2 | Une conversation ouverte par le briefing du matin était refusée par l'API au message suivant. | Historique commençant par l'assistant. | `7411f024` |
| F3 | Un redéploiement pendant une réponse laissait une bulle à moitié écrite, sans message. | Le client ne distinguait pas un flux fermé d'un flux terminé. | `5ba40e5b` |
| F4 | Au palier restreint, une question à deux lectures finissait en erreur, sans réponse. | Limite d'étapes sans appel de conclusion. | `0a32ea84` |
| F5 | Deux « Confirmer » simultanés (ou un message pendant une confirmation) laissaient deux résultats pour la même carte. | Aucun verrou par conversation. | `b5ff8286`, `3908ca1d` |
| F6 | Un refus du modèle ou un tour inachevé était tracé « ok ». | La trace ne lisait pas l'issue du tour. | `7411f024`, `5ad09a41` |
| F7 | Quand le plafond de la plateforme arrêtait un tour, le client lisait « tes crédits sont épuisés ». | Un seul message pour deux plafonds. | `aeadd1c7` |
| F8 | 4 tours sur 221 finissaient en « Lumi n'a pas pu répondre » sous cinq tours simultanés. | Une surcharge du modèle annoncée dans le flux n'était jamais reprise. | `ecff0846`, `9b991e77` |
| F9 | Une référence interne (« ref2 ») apparaissait dans le texte d'une réponse. | Rien ne filtrait le texte du modèle. | `9a4dca4c` |
| F10 | Dans une longue conversation, ce que la personne avait dit au début était oublié, et le cache réécrit à chaque tour. | Coupe nette à 60 messages, qui avançait à chaque tour. | lot 7 (PR #877) |

## Cohérence

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| C1 | Lumi vouvoyait quand il servait un article d'aide, et le support tutoyait dans sa relance. | Articles partagés, une seule voix. | `e43cf321` |
| C2 | Question en anglais sur un compte en français → réponse d'aide en français. | Les étages sans modèle suivaient la langue du compte. | `d3bc6170` |
| C3 | « Ton rôle ne te donne pas accès à les paiements. » | Libellé collé après « à ». | `9f4cd5a4` |
| C4 | « · both », « · email », « · sms » ; noms d'automatisations en anglais. | Valeurs de base affichées telles quelles. | `e4cf95a6`, `8031b505` |
| C5 | « Devis supprimé » à l'écran. | Accents doublement échappés. | `5ba857af` |
| C6 | L'agent du site annonçait des bureaux et des fonctions dans le mauvais forfait. | Prompt jamais réaligné sur la page Tarifs. | `d4fdb9e4` |
| C7 | « Désolé, je n'ai pas réussi à répondre. Réessayez. » | Message d'échec au « vous ». | `bf72538a` |

## Coût

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| K1 | Dès que la minute changeait, toute la conversation était réécrite en cache (2 088 → 9 103 tokens mesurés). | L'heure était dans le bloc mis en cache. | `91489639` |

## Ajouts du lot 7 et du lot 8 (commits de la branche, à remplacer par ceux de main après le merge de #880)

| # | Ce qui se passait | Cause | Commit |
|---|---|---|---|
| F10 | (lot 7, en prod) conversation longue : début oublié, cache réécrit à chaque tour | coupe nette à 60 messages | `38238f9e` |
| F11 | La dictée d'un silence revenait avec une phrase inventée (« Ok, affiche-moi la liste des clients qui ont une facture en retard. »). | Le modèle de transcription invente devant un audio vide ; rien ne mesurait le niveau sonore côté serveur. | lot 8 |
| F12 | Quand le plafond de coût retirait ses outils au modèle, il annonçait une action qu'il ne pouvait plus faire. | Le modèle n'était pas averti du retrait. | lot 8 |
| C8 | Support : « je veux parler à quelqu'un » écrit en toutes lettres n'était pas transmis sans passer par le modèle ; question en anglais → réponse en français. | Seul le bouton déclenchait le transfert ; la langue suivait le compte. | lot 8 |
| C9 | Support : « c'est combien, le forfait Autopilot ? » → pas de prix. | Aucun article de prix dans la FAQ. | lot 8 |
| S13 | Le résumé quotidien Slack de l'équipe listait les conversations des bureaux de test. | Aucun filtre sur le bac à sable. | lot 8 |
