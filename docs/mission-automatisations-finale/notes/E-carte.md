# Carte de l'agent E — où vit quoi (ciblage, doublons, variables, langue / expéditeur)

Relevé dans `D:/lume-final/wt-e` (branche `mission/auto-finale-e`, partie de origin/main `11e75ebc`), le 2026-10-01.
`E:` = `server/lib/automationEngine.ts`, `A:` = `server/lib/actions/index.ts`. Les numéros de ligne sont ceux de ce
commit (ils ont bougé depuis `AUTOMATIONS_INVENTORY.md`, écrit sur `5487b250`).

## 1. Conditions : ce que le moteur sait exprimer

### 1.1 Trois évaluateurs, appelés dans cet ordre au déclenchement (`handleEvent`, `E:1465-1494`)

| # | Quoi | Fonction | Sur quelles données | Opérateurs | Logique |
|---|---|---|---|---|---|
| 1 | Occurrence visée (« 3 jours de retard », l'étiquette posée, l'étape) | `separerCiblage` + `evaluateConditions` (`E:333-363`, `E:221-316`) | métadonnées de l'ÉVÉNEMENT | égalité, `eq neq in not_in gt gte lt lte`, suffixes `cle__gte` | ET entre les clés ; pas de trace si ça ne correspond pas |
| 2 | Filtres sur l'événement (source du prospect, montant…) | `evaluateConditions` | métadonnées de l'ÉVÉNEMENT (niveau 1) | idem | ET ; journal « Conditions non remplies : <libellé> » (`journaliserRegleEcartee`, `E:395-423`) |
| 3 | Champs personnalisés | `conditionsChampsOk` (`server/lib/champs/automatisations.ts:40-63`) → `evaluerCondition` (`src/lib/champs/filtres.ts:174-258`) | valeurs ACTUELLES des champs de l'OBJET de l'événement seulement | par famille : texte `is is_not contains not_contains`, nombre `eq neq gt lt between`, liste `any_of none_of`, date (8 opérateurs), case `is`, tous `is_empty is_not_empty` | ET ; champ d'un autre objet → faux |
| 4 | Étiquettes du client | `conditionsEtiquettesOk` (`server/lib/etiquettes.ts:66-86`) | `client_tags` du client de l'entité (`clientDeLEntite`, `A:2580`) | `client_a_etiquette` (une), `client_sans_etiquette` (une), sans casse | ET |
| 5 | Une fois par client tous les N jours | `dejaPasseRecemment` (`E:1634-1656`) | journaux + tâches de cette règle | — | — |

Étape « si » d'un parcours (`E:2219-2244`) : les trois mêmes évaluateurs, sur l'état RELU de la fiche
(`metadonneesFraiches`, `E:2603`). L'écart n° 1 de l'inventaire (étiquettes ignorées dans un « si ») est corrigé (`E:2242`).

**Ce qui est exprimable aujourd'hui** : « a l'étiquette X ET PAS l'étiquette Y » (oui — `[E-01 témoin]`) ; « champ
personnalisé = valeur » seulement si le champ est sur la fiche de l'événement (`[E-02 témoin]`) ; « source ∈ {a, b} »
par `in` sur une métadonnée.
**Ce qui ne l'est pas** : un OU entre deux conditions ; deux étiquettes ; un champ du CLIENT quand l'événement est une
facture, un devis, un job ou un rendez-vous ; « type de client » ; un champ de base de la fiche (statut, ville, compagnie).

### 1.2 Où ça s'écrit

- Base : `automation_rules.conditions` (jsonb), clés réservées `champs_perso`, `client_a_etiquette`, `client_sans_etiquette` ; `automation_rules.settings` (schéma strict).
- Validation : `conditionsAutomatisation` (`server/lib/validation.ts:1035-1068`, 10 clés au plus, liste seulement sous `champs_perso`) ; `conditionChampSchema` (`:1024-1032`) ; `automationSettingsSchema` (`:1191-1237`, `.strict()`).
- Éditeur : `src/components/automations/PanneauDeclencheur.tsx` — champs du déclencheur (`:299-313`), deux champs d'étiquette ajoutés d'office à tout déclencheur qui a un client (`src/lib/automationCatalogue.ts:493-518`), section « Filtres » (`:329-347`, seulement les champs de l'objet de l'événement), compteur « N clients correspondent aujourd'hui » pour « Client inactif » seulement (`:144-156`, `:315-321`).
- Étape « si » : zone de texte libre « champ = valeur » (`PanneauEtape.tsx:696-753`, signes `:51-53`) + conditions de champs (`ConditionsChampsEtape`, `src/components/champs/automatisations.tsx:359-379`).
- Briques réutilisables déjà là : `FiltreEtiquettes { avec, mode: 'toutes' | 'une', sans }` et `correspondEtiquettes` (`src/lib/etiquettesFiltre.ts:17-41`, filtre de la liste Clients et de la pipeline) ; moteur SQL `cf_filtrer(p_org, p_object, p_conditions, p_ids)` (`supabase/baseline/01_schema.sql:3907-3962`) ; `EditeurConditions` (`src/components/champs/EditeurConditions.tsx`).

### 1.3 Retraits et exclusions

| Sujet | Table / champ | Lu où | Remarque |
|---|---|---|---|
| STOP texto | `sms_opt_outs (org_id, phone)` | `A:1577-1590` | écrit par le texto entrant (`server/routes/messages.ts`) ET par la page de désabonnement (`server/routes/unsubscribe.ts:57`) |
| Désabonnement courriel | `email_unsubscribes (org_id, email, category)` (`pending` = simple porteur de jeton) | `A:1361-1370` via `isEmailUnsubscribed` | + `clients.email_opt_out_at` lu par le consentement |
| Drapeau par canal | `org_features.feature = 'auto_desabonnement_canal'` | `ctx.parCanal` | éteint par défaut ; allumé = le transactionnel part (E-11) |
| Consentement | `clients.sms_consent_at`, `email_consent_at`, tacite | `consentementCommercial` `A:387` | commercial seulement |
| Aucune demande d'avis | champ personnalisé client `noreview` (case à cocher, semé : `src/lib/champs/base.ts:32`) | `clientRefuseAvis` (`server/lib/reviewOptOut.ts:22-51`), appelé `A:2111-2119` et `A:3259-3270` | préréglages `google_review`, `review_reminder_7d` seulement (`server/lib/reviews.ts:28-32`) |

## 2. Doublons : les gardes existantes

Voir le tableau de `E-constats.md` (point 7). Points d'ancrage pour le correctif :

- envoi d'un courriel : `executeSendEmail`, juste avant `sendEmail` — `A:1477-1479` (`dejaEnvoye`) ;
- envoi d'un texto : `executeSendSms`, juste avant `messages.create` — `A:1643-1645` ;
- contexte d'une action immédiate : `E:958-1000` (`ruleId`, `presetKey`, `dejaEnvoyeDepuis` `E:979`) ; d'une tâche : `E:2385-2420` ;
- ce que le journal garde d'un envoi : `result_data = { to, subject }` (courriel, `A:1523`) ou `{ to, body }` (texto, `A:1682`) ; le corps d'un courriel n'est gardé nulle part (`email_deliveries` : objet seulement) ;
- avertissements : `server/lib/lumi/deja-publiees.ts` (lecture `:43-66`, note `:77-93`), branché dans la seule route `POST /api/automations/rules/generer` (`server/routes/automation-rules.ts:488-492`) ; confirmation de publication de l'éditeur `src/pages/AutomationBuilderPage.tsx:1244-1323` ; route de publication `server/lib/automations-publication.ts:79-177` ; règles de publication partagées `src/lib/publicationAutomatisation.ts`.

## 3. Variables d'un message

### 3.1 Trois écritures, un seul moteur de rendu

`resolveTemplate` (`A:601-637`, expression `A:627`) : `[cle]`, `{cle}`, `{{cle}}`, et `{{objet.cle}}` (variable pointée
du moteur d'abord, sinon champ de fiche `objet_cf_cle`). Une passe ; inconnue ou vide → chaîne vide ; valeur échappée
dans le corps HTML d'un courriel (`A:614-615`), seule exception `contract_html`. Aucune valeur de remplacement.

### 3.2 Ce que le moteur remplit, par fiche (relevé réel — `D:/lume-final/sorties/e/variables-par-entite.json`)

Toujours : `company_name`, `company_phone`, `google_review_url`, `facebook_review_url`, `review_page_url`.

| Fiche de l'événement | Déclencheurs | Variables classiques remplies | Champs de fiche `{{objet.cle}}` |
|---|---|---|---|
| client / prospect | nouveau prospect, statut changé, étiquette, note, tâche, client répond, inactif, date atteinte | `client_first_name`, `client_last_name`, `client_name`, `client_email`, `client_phone` ; `{{client.nom}}` | client (+ deal ouvert lié) |
| devis | envoyé, ouvert, accepté, refusé, changements demandés | + `quote_number`, `quote_total`, `quote_valid_until`, `quote_link`, `job_name` ; `{{soumission.numero / total / lien / lien_interne / nb_vues / ouverte_le}}` | client, devis, job lié, deal lié |
| facture | envoyée, payée, en retard, consultée, paiement échoué | + `invoice_number`, `invoice_total`, `invoice_due_date`, `invoice_link`, `job_name` ; sous drapeau : `{{facture.*}}`, `{{paiement.*}}` | client, facture, job lié |
| job | terminé, prêt à facturer, contrat signé | + `job_name`, `contract_link / line / html`, `signed_contract_link`, `deposit_amount`, `deposit_line` | client, job, deal lié |
| rendez-vous (`schedule_event`) | planifié, annulé | + `appointment_date`, `appointment_time`, `appointment_title`, `appointment_address`, `job_name`, `contract_*` | **AUCUN** (E-37) |
| deal | entre dans une étape, sans mouvement | client + `deal_stage`, `deal_stage_en`, `deal_source`, `deal_jours_dans_etape` | client, deal |
| appel reçu (webhook) | adresse d'appel | entreprise seulement | aucun |

`review_link` et `survey_url` n'existent que pendant l'action « Demander un avis ». Rien pour : solde dû, jours de
retard, courriel de l'entreprise, technicien.

### 3.3 Les listes côté éditeur (toutes différentes)

| Liste | Fichier | Contenu | Utilisée par |
|---|---|---|---|
| `VARIABLES` | `src/components/automations/PanneauEtape.tsx:124-131` | 6 raccourcis | panneau d'étape (« Insérer une information du client ») |
| `variablesSysteme()` | `src/components/champs/automatisations.tsx:29-31` → `champsSysteme` (`src/lib/champs/standard.ts:249-251`) | 90 champs de formulaire, 5 objets | « Champs de base » du panneau ; palette de courriel de la liste |
| champs personnalisés | `useChampsTous` (`automatisations.tsx:33-43`) | tous les champs non archivés (hors propriété) | panneau, palette de courriel |
| `VARIABLES_PROPOSEES` | `src/lib/emailBodyText.ts:194-203` | 8 raccourcis | éditeurs de texto et de courriel de la liste |
| `VARIABLES_CONNUES` | `src/lib/emailBodyText.ts:218-232` | 35 clés à crochets | détecteur `variablesInconnues` ; consigne de Lumi (`server/lib/lumi/generer-parcours.ts:399`) |
| `VARIABLES_POINTEES_CONNUES` | `src/lib/emailBodyText.ts:243-250` | 18 variables pointées | détecteur |
| `VARIABLES_PAR_TYPE` | `src/lib/variablesCourriel.ts:48-90` | par modèle de courriel de l'entreprise (facture, soumission…) | Réglages → Modèles de courriel (hors automatisations) |
| valeurs calculées | `server/lib/champs/variablesSysteme.ts` | une fonction par objet | moteur (`variablesChamps`, `server/lib/champs/service.ts:532-555`) |

### 3.4 Où l'on écrit un message automatisé (cinq endroits)

| Écran | Composant | Compteur | Palette | Aperçu |
|---|---|---|---|---|
| Éditeur → étape texto / courriel | `PanneauEtape.tsx` + `ChampAction.tsx:92-110` | « n / 1600 », « N SMS » dès 2 | 6 + 90 repliés + champs perso ; à la fin du texte ; sans recherche | bouton « Aperçu » de la barre du haut |
| Liste → texto d'une règle à l'ancien format | `MessageEditor.tsx` | « n caractères », « N SMS » dès 2 | 8 boutons | « Le client lira : » en direct, valeurs d'exemple |
| Liste → courriel | `EmailPreviewEditor.tsx:682-714` | — | 108 boutons, recherche | onglet « Aperçu réel » |
| Réglages → Messagerie SMS | `src/pages/SettingsMessaging.tsx:582-594` | « n / 320 » | texte « Variables disponibles » | — |
| Réglages → Avis clients | `src/pages/SettingsReviews.tsx:581-592`, `:700-706` | « n/320 » ou rien | texte | aperçu du texto d'avis |

## 4. Langue et expéditeur

- Langue : `company_settings.default_language` → `langueOrg` (`E:632-651`, cache 5 min) → `ctx.langue` (`E:974`, `E:2392`) → `champLocalise` (`A:210-216` : `<champ>_en` si anglais et non vide). Rien par client, rien par automatisation.
- Texto : `from` = numéro du bureau (`getOrgSmsFromNumber`, `A:1624-1635`) ; mention « Répondez STOP » ajoutée aux envois commerciaux (`A:1616-1618`).
- Courriel : `senderForOrg` (`server/routes/emails.ts:263`) — nom = `from_name` de l'étape, sinon nom de l'entreprise, sinon nom du bureau ; adresse = `<nom-en-minuscules>@<domaine de la plateforme>` sauf domaine vérifié ; réponse = `reply_to` de l'étape, sinon courriel de l'entreprise, sinon courriel du propriétaire (`A:1455-1467`). Gabarit : `buildEmailLayout` → `server/lib/courriels/gabarit.ts`. Désabonnement : pied + `List-Unsubscribe` si l'envoi est commercial (`A:1414`, `A:1439-1443`, `A:1496-1503`).

## 5. Mes fichiers

Tests (`D:/lume-final/wt-e/tests/automations-finale/e/`) :
`vitest.config.ts` · `unitaires/e-gabarit-variables.test.ts` · `unitaires/e-segments-texto.test.ts` ·
`unitaires/e-prototype-conceptions.test.ts` · `composants/e-inserer-un-champ.test.tsx` ·
`integration/outils-e.ts` · `integration/e-ciblage.test.ts` · `integration/e-doublons.test.ts` ·
`integration/e-variables-moteur.test.ts` · `integration/e-langue-expediteur.test.ts`.

Scripts (`D:/lume-final/wt-e/scripts/qa/finale/e/`) :
`semer-bureau.mts` (bureau A comme une vraie entreprise) · `charge-5000-clients.sql` (bureau B) ·
`mesure-compteur-ciblage.mts` · `prototype-ciblage.ts` · `prototype-doublons.ts` ·
`analyse-similarite-prereglages.mts` · `releve-inserer-champ.mts` · `releve-doublon-et-compteurs.mts` ·
`releve-panneau-declencheur.mts` · `releve-variables-par-entite.mts` · `lumi-variables-essai.mts`.

Sorties (`D:/lume-final/sorties/e/`) : les JSON du même nom, `suite-e.txt`, 30 captures.

Données laissées dans la pile locale : bureau A (e) semé (5 fiches marquées `[E-SEME]`, avis clients activés) ;
bureau B (e) : 5 000 clients `E-CHARGE n`, 3 000 étiquettes, 4 000 valeurs de champs, 151 STOP, 100 désabonnements.
