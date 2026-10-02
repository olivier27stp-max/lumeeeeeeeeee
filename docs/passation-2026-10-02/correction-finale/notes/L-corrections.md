# Agent L — corrections de Lumi sur les automatisations

Branche `mission/auto-finale-a`, worktree `D:/lume-final/wt-a`, **32 commits** depuis le merge `9c5f2378` (origin/main fusionné localement, pour partir des dernières versions de `orchestrateur.ts` et `routes/lumi.ts`). Arbre propre, HEAD `90398a2a`. **Rien n'est poussé, aucune PR.** Aucune requête vers la prod ni staging : tout est mesuré sur la pile locale `lumefinal-*`. Mes serveurs (3492 / 5492) sont arrêtés, par PID.

## 1. Scores

| Mesure | Résultat | Où le lire |
|---|---|---|
| **30 demandes** (`demandes-modification.json`), vrai modèle, vérifiées en base | **30/30** | `sorties/l/passe-complete-3.log` |
| **20 scénarios** (`scenarios-conversation.json`), vrai modèle, vérifiés en base | **20/20** | idem — 50/50, 68,47 ¢, 108 appels, sur le code commité |
| `qa:construire-lumi` AVANT | 123/123 contrôles, 14/14 conversations, 23,10 ¢ | `sorties/l/construire-lumi-avant.log` |
| `qa:construire-lumi` APRÈS | **123/123**, 14/14, 27,29 ¢ | `sorties/l/construire-lumi-apres-2.log` |
| `40-iklm-lumi-*` (intégration, vrai modèle) | **39/39** | `sorties/l/iklm-3.log` |
| `a-outils-lumi-relire` (tests rouges de A) | **9/9** (étaient 9 rouges) | `sorties/l/a-integration-2.log` |
| `a-moteur-deux-copies` | 4/5 — reste A-21, côté moteur (pas à moi) | idem |
| `a-ecrasement-silencieux` | 0/1 — écriture périmée de l'éditeur (pas à moi) | idem |
| Balayage `relire-apres-ecriture` | automatisations : **27/27 cas ok** ; « en défaut » 5 → 1 | `sorties/l/relire-apres-ecriture.md` |
| `tests/lumi-*`, `tests/agent*`, `tests/automations-finale/f` | 123 fichiers : 1 761 tests verts, 1 délai de 10 s dépassé sous charge (`lumi-fiches`), vert relancé seul | `sorties/l/unitaires-11.log` |
| `npx tsc --noEmit`, `npm run lint` | propres | — |

Précisions honnêtes :

- **Les 50/50 sont la 3e passe complète.** La 1re (43/50) a buté sur la limite de tours par heure du compte de test (cinq cas en 429) et sur deux vrais défauts (C03 T5, C12), corrigés. La 2e (46/50) a buté sur le garde-fou journalier du bureau de test (15 % du budget mensuel brûlés dans la journée par mes passes → palier « restreint », 2 étapes par tour) : D17, D30 et C12 T2 ont échoué dans ce mode dégradé, C09 T2 sur une faute du correcteur. Pour la 3e, mon serveur LOCAL tourne avec `LUMI_TOURS_PAR_HEURE=0` et `LUMI_PART_BUDGET_PAR_JOUR=1` (réglages prévus pour les batteries, jamais en prod).
- **Ce que la 2e passe apprend quand même** : au palier « restreint » (2 étapes), une réécriture « plus court » refusée une fois par le serveur n'a plus d'étape pour être reproposée — Lumi répond alors sans carte. C'est la dégradation voulue du palier, pas un recul, mais c'est visible pour l'utilisateur.
- **Le balayage** signale encore `approve_timesheet` : il répond « 0 entrée approuvée — aucune entrée de temps pour cette personne ». La réponse est honnête ; le balayage ne reconnaît pas la tournure. Ce n'est pas un outil d'automatisation.
- **`qa:construire-lumi`** a varié de 122 à 123 selon les passes ; la passe à 122 ratait « le client est vouvoyé » sur « vous l'êtes » — faux positif du correcteur (§ 4). Son coût varie beaucoup d'une passe à l'autre (16,96 ¢ à 27,29 ¢, même code).
- **F-05 (effort bas) : non retenu, sur mesure.** Même code, même prompt : effort « low » 118/123 (21,24 ¢), effort « high » 122/123 (25,57 ¢). 17 % d'économie pour quatre fautes de plus. Le niveau reste « high ».
- **Non rejoué : `npm run qa:lumi`** (80 demandes, ≈ 2,30 $). La consigne partagée a trois lignes de plus et deux outils sont ajoutés : à relancer avant la mise en prod.

## 2. Coût dépensé

**≈ 6,80 $** sur un budget d'environ 15 $ :
- 5,63 $ au grand livre (`ai_usage`) du bureau de test local — lanceur de A (10 passes partielles + 3 complètes), `40-iklm` (3 passes), balayage, tests de A et de F. Ce bureau est aussi celui de l'agent A : quelques lignes peuvent être les siennes ;
- 1,17 $ pour `qa:construire-lumi` (5 passes complètes + 2 cas isolés), hors grand livre.

## 3. Tableau : constat → commit → preuve → vérifié en base

« En base » = le lanceur de A relit `automation_rules`, `company_settings` et `agent_actions` après chaque tour, vrai modèle, pile locale.

| Constat | Ce qui était faux pour l'utilisateur | Commit | Test ou cas | En base |
|---|---|---|---|---|
| A-11, A-10 (socle) | Lumi jugeait « n'écrit pas aux clients » une automatisation à parcours (`actions` vide) | `6a6f0c6d` | `lumi-automations-etapes` (19) ; `a-moteur-deux-copies` A-11 | oui |
| A-03 | « C'est fait » sans rien écrire quand on redemande la même modification | `0d040843` | `lumi-nature-ecritures` (12) ; `a-outils-lumi-relire` ; balayage | oui |
| A-17, A-09 | Liste et journal en clés techniques, journal sans nom d'automatisation | `e52eb6e8` | C04 T1, C14 | oui |
| Demande du coordinateur | Chaque outil écrivait `automation_rules` à sa façon | `9110bb81`, `94d55ef7` | `lumi-ecrire-regle` (21) | oui |
| A-05, A-08, F-16 | « C'est activé » sans relire ; reçu « C'est fait : l'action. » | `06914286` | C02, C04, C11, D19, D20 ; I-024, I-025 | oui |
| A-05, A-11 | Création : `actions` vide, Lumi cite son intention | `c235d090` | `lumi-cree-automatisation`, `lumi-glossaire` ; I-001 à I-020 | oui |
| A-05, A-06, A-07, A-08, A-18 | Réécriture de la mauvaise copie, brouillon cité, variable inventée, « plus court » plus long | `65137a65` | `lumi-outils-reglages` ; D15-D17, D25, D28, D30 ; I-026, I-027 | oui |
| A-05 | Langue annoncée sans relecture | `3d23048a` | C16 ; I-028 | oui |
| A-04, A-16, F-01, F-03, F-06, F-07, F-08, F-10 | Panneau : renomme tout seul, coupe les longs parcours, « j'ai modifié » sans effet, aucune trace, plafond ignoré | `87808122` | qa:construire-lumi ; D01-D14 ; tests F | oui |
| A-10, F-15 | « Qu'est-ce qu'elle fait ? » : Lumi ne pouvait pas la lire | `451ffd27` | C02 T5, C15, C19 | oui (texte cité = texte en base) |
| A-14, F-14 | « Ajoute un délai », « change le déclencheur » : doublon ou « refais la règle » | `a620e248` | D21-D24 ; C02 T3 | oui |
| A-12, A-14, A-17 (panneau) | « active-la », « oui » impossibles dans le panneau ; rien au journal | `deae8188`, `bedd149a`, `1f7bd014` | `lumi-panneau-automatisation` (18) ; C01, C10, C13, C14, C20 | oui |
| A-13, A-06, A-18 | Carte d'activation muette ; carte fausse découverte après le clic | `242fbfa6` | `lumi-avant-carte` (16) ; C02, C04, C11, D17 | oui |
| A-15, F-02, F-12, F-13 | Lumi ne savait pas de quelle automatisation on parlait | `8e1c46af`, `0124d496`, `faf83429` | `lumi-contexte-automatisation` (28) ; C02, C04-C09, C15, C17, C19 | oui |
| C18 | « Arrête toutes mes automatisations » : réponse coupée, rien d'arrêté | `77ea794b` | C18 | oui (`automations_paused`) |
| C12 | « Active-la » sur un texte d'exemple : « tu veux l'activer tel quel ? », puis réécriture non demandée | `063310c1`, `ea486ce9`, `1f7bd014` | C12 | oui (rien d'activé ni d'écrit au tour 1) |
| C03 T5 | Panneau : explication paraphrasée, texto non cité | `37b384c1` | C03 ; qa:construire-lumi 123/123 | oui |
| I-008, I-017, I-020 | Recul de MON repérage : « c'est déjà en place », ou modification d'un préréglage au lieu de créer | `2e25f750` | `lumi-contexte-automatisation` ; `40-iklm` | oui |
| I-002 | Création depuis un modèle : un courriel non demandé, non dit | `410a5222` | `lumi-recu-creation-modele` (5) ; I-002 | oui |
| I-002, I-003, I-007, I-019 | Attente élargie aux deux outils de création, sans rien céder | `cd321b16` | `40-iklm-lumi-*` 39/39 | oui |
| Règle ferme | « C'est fait » sans résultat d'outil ; « introuvable » sans chercher ; « tu veux que j'écrive quoi ? » | `d9b307dd` | `lumi-items8-14` (v2026-10-02.1, empreinte bf8d92d1ef51) | — |
| Mesure | Lanceur de A, attentes ajustées, correcteur | `7b1453b4`, `90398a2a` | § 6 | — |
| Couverture | Scénario d'exécution de `update_automation_from_text` | `e265ae24` | `lumi-execution-couverture` | — |
| **À reporter** | `server/routes/automation-rules.ts` | `7dfd6c0c` | 9 points (§ 4) | — |
| **À reporter** | `src/pages/AutomationBuilderPage.tsx` | `3f820305` | une ligne (§ 4) | — |

Deux précisions sur les messages de commit : dans `87808122`, le plafond journalier est **F-06** (le message l'appelle « F-08 / F-10 ») ; et les commits sur `tools-reglages.ts` (`06914286`, `c235d090`, `65137a65`, `3d23048a`) sont un découpage PAR OUTIL d'un même travail — les aides communes sont dans le premier, ils n'ont pas été compilés un par un (`451ffd27` et la fin de la série, oui).

## 4. Changements à reporter hors de ma zone

### `server/routes/automation-rules.ts` — commit `7dfd6c0c` (26 lignes ajoutées, 3 remplacées, rien d'autre dans le commit)

Toute la logique vit dans `server/lib/lumi/panneau-automatisation.ts` et `server/lib/automations-etapes.ts` ; la route ne garde que les appels.

1. Imports : `demandeTropCourte, ouvrirPanneau, reponseSansChangement, journaliserProposition` (`../lib/lumi/panneau-automatisation`) ; `refletDesActions` (`../lib/automations-etapes`).
2. `POST /automations/rules/generer` : `if (demande.length < 10)` → `if (demandeTropCourte(demande, req.body.echanges))` (A-12).
3. Avant `genererParcours` : `const panneau = await ouvrirPanneau(auth.client, auth.orgId, ruleIdEnvoye);`.
4. Paramètres de `genererParcours` : `parcoursActuel: { ...corps.parcours_actuel, nom: panneau.nom, avant: panneau.etapesDAvant }`, `canal: 'panneau'`, `ruleId: panneau.id`.
5. Après le refus « rien construit », avant `sequenceEtapes.safeParse` : `const sansChangement = await reponseSansChangement({ panneau, parcours: resultat.parcours, parcoursALEcran: corps?.parcours_actuel, demande, langue, client: auth.client, admin: getServiceClient(), orgId: auth.orgId, userId: auth.user.id }); if (sansChangement) return res.json(sansChangement);`.
6. Dans l'entrée « assistant » du fil gardé : `...(resultat.parcours.remplacees?.length ? { avant: resultat.parcours.remplacees } : {})`.
7. Avant la réponse : `journaliserProposition(getServiceClient(), { orgId: auth.orgId, userId: auth.user.id, panneau, parcours: resultat.parcours });`.
8. Réponse : `modifie` et `renomme` ajoutés **avant** `autre` (un test lit `autre,\n  });`).
9. `PATCH /automations/rules/:id` : `.update({ ...patch, ...refletDesActions(patch, existante.steps), updated_at })` (A-02). Inutile le jour où le PATCH passe par `ecrireRegle(…, origine: 'editeur')`, qui le fait déjà.

### `src/pages/AutomationBuilderPage.tsx` — commit `3f820305` (une ligne, rien d'autre dans le commit)

`if (demande.length < 10 || genere) return;` → `if (demande.length < (echangesLumi.length > 0 ? 1 : 10) || genere) return;`

### Éditeur — décrit, NON fait (fichier d'un autre agent)

- **Ne rien enregistrer quand la réponse dit `modifie: false`** : la page réenregistre le parcours rendu même inchangé (une écriture pour rien, un « Enregistré » trompeur).
- **Refléter `publiee`** : après « active-la » puis « oui » (ou « mets-la en pause »), la réponse porte `publiee: true|false` ; l'état « Publiée / Brouillon » de la page doit suivre sans rechargement.
- **Lien vers le clavardage** : le bouton « Demander à Lumi » de l'éditeur doit pointer vers `lienLumiSurAutomatisation(id, { nom, nonEnregistre })` (`src/lib/lumiContextePage.ts`). Côté Lumi tout est en place (`contexte_page`, pastille « À propos de l'automatisation… », retirable).
- **`a-ecrasement-silencieux` (rouge)** : une écriture périmée de l'éditeur écrase le texto que Lumi vient d'écrire. À traiter côté PATCH / éditeur.
- **A-01** (le panneau d'étape déjà ouvert garde l'ancien texte) : constat de l'éditeur, pas touché.

### Moteur — NON fait

- **A-21** (`a-moteur-deux-copies`, rouge) : un corps de courriel en texte brut part sans ses sauts de ligne. Mes outils enregistrent maintenant le courriel au format de l'éditeur (titres, paragraphes) — le cas par Lumi est couvert ; le rendu d'un texte brut déjà en base est au moteur.

### Fichiers partagés — signalés, pas modifiés au-delà de ce qui m'était demandé

- `scripts/qa/executer-outils-staging.mts` : le scénario existant de `update_automation_message` écrit `{{client_name}}` ; l'outil refuse maintenant une variable qui n'existe pas (A-06). À remplacer par `[client_first_name]`. Je n'y ai fait qu'AJOUTER ma ligne (`e265ae24`).
- `scripts/qa/evaluer-construire-lumi.mts` : faux positif du contrôle de vouvoiement — `/\b(tu|ton|ta|tes|toi)\b/` lit « tes » dans « vous l'êtes » (`\b` ne voit pas la lettre accentuée).
- `tests/automations-suite/harnais/lumi-api.ts` (modifié, `cd321b16`) : le harnais ne montait que le routeur de Lumi ; les outils qui passent par une route de l'app (modèle, copie, renommage, suppression, arrêt général) n'aboutissaient nulle part. Il monte aussi le routeur des automatisations et pose `PORT` sur son port.

## 5. Autres lecteurs de `actions` à faire basculer sur `etapesDeLaRegle` / `messagesDeLaRegle`

Faits (ma zone) : `server/lib/lumi/execution.ts` (`ecrituresSensiblesPour`), `server/lib/lumi/deja-publiees.ts`, tous les outils de `tools-reglages.ts`.

Restent, hors de ma zone (carte de A, § 4) :

| Lecteur | Fichier | Ce qu'il lit aujourd'hui |
|---|---|---|
| Réglages › Messagerie | `src/pages/SettingsMessaging.tsx` (filtre l. 474) | **filtre sur `actions`** |
| Réglages › Avis | `src/pages/SettingsReviews.tsx` (l. 310, 698) | idem |
| Liste | `src/pages/Automations.tsx` (l. 768, 860, 2188-2260) | les deux |
| Éditeur, contrôles de publication | `AutomationBuilderPage.tsx`, `src/lib/publicationAutomatisation.ts`, `src/lib/sequenceTypes.ts` | les deux |
| Client d'API | `src/lib/automationRulesApi.ts` (`updateRuleMessage`) | écrit `actions` directement (PATCH) |
| Carte de Lumi | `server/lib/lumi/complements-cartes.ts` | `steps` d'abord (correct ; pourrait appeler `messagesDeLaRegle`) |
| Optimisation de journée | `server/lib/trajets/propositionJournee.ts` (l. 239-241) | les deux |
| Moteur | `server/lib/automationEngine.ts`, `server/lib/actions/index.ts` | `steps` d'abord |
| Aperçu | `server/routes/automation-test.ts` | `steps` d'abord |
| Copie / duplication / modèles | routes de `automation-rules.ts`, `tools-lot-entreprise.ts` | recopient les deux colonnes telles quelles |

Depuis `ecrireRegle` et le reflet du PATCH, `actions` redit le parcours à chaque écriture. Mais les règles DÉJÀ en base (36 parcours en prod avec « À compléter », selon A) ne se corrigent qu'à leur prochaine modification : une migration de rattrapage (`actions` re-dérivé de `steps`) fermerait l'écart d'un coup — `supabase/**` n'est pas à moi, je ne l'ai pas écrite.

## 6. Attentes de cas ajustées (et pourquoi)

- **C01 T4, C02 T4, C03 T4** (« seulement pour les clients commerciaux ») : le ciblage par type de client n'est pas bâti (consigne de la mission). Attente : aucune écriture + UNE question ou un « pas encore possible » honnête. Réponse obtenue : « Je ne peux pas encore cibler par type de client. As-tu une étiquette « Commercial » sur ces clients ? Si oui, je filtre dessus. »
- **C05 T1** (« renomme… » puis Annuler) : renommer n'affiche pas de carte dans le mode par défaut (geste sans effet sur les clients, défaisable — registre de l'autre session). Rien à annuler : l'attente devient « le nom est celui demandé, le message n'a pas bougé, l'action est au journal ». Le changement d'idée reste éprouvé au tour 2 et, sur une vraie carte, par C06.
- **C09 T2** : le correcteur du lanceur ne reconnaissait pas « Non plus, malheureusement… mais pas déclencher un appel » comme un refus. Trois tournures ajoutées (`90398a2a`).
- **I-002, I-003, I-007, I-019** : l'un ou l'autre outil de création ; déclencheur, ordre et moment des étapes, langue, brouillon vérifiés par les deux chemins ; le canal demandé doit être dans le parcours, et un canal en plus doit avoir été DIT. Les empreintes d'anti-doublon du bureau de test sont vidées avant chaque cas (I-003 et I-019 mènent au même modèle).

Aucun test existant n'est désactivé ni affaibli. Trois fichiers de tests statiques suivent l'écriture là où elle vit maintenant (`ecrireRegle`), avec les mêmes exigences : `lumi-cree-automatisation`, `lumi-glossaire-automatisations`, `lumi-outils-reglages`.

## 7. Écritures directes qui restent

| Écriture | Où | Pourquoi |
|---|---|---|
| `company_settings.default_language` | `set_automation_language` (`tools-reglages.ts`) | ce n'est pas le contenu d'une règle ; relue après écriture |
| `automation_rules.lumi_conversation` | `ouvrirPanneau().garderLeFil` (`panneau-automatisation.ts`) et le bloc existant de la route | le fil de la conversation gardé avec l'automatisation — pas du contenu exécuté. **Si la base se ferme aux écritures d'une session sur `automation_rules`, cette colonne doit rester permise, ou passer par le rôle de service.** |
| PATCH de l'éditeur, `updateRuleMessage` du front | `automation-rules.ts`, `src/lib/automationRulesApi.ts` | hors de ma zone |
| `rename_automation_rule`, `duplicate_automation_rule`, `delete_automation_rule`, `create_automation_from_template`, `pause_all_automations` | `tools-lot-entreprise.ts` (autre session) | passent par les routes (`viaRoute`), pas par `ecrireRegle` ; `garantirBrouillon` y écrit `is_active: false` directement |

Dans mes outils il ne reste **aucun** `insert` / `update` de contenu sur `automation_rules` (un test lit la source). La publication passe par `changerPublication` (`toggle_automation_rule`, panneau) : sur la pile locale, I-024 (« Active l'automatisation X » → publiée, et le moteur la déclenche) et D20 sont verts. Je n'ai pas éprouvé moi-même le refus 42501 d'une écriture directe.

## 8. Ce que je n'ai pas pu faire, et ce qu'il faut savoir

- **F-05 (effort bas)** : non retenu, sur mesure (§ 1).
- **F-09** (à zéro crédit, le routeur est encore payé) et **F-13 généralisé** : pas faits — ils touchent le routage de tout Lumi. F-13 est corrigé pour les conversations sur une automatisation.
- **F-12** : corrigé pour les automatisations (l'automatisation citée, désignée ou dont on parle arrive avec son contenu : C08 est passé de 5,6 ¢ sans écriture à ≈ 1,1 ¢ avec la carte) ; pas généralisé à `reperage.ts`.
- **`server/lib/lumi/recus.ts`** : touché alors qu'il n'est pas dans ma liste (non réclamé par un autre agent) — le reçu des outils d'automatisation en dépend (F-16, C18).
- **Texte au-dessus de la carte d'activation** : écrit par le serveur et inséré dans le tour de l'assistant avant son appel d'outil. L'autre session corrige la CARTE elle-même (`complements-cartes.ts`) : les deux disent la même chose — au coordinateur de garder les deux ou un seul. Cette insertion est à revoir si Lumi passe à un modèle qui exige des blocs de réflexion inchangés.
- **Activer une automatisation ne passe plus par la carte « directe » sans modèle** (`actions-directes.ts` reste intact ; c'est `routes/lumi.ts` qui l'écarte) : + ≈ 0,5 ¢ par activation, pour avoir le récapitulatif et le refus du texte d'exemple. Mettre en pause reste direct (0 ¢).
- **Le repérage par nom** (`contexte-automatisation.ts`) fait une lecture de `automation_rules` par message de clavardage (deux pour une « suite »), avant les étages sans modèle. Quelques millisecondes, aucun appel au modèle.
- Les tests de A sous `tests/automations-finale/a/**` et ceux de F sous `tests/automations-finale/f/**` sont pris par le `vitest.config.ts` par défaut ; ceux d'intégration demandent la pile locale.
- Sous charge du poste, des tests unitaires dépassent leur délai de 10 s (`lumi-fiches`, `lumi-agent`) et repassent seuls.
- Dates : mes commentaires et versions portent « 2026-10-02 » (`VERSION_PROMPT` v2026-10-02.1, `VERSION_PROMPT_PARCOURS` parcours-2026-10-02.2).
