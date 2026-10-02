# Constats de l'agent E — ciblage, doublons, « Insérer un champ », langue / contenu / expéditeur

Mission « correction finale Automatisations », points 6, 7, 8 et 16. Enquête du 2026-10-01, sur la pile LOCALE
(schéma = prod), dans mes bureaux « [TEST] QA Automatisations A / B (e) » en bac à sable. Aucune requête vers la
prod ni staging. Rien n'a été modifié dans le produit : seulement des tests neufs, des scripts neufs et ces notes.

**Comment rejouer les preuves** (dans `D:/lume-final/wt-e`) :

```
# fonctions pures et composants (sans réseau)
npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-unitaires
npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-composants
# vrai moteur, pile locale, mes bureaux
QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration
```

État au 2026-10-01 : **77 tests, 35 rouges (un par défaut ou manque ci-dessous), 42 verts** (témoins de ce qui marche
déjà + 17 preuves de conception). Sortie gardée : `D:/lume-final/sorties/e/suite-e.txt`.
Les numéros des constats sont ceux des tests (`[E-20]` = constat E-20). Les relevés au vrai navigateur (Chromium,
1440 × 900, propriétaire du bureau A semé comme une vraie entreprise par `seedOrgComplete`) sont dans
`D:/lume-final/sorties/e/` : `releve-inserer-champ.json`, `releve-doublon-et-compteurs.json`,
`releve-panneau-declencheur.json` et 30 captures.

Abréviations : `E:` = `server/lib/automationEngine.ts`, `A:` = `server/lib/actions/index.ts`.

---

## Point 6 — Ciblage « Qui est touché »

### E-03 — On ne peut pas dire « VIP OU Commercial » : une automatisation ne porte qu'une étiquette « a » et une étiquette « n'a pas », reliées par ET
- Point de la mission : 6
- Gravité : majeur
- Ce qu'on voit : dans « Réglages du déclencheur », deux listes seulement — « Seulement si le client a l'étiquette » et « Seulement si le client n'a PAS l'étiquette », une étiquette chacune. Impossible de viser deux groupes, ni d'exclure deux étiquettes. Aucune section « Qui est ciblé ».
- Reproduction : ouvrir une automatisation → carte « Quand » (relevé `releve-panneau-declencheur.json`, capture `panneau-declencheur-invoice-overdue.png`). Ou jouer le test.
- Preuve : `tests/automations-finale/e/integration/e-ciblage.test.ts::[E-03] un OU…` — le serveur refuse la structure à l'enregistrement, et le moteur écarte tout le monde (« Conditions non remplies : ciblage »). Témoin vert de ce qui marche : `::[E-01 témoin]` (VIP ET PAS « Ne pas relancer »).
- Cause racine : `server/lib/etiquettes.ts:71-74` lit deux clés scalaires (`client_a_etiquette`, `client_sans_etiquette`) ; `evaluateConditions` (`E:221-316`) relie toutes les clés par ET ; `in` / `not_in` existent mais seulement sur une métadonnée d'événement, jamais sur les étiquettes ; le schéma (`server/lib/validation.ts:1035-1068`) n'accepte qu'un scalaire ou un opérateur par clé (une liste seulement sous `champs_perso`).
- Correctif proposé : la structure `conditions.ciblage` de `E-conception.md` (Conception 1) — fichiers : `server/lib/validation.ts`, nouveau `server/lib/automations-ciblage.ts`, `server/lib/automationEngine.ts`, `src/components/automations/PanneauDeclencheur.tsx`.
- Risque / à décider par Rafba : aucun (les deux clés d'étiquette existantes restent lues telles quelles).

### E-04 — Impossible de cibler une automatisation de facture, de devis ou de rendez-vous sur un champ de la fiche CLIENT (« type de client ») : la règle ne part pour personne
- Point de la mission : 6
- Gravité : majeur
- Ce qu'on voit : sur « Facture en retard », le panneau n'offre AUCUN filtre de champ (la section « Filtres » n'apparaît que s'il existe des champs personnalisés de facture) ; sur « Nouveau prospect » elle apparaît, avec les champs du client. Si on écrit quand même un filtre sur un champ du client dans une règle de facture (Lumi, API, copie), la règle ne se déclenche plus jamais, sans erreur — le journal dit « Conditions non remplies : champs personnalisés ».
- Reproduction : `releve-panneau-declencheur.json` (sections : `[]` pour la facture, `["Filtres"]` pour le prospect) ; test ci-dessous.
- Preuve : `e-ciblage.test.ts::[E-04] « type de client »…` et `::[E-04] la même chose avec les SEULS outils d'aujourd'hui…` (0 envoi, journal `conditions`). Témoin vert : `::[E-02 témoin]` (le même champ filtre bien quand l'événement porte sur le client).
- Cause racine : `conditionsChampsOk` (`server/lib/champs/automatisations.ts:40-63`) lit les champs de l'OBJET de l'événement (`objetDeLEntite`, `:24-33`) ; un champ d'un autre objet n'est « pas trouvé » → faux (`:52-53`). L'éditeur ne garde que les champs de l'objet de l'événement (`PanneauDeclencheur.tsx:196-198`, `:330-335`). **« Type de client » n'existe pas comme colonne** : la fiche `clients` a `status` (`lead` / `active` / `inactive`), `company` et `display_as_company` (entreprise ou particulier), rien d'autre (`supabase/baseline/01_schema.sql:2585-2663`). Le modèle « lavage de vitres » prévoit un champ personnalisé « Type de bâtiment » (Résidentiel / Commercial / Multilogement, `src/lib/champs/modeles.ts:43-44`), posé à l'inscription seulement quand le métier choisi a un modèle (`server/routes/billing.ts:253-258`) : ni mon bureau semé par `seedOrgComplete`, ni la liste relevée par le propriétaire ne le portent.
- Correctif proposé : une règle de ciblage lit TOUJOURS la fiche du client de l'entité (`clientDeLEntite`, `A:2580`) : étiquettes, champs personnalisés du client, et quatre champs de la fiche (statut, entreprise / particulier, ville, source). Fichiers : nouveau `server/lib/automations-ciblage.ts`, `server/lib/automationEngine.ts`, `PanneauDeclencheur.tsx`.
- Risque / à décider par Rafba : ce qu'on appelle « type de client ». Proposition : « Entreprise / Particulier » (calculé : un nom de compagnie est saisi ou non) offert d'office, plus n'importe quel champ personnalisé de la fiche client.

### E-05 — Le ciblage n'est jugé qu'au déclenchement : un client exclu pendant l'attente reçoit quand même le message différé
- Point de la mission : 6 (« Évalué au moment de l'exécution »)
- Gravité : majeur
- Ce qu'on voit : une relance prévue dans 3 jours part même si, entre-temps, on a posé « Ne pas relancer » sur le client.
- Reproduction : règle différée d'une heure avec « n'a PAS l'étiquette Ne pas relancer » ; déclencher ; poser l'étiquette ; faire avancer la file.
- Preuve : `e-ciblage.test.ts::[E-05] évalué AU MOMENT DE L'EXÉCUTION…` (1 envoi, journal `envoye`).
- Cause racine : les conditions de la règle ne sont lues que dans `handleEvent` (`E:1465-1487`) ; `processScheduledTasks` (`E:1938` et suivantes) ne relit que l'état de la règle, les conditions de sortie et, pour une étape « si », les conditions de CETTE étape (`E:2219-2244`).
- Correctif proposé : avant toute action de message d'une tâche différée, rejouer le ciblage (pas les conditions d'occurrence comme `days_overdue`) ; hors ciblage → tâche close, journal « Ignoré : hors ciblage ». Fichier : `server/lib/automationEngine.ts` (bloc d'exécution des tâches, à côté de `checkStopConditions`).
- Risque / à décider par Rafba : à coordonner avec le point 9 (revalidation avant chaque envoi, agent B) — même endroit du moteur, une seule main.

### E-06 — « Démarrer une automatisation » ignore les conditions de l'automatisation démarrée : un client exclu la reçoit
- Point de la mission : 6
- Gravité : majeur
- Ce qu'on voit : l'automatisation B dit « pas pour les clients Ne pas relancer » ; lancée par l'action « Démarrer une automatisation » de A, elle écrit quand même à ce client.
- Reproduction / Preuve : `e-ciblage.test.ts::[E-06] « Démarrer une automatisation » respecte le ciblage…` (1 envoi au lieu de 0).
- Cause racine : `demarrerRegle` (`E:1588-1612`) appelle `lancerRegle` directement ; aucune condition n'est évaluée (déjà noté dans `AUTOMATIONS_INVENTORY.md`, action 1.20).
- Correctif proposé : dans `demarrerRegle`, juger le ciblage (étiquettes, champs, futur `ciblage`) avant `lancerRegle`, et journaliser l'écart. Fichier : `server/lib/automationEngine.ts`.
- Risque / à décider par Rafba : aucun.

### E-07 — Un client écarté est journalisé « Conditions non remplies : étiquette du client », pas « ignoré : hors ciblage »
- Point de la mission : 6
- Gravité : mineur
- Ce qu'on voit : dans Journaux, la raison ne nomme ni l'étiquette ni le champ en cause ; les trois formulations relevées : « … : étiquette du client », « … : champs personnalisés », « … : ciblage ».
- Preuve : `e-ciblage.test.ts::[E-07]` ; témoin `::[E-01 témoin]` (la ligne existe, lisible, jamais un échec).
- Cause racine : `journaliserRegleEcartee` (`E:395-423`) reçoit un libellé fixe (`E:1478`, `E:1485`).
- Correctif proposé : `saute: 'Ignoré : hors ciblage — exclu par l'étiquette « Ne pas relancer »'`, `saute_code: 'hors_ciblage'` ; l'évaluateur rend la raison (prototype `scripts/qa/finale/e/prototype-ciblage.ts`, `evaluerCiblage`). Fichiers : `server/lib/automationEngine.ts`, `src/lib/automationCatalogue.ts` (libellé du code), l'onglet Journaux (agent D).
- Risque / à décider par Rafba : aucun.

### E-08 — Aucun compteur « Touche X clients » ni aperçu de la liste (sauf sur « Client inactif »)
- Point de la mission : 6
- Gravité : majeur (fonction absente)
- Ce qu'on voit : le panneau du déclencheur ne dit jamais combien de clients sont visés ; la confirmation de publication non plus.
- Reproduction : `releve-panneau-declencheur.json` (`mentionne_un_compteur_de_clients: false` sur les deux déclencheurs).
- Preuve : relevé ci-dessus. Mesure de faisabilité : `scripts/qa/finale/e/mesure-compteur-ciblage.mts` sur 5 000 clients fictifs (`charge-5000-clients.sql`) → `D:/lume-final/sorties/e/mesure-compteur-ciblage.json` : 45 à 132 ms en une requête SQL, 135 à 275 ms en mémoire (6 à 14 lectures), les deux méthodes rendent le même nombre sur 5 scénarios ; aperçu de 20 lignes : 18 ms.
- Cause racine : seul `apercuClientsInactifs` existe (`PanneauDeclencheur.tsx:144-156`).
- Correctif proposé : route `POST /api/automations/ciblage/apercu` (compte + 20 premiers + combien sont désabonnés par canal), appelée avec un délai de 300 ms depuis la section « Qui est ciblé ». Voir Conception 1.
- Risque / à décider par Rafba : « X clients » = clients du carnet qui correspondent au ciblage, pas « X messages partiront » (ça dépend des événements à venir) — à dire tel quel à l'écran.

### E-11 — Avec le réglage « désabonnement par canal », un client qui a dit STOP ou s'est désabonné reçoit encore les messages transactionnels
- Point de la mission : 6 et 16 (« Désabonnés / STOP toujours exclus, peu importe les règles »)
- Gravité : majeur — **décision requise**
- Ce qu'on voit : réglage par défaut (drapeau éteint) : rien ne part, sur les deux canaux, quel que soit le type d'envoi — c'est ce que demande la mission. Drapeau `auto_desabonnement_canal` allumé : le texto et le courriel « transactionnels » (confirmation, rappel de rendez-vous, envoi de facture) partent quand même.
- Reproduction / Preuve : `e-ciblage.test.ts::[E-10 témoin]` (vert : 5 envois sautés « désabonné », dont un différé et un ciblé par étiquette) et `::[E-11]` (rouge : `['sms', 'courriel']` partis). Déjà établi et voulu par la suite existante : `tests/automations-suite/integration/30-fgh-conformite.test.ts::[G-011]`.
- Cause racine : `A:1362-1370` (courriel) et `A:1584-1590` (texto) : sous `ctx.parCanal`, seul un envoi `commercial` est sauté. Le texto transactionnel compte sur le blocage de l'opérateur (erreur Twilio 21610, `A:1686`) — or un retrait fait sur la page de désabonnement (`server/routes/unsubscribe.ts:57` écrit `sms_opt_outs`) n'est PAS connu de Twilio : ce texto-là arrive vraiment.
- Correctif proposé : au minimum, un texto n'est jamais tenté vers un numéro de `sms_opt_outs`, drapeau ou non (retirer la branche `parCanal` du texto) ; pour le courriel, garder le transactionnel strict (facture, reçu) et rien d'autre. Fichier : `server/lib/actions/index.ts`.
- Risque / à décider par Rafba : la mission dit « toujours exclus » ; le test existant G-011 affirme l'inverse pour le transactionnel. Trancher avant de toucher (le drapeau est éteint partout par défaut, donc aucun bureau n'est touché tant qu'il n'est pas allumé). Autre point connu : une lecture ratée de `sms_opt_outs` laisse partir le texto (`A:1578-1583` ne regarde pas l'erreur ; inventaire § 9-11) — non rejoué ici.

### E-17 — « Aucune demande d'avis (noreview) » n'est respecté que par l'action « Demander un avis » et deux préréglages : une demande d'avis écrite à la main part quand même
- Point de la mission : 6 (« règle d'exclusion automatique pour toute automatisation de demande d'avis »)
- Gravité : majeur
- Ce qu'on voit : le client coché « noreview » ne reçoit pas la demande d'avis fournie par Lume ; mais une automatisation maison « Job terminé → texto : laissez-nous un avis [lien] » (ou une copie d'un préréglage, qui perd sa clé) lui écrit.
- Reproduction / Preuve : `e-ciblage.test.ts::[E-15 témoin]` (vert : saut « Client marqué « noreview » : aucune demande d'avis », le voisin reçoit) ; `::[E-17]` (rouge : 1 envoi, journal `envoye`).
- Cause racine : le champ existe — champ personnalisé client `noreview`, case à cocher, posé d'office dans chaque entreprise (`src/lib/champs/base.ts:32`, migration `20261005500100_champ_noreview.sql`), lu par `clientRefuseAvis` (`server/lib/reviewOptOut.ts:22-51`). Il est consulté dans `executeRequestReview` (`A:2111-2119`) et, pour `send_sms` / `send_email`, seulement si la règle porte `preset_key` ∈ {`google_review`, `review_reminder_7d`} (`A:3259-3270`, `server/lib/reviews.ts:28-32`).
- Correctif proposé : une étape est une « demande d'avis » si c'est `request_review`, OU si son texte cite une variable d'avis (`google_review_url`, `facebook_review_url`, `review_page_url`, `review_link`, `survey_url`), OU si la règle est un préréglage d'avis — et dans ces trois cas l'exclusion « noreview » s'applique d'office (et s'affiche dans « Qui est ciblé », non décochable). Fichiers : `server/lib/reviews.ts` (fonction pure `estDemandeDAvis`), `server/lib/actions/index.ts:3259`.
- Risque / à décider par Rafba : aucun.

---

## Point 7 — Doublons

Ce qui empêche AUJOURD'HUI un double envoi, relevé dans le code et rejoué :

| Garde | Ce qu'elle couvre | Où | Rejoué |
|---|---|---|---|
| Clé d'exécution `règle:fiche:action` + index unique sur les tâches en file | la MÊME automatisation deux fois pour la même fiche (différé) | `E:433-459` | `[E-26 témoin]`, suite existante D-006, D-020 |
| Réservation `règle:fiche:action@tranche de 2 min` | le même événement reçu deux fois de suite (immédiat) | `E:671`, `E:818-897` | `[E-24 témoin]`, D-003, D-004 |
| « Déjà envoyé » (même texte / même objet au même destinataire depuis la 1re tentative) | reprise d'une tâche, rejeu de l'outbox | `A:180-198`, posé seulement si `dejaEnvoyeDepuis` (`E:979`, `E:2401`) | `[E-25 témoin]`, D-010, D-011 |
| Une relance de facture par 20 h, toutes règles de relance confondues | facture en retard + relance J+n | `E:770-809` | (suite existante K-013) |
| Demande d'avis : une par client par 7 jours | `request_review` | `A:2135-2145` | — |
| Plafond : 3 messages COMMERCIAUX par 24 h, par destinataire et par canal | rafale | `A:260-307` | F-080, F-081 (rejoués, verts) |
| Deux actions identiques dans la même règle : refus à l'enregistrement | une règle | `server/routes/automation-rules.ts:113-126` | — |

Aucune de ces gardes ne regarde ce qu'une AUTRE automatisation a envoyé au même client.

### E-20 — Deux automatisations identiques (même déclencheur, même message) : le client reçoit le message deux fois
- Point de la mission : 7
- Gravité : majeur
- Ce qu'on voit : deux textos identiques (ou deux courriels identiques) à la même seconde. Cas réel : un préréglage (« Invoice Reminder — 7 Days ») publié en même temps que le parcours du pack (« Relance de facture — 3, 7, 14 et 30 jours »), ou une copie d'une automatisation publiée.
- Reproduction / Preuve : `tests/automations-finale/e/integration/e-doublons.test.ts::[E-20]` (texto : 2 envois, journal `envoye`, `envoye`) et `::[E-21]` (courriel : 2 envois).
- Cause racine : les clés d'idempotence portent l'id de la règle ; « déjà envoyé » ne s'applique qu'aux reprises.
- Correctif proposé : garde « doublon » au point d'envoi — Conception 2. Fichiers : nouveau `server/lib/actions/doublons.ts`, `server/lib/actions/index.ts` (deux appels, à côté de `dejaEnvoye`, lignes 1477 et 1643), `server/lib/automationEngine.ts` (journal).
- Risque / à décider par Rafba : la fenêtre (proposée : 24 h).

### E-22 — Deux automatisations au message reformulé : les deux partent
- Point de la mission : 7
- Gravité : majeur
- Preuve : `e-doublons.test.ts::[E-22]` (2 envois). Garde-fous verts, à ne pas casser : `::[E-23 témoin]` (deux messages réellement différents le même jour → les deux partent ; le même texte à deux clients différents → les deux partent).
- Cause racine : comme E-20.
- Correctif proposé : « quasi identique » = même fiche ET similarité ≥ 0,8 sur les mots utiles — mesuré sur les 87 messages fournis par Lume : jamais plus de 0,63 entre deux messages de familles différentes ; 0,79 à 1 entre un préréglage et sa reprise dans le pack (`scripts/qa/finale/e/analyse-similarite-prereglages.mts`, `D:/lume-final/sorties/e/analyse-similarite.json`, preuve `tests/automations-finale/e/unitaires/e-prototype-conceptions.test.ts`).
- Risque / à décider par Rafba : aucun.

### E-27 — Deux automatisations identiques différées, traitées par deux consommateurs en même temps : deux envois
- Point de la mission : 7 (« workers en parallèle »)
- Gravité : majeur
- Preuve : `e-doublons.test.ts::[E-27]` (2 envois). Témoin : `::[E-26 témoin]` (la même tâche prise par deux consommateurs → un seul envoi).
- Cause racine : comme E-20 ; en plus, une garde par simple lecture ne tiendrait pas en parallèle.
- Correctif proposé : la réservation atomique de la Conception 2 (une ligne de journal à clé unique `doublon:<canal>:<destinataire>:<empreinte>:<jour>`, sur l'index unique déjà en place `idx_execution_logs_immediat_dedup`) — sans migration.
- Risque / à décider par Rafba : deux messages quasi identiques (pas identiques) envoyés à la même milliseconde par deux processus restent possibles ; l'avertissement à la publication (E-28) couvre ce reste.

### E-28 — Publier une automatisation identique à une autre déjà publiée : aucun avertissement, nulle part hors « Construire avec Lumi »
- Point de la mission : 7
- Gravité : majeur
- Ce qu'on voit (vrai navigateur) : la confirmation dit seulement « Publier cette automatisation ? Elle commencera à envoyer de vrais messages à vos clients dès le prochain déclenchement. » ; elle ne nomme pas l'automatisation en conflit ; « Automatisation publiée ».
- Reproduction : `scripts/qa/finale/e/releve-doublon-et-compteurs.mts` → `releve-doublon-et-compteurs.json`, bloc `A_publication_d_un_doublon` ; capture `doublon-confirmation-publication.png`.
- Preuve : le relevé ci-dessus et `e-doublons.test.ts::[E-28]` (`changerPublication` ne rend aucun avertissement).
- Cause racine : `changerPublication` (`server/lib/automations-publication.ts:79-177`) ne lit que la règle publiée ; `problemesPublication` (`src/lib/publicationAutomatisation.ts`) ne connaît pas les autres règles ; la confirmation de l'éditeur (`src/pages/AutomationBuilderPage.tsx:1308-1322`) n'affiche que ces avertissements-là. Rien non plus à la création (`POST /automations/rules`), à la copie, ni au basculement depuis la liste.
- Correctif proposé : Conception 2, volet « avertir » — une fonction serveur `conflitsDePublication` appelée par la route de publication (réponse `avertissements`), affichée dans la confirmation existante. Fichiers : nouveau `server/lib/automations-conflits.ts`, `server/routes/automation-rules.ts`, `server/lib/automations-publication.ts`, `src/pages/AutomationBuilderPage.tsx`, `src/pages/Automations.tsx`.
- Risque / à décider par Rafba : avertir sans bloquer (décision déjà prise).

### E-29 — L'avertissement de Lumi ne regarde ni le ciblage ni le clavardage : fausses alertes d'un côté, silence de l'autre
- Point de la mission : 7 (« Lumi avertit aussi »)
- Gravité : mineur
- Ce qu'on voit : `server/lib/lumi/deja-publiees.ts` ajoute « À savoir : tu as déjà une automatisation publiée qui fait la même chose sur ce déclencheur… » sous la réponse de « Construire avec Lumi », au PREMIER tour seulement (`server/routes/automation-rules.ts:488-492`). Critère : même déclencheur + au moins un type d'action en commun (`deja-publiees.ts:77-79`). Le ciblage n'est pas lu : « offre aux VIP » et « message à tous sauf les VIP » sont signalées comme double emploi. Les outils de Lumi dans le clavardage (`create_automation_from_text`, `toggle_automation_rule`) n'avertissent pas.
- Preuve : `e-doublons.test.ts::[E-29 témoin]` (vert : la note existe et nomme l'automatisation) et `::[E-29]` (rouge : signalée malgré des ciblages disjoints). Pour le clavardage : lecture de code seulement — **NON VÉRIFIÉ au vrai modèle** (zone de l'agent A).
- Correctif proposé : `deja-publiees.ts` appelle la même `conflitsDePublication` que la publication ; les outils de Lumi qui publient relaient ses avertissements. Fichiers : `server/lib/lumi/deja-publiees.ts` ; outils : zones a1 / agent A.
- Risque / à décider par Rafba : aucun.

### E-66 — Le plafond « 3 messages commerciaux par 24 h » compte le 4e comme un ÉCHEC, écrit en anglais
- Point de la mission : 7 (et 5, journaux)
- Gravité : mineur
- Ce qu'on voit : dans la base, `result_success = false`, « Frequency cap reached for +1555… (max 3 commercial messages / 24h) — skipped to avoid spamming ». Compté dans « Échoués » ; d'après `AUTOMATIONS_INVENTORY.md` (partie 2, § 6), dans un parcours l'étape échouée arrête la suite et déclenche la notification d'échec (non rejoué ici).
- Preuve : tests existants rejoués dans mon bureau, verts : `tests/automations-suite/integration/30-fgh-moteur.test.ts::[F-080]` et `::[F-081]` ; lignes lues dans `automation_execution_logs`.
- Cause racine : `A:1400-1402` et `A:1604-1606` rendent `{ success: false }` au lieu d'un saut.
- Correctif proposé : `saute('Ignoré : plafond de 3 messages par 24 h atteint pour ce client', 'plafond')`. Fichier : `server/lib/actions/index.ts`.
- Risque / à décider par Rafba : F-080 et F-081 attendent aujourd'hui un échec : ils devront suivre la décision (ne pas les affaiblir sans elle).

---

## Point 8 — « Insérer un champ »

Relevé au vrai navigateur, identique pour « Facture en retard », « Devis envoyé », « Rendez-vous planifié » et
« Nouveau prospect », texto comme courriel (`releve-inserer-champ.json`, captures `*-replie.png` / `*-deplie.png`) :

1. « Insérer une information du client » — 6 boutons fixes : Nom du client · Nom de votre entreprise · Total · Lien facture · Lien du devis · Date du rendez-vous.
2. « Insérer un champ » :
   - une ligne repliée « ▸ Champs de base » (90 entrées une fois dépliée : Client 20, Pipeline 11, Job 25, Devis 22, Facture 12) ;
   - puis, visibles SANS rien déplier et sans titre : Client · Référé par, Client · Code d'accès, Client · Courriel de facturation, Client · Instructions d'accès, Client · Aucune demande d'avis (noreview), Job · Carburant, Job · Instructions spéciales, Job · Sous-traitance, Job · Autres dépenses, Devis · Motif de refus.

Les trois palettes de l'app ne se ressemblent pas : panneau de l'éditeur (ci-dessus, sans recherche) ; éditeur de texto de
la liste (8 boutons fixes : Prénom du client, Nom complet, Votre entreprise, N° de facture, Montant, N° de soumission,
Date du RDV, Heure du RDV) ; éditeur de courriel de la liste (108 boutons à plat, avec recherche).

### E-30 — Les champs personnalisés s'affichent comme s'ils étaient les « Champs de base » ; les vrais champs de base sont cachés
- Point de la mission : 8
- Gravité : majeur
- Ce qu'on voit : exactement la liste citée par le propriétaire. La ligne « ▸ Champs de base » est repliée ; les boutons qui la suivent, au même niveau et sans titre, sont les champs personnalisés de l'entreprise — on les lit comme le contenu de « Champs de base ».
- Reproduction : ouvrir une étape texto ou courriel → bas du panneau (capture `invoice-overdue-texto-replie.png`).
- Preuve : `tests/automations-finale/e/composants/e-inserer-un-champ.test.tsx::[E-30 témoin]` (vert : l'état constaté) et `::[E-30]` (rouge : pas de section « Champs personnalisés »).
- Cause racine : `BoutonsVariablesChamps` (`src/components/champs/automatisations.tsx:326-356`) rend un `<details>` « Champs de base » (`:331-343`) puis, hors du `<details>`, un bouton par champ personnalisé (`:344-353`). La liste vient de `useChampsTous()` (`:33-43`, `GET /api/custom-fields`) : TOUS les champs non archivés de l'entreprise sauf ceux des propriétés. Ce sont les « champs personnalisés de base » posés d'office dans chaque entreprise par la base (`cf_champs_base()` et `cf_depenses_champs_base()`, recopiés dans `src/lib/champs/base.ts:29-40`) — d'où la confusion de vocabulaire : « champs de base » désigne à la fois les champs des formulaires (`CHAMPS_STANDARD`, `src/lib/champs/standard.ts:100-242`) et ces champs personnalisés semés.
- Correctif proposé : Conception 3 — une palette unique, deux sections titrées (« Champs de base » ouverte, « Champs personnalisés »). Fichiers : nouveau `src/components/automations/PaletteChamps.tsx`, `src/components/automations/PanneauEtape.tsx:556-600`, `src/components/champs/automatisations.tsx`.
- Risque / à décider par Rafba : aucun.

### E-70 — « Client · Petit » n'est pas un champ fourni par Lume — NON VÉRIFIÉ en prod
- NON VÉRIFIÉ : ma consigne interdit toute requête vers la prod.
- Point de la mission : 8
- Gravité : cosmétique
- Ce qu'on voit : dans un bureau neuf semé comme une vraie entreprise, la liste compte exactement les dix champs cités par le propriétaire MOINS « Petit ».
- Preuve : relevé `releve-inserer-champ.json` (10 boutons, pas de « Petit ») ; `grep` du dépôt : « Petit » n'est ni dans `cf_champs_base()` / `cf_depenses_champs_base()` (migrations `20261003520000`, `20261005400000`, `20261005500100`, `20261003470000`), ni dans `src/lib/champs/base.ts`, ni dans les modèles par métier (`src/lib/champs/modeles.ts`). Le bouton affiche le libellé entier (aucune coupe dans le style du bouton, `automatisations.tsx:327`).
- Cause racine (déduite) : un champ personnalisé client créé à la main dans le bureau du propriétaire, dont le libellé est « Petit » — ni un champ semé, ni un libellé tronqué.
- Correctif proposé : aucun côté code. Pour le confirmer, une lecture seule en prod : `select object_type, key, label, field_type, created_at from custom_fields where lower(label) like 'petit%' and archived_at is null` (compte et libellé seulement).
- Risque / à décider par Rafba : garder ou archiver ce champ.

### E-31 — La liste est la même pour tous les déclencheurs : « Nouveau prospect » propose 70 variables de facture, de devis, de job et de pipeline qui partiront vides
- Point de la mission : 8 (« Liste contextuelle au déclencheur »)
- Gravité : majeur
- Ce qu'on voit : sur « Nouveau prospect », les raccourcis « Total », « Lien facture », « Lien du devis », « Date du rendez-vous » et les 70 entrées Pipeline / Job / Devis / Facture ; aucune n'a de valeur pour un prospect.
- Preuve : `e-inserer-un-champ.test.tsx::[E-31 témoin]` (vert : 106 entrées identiques pour 4 déclencheurs) et `::[E-31]` (rouge). Ce que le moteur remplit vraiment par fiche : `scripts/qa/finale/e/releve-variables-par-entite.mts` → `D:/lume-final/sorties/e/variables-par-entite.json` (tableau dans `E-carte.md`).
- Cause racine : `VARIABLES` figé (`PanneauEtape.tsx:124-131`) ; `variablesSysteme()` sans argument = tous les objets (`automatisations.tsx:29-31`, `:336`) ; `BoutonsVariablesChamps` ne reçoit pas le déclencheur.
- Correctif proposé : la palette lit un catalogue unique filtré par l'entité du déclencheur (`ENTITE_PAR_DECLENCHEUR`). Conception 3.
- Risque / à décider par Rafba : aucun.

### E-37 — Sur « Rendez-vous planifié », les 100 champs proposés sous « Insérer un champ » sont TOUS vides à l'envoi
- Point de la mission : 8
- Gravité : majeur
- Ce qu'on voit : « Bonjour {{client.first_name}}, » inséré depuis « Champs de base » dans un rappel de rendez-vous part « Bonjour, » ; `{{job.title}}`, `{{client.refere_par}}` partent vides. Aucun avertissement.
- Reproduction / Preuve : `tests/automations-finale/e/integration/e-variables-moteur.test.ts::[E-37]` (rendu `||`) ; témoin `::[E-38 témoin]` (les mêmes variables sont remplies sur une facture) ; relevé `variables-par-entite.json` (`schedule_event` : 0 champ de fiche rempli).
- Cause racine : dans `resolveEntityVariables`, le bloc des champs de fiche (`A:1181-1204`) ne connaît que `client`, `lead`, `deal`, `job`, `quote`, `invoice` (`liens`, `A:1184-1189`) ; un rendez-vous (`schedule_event`) n'a aucune référence → `variablesChamps` ne rend rien.
- Correctif proposé : pour `schedule_event` / `appointment`, remonter au job puis au client (`refs.job = evt.job_id`, `refs.client = job.client_id`). Fichier : `server/lib/actions/index.ts`.
- Risque / à décider par Rafba : aucun.

### E-32 — Les champs utiles manquent : solde dû, jours de retard, courriel de l'entreprise, technicien ; « nom complet » et l'entreprise ne sont pas dans « Champs de base »
- Point de la mission : 8
- Gravité : majeur
- Ce qu'on voit : aucune variable ne porte le solde restant d'une facture payée en partie (seulement le total), ni les jours de retard, ni le courriel de l'entreprise, ni le nom du technicien. Lumi, avec le vrai modèle, le dit lui-même : « je ne peux pas inclure le nombre de jours de retard (aucune variable n'existe pour ça) » — et écrit « Solde : [invoice_total] », faux dès qu'un acompte a été payé (`D:/lume-final/sorties/e/lumi-variables-essai.json`).
- Preuve : `e-variables-moteur.test.ts::[E-39]` (deux tests rouges) ; `e-inserer-un-champ.test.tsx::[E-32]` (deux tests rouges).
- Cause racine : `resolveEntityVariables` ne calcule pas ces valeurs (`A:1035-1111` : `invoice_total` = `total_cents`) ; `CHAMPS_STANDARD.invoice` déclare `balance` sans section, donc non calculé (`src/lib/champs/standard.ts:225`, `server/lib/champs/variablesSysteme.ts:163-177`) ; `days_overdue` n'existe que dans les métadonnées de l'événement.
- Correctif proposé : table des variables À CRÉER dans `E-conception.md` (Conception 3). Fichier : `server/lib/actions/index.ts` (bloc `invoice`, bloc entreprise).
- Risque / à décider par Rafba : « technicien » = le membre assigné à la visite (`schedule_events`), sinon l'équipe du job — à confirmer.

### E-33 — La palette offre les notes INTERNES de la facture, les codes et instructions d'accès, et 12 cases à cocher
- Point de la mission : 8 (« Exclus par défaut : booléens, champs internes, champs sensibles »)
- Gravité : majeur (une note interne ou un code d'accès peut partir dans un message au client, d'un clic)
- Ce qu'on voit : « Facture · Notes internes » (`{{invoice.internal_notes}}`), « Client · Code d'accès », « Client · Instructions d'accès », « Client · Utiliser le nom de la compagnie comme nom du client » (rend « Oui » / « Non »), « Job · Afficher sur le leaderboard »…
- Preuve : `e-inserer-un-champ.test.tsx::[E-33]` ; `tests/automations-finale/e/unitaires/e-gabarit-variables.test.ts::[E-49]` (11 cases à cocher et `invoice.internal_notes` parmi les 90).
- Cause racine : `champsSysteme` rend tout champ de formulaire (`standard.ts:249-251`), dont `internal_notes` (`:221`) ; aucun filtre par type ni par sensibilité ; les champs personnalisés sont tous listés.
- Correctif proposé : liste d'exclusion dans le catalogue des variables (types `checkbox` et `file`, clés internes, clés `code_acces`, `instructions_acces`, `code_alarme`, notes) + une case « Proposer dans les messages » sur un champ personnalisé (défaut : non pour une case à cocher et pour les deux champs d'accès). Conception 3.
- Risque / à décider par Rafba : une variable déjà écrite dans une règle existante continue d'être remplie (on retire de la palette, pas du moteur).

### E-35 — La variable s'insère à la FIN du texte, pas au curseur ; pas de recherche ; trois palettes différentes
- Point de la mission : 8 (« ce qui rend l'insertion compliquée »)
- Gravité : mineur
- Ce qu'on voit : curseur placé entre « DEBUT » et « FIN », clic sur « Nom du client » → « DEBUT FIN[client_name] ». Pour trouver « Prénom » il faut déplier « Champs de base » puis lire 90 boutons sans recherche ni regroupement ; dans un courriel, la variable va toujours dans « Message », jamais dans « Objet » ni « Aperçu ». Deux écritures pour la même chose : `[client_name]` (raccourcis) et `{{client.first_name}}` (champs).
- Preuve : relevé navigateur (`texto_insertion`, `courriel_insertion`, `recherche_presente: false`) ; `e-inserer-un-champ.test.tsx::[E-35]` et `::[E-34]`.
- Cause racine : `majConfig(champ.cle, \`${actuel}[${v.cle}]\`)` (`PanneauEtape.tsx:568-573`, `:590-596`) concatène ; la cible est toujours le premier champ de type `zone`.
- Correctif proposé : mémoriser le dernier champ de texte actif et sa sélection, insérer à cet endroit et replacer le curseur après ; champ de recherche (sans accents ni casse, comme `EmailPreviewEditor.tsx:226-232`) ; la même palette dans les trois éditeurs. Conception 3.
- Risque / à décider par Rafba : aucun.

### E-44 — Aucune valeur de remplacement : « Bonjour {prénom|là} » part tel quel chez le client
- Point de la mission : 8
- Gravité : majeur
- Ce qu'on voit : `[client_first_name|là]`, `{{client.first_name|cher client}}`, `{prénom|là}` ne sont reconnus par personne : le client lit les crochets ou les accolades. Seuls replis existants : le prénom retombe sur le nom de compagnie puis le nom complet (`A:880`), et « Bonjour , » est recollé en « Bonjour, » (`sansPrenomVide`, `A:552-567`).
- Preuve : `e-gabarit-variables.test.ts::[E-44]` (trois tests rouges).
- Cause racine : l'expression de `resolveTemplate` (`A:627`) n'admet aucun `|`.
- Correctif proposé : `|texte` facultatif dans les trois écritures ; valeur vide → le texte de remplacement (échappé comme une valeur). Mêmes règles dans les aperçus (`src/lib/emailBodyText.ts:174-183`, `src/lib/variablesCourriel.ts:109-125`) et le détecteur. Conception 3.
- Risque / à décider par Rafba : le signe (proposé : `|`, celui de l'exemple du propriétaire).

### E-36 — Une variable inconnue n'est qu'un avertissement, incomplet : l'enregistrement passe, le serveur accepte
- Point de la mission : 8 (« Variable inconnue → erreur à la sauvegarde »)
- Gravité : majeur
- Ce qu'on voit (vrai navigateur) : texte « Bonjour [prenom_du_client], voici {{client.champ_qui_nexiste_pas}} et {prénom|là}. » → un seul des trois est signalé (« Variable inconnue : [prenom_du_client] — sera vide dans le message envoyé. ») ; « Enregistrer » reste actif (capture `lead-created-courriel-variable-inconnue.png`). Le serveur accepte la règle.
- Preuve : relevé `courriel_variable_inconnue_alerte` ; `e-inserer-un-champ.test.tsx::[E-36]` ; `e-gabarit-variables.test.ts::[E-45]` (le schéma serveur accepte `[prenom_du_client]`), `::[E-46]` (`{prénom}` ni remplacé ni détecté), `::[E-43 témoin]` (une inconnue part vide).
- Cause racine : `variablesInconnues` est appelé sans la liste des champs de l'entreprise (`PanneauEtape.tsx:313`) → tout `{{objet.cle}}` passe (`src/lib/emailBodyText.ts:273-275`) ; son expression `\w+` ne voit pas une clé accentuée (`:264`) ; aucun contrôle côté serveur (`server/lib/validation.ts`, `server/routes/automation-rules.ts`). Seul « Construire avec Lumi » refuse une variable inventée (`server/lib/lumi/generer-parcours.ts:824-833`).
- Correctif proposé : un contrôle serveur à l'enregistrement et à la publication, bâti sur le catalogue unique + les champs de l'entreprise ; message qui nomme la variable et l'étape. Fichiers : `server/routes/automation-rules.ts`, `server/lib/automations-validation-messages.ts`, `src/lib/publicationAutomatisation.ts`, `PanneauEtape.tsx`.
- Risque / à décider par Rafba : bloquer l'ENREGISTREMENT casserait l'enregistrement automatique d'un brouillon en cours de frappe. Proposition : brouillon → avertissement ; **publication → refus** ; une règle déjà publiée qui contient une inconnue reste publiée mais s'affiche « à corriger ».

### E-47 — Une variable qui existe mais n'a jamais de valeur pour CE déclencheur n'est signalée nulle part
- Point de la mission : 8
- Gravité : mineur
- Ce qu'on voit : `[invoice_link]` dans une automatisation « Nouveau prospect » : aucun avertissement, « payez ici : . » chez le client.
- Preuve : `e-gabarit-variables.test.ts::[E-47]`. (Lumi, lui, refuse correctement : « Un nouveau prospect n'a pas encore de facture… », `lumi-variables-essai.json`.)
- Cause racine : `VARIABLES_CONNUES` est une liste plate (`src/lib/emailBodyText.ts:218-232`), sans notion de déclencheur.
- Correctif proposé : le catalogue porte, pour chaque variable, les entités où elle a une valeur. Conception 3.
- Risque / à décider par Rafba : aucun.

### E-71 — Lumi n'écrit que les 35 variables à crochets : jamais un champ de fiche, jamais une valeur de remplacement
- Point de la mission : 8 (« Lumi utilise les mêmes variables »)
- Gravité : mineur
- Ce qu'on voit : avec le vrai modèle (3 demandes, 3,5 ¢ au total) : variables toujours dans la liste du moteur ; refus correct d'une variable de facture sur un prospect ; « je ne peux pas… remplacer le prénom par “Bonjour là” quand il est vide » ; « Solde : [invoice_total] ».
- Preuve : `scripts/qa/finale/e/lumi-variables-essai.mts` → `D:/lume-final/sorties/e/lumi-variables-essai.json`.
- Cause racine : la consigne de Lumi cite `VARIABLES_CONNUES` (`server/lib/lumi/generer-parcours.ts:399`) — la même liste que le détecteur, mais pas les variables pointées (`{{soumission.total}}`…), ni les champs de la fiche, ni les champs personnalisés.
- Correctif proposé : la consigne lit le catalogue unique, filtré par déclencheur quand il est connu. Fichier : `server/lib/lumi/generer-parcours.ts` (zone du coordinateur).
- Risque / à décider par Rafba : la liste est dans le préfixe mis en cache du prompt : la rendre dépendante du déclencheur change le cache (voir agent F) — garder la liste complète dans le préfixe et ajouter le filtre dans le message.

---

## Point 16 — Langue, contenu, expéditeur

### E-52 — La langue du message est celle de l'ENTREPRISE ; il n'existe aucune préférence de langue par client
- Point de la mission : 16
- Gravité : à décider
- Ce qu'on voit : un client anglophone d'une entreprise réglée en français reçoit tout en français. « Messages en FR / EN » de la liste et l'outil `set_automation_language` règlent `company_settings.default_language` : c'est un réglage du bureau, pas de l'automatisation.
- Preuve : `tests/automations-finale/e/integration/e-langue-expediteur.test.ts::[E-52 témoin]` (aucune colonne ni champ de langue sur la fiche client) ; langue de l'entreprise : suite existante `30-fgh-langue.test.ts::[H-001]` à `[H-006]`.
- Cause racine : `langueOrg` (`E:632`, posée dans le contexte `E:974`, `E:2392`) → `champLocalise` (`A:210-216`). Un bureau créé avant le « ménage » des champs de base (migration `20261005400000_menage_champs_de_base.sql`, qui a réduit la liste de 31 à 8) peut porter un champ personnalisé client « Langue de communication » — c'est le cas du bureau de test sans suffixe de la pile locale : le moteur ne le lit pas.
- Correctif proposé : si on la veut — colonne `clients.langue` (`fr` / `en`, vide = celle de l'entreprise), lue dans `executeRuleActions` et `processScheduledTasks` pour `ctx.langue`. C'est une migration.
- Risque / à décider par Rafba : la vouloir ou non avant le 26 octobre (migration + saisie sur la fiche + import).

### E-61 — Le compteur de SMS compte le gabarit, pas le texto envoyé : le texte par défaut annoncé « 1 SMS » en coûte 2
- Point de la mission : 16
- Gravité : majeur
- Ce qu'on voit : l'éditeur affiche « 52 caractères » pour « Bonjour [client_name], c’est [company_name]. Merci ! » — le texte que Lume pose lui-même dans tout nouveau texto. Il contient une apostrophe typographique (« ’ », U+2019), qui n'est pas dans l'alphabet des textos : le texto part en tranches de 70 ; avec les noms remplis et la mention « … - Répondez STOP pour ne plus recevoir. » ajoutée par le serveur à tout texto commercial, il fait 2 SMS. Le nombre de SMS n'apparaît qu'à partir de 2, calculé sur le gabarit. Lumi suit la règle « un texto tient en 160 caractères » : son texto de bienvenue de 115 caractères (« intérêt », « bientôt ») coûte 2 SMS (`lumi-variables-essai.json`).
- Preuve : `tests/automations-finale/e/unitaires/e-segments-texto.test.ts::[E-61]`, `::[E-62]`, `::[E-63]` (rouges) ; `::[E-60 témoin]` (le calcul lui-même est juste) ; relevé navigateur (`texto_compteur`, `B_liste_ancien_format.texto_par_defaut` : « 52 caractères », aucun nombre de SMS).
- Cause racine : `libelleSegments(valeur)` reçoit le texte tapé (`src/components/automations/ChampAction.tsx:106-109`, `MessageEditor.tsx:59`) ; il rend `null` pour un seul segment (`src/lib/smsSegments.ts:47-55`) ; la mention est ajoutée à l'envoi (`A:1616-1618`, `server/lib/desabonnement/mention-sms.ts:44`) ; consigne de Lumi `server/lib/lumi/generer-parcours.ts:423-424` ; texte par défaut `src/lib/automationCatalogue.ts:811`.
- Correctif proposé : compter le texte « tel que le client le lira » (variables remplacées par des exemples de longueur réaliste, mention STOP ajoutée quand l'envoi est commercial), afficher toujours « N caractères · N SMS », dire quel caractère fait basculer en tranches de 70 ; à l'envoi d'un texto, remplacer les signes typographiques qui ont un jumeau dans l'alphabet des textos (« ’ » → « ' », guillemets courbes, « … », tirets longs, espace insécable) — jamais une lettre ; corriger la consigne de Lumi (70 caractères dès qu'il y a ê, ç, ô, un émoji). Fichiers : `src/lib/smsSegments.ts`, `ChampAction.tsx`, `MessageEditor.tsx`, `src/lib/automationCatalogue.ts`, `server/lib/lumi/generer-parcours.ts`.
- Risque / à décider par Rafba : aucun.

### E-64 — Deux écrans où l'on écrit un texto automatisé n'ont aucun compteur de SMS
- Point de la mission : 16
- Gravité : mineur
- Ce qu'on voit : Réglages → Messagerie SMS : « 22 / 320 » ; Réglages → Avis clients : « 0/320 » (texto d'avis) et rien du tout pour le texto de rappel d'avis. Jamais le nombre de SMS.
- Preuve : relevé navigateur `releve-doublon-et-compteurs.json`, blocs `C_reglages_messagerie` et `C_reglages_avis` (`mention_du_nombre_de_sms: false`) ; captures `reglages-messagerie.png`, `reglages-avis.png`.
- Cause racine : `src/pages/SettingsMessaging.tsx:582-594`, `src/pages/SettingsReviews.tsx:581-592` et `:700-706` n'utilisent pas `libelleSegments`.
- Correctif proposé : le même composant de compteur partout. (Ces deux écrans enregistrent par `updateRuleMessage`, qui n'écrit pas dans les parcours — écart n° 7 de `AUTOMATIONS_INVENTORY.md`, hors de mon domaine.)
- Risque / à décider par Rafba : aucun.

### E-50 — Expéditeur : conforme (témoin) ; deux décisions déjà ouvertes
- Point de la mission : 16
- Gravité : aucune (témoin) — deux décisions requises, déjà consignées
- Ce qu'on voit : le texto part du numéro de l'entreprise ; le courriel porte le nom de l'entreprise, la réponse va à l'adresse de l'entreprise ; sans nom ni adresse dans les réglages, le nom du bureau et le courriel du propriétaire prennent le relais (jamais « Lume CRM », jamais le soutien de Lume) ; logo, couleur, pied de page de l'entreprise.
- Preuve : `e-langue-expediteur.test.ts::[E-50 témoin]` et `::[E-51 témoin]` (verts) ; suite existante `30-fgh-conformite.test.ts::[G-020]`, `[G-021]`.
- Décisions requises (tests « ROUGE ATTENDU — décision requise » déjà dans la suite) : `30-fgh-conformite.test.ts::[G-022]` — le petit mascot Lume en bas du courriel, demandé par la mission, a été retiré le 2026-09-29 (norme « marque blanche », `server/lib/courriels/gabarit.ts`) ; `::[G-023]` — l'adresse d'expédition reste sur le domaine de Lume tant que l'entreprise n'a pas fait vérifier le sien (`senderForOrg`, `server/routes/emails.ts:263`). Lien de désabonnement : `[G-001]` à `[G-004]` ; STOP : `[G-010]` à `[G-013]`, et E-10 / E-11 ci-dessus.
- Risque / à décider par Rafba : G-022 (remettre le mascot ou garder la marque blanche) ; G-023 (contrainte technique).

---

## Ce que je n'ai pas pu vérifier

- « Client · Petit » : déduit, pas lu en prod (E-70).
- L'avertissement de doublon dans le clavardage de Lumi (outils `create_automation_from_text`, `toggle_automation_rule`) : lu dans le code, pas joué au vrai modèle (zone de l'agent A).
- La lecture ratée de `sms_opt_outs` qui laisse partir un texto : citée de l'inventaire, non rejouée.
- Le préréglage `review_reminder_7d` face à « noreview » : lu dans le code (`A:3259-3270`), non rejoué (il aurait fallu publier le préréglage du bureau).
- La variable « technicien » : aucune donnée d'assignation semée ; à préciser avant de la créer.

## Pour le coordinateur

- `tests/automations-finale/**` est pris par le `include` de `vitest.config.ts` (`tests/**/*.test.ts`) : mes 35 tests rouges feraient échouer `npm test` et la CI. Avant toute fusion : exclure le dossier dans `vitest.config.ts` (comme `tests/automations-suite/**`) ou y déplacer les tests une fois verts. Mes tests d'intégration se sautent d'eux-mêmes hors de la pile locale (`PILE_LOCALE`).
- Mon `.env.local` avait une `PAYMENTS_ENCRYPTION_KEY` de 64 caractères hexadécimaux que l'API refuse (« Expected 32 bytes, got 48 ») : je l'ai remplacée par une clé jetable en base64 dans MON worktree. `outils/env-local.mjs:36` écrit toujours l'ancienne forme.
- Un compte neuf voit la fenêtre « Partage de votre localisation » par-dessus l'éditeur au premier chargement : mes scripts la referment (« Refuser »).
- Vu en passant, hors domaine (agent B) : le panneau de « Facture en retard » n'offre aucun réglage du nombre de jours de retard (`days_overdue`) ; je n'ai pas creusé.
