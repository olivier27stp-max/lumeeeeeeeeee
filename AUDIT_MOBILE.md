# Audit mobile — champs personnalisés + parité des pages

**Date :** 2026-09-30 · **Dépôt mobile :** `/Users/williamhebert/Projects/lumeeeeeeeeee` (branche `mobile-app`)
**Base de test :** staging `boylnjjlhexljmddmjyg` — aucune donnée client réelle touchée.

---

## Ce que cet audit vaut, et ce qu'il ne vaut pas

**L'appareil n'a jamais rejoint Metro pendant la session.** Tout ce qui demande de manipuler l'app — hors ligne, clavier, safe area, rendu iPhone SE, navigation réelle — **n'a pas pu être vérifié**. Je ne l'ai pas deviné : c'est marqué ⚠️ partout où c'est le cas.

Ce qui **a** été vérifié l'a été par deux moyens solides :

1. **Croisement mécanique code ↔ catalogue réel de la base** (la méthode qui a trouvé les vrais bugs de ce projet). 167 fichiers mobiles, 276 relations, 189 contraintes CHECK.
2. **Lecture du contrat serveur** (`server/routes/custom-fields.ts`, `server/lib/champs/service.ts`) et des policies RLS en base.

Un ✅ ci-dessous veut dire « prouvé par le code ou par la base », jamais « ça a l'air correct ».

---

## Résumé en trois phrases

Les champs personnalisés du mobile étaient **entièrement morts, et morts en silence**, depuis la refonte GoHighLevel du 26 septembre : le mobile lisait deux tables déplacées dans le schéma `archive`, PostgREST répondait 404, et la carte disparaissait sans message. C'est **corrigé** : le mobile passe maintenant par les routes serveur, comme le web, donc validation, unicité, permissions et automatisations restent au serveur. Le reste de la couche de données mobile est **sain** (0 écart de colonne sur 167 fichiers, 2 tables mortes et c'étaient celles-là).

---

# Volet A — Champs personnalisés

## A.1 Mécanique : comment le mobile obtient les définitions

### Avant (cassé)

| | |
|---|---|
| Source | PostgREST direct, tables `custom_columns` / `custom_column_values` |
| État de ces tables | **Déplacées dans le schéma `archive`** le 2026-09-26 (`archive.custom_columns_`) |
| Réponse réelle | `404 — Could not find the table 'public.custom_columns' in the schema cache` |
| Symptôme visible | **Aucun.** `CustomFieldsCard` faisait `if (!columns …) return null` : l'erreur n'était jamais affichée, la carte s'évaporait |

C'est le scénario exact décrit dans `CLAUDE.md` : supabase-js ne lève pas, donc la fonctionnalité meurt sans bruit.

**Preuve** (staging, service_role) :

```
404  custom_columns           Could not find the table 'public.custom_columns'
404  custom_column_values     Could not find the table 'public.custom_column_values'
200  custom_fields            OK
200  custom_field_values      OK
200  custom_field_options     OK
200  custom_field_folders     OK
```

### Après (corrigé)

| | |
|---|---|
| Source | `GET /api/custom-values/:objet/:id` → `{ fields, folders, values }` |
| Écriture | `PUT /api/custom-values/:objet/:id` → `{ results: [{ ok, changed, conflict, version, erreur }] }` |
| Transport | `serverGet` / `serverPut` existants : `Authorization: Bearer` + `x-org-id`, rafraîchissement du jeton inclus |
| Validation, unicité, RBAC, automatisations | **Au serveur.** Le mobile ne décide rien |
| Cache | react-query, clé `['champs-perso', objet, recordId]`, invalidée après chaque écriture effective |

**Un changement fait au bureau apparaît-il sans réinstallation ?** Oui — au prochain montage de la fiche (comportement react-query par défaut). Il n'y a **ni realtime ni refetch au retour au premier plan** sur les champs : si la fiche est déjà ouverte à l'écran quand la définition change au bureau, il faut en sortir et y revenir. Le web ne fait pas mieux. ⚠️ non mesuré sur appareil.

## A.2 Le modèle réel (la baseline mentait)

`supabase/baseline/01_schema.sql` a été régénérée le **25** septembre, la refonte livrée le **26** : la baseline est périmée pour cette fonctionnalité. Valeurs prises **dans la base réelle** :

- `cf_field_type` — **12** : `single_line`, `multi_line`, `number`, `monetary`, `date`, `dropdown_single`, `dropdown_multi`, `checkbox`, `phone`, `email`, `url`, `file`
- `cf_object_type` — **6** : `client`, `deal`, `job`, `quote`, `invoice`, `property`

Le mobile connaissait 12 types d'un **autre** vocabulaire (`text`, `status`, `dropdown`, `currency`, `rating`, `label`…). Aucun ne correspondait.

## A.3 Matrice — définitions (web → mobile)

Toutes ces opérations traversent le même chemin : le mobile relit `GET /custom-values/:objet/:id`, qui renvoie les définitions **telles que le serveur les calcule**. Le mobile n'a aucune logique propre à désynchroniser.

| Opération sur le web | Avant | Après | Preuve / réserve |
|---|---|---|---|
| Création d'un champ | ❌ mort | ✅ | Renvoyé par la route, rendu selon `field_type` |
| Renommage (`label`) | ❌ | ✅ | Affiché depuis `label` |
| Changement de `key` | ❌ | ✅ | Le mobile n'utilise jamais la `key`, seulement l'`id` |
| Changement de type | ❌ | ✅ | Rendu piloté par `field_type`, 12 types couverts |
| Ajout / retrait d'options | ❌ | ✅ | `options[]` de la route ; une option **archivée** reste lisible mais n'est plus proposable (`optionsActives`) |
| Réordonnancement | ❌ | ✅ | Tri sur `position`, comme le web |
| Déplacement de dossier | ❌ | ✅ | Regroupement par `folder_id`, dossiers triés sur leur `position` |
| `is_required` | ❌ | ✅ affichage + ⚠️ refus | L'astérisque s'affiche ; **le refus vient du serveur**, pas d'un contrôle mobile (voulu) |
| `is_unique` | ❌ | ✅ | Le serveur refuse le doublon, le message s'affiche sous le champ |
| `is_searchable` | ❌ | s.o. | Pas de recherche par champ perso sur mobile (le web non plus dans cette carte) |
| `masque_creation` | ❌ | ✅ | Un champ que le bureau a sorti de la fenêtre de création n'apparaît pas dans les formulaires mobiles (c'est le cas des 10 champs de dépenses) |
| `default_value` | ❌ | ✅ | Pré-rempli une seule fois par champ à la création, libellé d'option traduit en id comme le web |
| Archivage | ❌ | ✅ | Règle du serveur respectée : **un champ archivé reste visible s'il porte une valeur sur la fiche** |
| Suppression (purge) | ❌ | ✅ | Le champ disparaît de la réponse ; aucun plantage, la carte se recalcule |

**Aucun crash possible sur un champ supprimé ou archivé** : le mobile ne garde plus d'index par `column_id` maison, il rend ce que le serveur renvoie.

## A.4 Matrice — types de champ

| Type | Rendu mobile | Clavier / saisie | Format |
|---|---|---|---|
| `single_line` | champ texte | par défaut | — |
| `multi_line` | champ texte **multiligne** (4 lignes) | par défaut | — |
| `number` | champ numérique | `decimal-pad` | virgule acceptée |
| `monetary` | champ montant | `decimal-pad` | **affiché en dollars, envoyé en cents** |
| `date` | **sélecteur natif** `DateTimePicker` | — | `AAAA-MM-JJ`, ISO si `include_time` |
| `dropdown_single` | pastilles, choix unique, re-clic = désélection | — | envoie l'**id** de l'option |
| `dropdown_multi` | pastilles, choix multiple | — | envoie un **tableau d'ids** |
| `checkbox` | case à cocher | — | booléen |
| `phone` | champ texte | `phone-pad` | — |
| `email` | champ texte | `email-address`, sans majuscule auto | — |
| `url` | champ texte | par défaut, sans majuscule auto | — |
| `file` | **lecture seule** — nom du fichier | — | ❌ téléversement absent : il faut le bucket privé `custom-field-files` et une URL signée. Non décidé, non chiffré. |

**FR/EN :** libellés, `placeholder` et `help_text` viennent de la base (identiques web/mobile). Les messages de refus viennent du serveur, en français, exactement comme sur le web. Les 6 chaînes de l'interface de la carte sont ajoutées dans `fr.ts` **et** `en.ts`.

⚠️ Aucun rendu n'a été vu à l'écran. Le typage compile, la logique est lisible, mais l'apparence n'est pas vérifiée.

## A.5 Matrice — valeurs, dans les deux sens

| Cas | État | Détail |
|---|---|---|
| Valeur changée au bureau → visible sur mobile | ✅ | Relecture à l'ouverture de la fiche |
| Valeur changée sur mobile → visible au bureau | ✅ | Même route, même table, même normalisation |
| **Conflit** (même champ des deux côtés) | ✅ **prévisible** | Le mobile envoie la `version` lue. Si elle est périmée → **409**, rien n'est écrit, la valeur du serveur est reprise et l'utilisateur est prévenu. **Le dernier qui écrit n'écrase plus l'autre en silence.** |
| Refus par champ (obligatoire, unique, hors bornes) | ✅ | 422 ; le message s'affiche **sous le champ**, la saisie reste à l'écran pour être corrigée |
| **Édition hors ligne** | ✅ **en file d'attente** | Voir la correction ci-dessous |

**Hors ligne — ⚠️ CORRECTION d'une erreur de cet audit.** La première version de ce document affirmait que le mobile n'avait « aucune persistance ni file d'attente, zéro occurrence dans tout `src/` ». **C'était faux.** Mon relevé passait par un `| head -15` et les résultats ont été absorbés par les `staleTime` avant d'atteindre le fichier concerné : j'ai présenté une troncature comme un fait.

La vérité : l'infrastructure existe et elle est complète.

| Pièce | Où |
|---|---|
| Cache persistant (AsyncStorage) | `src/lib/queryClient.ts` + `PersistQueryClientProvider` dans `src/app/_layout.tsx` |
| État en ligne branché sur l'appareil | `onlineManager.setEventListener` + NetInfo |
| Mutations en file, **qui survivent à un redémarrage** | `src/lib/offline/registerMutationDefaults.ts` (la fonction vit dans le registre, pas dans la mutation persistée) |
| Reprise au retour du réseau | `queryClient.resumePausedMutations()` |
| Bandeau « hors ligne » | `src/components/OfflineBanner.tsx` |

Étaient déjà en file : démarrer/terminer une job, pointer, les pauses, les événements D2D.

**Ajouté (D2)** : l'écriture d'un champ personnalisé. C'est la seule écriture des champs qu'on pouvait mettre en file **sans risque de doublon**, et la raison est dans le contrat : le `PUT` porte la `version` lue. Si l'écriture est rejouée alors que la valeur a déjà été posée, le serveur répond « conflit » au lieu d'écrire une seconde fois. Une **création** (job, client, devis) n'a pas cette garantie : la mettre en file demanderait une clé d'idempotence côté serveur, donc un changement de contrat d'API partagé — que tes règles interdisent sans ton accord. Les créations échouent donc encore franchement hors ligne, ce qui est le comportement sûr.

## A.6 Conversions

Elles sont assurées par des **déclencheurs en base** — donc identiques pour le web et le mobile, quel que soit le chemin emprunté.

| Conversion | Mécanisme | État |
|---|---|---|
| devis → job | trigger `quotes_cf_copier_vers_job` sur `quotes.job_id` | ✅ |
| job → facture | trigger `invoices_cf_copier_depuis_job` sur `invoices.job_id` | ✅ |
| devis → facture | la route `/quotes/convert-to-invoice` appelle `cf_copier_valeurs` | ✅ |
| deal → job | `cf_copier_valeurs_deal_vers_job` | ✅ |
| **lead → client** | Un lead **EST** une ligne de `clients` (`status='lead'`) : même `client_id`, donc **les valeurs ne bougent pas** | ✅ par construction |
| **lead → job** | Client → job **n'est couvert par aucun déclencheur** — ni sur mobile, **ni sur le web** | ⚠️ parité respectée, comportement à confirmer (**D4**) |

Règle de copie : champ cible de même clé **et** même type, non archivé, encore vide ; une option est retrouvée par son libellé. Une copie ne bloque jamais la conversion.

## A.7 Dépenses — ⚠️ la prémisse de la mission est fausse

Le dossier **« Dépenses »** existe bien (objet `job`, semé dans les 22 entreprises) avec **10 champs `monetary`** : `depense_materiaux`, `depense_carburant`, `depense_sous_traitance`, `depense_outils`, `depense_location`, `depense_consommables`, `depense_elimination`, `depense_permis`, `depense_deplacement`, `depense_autres`.

**Mais rien ne les additionne dans la rentabilité** :

| Vérification | Résultat |
|---|---|
| `rentabilite_jobs` lit-elle `custom_field_values` ? | **non** |
| `rentabilite_jobs` lit-elle `jobs.expenses_cents` ? | **oui — et uniquement ça** |
| `rpc_insights_job_profitability` lit-elle les champs perso ? | **non** |
| Un déclencheur sur `custom_field_values` touche-t-il `expenses_cents` ? | **non** — un seul trigger, `cf_valeur_avant_ecriture`, qui n'y touche pas |
| Du code additionne-t-il les clés `depense_*` ? | **non** |

**Donc ces dépenses ne comptent pas dans la rentabilité — sur le web non plus.** Ce n'est pas un écart de parité mobile : c'est un trou côté produit, des deux côtés. Je n'ai rien construit (ça demanderait une migration). Voir décision **D1**.

## A.8 Isolation et RBAC — ✅ solide

Vérifié en base, pas déduit.

- **4 tables**, policies par commande. Les écritures (`INSERT`/`UPDATE`/`DELETE`) vérifient **`member_has_permission`** — la page Rôles s'applique.
- La lecture des **valeurs** délègue à la RLS de la fiche parente :
  `client_id in (select id from clients) or job_id in (select id from jobs) or …`
  On ne voit donc une valeur **que si on voit déjà la fiche**. L'isolation est transitive et ne peut pas être contournée.
- Une policy `bureau_actif` s'ajoute par-dessus (multi-bureau).

**Conséquence rassurante :** même si le mobile écrivait en direct, il ne pourrait ni traverser un tenant, ni contourner une permission de rôle. La correction renforce quand même la règle en passant par le serveur (validation par type, unicité, automatisations).

---

## A.9 Les champs dans les FORMULAIRES (ajouté après le premier livrable)

Le premier jet de cet audit ne couvrait que les **fiches**. C'était un trou réel :
le web met les champs personnalisés dans ses formulaires de création
(`NewJobModal`, `InvoiceEdit`, tiroir du pipeline), le mobile dans aucun. Un champ
marqué « obligatoire » au bureau était donc **invisible** au technicien qui créait
une job sur son cell — la job se créait avec le champ vide.

Corrigé sur **six écrans** :

| Écran | Comportement |
|---|---|
| Création de client, job, devis, facture | Les champs se remplissent dans le formulaire ; les valeurs sont écrites **après** la création (elles ont besoin de l'id de la fiche). Un champ obligatoire vide **bloque avant** qu'une fiche à moitié remplie existe. |
| Modification de job, de client | La fiche existe déjà : la carte à enregistrement automatique suffit. |

**Deux pièces nouvelles, et pourquoi :**

- `src/components/champs/SaisieChamp.tsx` — la saisie d'un champ, les 12 types,
  **extraite** de `CustomFieldsCard`. La fiche et le formulaire partagent
  désormais le même rendu : un seul endroit à maintenir, donc aucune dérive
  possible entre les deux surfaces. Corrige au passage un défaut d'usage réel :
  les champs numériques gardent un tampon de texte local — sans lui, convertir à
  chaque frappe réaffichait « 12.00 » dès qu'on avait tapé « 12 », ce qui rendait
  « 12,50 » impossible à écrire.
- `src/components/champs/useChampsCreation.tsx` — miroir du hook du web, même
  contrat (`bloc` / `valider()` / `enregistrer(id)`). Il garde les valeurs dans
  une `ref` autant que dans l'état, parce que le bouton « Créer » est pressé dans
  le **même événement** que la sortie du dernier champ texte : une closure
  verrait l'ancienne valeur.

**Où s'arrête la validation, délibérément :** le formulaire ne vérifie que
l'obligatoire manquant. Le format, les bornes et l'unicité restent au serveur,
seule autorité — dupliquer ses règles ici les ferait dériver. Conséquence
assumée : une valeur mal formée n'est refusée qu'à l'écriture, donc après la
création de la fiche.

⚠️ Non vérifié sur appareil, comme tout le reste.

# Volet B — Pages mobiles existantes

## B.1 Inventaire

**49 pages** (hors `_layout`). Onglets : accueil, horaire, clients, D2D, formations, temps, profil, classement des ventes, stats de vente, profil de vente.
Écrans : clients (liste/fiche/nouveau/édition), jobs (fiche/nouveau/édition), devis (nouveau/envoi), factures (nouveau/envoi), leads, tâches, messages, conversation, notifications, paie, commissions, équipe, membre, rep, checklist, cours, maison D2D, recherche, recherche globale, tableau de bord, gamification, classement, parrainage, réglages de vente, configuration des paiements, entreprise, historique technicien, + 3 écrans d'authentification.

## B.2 Vérifications transversales — ce qui a été réellement mesuré

| Contrôle | Résultat |
|---|---|
| **Colonnes / valeurs CHECK / arguments RPC** cités par le code vs base réelle | ✅ **0 écart** sur 167 fichiers |
| **Tables inexistantes** (les 63 tables citées par le mobile) | ❌ **2** : `custom_columns`, `custom_column_values` → **corrigées** |
| **Filtres `.in('status', …)`** (angle mort du détecteur) vs contraintes CHECK | ✅ 8 sur 9 valides — 1 littéral mort (voir B.3) |
| **Mode sombre** | 🟡 jetons et réglage app-wide en place ; 276 couleurs en dur restent (voir D6) |
| **Realtime** | Présent seulement sur messages/conversations (voulu) |
| **Hors ligne** | ✅ cache persistant + file de mutations (constat corrigé — voir A.5) |

## B.3 Problèmes relevés

| # | Problème | Nature | Sévérité | Statut |
|---|---|---|---|---|
| B1 | Champs personnalisés morts (tables archivées), échec **silencieux** | Bug | **Bloquant** | ✅ **corrigé** |
| B2 | Un échec de chargement faisait disparaître la carte sans message | Bug | Majeur | ✅ **corrigé** (état d'erreur + « Réessayer ») |
| B3 | Pas d'écran de **fiche devis** → les champs perso des devis n'ont nulle part où vivre | Feature web manquante | Majeur | ✅ **corrigé** (D3) |
| B4 | `schedule.ts:179` et `:208` filtrent `jobs.status` sur `['draft', 'Draft']` ; `'Draft'` n'existe pas dans la contrainte CHECK | Incohérence | Mineur | ✅ **corrigé** (D5) |
| B5 | Aucun mode sombre dans l'app | Incohérence UI | Mineur | 🟡 **fondation posée, balayage inachevé** (D6) |
| B6 | ~~Aucune édition hors ligne~~ — **constat erroné, corrigé** ; l'infra existait, il manquait les champs perso dans la file | Feature manquante | Mineur | ✅ **corrigé** (D2) |
| B7 | `check:schema-refs` **ne détecte pas une table disparue** (`if table not in cols: continue`) — c'est pourquoi B1 est passé | Bug d'outillage | Majeur | ✅ **corrigé** (D7) |

## B.4 Ce que je n'ai PAS pu vérifier ⚠️

Sans appareil connecté, tout ceci reste ouvert, **page par page** : que chaque bouton fonctionne · états de chargement/vide/erreur · rendu iPhone SE et grand écran · clavier et safe area · comportement hors ligne réel · navigation et liens profonds · parité visuelle avec le web.

Dès que le téléphone rejoint Metro, c'est une seconde passe — et elle est nécessaire avant de considérer le volet B fermé.

---

# Fichiers modifiés

Tous dans `/Users/williamhebert/Projects/lumeeeeeeeeee/mobile` :

| Fichier | Changement |
|---|---|
| `src/lib/api/customFields.ts` | **Réécrit.** Modèle v2, 12 types, 6 objets, passage par les routes serveur, gestion des refus par champ |
| `src/components/CustomFieldsCard.tsx` | **Réécrit.** 12 types, dossiers, sélecteur de date natif, montants en cents, état d'erreur, conflits, messages de refus |
| `src/lib/api/server.ts` | +1 champ `data` sur `ServerError` (additif) pour lire le corps d'un 409/422 |
| `src/lib/i18n/fr.ts` · `src/lib/i18n/en.ts` | +6 clés, **des deux côtés** |
| `src/app/(app)/clients/[id].tsx` · `src/app/(app)/jobs/[id].tsx` | `entity="clients"` → `objet="client"` (idem job) ; la ligne d'un devis ouvre sa fiche |
| `src/app/(app)/quotes/[id].tsx` | **nouveau** — fiche devis (D3) |
| `src/app/(app)/_layout.tsx` | route `quotes/[id]` déclarée |
| `src/components/JobBillingCard.tsx` | la ligne d'un devis ouvre sa fiche ; le bouton « Envoyer » reste séparé |
| `src/lib/api/schedule.ts` | `['draft', 'Draft']` → `.eq('status', 'draft')` (D5) |
| `src/lib/offline/mutationKeys.ts` · `registerMutationDefaults.ts` | + clé `champsPersoEcrire` et son écriture en file (D2) |
| `src/global.css` · `tailwind.config.js` | jetons de couleur clair/sombre, `darkMode: 'class'` (D6) |
| `src/lib/lumi/theme.tsx` | thème hissé au rang d'app entière, pousse `colorScheme` à nativewind (D6) |
| `src/app/_layout.tsx` | fournisseur de thème à la racine + barre d'état qui suit (D6) |
| `src/app/(app)/(tabs)/lumi.tsx` | enveloppe de thème imbriquée retirée (D6) |
| 58 fichiers | `bg-white` → `bg-surface`, `text-white` → `text-onAction` là où le parent s'inverse (D6) |
| `src/components/ui/Input.tsx` · `Button.tsx` | couleurs en valeur lues dans le thème (D6) |
| `src/lib/i18n/fr.ts` · `src/lib/i18n/en.ts` | + section `mobileQuoteDetail`, + `mobileNav.quote`, + `status.changes_requested` |

**Dans le dépôt web** `/Users/williamhebert/Lume desktop/lumeeeeeeeeee` :

| Fichier | Changement |
|---|---|
| `supabase/migrations/20260930120000_depenses_alimentent_expenses_cents.sql` | **nouveau** (D1) — appliqué staging + prod |
| `supabase/migrations/20260930123000_cf_copier_client_vers_job.sql` | **nouveau** (D4) — appliqué staging + prod |
| `scripts/check-schema-refs.py` | détection des tables inexistantes (D7) |

**Deux** migrations, approuvées explicitement, appliquées staging puis prod, empreintes vérifiées identiques. **Aucun** changement de contrat d'API partagé. **Une** nouvelle page (la fiche devis, approuvée). **Aucune** nouvelle dépendance, native ou non.

## Ce qui a été testé

| | |
|---|---|
| `npx tsc --noEmit` | ✅ code 0, zéro erreur |
| `npx eslint` sur les 3 fichiers de code | ✅ code 0, zéro avertissement |
| Existence des tables/colonnes/enums | ✅ contre staging, Management API, lecture seule |
| Contrat des routes | ✅ lu dans `server/routes/custom-fields.ts` + `server/lib/champs/service.ts` |
| Policies RLS | ✅ lues dans `pg_policies` |
| **Exécution sur appareil** | ❌ **jamais** — le téléphone n'a pas rejoint Metro |

Deux erreurs que j'ai faites et corrigées en cours de route, parce qu'elles auraient cassé la parité :
1. Je filtrais **tous** les champs archivés ; le serveur, lui, garde un champ archivé **s'il porte une valeur** sur la fiche. Sans ça, une valeur existante aurait disparu de l'écran.
2. La mutation relisait la valeur dans l'état React, ce qui obligeait à différer chaque enregistrement d'un tour de rendu. La valeur est maintenant passée explicitement.

---

# État des décisions (toutes approuvées le 2026-09-30)

| # | Sujet | État |
|---|---|---|
| **D1** | Les 10 champs « Dépenses » alimentent `jobs.expenses_cents` | ✅ **livré, staging + prod.** Migration `20260930120000`. Ancrage sur `custom_field_folders.cle_systeme = 'depenses'` (pas un motif de clé) : un champ que tu ajoutes dans ce dossier compte, un champ « dépense prévue » rangé ailleurs ne compte pas. Testé en transaction annulée : 0 → 3500 → 15500 → 17000 → 12000, et témoin négatif (999 $ hors dossier n'influence rien). Empreintes prod ≡ staging. |
| **D4** | Les valeurs custom suivent de lead → job | ✅ **livré, staging + prod.** Migration `20260930123000`, déclencheur `jobs_cf_copier_depuis_client`. Un lead EST un client, donc c'est client → job. Testé : copie à la création, rien pour une job sans client, copie au rattachement, **pas de doublon** si on rattache deux fois. ⚠️ Précédence documentée dans la migration : le client remplit avant qu'un devis ne soit lié. |
| **D5** | `'Draft'` mort dans 2 filtres | ✅ **corrigé.** Vérifié d'abord qu'aucune job ne porte ce statut — ni les 78 de staging, ni les 952 de la prod. Remplacé par `.eq('status', 'draft')`. |
| **D7** | Le détecteur voit les tables disparues | ✅ **corrigé et prouvé.** Nouveau bloc « TABLES INEXISTANTES ». Écarte `.storage.from('bucket')` et `.schema('auth').from('users')` par une règle générale, pas par des exceptions ponctuelles. Web toujours vert (ta CI ne casse pas) ; test négatif fait avec un fichier jetable : la table morte est bien signalée. |
| **D3** | Fiche devis sur mobile | ✅ **livré.** `src/app/(app)/quotes/[id].tsx` : numéro, titre, statut traduit, client, lignes, totaux (masqués sans `financial.view_pricing`), **carte des champs personnalisés**, bouton d'envoi vers l'écran existant. Toucher un devis ouvre la fiche au lieu de sauter à l'envoi — dans la fiche client et dans la carte Facturation d'une job. Aucune capacité que le web n'a pas. |
| **D2** | Édition hors ligne | ✅ **livré.** L'infrastructure existait déjà (mon constat initial était faux, corrigé en A.5) ; j'y ai ajouté l'écriture des champs personnalisés, la seule rejouable sans doublon grâce à la `version`. Clé `MK.champsPersoEcrire`, variables PLATES pour survivre à la sérialisation. |
| **D6** | Mode sombre | 🟡 **fondation complète, balayage inachevé.** Détail ci-dessous — à ne PAS activer en l'état. |

## D6 — où en est le mode sombre, exactement

**Fait, et solide :**

| Pièce | Détail |
|---|---|
| Jetons de couleur, clair **et** sombre | `src/global.css` — `:root` / `.dark:root`. Les valeurs sombres ne sont pas inventées : ce sont **celles que le projet avait déjà choisies** pour l'écran Lumi (`lib/lumi/theme.tsx`, palette SOMBRE). Une seule vérité. |
| Jetons Tailwind branchés dessus | `tailwind.config.js` : `darkMode: 'class'`, `ink`/`surface`/`brand` → `rgb(var(--…))`. Nouveaux jetons `onAction` (texte sur un bouton plein) et `tint.*` (fonds teintés des états). |
| **Un seul** réglage pour toute l'app | Le fournisseur de thème est hissé à la racine (`src/app/_layout.tsx`) et pousse le choix dans nativewind (`colorScheme.set`). L'enveloppe imbriquée dans l'écran Lumi est retirée — sinon deux états de thème indépendants. La barre d'état suit. |
| 211 `bg-white` → `bg-surface` | Les `bg-white/20` translucides sont volontairement **exclus** : c'est du blanc posé sur du foncé. |
| 58 `text-white` → `text-onAction` | Uniquement ceux dont l'élément **parent** est `bg-ink`/`bg-brand`, résolu en remontant l'arbre — pas devinés. Les 71 autres gardent leur blanc (fond de couleur fixe, ou translucide). |
| Couche partagée | `Input` (couleur du texte d'invite) et `Button` (voyant de chargement) lisent le thème. |

Comme plus de 700 usages passaient déjà par les jetons `surface-*` / `ink-*`, redéfinir les jetons bascule **l'essentiel** de l'app d'un coup.

**Deux erreurs attrapées au passage**, qui montrent pourquoi le balayage mécanique doit être vérifié :
1. Mon remplacement en masse avait transformé deux **points blancs décoratifs** posés sur une pastille indigo en `bg-surface` — ils auraient noirci. Remis en blanc.
2. Le tableau `bg-surface` sur fond `bg-status-late` semblait faux : c'était ma remontée d'arbre qui attrapait une pastille **voisine**, pas le parent. Rien à corriger.

**Ce qui reste, et pourquoi je m'arrête là : 276 couleurs en dur dans 71 fichiers.**

| Rôle | Nombre |
|---|---|
| `tintColor` (icônes SF Symbols) | 105 |
| `color` | 93 |
| autre (props diverses) | 54 |
| `backgroundColor` | 17 |
| `borderColor` | 7 |

Ce sont des **valeurs**, pas des classes : aucune ne peut venir d'un jeton Tailwind, chacune exige le thème à l'exécution (`const { c } = useThemeLumi()`) dans son composant. Trois raisons de ne pas les faire à l'aveugle :

- **Une icône ratée devient invisible.** `tintColor="#171717"` sur une carte sombre ne se voit pas. Je ne peux vérifier aucun de ces 105 rendus sans appareil.
- **Certaines ne doivent PAS changer.** `lib/invoicePreview.ts` en compte 16 : c'est un document **imprimable**. Une facture reste blanche quel que soit le thème de l'app. Une conversion en masse l'aurait noircie — exactement le genre de dégât qu'on ne découvre qu'en production.
- **Certaines sont hors d'atteinte d'un hook** : les valeurs déclarées au niveau du module (palettes de statuts, couleurs d'entité) ne sont pas dans un composant React.

Pour reproduire l'inventaire à tout moment : chercher les hex neutres (`#171717`, `#FFFFFF`, `#A3A3A3`, `#525252`, `#E5E5E5`, `#D4D4D4`, `#F5F5F5`, `#FAFAFA`…) hors `shadowColor` et hors fichiers de palette.

⚠️ **Conséquence pratique : ne pas activer le mode sombre en l'état.** Le réglage existe et reste par défaut sur **clair** ; l'activer aujourd'hui donne une app majoritairement sombre avec des icônes noires invisibles. La fondation est là pour que le balayage soit ensuite mécanique — mais il doit se faire écran par écran, avec les yeux sur l'écran.

# À faire dès que le téléphone se connecte

1. Ouvrir une fiche client et une fiche job → la carte **Champs personnalisés** doit apparaître, groupée par dossier.
2. Modifier une valeur au bureau, rouvrir la fiche sur le cell → la valeur doit suivre.
3. Modifier sur le cell, rafraîchir le web → idem.
4. Ouvrir la même fiche des deux côtés, modifier le même champ → le mobile doit afficher le message de conflit, **pas** écraser.
5. Laisser vide un champ obligatoire → le refus du serveur doit s'afficher **sous le champ**.

⚠️ Ces cinq tests doivent se faire **sur staging**, pas sur la prod : le mobile pointe actuellement sur `bbzcuzqfgsdvjsymfwmr` (prod). Deux lignes dans `mobile/.env.local` et un redémarrage de Metro suffisent, aucun rebuild.
