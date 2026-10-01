# Automatisations — rapport final de la mission de tests

Mission du 30 septembre au 1er octobre 2026 : prouver que tout ce qui touche aux automatisations de Lume fonctionne, corriger chaque bug trouvé, et laisser une suite rejouable avant chaque déploiement. Lancement visé : 26 octobre 2026.

## En bref

- **La suite existe et tourne** : `npm run test:automations`, environ 3 400 tests. Elle fait tourner le vrai moteur, contre staging ou contre la prod, sans qu'aucun texto, courriel ou webhook réel ne puisse partir.
- **Résultat contre la prod** : 3 388 tests réussis sur 3 398 à la dernière passe complète (1er octobre, 18 h 22 UTC). Les 10 échecs ont été repris un par un : 4 étaient des attentes de test à corriger, rejouées vertes contre la prod ; 6 étaient des tests unitaires sensibles à la charge du poste, verts quand ils tournent seuls. Aucun n'était un défaut du produit.
- **Matrice** : 709 cas. 696 PASS, 0 FAIL, 13 NON COUVERT.
- **79 défauts corrigés**, un commit chacun, chacun avec un test qui échoue sans le correctif. Tout est sur `main` et déployé (#813, #842, #861, #873).
- **Aucun envoi réel** pendant toute la mission, vérifié en base sur staging et en prod.
- **Deux décisions de produit** restent à prendre (mascot, adresse d'expédition), plus deux décisions d'exploitation (voir « Ce qui attend ta décision »).

## Ce qui a été livré

| Livrable | Où |
|---|---|
| Suite de tests | `tests/automations-suite/` (unitaires, intégration, interface) |
| Commande unique | `npm run test:automations` — options `--prod`, `--canari`, `--integration`, `--ui`, ou des fichiers précis |
| Rapport de chaque passe | `rapports/automatisations/RAPPORT.md` (lisible) et `synthese.json` (pour QA Smoke) |
| Inventaire tiré du code | `AUTOMATIONS_INVENTORY.md` |
| Matrice | `AUTOMATIONS_TEST_MATRIX.md` — le statut de chaque cas est recalculé à chaque passe |
| Job CI | « Automatisations (npm run test:automations) » dans `.github/workflows/ci.yml` |
| Bac à sable des envois | `server/lib/bac-a-sable.ts`, tables `orgs_envois_simules` et `envois_simules` (staging et prod) |

### Comment la suite reste sans danger

1. **Bac à sable par entreprise.** Une entreprise inscrite dans `orgs_envois_simules` n'envoie rien : chaque texto, courriel et webhook est écrit mot pour mot dans `envois_simules`. Les bureaux de test y sont inscrits avant toute donnée.
2. **Second filet par destinataire.** Un numéro 555-01xx ou une adresse en `lume-qa.test` n'est jamais joint, quelle que soit l'entreprise.
3. **Fournisseurs piégés dans le processus de test.** Le courriel pointe vers un port fermé, Twilio est un faux client qui compte et refuse, et le réseau n'accepte que Supabase et Anthropic.
4. **Canari.** Il tourne seul avant tout le reste. Il prouve d'abord que les pièges détectent un envoi réel, puis que le bureau de test n'en atteint aucun. S'il n'est pas vert, rien d'autre ne tourne.
5. **Une passe à la fois.** La suite prend un verrou en base ; une seconde passe attend son tour.

### Les bureaux de test (conservés pour QA Smoke)

| Base | Bureaux | Comptes |
|---|---|---|
| Prod | « [TEST] QA Automatisations A » et « B — ne pas utiliser » | `qa-auto-proprio-a@lume-qa.test`, `qa-auto-tech-a@…`, `qa-auto-proprio-b@…` |
| Staging | les deux mêmes | les trois mêmes |

Ils ont un forfait Autopilot à 0 $ sans identifiant Stripe, et un numéro texto fictif. On s'y connecte par lien magique généré côté serveur (`sessionDe` dans le harnais), sans mot de passe.

## Matrice : résultat par catégorie

Dernière passe complète, contre la production. Le détail cas par cas est dans `rapports/automatisations/RAPPORT.md` après chaque passe.

| Catégorie | Sujet | PASS | NON COUVERT |
|---|---|---|---|
| A | Unitaires : conditions, rendu des variables, horaires, validation | 265 | 3 |
| B | Intégration : déclencheurs × conditions × actions, parcours, webhooks entrants | 151 | 4 |
| C | Cas négatifs | 30 | 0 |
| D | Idempotence, concurrence, boucles | 18 | 1 |
| E | Échecs et reprise | 23 | 1 |
| F | Sécurité, multi-bureaux, RLS, RBAC, injection | 54 | 1 |
| G | Conformité LCAP / Loi 25 | 17 | 0 |
| H | Langue et contenu | 13 | 1 |
| I | Lumi | 39 | 0 |
| J | Interface (Playwright) | 33 | 1 |
| K | Préréglages et systèmes adjacents | 37 | 1 |
| L | Observabilité | 10 | 0 |
| M | Charge | 6 | 0 |
| **Total** | | **696** | **13** |

Ces chiffres viennent de la passe complète du 1er octobre à 18 h 22 UTC (688 PASS, 5 FAIL, 14 NON COUVERT), plus la reprise ciblée des 5 cas en échec contre la prod après correction des attentes de test : B-407, B-408, J-065, K-014 et I-021 sont repassés verts. Trois cas se sont ajoutés avec les derniers correctifs (K-004, I-036, et D-044 qui n'était pas couvert), joués verts contre la prod. Il n'y a pas eu de seconde passe complète contre la prod après ces corrections ; la passe complète suivante est celle du job CI de la PR de finition.

### Performance mesurée (rafale de 1 000 événements, staging)

| | Avant | Après |
|---|---|---|
| Durée totale | 264 s | 22 s |
| Latence médiane | 139 s | 2,8 s |
| Latence au 95e centile | 232 s | 5,2 s |
| Requêtes par événement | 18,9 | 9,1 |
| Événements perdus | 0 | 0 |
| File planifiée | 600 tâches/h pour toute la plateforme | environ 12 000 tâches/h |

En prod, la rafale est réduite à 200 événements : la même rafale de 1 000 a rendu l'API de staging indisponible par moments.

## Défauts trouvés et corrigés

79 commits, tous sur `main`. Le titre de chaque commit dit ce qui était faux ; son message donne la cause, le correctif et le test qui le prouve (`git show <commit>`).

Les plus graves :

- **Fuites entre bureaux.** Les routes d'événements faisaient tourner les règles d'un bureau sur les clients d'un autre, et les variables d'un deal se lisaient sans filtre de bureau.
- **Textos automatiques tous sautés sans numéro partagé de plateforme.** Trouvé en faisant tourner la suite contre la prod. Invisible aujourd'hui, parce qu'aucune entreprise n'a encore de numéro ; bloquant le jour où les numéros arrivent.
- **Texto envoyé à un client supprimé** par une tâche différée.
- **Boucle sans fin** entre deux règles de pipeline qui se renvoient un deal.
- **Conditions qui laissaient tout passer** : « montant ≥ 1500$ », `in` sans liste, condition de texte vide, date illisible.
- **File planifiée** : 600 tâches par heure pour toute la plateforme, et une entreprise en pause bloquait la file de toutes les autres.
- **Jobs récurrents** : les visites n'étaient jamais créées.
- **Chaque paiement déclenchait « Paiement reçu » ET « Dépôt reçu »** (8 entreprises sur 9 en prod, corrigé par migration).
- **Conformité** : un courriel commercial immédiat partait sans lien de désabonnement, sans vérification du consentement ni plafond.
- **Confirmation perdue** quand le fournisseur était en panne au moment d'un envoi immédiat : elle est maintenant reprise.
- **Automatisations qui ne pouvaient jamais partir** : le préréglage « Estimate Follow-Up », affiché « publié » chez 9 entreprises, et les règles que Lumi créait sur un déclencheur pas encore activé pour l'entreprise (« paiement échoué », « client inactif »).
- **Rafale de textos sans avertissement** : le propriétaire est maintenant prévenu dès qu'une rafale est étalée.

### Sécurité et conformité (5)

| Commit | Ce qui était faux |
|---|---|
| `33148639` | Un courriel commercial immédiat partait sans lien de désabonnement |
| `2630bdaa` | Les variables d'un deal se lisaient sans filtre de bureau |
| `e40342ee` | Les routes d'événements faisaient tourner les règles d'un bureau sur les objets d'un autre |
| `2dd84dbd` | Un champ personnalisé nommé « … HTML » s'injectait brut dans le courriel |
| `a33b49b3` | Un envoi commercial IMMÉDIAT partait sans vérifier le consentement ni le plafond (drapeau par canal éteint) |

### Moteur, file et reprises (20)

| Commit | Ce qui était faux |
|---|---|
| `5821047c` | Le refus d'un parcours invalide reste lisible par le garde statique |
| `7c6fe118` | Un parcours refusé par la validation ne laissait aucune trace du motif |
| `fbfdd1f5` | La file planifiée plafonnait à 600 tâches/h et une entreprise en pause bloquait toutes les autres |
| `9e33d5a8` | Une règle sans message ne relit plus les variables de l'événement |
| `d0f91513` | « Demander un avis » après un déclencheur client n'était rattaché à aucun client |
| `2d3f754c` | L'image Docker n'aurait pas contenu src/lib/smsSegments.ts |
| `6b57c363` | La notification d'échec définitif finissait par un double point (« …number.. ») |
| `934b11be` | Une panne DNS passagère rendait un webhook définitivement « refusé » |
| `8cc8538b` | Des erreurs définitives étaient reprises 4 fois (et une demande d'avis refaite à chaque fois) |
| `457c80b8` | Deux règles de pipeline qui se renvoient un deal (S1→S2, S2→S1) tournaient sans fin |
| `13f1825d` | Une tâche différée agissait encore sur un client mis à la corbeille ou supprimé |
| `544d1164` | Le rappel « 7 jours avant » d'un parcours glissait d'une heure au changement d'heure |
| `4de0343d` | Près de minuit le jour du changement d'heure, « dans N jours » visait la veille |
| `d23cbe67` | Une fenêtre d'envoi impossible bloquait le message pour toujours, sans trace |
| `6c4b6afe` | La chaîne anti-boucle d'un deal pouvait être lue avant d'être écrite |
| `4031dbb9` | Sans numéro partagé de plateforme, TOUS les textos automatiques étaient sautés |
| `af66b863` | La garde « fenêtre d'envoi sur les deux canaux » de la file reste lisible par son test statique |
| `70d4757d` | Une confirmation immédiate en panne passagère était perdue, sans reprise ni signalement |
| `8dc9b89c` | Une action posée sur la mauvaise fiche était reprise 4 fois avant d'être signalée |
| `35ddc190` | Une rafale de textos partait sans que le propriétaire en soit averti |

### Conditions et déclencheurs (13)

| Commit | Ce qui était faux |
|---|---|
| `7e3e8d77` | « Date atteinte » jugeait « aujourd'hui » à Toronto pour toutes les entreprises |
| `107dba04` | « Sans mouvement » : une règle à 7 jours partait sur l'alerte d'une règle à 3 jours |
| `63c6219f` | « Client inactif » : une règle au plafond horaire différent ne partait jamais |
| `e59b564d` | Une date illisible en base satisfaisait « après le… » et « il y a moins de… » |
| `5ce09bf4` | Une condition de champ texte laissée vide faisait partir la règle pour tous |
| `683b5ead` | « montant = 1250.50 » ne reconnaissait pas le montant 1250.5 |
| `4483b36e` | « in » / « not_in » sans liste laissait passer la règle |
| `1ba8c0de` | Une borne « montant ≥ 1500$ » laissait passer tous les montants |
| `87aa01b1` | Le cron des rappels de paiement relançait une facture qu'une règle « Facture en retard » conditionnée relance déjà |
| `b40123e8` | Une règle écartée par ses conditions ne laissait aucune trace |
| `3bf534a0` | « Date atteinte » avec « 3.5 » ou « 400 » jours avant ne partait jamais |
| `68374a2b` | Le « si » d'un rendez-vous ou d'une opportunité était jugé sur l'état d'origine |
| `d8d6b99f` | Une étape « si » sur une étiquette du client était toujours vraie |

### Contenu des messages (13)

| Commit | Ce qui était faux |
|---|---|
| `26ca3163` | Le compteur de l'éditeur de texto ignorait le coût des accents |
| `dafaca17` | L'heure du rendez-vous était au format français dans une entreprise anglaise |
| `7d601691` | La demande d'avis partait en français par texto dans une entreprise anglaise |
| `cd7e56d9` | Un refus d'enregistrement disait « Invalid input: expected string, received null » |
| `361af94e` | L'aperçu du courriel dans la boîte de réception affichait « &amp;quot; » |
| `6d79503f` | « Bonjour {{client_first_name}} » partait « Bonjour {Marie} » |
| `2806dd44` | « Rabais [50] % » partait « Rabais  % » dans les messages automatiques |
| `16fda221` | [constructor] ou {toString} dans un message envoyait « function Object() { [native code] } » |
| `b856fef6` | « envoie-la d'abord au client » était écrit deux fois dans le refus de payer un brouillon |
| `efab3030` | La forme technique des dates ne doit pas devenir une variable de gabarit (`*_iso`) |
| `6a954815` | Un paiement en ligne n'annonçait pas `payment_type` — une règle « full » ne partait jamais pour Stripe ou PayPal |
| `5a5f47e9` | « Bonjour Bonjour, » dans la demande d'avis, et son texte résolu deux fois |
| `580e985b` | Les dates partaient en ISO brut dans les messages au client (« due le 2026-10-15 ») |

### Préréglages et systèmes adjacents (12)

| Commit | Ce qui était faux |
|---|---|
| `6bce8eae` | Chaque paiement déclenchait « Paiement reçu » ET « Dépôt reçu » |
| `ae437d3d` | Un rapport planifié échappait au journal des envois et au bac à sable de l'entreprise |
| `b218b603` | « exécuter maintenant » générait une facture depuis une récurrence arrêtée |
| `518c8420` | Une série de jobs récurrents sans fuseau prenait celui de Toronto, pas celui de l'entreprise |
| `ace5a74e` | Les visites des jobs récurrents n'étaient jamais créées (ni calendrier, ni confirmation, ni rappels) |
| `9b48f18d` | Une facture très en retard recevait 4 relances le même soir |
| `9346da61` | Relances de factures — passage par entreprise, et réponse HTTP envoyée deux fois |
| `b9cb7f92` | « crée un parcours de relance de facture » partait au sous-agent Facturation, sans l'outil de création |
| `35b8db5c` | La relance d'abonnement impayé partait chaque jour de J+3 à J+6 (4 courriels) au lieu d'une fois |
| `55ef5f0f` | Une récurrence de job plaçait ses visites vers 1 h du matin (ou à l'heure où on l'avait créée) |
| `b7d8daa5` | Le parcours « Dépôt — demande et rappel » s'annulait lui-même, drapeau de sortie éteint |
| `098dd153` | « Estimate Follow-Up » s'affichait publié alors qu'il ne peut jamais partir |

### Lumi (10)

| Commit | Ce qui était faux |
|---|---|
| `c402ad57` | « How do I set up taxes? » ne perdait plus sa réponse d'aide |
| `9f570f86` | Lumi ne savait pas filtrer sur un montant ou une étiquette, ni attendre la réponse du client |
| `dd1fedc0` | Get_automation_health comptait les envois sautés comme « partis » |
| `5ab3ef5a` | Lumi disait « je n'ai pas d'outil » pour « crée un parcours… » |
| `b4e2fd59` | « Crée un rappel automatique… » recevait l'article d'aide SMS au lieu d'une automatisation |
| `34cd678a` | List_automations montrait à Lumi les règles à la corbeille |
| `c4960f0f` | Une automatisation créée par Lumi écrivait toujours ses messages en français |
| `8630d9ef` | Lumi enregistrait un déclencheur inventé et oubliait la 2e automatisation |
| `8f2ce578` | Redemander à Lumi une automatisation qu'on vient de supprimer répondait « c'est fait » sans rien créer |
| `d03ea20d` | Lumi et l'API créaient une automatisation sur un déclencheur pas encore offert à l'entreprise |

### Interface (6)

| Commit | Ce qui était faux |
|---|---|
| `ca84ca01` | « Publier » laissait passer un renvoi « si dépassé » vers une étape supprimée |
| `33a8faf2` | La carte de l'app du support connaît l'état « impossible de charger » de la liste |
| `4f620843` | Modifier un texto depuis Réglages › Messagerie/Avis ne changeait pas ce qui part |
| `ae5c8164` | Les boutons « + » entre deux étapes étaient cachés aux lecteurs d'écran |
| `a45b84f9` | Un échec de chargement de la liste affichait « Aucune automatisation » |
| `d230a528` | Le PATCH d'une règle pouvait publier une automatisation à la corbeille |

## Ce qui n'a pas été testé, et pourquoi

| Cas | Pourquoi |
|---|---|
| A-173, A-384 | Ces fonctions lisent la base : elles sont couvertes en intégration (catégories B et C), pas en unitaire. |
| A-377 | Aucun déclencheur du catalogue n'est marqué « bientôt » : rien à tester. |
| B-090 | Événements émis par le serveur mais absents du catalogue (`estimate.sent`, `lead.converted`, `job.created`…). On ne peut pas créer de règle dessus dans l'éditeur. |
| B-091 | Réponse du client par courriel : exige une vraie boîte Gmail connectée, hors bac à sable. |
| B-092 | Pont navigateur « rendez-vous déplacé » : couvert indirectement par les tests de sécurité des routes. |
| B-590 | Le produit cartésien complet (28 déclencheurs × 24 actions × conditions) ferait environ 1 400 cas. La matrice couvre chaque déclencheur avec une condition vraie et une fausse, chaque action avec un déclencheur représentatif, et les combinaisons à risque. |
| D-043 | Deux consommateurs simultanés de la file de pipeline : impossible à reproduire sans contourner le verrou du serveur. |
| E-044 | Vrai dépassement de 5 s chez le fournisseur : le bac à sable échoue tout de suite ; ce cas est couvert par un test unitaire existant. |
| F-090 | Route de l'ancien pipeline porte-à-porte : aucune donnée d'un autre bureau n'en sort, mais l'identifiant du deal n'y est pas vérifié. À traiter avec le retrait de cet ancien pipeline. |
| H-021 | Compteur de SMS dans l'éditeur plein écran : livré par une autre PR (#840), avec ses propres tests. |
| J-064 | Opérateurs `in` / `not_in` absents de l'éditeur : choix d'interface, pas un défaut. |
| K-022 | Idempotence des relances de factures : la ligne de matrice existe, le test dédié reste à écrire (la non-répétition est couverte par K-061 et K-027). |
| Interface | « Construire avec Lumi » à l'écran, copie vers d'autres bureaux, dossiers, actions en lot, onglets Historique et Journaux : repris par l'audit d'interface en cours dans une autre session. |
| Autres navigateurs, rôles à l'écran | Idem. |

## Ce qui attend ta décision

Deux choix de produit. Chacun est documenté par un test marqué « ROUGE ATTENDU — décision requise », qui deviendra un test normal une fois le choix fait.

1. **Le mascot Lume en bas des courriels (G-022).** Ta mission le demande. Il a été retiré le 29 septembre, et la norme du 30 dit « marque blanche côté client ». Les deux se contredisent.
2. **L'adresse d'expédition en `@lumecrm.net` (G-023).** C'est l'adresse utilisée tant qu'une entreprise n'a pas vérifié son propre domaine, et les liens publics sont sur le domaine de Lume. C'est une contrainte d'authentification des courriels ; la retirer suppose que chaque entreprise vérifie son domaine.

Deux choix d'exploitation.

3. **Bloquer le déploiement quand un test échoue.** Le job CI existe, mais `main` n'exige aucun check : une PR rouge peut être fusionnée, et Railway déploie à chaque poussée. Pour bloquer vraiment, il faut rendre les checks obligatoires sur `main` et activer « Wait for CI » sur Railway. Je ne l'ai pas fait seul : cela change la façon de travailler de toutes les sessions.
4. **Cible du job CI : staging ou prod.** Il vise staging. Tu as dit « en prod, jamais en staging » ; je les y ai fait tourner à la main (`npm run test:automations -- --prod`). Pour que la CI vise la prod, il faudrait mettre la clé de service de prod dans les secrets GitHub, ce que `CLAUDE.md` interdit par défaut (règle 7). Sur staging, le job est fragile quand plusieurs sessions chargent la base en même temps : elle est tombée une fois le 1er octobre.

## Risques restants avant le 26 octobre

- **Aucun numéro texto actif en prod.** L'achat de numéros attend l'approbation du dossier Trust Hub chez Twilio. Tant que ce n'est pas fait, aucun texto automatique ne part, pour personne. Le code est prêt ; à vérifier par un vrai envoi dès le premier numéro obtenu.
- **Sauvegardes.** Celles de la prod étaient en panne du 26 au 30 septembre (mot de passe Postgres périmé) ; une autre session les a réparées le 30 au soir, et le dernier dump date du 1er octobre (`../lume-backups/prod-20261001-1438.dump`, 9,5 Mo). Au début de la mission, faute de mot de passe, le filet a été un export complet par l'API (prod : 265 tables, 59 649 lignes, vérifié sans écart). Le mot de passe staging de `.env.local` est toujours refusé : `npm run db:diff` ne tourne pas.
- **Tests unitaires sensibles à la charge du poste.** Quand plusieurs sessions saturent la machine, 2 à 6 tests unitaires à vraies minuteries échouent, jamais les mêmes (`tests/automation/launch-*`, `vague2-*`, `desabonnement-canal`). Rejoués seuls, ils passent tous (61 sur 61). Sur la CI, qui a sa propre machine, ils sont verts. Je n'ai ajouté ni réessai automatique ni délai plus long : cela masquerait un vrai test instable.
- **Staging est une petite instance partagée.** Elle a saturé puis est tombée sous la charge de plusieurs sessions. Le job CI en dépend.
- **Le verrou des passages planifiés est un bail de 10 minutes.** Un passage plus long peut se chevaucher avec le suivant. La file passe désormais jusqu'à 1 000 tâches en 3 minutes au plus, ce qui reste dans le bail, mais les autres passages (rappels sur date, relances) n'ont pas tous de verrou propre. Les rappels sur date restent protégés par la clé d'exécution du moteur : rejoués trois fois le même jour, ils n'agissent qu'une fois (D-044).
- **Les drapeaux `auto_*` sont encore éteints** pour les vraies entreprises (désabonnement par canal, sortie de parcours, paiement échoué, client inactif). La suite les éprouve allumés et éteints ; les allumer reste une décision. Tant qu'ils sont éteints, l'éditeur cache ces déclencheurs, et Lumi comme l'API refusent d'y bâtir une automatisation.
- **Pas de plafond d'envois par automatisation** (ta décision du 23 septembre, maintenue). Une étiquette posée sur 5 000 clients envoie toujours 5 000 textos, à 30 par minute ; la différence est que le propriétaire reçoit une notification dès le début, avec « Tout arrêter ».
- **13 lignes « Estimate Follow-Up » restent en base en prod**, inertes et cachées. Les retirer demande une migration sur les données des entreprises ; je ne l'ai pas faite.
- **Ancien système d'automatisations** (`server/lib/scheduler.ts`, table `automations`) : il tourne encore, ignore la pause et l'arrêt global, et aucun écran n'écrit plus dans sa table. À retirer.
- **« Arrêt quand le client répond » par courriel** n'est pas prouvé : il faut une vraie boîte Gmail connectée. Par texto, c'est prouvé.
- **Les tests qui parlent à Lumi coûtent** environ 0,30 $ par passe et dépendent du modèle : une formulation différente de Lumi peut faire rougir un test sans défaut réel. C'est arrivé une fois (I-021).

## Ménage

- **Conservé** : les deux bureaux « [TEST] QA Automatisations A / B » en prod et sur staging, pour QA Smoke.
- **Retiré** : les 16 bureaux de test créés par mes agents sur staging (règles désactivées, tâches annulées, bureaux marqués supprimés, toujours au bac à sable).
- **Non touché** : les bureaux de test d'une autre session (audit d'interface) sur staging, qui portent le même préfixe.
- **Aucune donnée de test ailleurs** : rien n'a été créé dans une vraie entreprise. En prod, la seule écriture hors des bureaux de test est la migration des conditions de deux préréglages (« Paiement reçu » et « Dépôt reçu »).
- **Worktrees et branches** : les worktrees des agents sont supprimés ; les branches `qa/auto-*` et `qa/fin-*` restent en local, leur contenu est sur `main`.
