# Propositions de conception de l'agent E

Trois conceptions (ciblage, doublons, « Insérer un champ ») et une courte liste pour le point 16. Chacune nomme les
fichiers à toucher, pour répartir les corrections sans chevauchement, et les tests rouges qu'elle doit faire passer au
vert. Deux prototypes purs, écrits pendant l'enquête et éprouvés (17 tests verts,
`tests/automations-finale/e/unitaires/e-prototype-conceptions.test.ts`), peuvent être repris tels quels :
`scripts/qa/finale/e/prototype-ciblage.ts` et `scripts/qa/finale/e/prototype-doublons.ts`.

Aucune des trois n'exige de migration de base.

---

## Conception 1 — « Qui est ciblé », bâti sur le moteur de conditions existant

### Le principe en une phrase
Un ciblage est une liste de règles sur **la fiche du client de l'entité** (ses étiquettes, ses champs personnalisés,
quatre champs de sa fiche), jugée par les évaluateurs qui existent déjà (`evaluerCondition` de
`src/lib/champs/filtres.ts` et la comparaison d'étiquettes de `server/lib/etiquettes.ts`), aux trois moments où une
automatisation agit : au déclenchement, avant chaque envoi différé, et quand une autre automatisation la démarre.

### Où ranger le ciblage : `automation_rules.conditions.ciblage`
Dans `conditions`, pas dans `settings` : c'est là que le moteur lit ce qui décide « cette règle part-elle ? », c'est ce
que copient « Partir d'un modèle », la copie entre bureaux et « Construire avec Lumi », et le journal « règle écartée »
y est déjà branché. `settings` porte le COMMENT (fenêtre d'envoi, ré-entrée) et son schéma est strict.

```jsonc
"conditions": {
  "days_overdue": 3,                      // inchangé : l'occurrence visée
  "ciblage": {
    "inclure": { "mode": "une",           // "toutes" = ET · "une" = OU ; absent ou vide = tous les clients
      "regles": [
        { "type": "etiquette", "valeur": "VIP" },
        { "type": "fiche", "cle": "genre", "op": "is", "value": "entreprise" },
        { "type": "champ", "field_id": "<id d'un champ personnalisé CLIENT>", "op": "is", "value": "Commercial" }
      ] },
    "exclure": [                          // prioritaire : UNE règle vraie suffit à exclure
      { "type": "etiquette", "valeur": "Ne pas relancer" }
    ]
  }
}
```

- `type: "champ"` reprend exactement la forme `Condition` déjà validée (`conditionChampSchema`, `server/lib/validation.ts:1024-1032`) — mais le champ est TOUJOURS un champ de la fiche client, quel que soit le déclencheur (c'est ce qui manque aujourd'hui, constat E-04).
- `type: "fiche"` : `status` (prospect / actif / inactif), `genre` (« entreprise » si un nom de compagnie est saisi, sinon « particulier » — la réponse à « type de client »), `company`, `city`, `lead_source`, `source`. Opérateurs texte de `filtres.ts`.
- Bornes : 10 règles d'inclusion, 10 d'exclusion.
- **Compatibilité, sans migration de données** : à la lecture, `client_a_etiquette: X` vaut une règle d'inclusion, `client_sans_etiquette: Y` une règle d'exclusion (fonction `lireCiblage(conditions)`). L'éditeur réécrit la règle au nouveau format la première fois qu'on enregistre la section. `champs_perso` (filtre sur la fiche de l'événement) reste tel quel.

### Évaluation
Cœur pur partagé (client + serveur) : `evaluerCiblage(ciblage, fiche, ctx) → { cible, raison }` — le prototype. Côté
serveur, `ciblageOk(supabase, orgId, entityType, entityId, conditions)` : `clientDeLEntite` → une lecture de la fiche,
une de `client_tags`, une des valeurs des seuls champs cités (`lireValeursLot`) ; fiche sans client → hors ciblage dès
qu'un ciblage est posé (même règle que les étiquettes aujourd'hui) ; lecture ratée → hors ciblage + trace d'erreur.

| Moment | Où | Aujourd'hui | Avec le ciblage |
|---|---|---|---|
| déclenchement | `handleEvent`, `E:1482-1487` | étiquettes seulement | `ciblageOk` remplace l'appel `conditionsEtiquettesOk` |
| avant chaque action de message d'une tâche différée | `processScheduledTasks`, à côté des conditions de sortie (`checkStopConditions`, `E:2870`) | rien (E-05) | hors ciblage → tâche close « annulée », parcours arrêté, journal |
| « Démarrer une automatisation » | `demarrerRegle`, `E:1588-1612` | rien (E-06) | hors ciblage → rien ne démarre, journal |

Toujours exclus, sans figurer dans le ciblage et sans pouvoir être retirés :
- désabonnés et STOP, par canal — déjà dans `executeSendEmail` / `executeSendSms` (décision E-11 à prendre pour le drapeau « par canal ») ;
- « Aucune demande d'avis (noreview) » pour toute étape de demande d'avis — `estDemandeDAvis(regle, etape)` : action `request_review`, OU texte citant `google_review_url` / `facebook_review_url` / `review_page_url` / `review_link` / `survey_url`, OU préréglage d'avis (constat E-17).

### Journal
`journaliserRegleEcartee` (`E:395-423`) reçoit la raison rendue par l'évaluateur :
`result_data = { saute: "Ignoré : hors ciblage — exclu par l'étiquette « Ne pas relancer »", saute_code: "hors_ciblage" }`
(toujours `result_success: true`, `action_type: 'conditions'` au déclenchement ; le type de l'action pour une tâche
différée). Les filtres d'événement gardent « Conditions non remplies : … ».

### Compteur « Touche X clients » et aperçu
`POST /api/automations/ciblage/apercu` `{ ciblage, canaux: ["sms","email"], demande_avis }` →
`{ total, dont: { stop_texto, desabonnes_courriel, sans_telephone, sans_courriel, sans_avis }, apercu: [20 clients], tronque }`.
Calcul EN MÉMOIRE par le même `evaluerCiblage` que l'exécution : le compteur ne peut pas dire autre chose que le moteur.

Mesuré sur 5 000 clients fictifs (`scripts/qa/finale/e/mesure-compteur-ciblage.mts`, pile locale) :

| Scénario | Touche | dont STOP | SQL (1 requête) | En mémoire | Lectures |
|---|---|---|---|---|---|
| Tous les clients | 5 000 | 151 | 132 ms | 155 ms | 6 |
| Étiquette VIP | 1 500 | 45 | 70 ms | 190 ms | 10 |
| VIP OU Commercial, SAUF « Ne pas relancer » | 2 000 | 60 | 67 ms | 238 ms | 10 |
| VIP ET « Référé par » = Facebook | 500 | 15 | 49 ms | 275 ms | 14 |
| Entreprise, pas un prospect, SAUF « noreview » | 643 | 20 | 45 ms | 135 ms | 7 |

Les deux méthodes rendent le même nombre. Recommandation : en mémoire (aucune migration, un seul évaluateur), avec un
délai de 300 ms sur la saisie et un plafond de 20 000 fiches (au-delà : « plus de 20 000 clients », et la requête SQL
du script devient une fonction en base — une migration, plus tard si un bureau en a besoin).

### Écran : section « Qui est ciblé » du panneau du déclencheur
```
Qui est ciblé
(•) Tous les clients          ( ) Seulement certains clients
    Inclure les clients qui remplissent  [au moins une ▾]  de ces conditions
      [Étiquette ▾] [est ▾] [VIP ▾]                              ✕
      [Type de client ▾] [est ▾] [Entreprise ▾]                  ✕
      + Ajouter une condition
    Toujours exclure
      [Étiquette ▾] [est ▾] [Ne pas relancer ▾]                  ✕
      + Ajouter une exclusion
🔒 Toujours exclus : les clients désabonnés ou qui ont répondu STOP
🔒 (demande d'avis) les clients « Aucune demande d'avis »
Touche 2 000 clients · 60 ne recevront pas de texto (STOP)      Voir la liste
```
Les deux listes d'étiquettes actuelles disparaissent (elles deviennent des lignes). « Filtres » (champs de la fiche de
l'événement) reste, renommé « Seulement si ce devis / cette facture… ».

### Lumi
Le générateur de parcours accepte `ciblage` dans sa réponse et la consigne dit comment l'écrire (« seulement mes clients
VIP » → une règle d'étiquette) ; un outil de clavardage « changer le ciblage d'une automatisation » passe par la même
route de modification. Le résumé de Lumi cite le compteur (« touche 1 500 clients »).

### Fichiers
| Fichier | Changement |
|---|---|
| **nouveau** `src/lib/automationCiblage.ts` | types, `lireCiblage`, `evaluerCiblage`, `ciblagesSeChevauchent`, libellés (reprise du prototype) |
| **nouveau** `server/lib/automations-ciblage.ts` | `ciblageOk`, chargement de la fiche, `apercuCiblage` |
| `server/lib/validation.ts` | `ciblage` accepté sous `conditions` (schéma dédié) |
| `server/lib/automationEngine.ts` | trois appels + journal `hors_ciblage` (**même zone que le point 9 : une seule main**) |
| `server/lib/reviews.ts`, `server/lib/actions/index.ts` (`:3259-3270`) | `estDemandeDAvis` |
| `server/routes/automation-rules.ts` | route d'aperçu ; ciblage gardé à la copie, au changement de déclencheur |
| `src/components/automations/PanneauDeclencheur.tsx` + **nouveau** `src/components/automations/SectionCiblage.tsx` | la section |
| `src/lib/automationCatalogue.ts` (`:493-518`) | retrait des deux champs d'étiquette ajoutés d'office ; code de saut `hors_ciblage` |
| `src/lib/automationBuilderApi.ts` | appel de l'aperçu |
| `server/lib/lumi/generer-parcours.ts`, `server/lib/agent/tools-reglages.ts` | Lumi lit et écrit le ciblage (zones du coordinateur) |

Tests qui passent au vert : `e-ciblage.test.ts` `[E-03]`, `[E-04]` (le premier), `[E-05]`, `[E-06]`, `[E-07]`, `[E-17]`.
Le second `[E-04]` (un `champs_perso` sur un champ d'un autre objet) doit devenir un REFUS à l'enregistrement plutôt
qu'une règle muette : à réécrire en ce sens au moment du correctif.

---

## Conception 2 — Doublons : avertir, et un seul envoi

### 2a. Avertir à la création et à la publication
`conflitsDePublication(client, orgId, regle)` (nouveau `server/lib/automations-conflits.ts`) rend les automatisations
PUBLIÉES du bureau qui remplissent les quatre conditions :
1. même `trigger_event` ;
2. même occurrence : les clés de `CLES_DE_CIBLAGE` (`E:333-347`) égales ou absentes d'un côté (« 3 jours de retard » et « 15 jours de retard » ne sont pas en conflit) ;
3. au moins un canal client en commun (`send_sms`, `send_email` ; `request_review` compte pour les deux) ;
4. ciblages qui se chevauchent — `ciblagesSeChevauchent` : « oui » sauf quand on peut prouver le contraire (l'un exige une étiquette que l'autre exclut).

Branchements :
- `GET /api/automations/rules/:id/conflits` appelé par l'éditeur AVANT d'ouvrir la confirmation de publication ; le texte s'ajoute aux avertissements déjà affichés (`src/pages/AutomationBuilderPage.tsx:1285`, `:1319`) : « ⚠ « Relance de facture — 3, 7, 14 et 30 jours » envoie déjà un texto aux mêmes clients sur ce déclencheur. Les deux partiront : un message identique ne sera envoyé qu'une fois. » ;
- la route de publication (`changerPublication`, `server/lib/automations-publication.ts`) rend `avertissements` — pour la liste (`src/pages/Automations.tsx`) et pour Lumi ;
- `server/lib/lumi/deja-publiees.ts` appelle la même fonction (fini les fausses alertes sur des ciblages disjoints, constat E-29) ; les outils de Lumi qui publient ou créent relaient l'avertissement.
Jamais bloquant.

### 2b. Un seul envoi : la garde au point d'envoi
Nouveau `server/lib/actions/doublons.ts` (reprise de `prototype-doublons.ts`), appelé dans `executeSendEmail` et
`executeSendSms` à l'endroit exact de la garde « déjà envoyé » (`A:1477-1479`, `A:1643-1645`) — donc aussi pour une
demande d'avis, qui passe par ces deux fonctions.

**« Le même message »**, pour un même destinataire et un même canal, dans la fenêtre :
1. même texte une fois normalisé (casse, accents, ponctuation, espaces ; un lien vaut « lien ») — quelle que soit la fiche ;
2. OU même fiche (même facture, même devis, même rendez-vous…) ET similarité ≥ 0,8 sur les mots utiles ;
3. OU même fiche, même déclencheur ET même lien public (`/invoice/…`, `/quote/…`, `/pay/…`, `/survey/…`) — la reformulation lourde d'une relance.

Jamais entre deux envois de la MÊME automatisation (une suite « la veille » puis « 2 h avant » est voulue).

**Pourquoi pas de faux positif** (`scripts/qa/finale/e/analyse-similarite-prereglages.mts`, 87 messages fournis par
Lume, 1 839 paires différentes) : entre deux messages de familles différentes, la similarité ne dépasse jamais 0,63 ;
les 23 paires au-dessus de 0,8 sont toutes un préréglage et sa reprise dans le pack de base, ou deux relances de la
même famille. Cas tranchés par un test : deux factures différentes en retard le même jour → les deux partent (fiches
différentes) ; relance le matin et reçu de paiement l'après-midi, même lien → les deux partent (déclencheurs
différents) ; merci + demande d'avis après la même job → les deux partent.

**Fenêtre par défaut : 24 h** (`AUTOMATION_FENETRE_DOUBLON_HEURES`), glissante, par destinataire et par canal.

**Mécanisme**
1. Lire les envois d'automatisation réussis des 24 dernières heures vers ce destinataire sur ce canal : `automation_execution_logs` (index `idx_execution_logs_org (org_id, created_at desc)` déjà là), filtrés sur `result_data->'envoi'->>'a'` (empreinte du destinataire). Pour cela, chaque envoi réussi garde dans son journal `envoi: { a, e: empreinte du texte, t: texte normalisé (600 caractères au plus), fiche, declencheur }` — le corps d'un courriel n'est gardé nulle part aujourd'hui.
2. `estDoublon(...)` → `saute("Ignoré : doublon de « <nom de l'autre automatisation> », envoyé à 14 h 02", 'doublon')` : `result_success: true`, compté dans « Sautés », le parcours continue.
3. Deux consommateurs en même temps (test `[E-27]`) : avant d'envoyer, réserver par une ligne à clé unique `doublon:<canal>:<a>:<e>:<jour>` — l'index unique `idx_execution_logs_immediat_dedup (org_id, execution_key) where scheduled_task_id is null` existe déjà ; l'insertion refusée (23505) = doublon. Cette ligne technique porte `action_type: 'reservation'` et doit être ignorée des compteurs et de l'onglet Journaux, comme `'conditions'` aujourd'hui (agent D).
   Variante si on préfère ne pas ajouter de lignes au journal : une petite table dédiée `automation_envois_recents` (clé primaire org, canal, destinataire, empreinte, jour) — c'est une migration (non destructive).
4. Une lecture ratée → on envoie (comme le plafond : un message de trop vaut mieux qu'une relance perdue), avec une trace d'erreur.

Ce que ça remplace ou laisse en place : la garde « déjà envoyé » des reprises reste (elle protège la même règle) ; la
règle « une relance de facture par 20 h » (`E:770-809`) devient un cas particulier et peut rester ; le plafond de 3 par
24 h reste, un doublon ignoré ne compte pas dedans.

### Fichiers
| Fichier | Changement |
|---|---|
| **nouveau** `server/lib/actions/doublons.ts` | normalisation, similarité, `estDoublon`, lecture + réservation |
| `server/lib/actions/index.ts` | deux appels (`:1477`, `:1643`), `CodeSaut 'doublon'`, `data.envoi` dans le résultat ; `ctx.declencheur`, `ctx.nomRegle` |
| `server/lib/automationEngine.ts` | passer le déclencheur et le nom de la règle dans le contexte (`:958-1000`, `:2385-2420`) |
| **nouveau** `server/lib/automations-conflits.ts` | `conflitsDePublication` |
| `server/lib/automations-publication.ts`, `server/routes/automation-rules.ts` | `avertissements`, route `conflits` |
| `server/lib/lumi/deja-publiees.ts` | s'appuie sur `conflitsDePublication` |
| `src/pages/AutomationBuilderPage.tsx`, `src/pages/Automations.tsx`, `src/lib/automationBuilderApi.ts` | afficher l'avertissement avant de publier |
| `src/lib/automationCatalogue.ts` + écran Journaux (agent D) | libellé « Ignoré : doublon », ligne `reservation` masquée |

Tests qui passent au vert : `e-doublons.test.ts` `[E-20]`, `[E-21]`, `[E-22]`, `[E-27]`, `[E-28]`, `[E-29]` ; les
témoins `[E-23]` à `[E-26]` doivent rester verts.

---

## Conception 3 — « Insérer un champ » : un catalogue unique, contextuel, sûr

### Un seul catalogue : `src/lib/automationVariables.ts` (nouveau)
Une entrée par variable : `{ jeton, groupe, fr, en, entites, exemple, source }`. Il remplace les sept listes
d'aujourd'hui (`E-carte.md` § 3.3) et sert à cinq usages : la palette, l'aperçu en direct, le détecteur de variables
inconnues, le contrôle du serveur, la consigne de Lumi. Un test de parité le croise avec ce que
`resolveEntityVariables` remplit vraiment (il existe déjà pour `VARIABLES_CONNUES` : l'étendre).

### La liste cible « Champs de base »

| Groupe | Libellé | Variable | État |
|---|---|---|---|
| Client | Prénom | `[client_first_name]` | existe (repli : compagnie, puis nom complet) |
| Client | Nom | `[client_last_name]` | existe |
| Client | Nom complet | `[client_name]` | existe |
| Entreprise | Nom | `[company_name]` | existe |
| Entreprise | Téléphone | `[company_phone]` | existe |
| Entreprise | Courriel | `[company_email]` | **À CRÉER** (`company_settings.email`) |
| Facture | Numéro | `[invoice_number]` | existe |
| Facture | Montant | `[invoice_total]` | existe |
| Facture | Solde dû | `[invoice_balance]` | **À CRÉER** (`invoices.balance_cents`) |
| Facture | Date d'échéance | `[invoice_due_date]` | existe (« 15 octobre 2026 ») |
| Facture | Jours de retard | `[invoice_days_overdue]` | **À CRÉER** (aujourd'hui − échéance, fuseau de l'entreprise ; vide si pas en retard) |
| Facture | Lien de paiement | `[invoice_link]` | existe (page publique de la facture, bouton de paiement) |
| Job | Date | `[appointment_date]` | existe sur un rendez-vous ; sur un job : **À CRÉER** (prochaine visite — la valeur existe déjà sous `{{job.visits}}`) |
| Job | Heure | `[appointment_time]` | idem (`{{job.visit_start_time}}`) |
| Job | Adresse | `[appointment_address]` | idem (`{{job.property}}`) |
| Job | Technicien | `[technician_name]` | **À CRÉER** (`schedule_events.assigned_user`, sinon `jobs.assigned_user_id`, sinon le nom de l'équipe) |
| Devis | Numéro | `[quote_number]` | existe |
| Devis | Montant | `[quote_total]` | existe |
| Devis | Lien | `[quote_link]` | existe |

Hors « Champs de base », dans un groupe replié « Plus » : titre du job, validité du devis, liens d'avis, contrat,
dépôt, étape du pipeline.

### Règle de contexte par déclencheur
La palette n'offre que ce qui aura une valeur (`ENTITE_PAR_DECLENCHEUR`, `src/lib/automationCatalogue.ts`) :

| Fiche de l'événement | Groupes offerts |
|---|---|
| client, prospect | Client, Entreprise |
| devis | Client, Entreprise, Devis (+ Job si le devis en a un) |
| facture | Client, Entreprise, Facture (+ Job) |
| job | Client, Entreprise, Job |
| rendez-vous | Client, Entreprise, Job |
| deal | Client, Entreprise, Pipeline |
| appel reçu (webhook) | Entreprise |

Une variable hors contexte écrite à la main est signalée (« [invoice_link] n'a pas de valeur sur “Nouveau prospect” »).
Correctif moteur associé : sur un rendez-vous, remplir les champs de fiche du client et du job (constat E-37,
`server/lib/actions/index.ts:1181-1204`).

### Section « Champs personnalisés »
Titrée, séparée, sous « Champs de base ». Seulement les champs des fiches offertes par le contexte. Exclus par défaut :
- les cases à cocher et les fichiers ;
- les champs sensibles : `code_acces`, `instructions_acces`, `code_alarme`, et tout champ de type paragraphe — jusqu'à ce que l'entreprise coche « Proposer dans les messages » sur le champ (`config.dans_messages`, lu comme `false` par défaut pour ces cas, `true` pour les autres) ;
- côté champs de formulaire : les notes internes, les cases à cocher, les champs techniques (liste dans le catalogue).
Une variable déjà écrite dans une règle continue d'être remplie : on retire de la palette, pas du moteur.

### Insertion
- au curseur du dernier champ de texte actif (objet, aperçu ou message), le curseur placé après la variable ;
- un champ de recherche (sans accents ni casse, sur le libellé et le jeton) ;
- une seule écriture affichée dans le texte ;
- la même palette (`PaletteChamps`) dans le panneau d'étape, l'éditeur de texto de la liste et l'éditeur de courriel.

### Aperçu en direct
Sous la zone de texte : « Le client lira : … » (il existe déjà dans l'éditeur de texto de la liste, avec des valeurs
d'exemple). Cible : les valeurs d'un VRAI client du bureau — la route `POST /api/automations/rules/:id/apercu` existe
(bouton « Aperçu ») ; l'appeler avec le texte en cours, 500 ms après la dernière frappe. Le compteur de SMS compte CE
texte (constat E-61).

### Valeur de remplacement
`[client_first_name|là]`, `{client_first_name|là}`, `{{client.first_name|cher client}}` : si la valeur est vide, le
texte après `|` (60 caractères au plus, sans crochet ni accolade), échappé comme une valeur dans un courriel. Un bouton
« Si vide : … » dans la palette l'écrit pour l'utilisateur. Le repli actuel du prénom (compagnie, nom complet) reste
appliqué AVANT le remplacement.

### Variable inconnue
- en frappe et à l'enregistrement d'un brouillon : avertissement qui nomme la variable (comme aujourd'hui, mais complet : champs de fiche inexistants, clés accentuées, hors contexte) ;
- **à la publication : refus** (« Étape “Courriel de relance” : [prenom_du_client] n'existe pas »), dans `problemesPublication` (partagé éditeur / serveur) ;
- à la modification d'une règle PUBLIÉE : refus aussi (le garde-fou « publiée cassée » existe : `messagePublieeCassee`) ;
- le serveur applique le même contrôle (`server/routes/automation-rules.ts`), avec la liste des champs du bureau.

### Rendu
Rien à changer : accents et caractères spéciaux intacts, valeurs échappées dans le HTML d'un courriel, une seule passe
(témoins `[E-40]` à `[E-42]`, suite existante `[F-070]`, `[F-071]`). À ajouter : à l'envoi d'un texto, remplacer les
signes typographiques qui ont un jumeau dans l'alphabet des textos (constat E-61).

### Lumi
La consigne (`server/lib/lumi/generer-parcours.ts:399`) lit le catalogue : mêmes variables, valeur de remplacement
permise, « solde », « jours de retard » disponibles ; son contrôle des variables inventées (`:824`) appelle le même
détecteur, avec le déclencheur.

### Fichiers
| Fichier | Changement |
|---|---|
| **nouveau** `src/lib/automationVariables.ts` | le catalogue, `variablesPour(declencheur, champsDuBureau)`, `variablesInconnues` (déplacé de `emailBodyText.ts`), exemples |
| **nouveau** `src/components/automations/PaletteChamps.tsx` | la palette (recherche, sections, insertion au curseur, « Si vide ») |
| `src/components/automations/PanneauEtape.tsx` (`:124-131`, `:306-316`, `:556-600`) | brancher la palette, le détecteur complet, l'aperçu |
| `src/components/automations/ChampAction.tsx` | exposer le champ actif et la sélection ; compteur sur le texte rendu |
| `src/components/automations/MessageEditor.tsx`, `EmailPreviewEditor.tsx` | même palette |
| `src/components/champs/automatisations.tsx` (`:29-31`, `:326-356`, `:389-413`) | retirer `BoutonsVariablesChamps` et ses listes au profit du catalogue |
| `src/lib/emailBodyText.ts`, `src/lib/variablesCourriel.ts` | listes remplacées par le catalogue ; aperçus avec valeur de remplacement |
| `server/lib/actions/index.ts` | `resolveTemplate` (`:601-637`) : `|remplacement` ; variables À CRÉER (`:806-1208`) ; champs de fiche sur un rendez-vous (`:1181-1204`) |
| `server/lib/champs/variablesSysteme.ts` | `balance` de la facture |
| `src/lib/publicationAutomatisation.ts`, `server/routes/automation-rules.ts`, `server/lib/automations-validation-messages.ts` | refus à la publication |
| `server/lib/lumi/generer-parcours.ts` | consigne et contrôle sur le catalogue (zone du coordinateur) |
| `src/lib/champs/types.ts`, écran Réglages → Champs personnalisés | `config.dans_messages` |

Tests qui passent au vert : `e-inserer-un-champ.test.tsx` `[E-30]` à `[E-36]` ; `e-gabarit-variables.test.ts` `[E-44]`
à `[E-47]`, `[E-49]` ; `e-variables-moteur.test.ts` `[E-37]`, `[E-39]`. `[E-45]` exprime un refus à l'enregistrement
du schéma : si la décision est « refus à la publication seulement », l'adapter à `problemesPublication`.

---

## Point 16 — corrections courtes

| Constat | Correction | Fichiers |
|---|---|---|
| E-61 compteur de SMS | compter le texte rendu (variables d'exemple ou du vrai client, mention STOP si commercial), afficher toujours « N caractères · N SMS », nommer le caractère qui fait basculer ; translittération des signes typographiques à l'envoi ; consigne de Lumi | `src/lib/smsSegments.ts`, `ChampAction.tsx`, `MessageEditor.tsx`, `server/lib/actions/index.ts`, `server/lib/lumi/generer-parcours.ts`, `src/lib/automationCatalogue.ts:811` |
| E-64 compteur absent | même compteur dans Réglages → Messagerie et Avis clients | `src/pages/SettingsMessaging.tsx`, `src/pages/SettingsReviews.tsx` |
| E-66 plafond = échec | le rendre comme un saut « Ignoré : plafond de 3 messages par 24 h » | `server/lib/actions/index.ts` (+ tests F-080, F-081 à faire suivre) |
| E-52 langue du client | décision : si voulue, colonne `clients.langue` (migration) lue pour `ctx.langue` | `server/lib/automationEngine.ts`, fiche client |
| E-11 STOP sous le drapeau « par canal » | décision : aucun texto vers un numéro de `sms_opt_outs`, drapeau ou non | `server/lib/actions/index.ts:1584-1590` (+ test G-011 à faire suivre) |

## Répartition suggérée (sans chevauchement de fichiers)

- **Moteur** (une seule main, avec le point 9) : `automationEngine.ts`, `actions/index.ts`, `actions/doublons.ts`, `automations-ciblage.ts`, `reviews.ts`, `champs/variablesSysteme.ts`.
- **Serveur, routes et validation** : `validation.ts`, `routes/automation-rules.ts`, `automations-publication.ts`, `automations-conflits.ts`, `automations-validation-messages.ts`, `lumi/deja-publiees.ts`.
- **Éditeur, panneau du déclencheur** : `PanneauDeclencheur.tsx`, `SectionCiblage.tsx`, `automationCiblage.ts`, `automationCatalogue.ts`.
- **Éditeur, messages** : `automationVariables.ts`, `PaletteChamps.tsx`, `PanneauEtape.tsx`, `ChampAction.tsx`, `MessageEditor.tsx`, `EmailPreviewEditor.tsx`, `champs/automatisations.tsx`, `emailBodyText.ts`, `variablesCourriel.ts`, `smsSegments.ts`, `SettingsMessaging.tsx`, `SettingsReviews.tsx`.
- **Publication et liste** : `AutomationBuilderPage.tsx`, `Automations.tsx`, `publicationAutomatisation.ts`, `automationBuilderApi.ts`.
- **Lumi** (coordinateur / agent A) : `lumi/generer-parcours.ts`, `agent/tools-reglages.ts`.
