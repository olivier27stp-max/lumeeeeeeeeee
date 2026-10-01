# Glossaire de Lumi

Relevé du 1er octobre 2026, fait sur la branche `mission/lumi-glossaire` (partie de `origin/main`), sans appeler ni la production ni un modèle.

Ce document sert à deux lecteurs :

- **le propriétaire de l'entreprise**, qui veut savoir quels mots Lume emploie et où ils se contredisent ;
- **les agents et les développeurs**, qui doivent écrire un texte de Lumi, du support, d'une automatisation ou d'un courriel avec les mêmes mots que l'écran.

Le principe est simple : **l'écran fait foi**. Quand Lume affiche « En retard » sur une pastille, Lumi dit « en retard », le support dit « en retard », le courriel dit « en retard ». Personne ne dit « scheduled », « past_due » ni « overdue ».

Là où l'écran lui-même hésite entre deux mots, ce document **ne tranche pas** : il dit lequel est le plus employé, avec le compte, et laisse la décision au propriétaire (section 5).

---

## 1. Les règles, en bref

1. **Le statut affiché, jamais la valeur rangée en base.** « Brouillon », pas « draft ».
2. **Un seul mot pour une même chose**, d'un bout à l'autre : écran, Lumi, support, automatisations, courriels.
3. **Lumi tutoie** la personne qui lui parle. **Le support vouvoie.** Les messages envoyés aux **clients de l'entreprise** vouvoient toujours.
4. **Dans la langue de la personne** : français par défaut, anglais si elle écrit en anglais. Les messages automatiques partent dans la langue choisie pour l'entreprise.
5. **Français d'ici, sans anglicisme inutile** : « courriel » et « texto », pas « email » ni « SMS » dans une phrase.
6. **Les prix et les forfaits** se disent comme sur la page Tarifs, nulle part autrement.

---

## 2. Les statuts, entité par entité

Lecture des tableaux : la première colonne est ce que la base range (personne ne doit le lire) ; les deux suivantes sont ce que **l'écran affiche** ; la dernière est ce que **Lumi dit aujourd'hui**. Un ⚠ signale un mot différent de l'écran (détail en section 7).

### Job

Le statut qu'on voit dans la page Jobs est **calculé** : il tient compte des visites et des dates.

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `upcoming` | À venir | Upcoming | à venir |
| `late` | En retard | Late | en retard |
| `action_required` | Action requise | Action Required | action requise |
| `requires_invoicing` | À facturer | Requires Invoicing | à facturer |
| `archived` | Archivé | Archived | archivé |
| `draft` | Brouillon | Draft | brouillon |
| `scheduled` | Planifiée | Scheduled | planifié |
| `in_progress` | En cours | In Progress | en cours |
| `completed` | Complétée | Completed | terminé ⚠ |
| `cancelled` | Annulée | Cancelled | annulé |

Un job sans date s'affiche « Non planifiée » (*Unscheduled*).

### Visite

Une visite est un passage chez le client, placé au calendrier. Elle porte le statut du job auquel elle appartient ; le calendrier connaît aussi « Confirmé » (*Confirmed*) et « Tentatif » (*Tentative*). Les valeurs que la base accepte pour une visite ne sont pas bornées par une règle : elles n'ont pas pu être relevées (section 9).

### Devis (aussi appelé « soumission », voir section 5)

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `draft` | Brouillon | Draft | brouillon |
| `awaiting_response` | En attente de réponse | Awaiting Response | en attente de réponse |
| `changes_requested` | Changements demandés | Changes Requested | modifications demandées ⚠ |
| `approved` | Approuvé | Approved | accepté ⚠ |
| `declined` | Refusé | Declined | refusé |
| `expired` | Expiré | Expired | expiré |
| `converted` | Converti | Converted | converti en job |
| `archived` | Archivé | Archived | archivé |

### Facture

La base ne connaît que cinq états. « En attente de paiement » et « En retard » sont **calculés** à partir de la date d'échéance.

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `draft` | Brouillon | Draft | brouillon |
| `sent` | Envoyé | Sent | envoyée |
| `sent` et pas encore due (`sent_not_due`) | En attente de paiement | Awaiting Payment | envoyée (pas encore due) ⚠ |
| `sent` et échue (`past_due`) | En retard | Past Due | en retard |
| `partial` | Partiel | Partial | partiellement payée |
| `paid` | Payée | Paid | payée |
| `void` | Annulée | Voided | annulée |

### Paiement

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `succeeded` | Réussi | Succeeded | réussi |
| `pending` | En attente | Pending | en attente |
| `failed` | Échoué | Failed | échoué |
| `refunded` | Remboursé | Refunded | remboursé |

Dans l'onglet Versements, l'argent en route vers la banque se dit « En transit » (*On the way*) puis « Déposé » (*Deposited*).

### Demande de paiement

La base range `pending`, `sent`, `processing`, `paid`, `expired`, `cancelled`. Aucune table de libellés propre à la demande de paiement n'a été trouvée à l'écran : ses libellés n'ont pas pu être relevés (section 9). Lumi n'a pas de table pour elle non plus.

### Client et prospect

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `active` | Actif | Active | client actif |
| `inactive` | Inactif | Inactive | inactif |
| `lead` | Prospect | Lead | prospect |

### Étapes d'un prospect (ancien tableau de vente)

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `new_prospect` | Nouveau prospect | New Prospect | nouveau prospect |
| `no_response` | Sans réponse | No Response | sans réponse |
| `quote_sent` | Devis envoyé | Quote Sent | devis envoyé |
| `closed_won` | Gagné | Closed Won | gagné |
| `closed_lost` | Perdu | Closed Lost | perdu |

### Deal du Pipeline de ventes

Dans le Pipeline de ventes (page Pipeline), les étapes ne sont pas des statuts fixes : chaque entreprise nomme les siennes. Le modèle fourni au départ contient entre autres « Nouveau lead » (*New lead*), « Soumission envoyée » (*Quote sent*), « Soumission ouverte », « Gagné » (*Won*) et « Perdu » (*Lost*). Deux étapes ont un rôle que les automatisations reconnaissent : « Soumission envoyée » et « Soumission ouverte ».

### Tâche

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `open` | Ouverte | Open | à faire ⚠ |
| `done` | Terminée | Done | terminée |

Priorités : « Haute », « Moyenne », « Basse » (*High*, *Medium*, *Low*).

### Feuille de temps

Une personne qui pointe est « Actif » (*Active*), « En pause » (*On break*) ou « Terminé » (*Finished*). Les boutons se nomment « Arrivée » (*Punch In*) et « Départ » (*Punch Out*). Lumi dit « Pointé » et « Dépointé ».

### Paie et commissions

| En base | Affiché (français) | Affiché (anglais) |
|---|---|---|
| `pending` | En attente | Pending |
| `approved` | Approuvé | Approved |
| `paid` | Payé (paie) · Versé (commissions) | Paid |
| `reversed` (commissions) | Reversé | Reversed |

Fréquences de paie : « Hebdomadaire », « Aux 2 semaines », « Bimensuel (1–15, 16–fin) », « Mensuel ».

### Automatisation

| État | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| en service | Publiée | Published | active ⚠ |
| arrêtée | Brouillon | Draft | en pause ⚠ |

La page connaît aussi l'état « Publiée · en pause » et un bouton « Tout arrêter ».

Les automatisations fournies par Lume sont rangées sous un nom anglais et **traduites à l'affichage** : « Job Reminder — 1 Day Before » s'affiche « Rappel de rendez-vous — 1 jour avant ». C'est le nom affiché qu'il faut dire.

### Membre, rôle, invitation

| En base | Affiché (français) | Affiché (anglais) | Lumi dit |
|---|---|---|---|
| `owner` | Propriétaire | Owner | propriétaire |
| `admin` | Administrateur | Admin | administrateur |
| `sales_rep` | Représentant | Sales Rep | représentant |
| `technician` | Technicien | Technician | technicien |

Invitation : Lumi dit « en attente », « acceptée », « expirée », « révoquée ». Les libellés de l'écran pour les invitations et pour un membre suspendu n'ont pas été relevés (section 9).

### Crédits Lumi

L'unité s'appelle **« crédits Lumi »** (*Lumi credits*), jamais « tokens », jamais un montant en dollars. Formules de l'écran : « 1 000 crédits Lumi / mois », « {restants} crédits Lumi restants sur {total} », « Renouvellement le {date} », « Les crédits Lumi non utilisés ne sont pas reportés ». Quand ils sont épuisés : « Tes crédits Lumi sont épuisés jusqu'au {date}. Les actions rapides et tout le reste de Lume fonctionnent toujours. »

### Formation

« Brouillon », « Publié », « Archivé » (Lumi) — page Formations.

---

## 3. Les pages et leur chemin

### Menu principal

| Nom affiché (français) | Nom affiché (anglais) | Chemin |
|---|---|---|
| Accueil | Home | `/day` |
| Clients | Clients | `/clients` |
| Demandes | Requests | `/requests` |
| Pipeline | Pipeline | `/ventes` |
| Devis | Quotes | `/quotes` |
| Finances — onglets Facturation, Paiements, Versements | Finances — Invoicing, Payments, Payouts | `/finances` |
| Jobs | Jobs | `/jobs` |
| Calendrier | Calendar | `/calendar` |
| Lumi | Lumi | `/lumi` |
| Messages | Messages | `/messages` |
| Feuilles de temps | Timesheets | `/timesheets` |
| Formations | Courses | `/courses` |
| Vente → Map | Sales → Map | `/field-sales` |
| Vente → Classement | Sales → Leaderboard | `/leaderboard` |
| Vente → Commissions | Sales → Commissions | `/commissions` |
| Statistiques | Statistics | `/insights` |
| Tâches | Tasks | `/tasks` |
| Automatisations | Automations | `/automations` |
| Paramètres | Settings | `/settings` |

Sur la page Devis, le bouton des modèles prêts à envoyer s'appelle « Modèles » (*Presets*) et mène à `/quotes/presets`.

### Paramètres

| Groupe | Entrée (français) | Entrée (anglais) | Chemin |
|---|---|---|---|
| Mon compte | Mon profil | My profile | `/settings/profile` |
| Entreprise | Paramètres entreprise | Company Settings | `/settings/company` |
| Entreprise | Champs personnalisés | Custom fields | `/settings/custom-fields` |
| Entreprise | Étiquettes | Tags | `/settings/tags` |
| Entreprise | Bureaux | Offices | `/settings/offices` |
| Entreprise | Forfait & facturation | Plan & billing | `/settings/billing` |
| Ventes & paiements | Produits & Services | Products & Services | `/settings/products` |
| Ventes & paiements | Taxes | Taxes | `/settings/taxes` |
| Ventes & paiements | Lume Payments | Lume Payments | `/settings/payments` |
| Communication | Messagerie SMS | SMS Messaging | `/settings/messaging` |
| Communication | Avis clients | Customer reviews | `/settings/reviews` |
| Communication | Formulaire de demande | Request Form | `/settings/request-form` |
| Communication | Modèles de courriel | Email templates | `/settings/email-templates` |
| Communication | Automatisations | Automations | `/automations` |
| Équipe | Membres | Members | `/settings/team` |
| Équipe | Rôles & Permissions | Roles & Permissions | `/settings/roles` |
| Équipe | Paie | Payroll | `/settings/payroll` |
| Équipe | Localisation GPS | GPS tracking | `/settings/location` |
| Plus | Rapports | Reports | `/settings/reports` |
| Plus | Archives | Archives | `/settings/archives` |
| Plus | Marketplace | Marketplace | `/settings/marketplace` |
| Plus | API & MCP | API & MCP | `/settings/api` |
| Plus | Support | Support | `/settings/support` |

« Champs personnalisés » n'apparaît que si la fonction est activée ; « Marketplace » et « API & MCP » ne sont visibles que du propriétaire et des administrateurs.

---

## 4. Les forfaits, les prix et les fonctionnalités

La page Tarifs est la référence. Elle est verrouillée contre la table des forfaits par un test déjà en place (`tests/tarifs-coherence.test.ts`).

| Forfait | Prix par mois (CAD) | Utilisateurs inclus | Utilisateur de plus | Bureaux inclus | Rabais annuel |
|---|---|---|---|---|---|
| **Minimum** | 150 $ | 3 | 35 $ | 1 | 10 % |
| **Scale** | 347 $ | 10 | 30 $ | 1 | 15 % |
| **Autopilot** | 495 $ | 20 | 25 $ | 2 | 30 % |

> **À confirmer par le propriétaire.** La consigne de la mission cite « 150 / 340 / 495 ». Le dépôt, lui, dit **347** pour Scale partout où un prix est écrit : la page Tarifs, l'agent du site, la réponse fixe « Combien ça coûte ? », et la grille que le test de cohérence déclare « décidée le 2026-09-22 ». Le chiffre 340 n'apparaît que dans une ancienne migration et dans un rapport d'audit. Ce document n'a pas pu lire la base de production ni Stripe : si 340 est le bon prix, c'est toute la grille du dépôt qu'il faut reprendre ; si 347 est le bon, la consigne est à corriger. Rien n'a été modifié.

Les noms des forfaits ne se traduisent pas : **Minimum**, **Scale**, **Autopilot**, dans les deux langues. Les anciens noms (Débutant, Starter, Pro, Entreprise, Solo, Gratuit) ne doivent plus être employés.

### Ce que chaque forfait contient, selon la page Tarifs

- **Minimum** — Clients, soumissions, signatures et contrats · Calendrier, jobs et jobs récurrentes · Facturation et paiements en ligne · Demandes entrantes et portail client · Courriels et rappels de rendez-vous · Accès mobile, finances et rapports de base.
- **Scale** — tout Minimum, plus : Textos bidirectionnels et messages groupés · Automatisations et relances de soumissions et factures · Feuilles de temps, paie et performance · Statistiques avancées et export QuickBooks · Rôles et permissions de l'équipe · Intégration gratuite.
- **Autopilot** — tout Scale, plus : Lumi, l'assistant IA (1 000 crédits Lumi / mois, exclusif à Autopilot) · Porte-à-porte : pipeline, commissions, leaderboard · Procédures (SOP) et vidéos de formation · Répartition sur carte et GPS en direct · 2 bureaux inclus · Rôles avancés, multi-équipes et disponibilités · API, marketplace et soutien prioritaire.

Il n'y a **ni essai gratuit ni forfait gratuit** : la porte d'entrée est « Réserver une démo ».

### Noms de fonctionnalités à employer tels quels

Lumi · crédits Lumi · Lume Payments · Pipeline · Formulaire de demande · Portail client · Avis clients · Automatisations · Feuilles de temps · Paie · Commissions · Classement · Formations · Champs personnalisés · Étiquettes · Bureaux · Rapports · Archives · Marketplace · Rentabilité (« Afficher la rentabilité » dans la fiche d'un job).

---

## 5. Les mots retenus quand l'écran hésite

Les comptes ci-dessous sont des occurrences dans les textes français de chaque source, commentaires de code exclus. « Écran traduit » est le fichier des traductions ; « Écran, pages » est le texte écrit directement dans les pages et les composants de l'application, site public exclu.

**Ce document ne tranche pas.** Pour chaque ligne, la colonne « Le plus employé à l'écran » dit ce que l'application montre le plus ; la décision appartient au propriétaire.

| Pour dire… | Mots en concurrence | Écran traduit | Écran, pages | Site public | Lumi | Support | Automatisations | Courriels et textos | Le plus employé à l'écran |
|---|---|---|---|---|---|---|---|---|---|
| le document de prix envoyé au client | devis / soumission | 46 / 2 | 169 / 88 | 3 / 56 | 116 / 18 | 50 / 34 | 16 / 48 | 6 / 7 | **devis** (215 contre 90) — mais le site, les automatisations et les courriels aux clients disent « soumission » |
| le travail à faire chez un client | job / travail, travaux | 106 / 8 | 275 / 27 | 58 / 5 | 183 / 9 | 87 / 9 | 13 / 4 | 6 / 5 | **job** (381 contre 35) ; les courriels aux clients disent « vos travaux » |
| le genre du mot job | la job / le job | 62 / 0 | 88 / 74 | — | 14 / 78 | 20 / 16 | 10 / 0 | — | **la job** à l'écran traduit ; Lumi dit surtout « le job » |
| le message électronique | courriel / email, e-mail | 42 / 8 | 116 / 29 | 10 / 0 | 61 / 4 | 53 / 1 | 27 / 0 | 40 / 0 | **courriel** (158 contre 37) |
| le message texte | texto / SMS | 0 / 9 | 32 / 49 | 24 / 12 | 29 / 8 | 18 / 9 | 8 / 0 | 3 / 0 | **SMS** à l'écran (58 contre 32) ; **texto** partout ailleurs |
| la personne pas encore cliente | prospect / lead | 9 / 42 | 16 / 49 | 1 / 14 | 40 / 6 | 5 / 14 | 11 / 0 | — | **lead** à l'écran (91 contre 25) ; la pastille de statut dit « Prospect » ; Lumi dit « prospect » |
| l'affaire dans le pipeline | deal / opportunité | 18 / 1 | 143 / 9 | 2 / 1 | 6 / 0 | 53 / 2 | 17 / 0 | — | **deal** |
| le menu de configuration | Paramètres / Réglages | 21 / 1 | 35 / 46 | 1 / 0 | 6 / 20 | 52 / 13 | — | 2 / 1 | le **menu** s'appelle « Paramètres » ; dans le texte des pages, « réglages » domine |
| l'offre payée chaque mois | forfait / plan | 2 / 10 | 22 / 84 | 26 / 0 | 6 / 1 | 18 / 12 | — | 4 / 0 | **plan** à l'écran (94 contre 24) ; le menu dit « Forfait & facturation » et le site dit « forfait » |
| l'argent demandé d'avance | dépôt / acompte | 2 / 2 | 55 / 3 | 2 / 0 | 3 / 1 | 8 / 0 | 24 / 0 | 7 / 0 | **dépôt** |
| un job fini | terminé / complété | 15 / 10 | 49 / 38 | 5 / 0 | 14 / 4 | 11 / 3 | — | 1 / 0 | partagé ; la **pastille** dit « Complétée » |
| un devis que le client veut bien | approuvé / accepté | 5 / 1 | 51 / 19 | 5 / 0 | 3 / 6 | 4 / 3 | 0 / 9 | 0 / 1 | **approuvé** à l'écran ; les automatisations disent « accepté » |
| le modèle de devis prêt à envoyer | modèle / préréglage | 50 / 0 | 56 / 9 | 11 / 10 | 77 / 7 | 18 / 11 | — | — | **modèle** (le bouton de la page Devis dit « Modèles ») |
| le marqueur de couleur | étiquette / tag | 3 / 2 | 55 / 11 | — | 28 / 3 | 41 / 2 | — | — | **étiquette** |
| le classement des vendeurs | classement / leaderboard | 1 / 0 | 7 / 6 | 2 / 5 | — | 1 / 2 | — | — | **classement** (nom de la page) |
| la personne qui vend | représentant / vendeur / rep | 3 / 1 / 2 | 40 / 8 / 15 | 0 / 3 / 4 | 7 / 1 / 2 | 9 / 5 / 5 | 0 / 3 / 1 | — | **représentant** (nom du rôle) |
| le passage chez le client | visite / rendez-vous | 10 / 2 | 83 / 37 | 3 / 6 | 50 / 4 | 14 / 7 | 0 / 29 | — | **visite** dans l'application ; **rendez-vous** dans les messages aux clients |

Deux partages méritent d'être remarqués, parce qu'ils ressemblent à un choix plus qu'à un oubli :

- **Ce que le client de l'entreprise lit** dit « soumission », « travaux », « rendez-vous » — jamais « job ». **Ce que l'entreprise lit dans son application** dit « devis », « job », « visite ».
- La page s'appelle « Devis » dans le menu, mais on y lit « Retour aux soumissions » et « Titre de la soumission ». Les deux mots cohabitent sur le même écran.

---

## 6. Tutoiement et vouvoiement

| Qui parle, à qui | Registre voulu | Constat |
|---|---|---|
| Lumi, à la personne dans l'application | **tu** | tenu dans tous ses textes sans modèle |
| Le support, à la personne dans le chat d'aide | **vous** | le prompt le demande ; la FAQ vouvoie partout ; deux textes tutoient (section 7) |
| L'agent du site public, à un visiteur | tu (c'est écrit dans sa consigne) | à confirmer : il partage le module du support |
| Les automatisations, aux clients de l'entreprise | **vous** | tenu : aucun message fourni par Lume ne tutoie un client |
| Les courriels de Lume, au propriétaire | tu | tenu, sauf un courriel qui mélange les deux |
| L'application elle-même | — | les textes traduits mélangent les deux : 69 formes en « tu », 126 en « vous » |

---

## 7. Écarts constatés

Chaque écart porte une classe :

- **(a)** une valeur rangée en base est visible par l'utilisateur ;
- **(b)** deux mots pour la même chose ;
- **(c)** un anglicisme inutile dans du français ;
- **(d)** tutoiement et vouvoiement mêlés à l'intérieur d'une même source ;
- **(e)** un prix, un quota ou un nom de forfait faux ;
- **(f)** une promesse qu'on ne peut pas confirmer dans le code.

Les références `fichier:ligne` s'adressent à la personne qui corrigera. Un ✅ signale un écart corrigé dans cette branche ; un 🔒 un fichier qu'il était interdit de modifier ici.

### Compte par classe et par source

| Source | (a) | (b) | (c) | (d) | (e) | (f) | Hors classe | Total |
|---|---|---|---|---|---|---|---|---|
| Ce que Lumi dit | 7 | 9 | 2 ✅ | 1 | 0 | 0 | 0 | **19** |
| Ce que le support dit | 0 | 6 | 1 | 4 | 2 | 4 | 0 | **17** |
| Messages des automatisations | 0 | 3 | 1 | 1 | 0 | 0 | 0 | **5** |
| Courriels et textos automatiques | 0 | 2 | 0 | 1 | 0 | 0 | 0 | **3** |
| L'écran lui-même | 0 | 15 | 3 | 1 | 0 | 0 | 1 | **20** |
| **Total** | **7** | **35** | **7** | **8** | **2** | **4** | **1** | **64** |

Un écart peut toucher plusieurs endroits : la carte de confirmation, par exemple, compte pour un écart mais treize lignes.

### 7.1 Ce que Lumi dit

**Statuts bruts visibles — classe (a)**

| N° | Écart | Où |
|---|---|---|
| L1 | 🔒 La **carte de confirmation** pose la valeur de base à côté du nom : « #INV-0004 · Tremblay · total 250,00 $ · solde 250,00 $ · **sent** », « Carte du pipeline · … · **new_prospect** », « Membre · … · **sales_rep** », « Tâche · … · **open** », « Rapport planifié · … · **weekly** ». Treize endroits. | `server/lib/lumi/apercu-action.ts:77-78`, `:90-91`, `:105-106`, `:113`, `:136`, `:141`, `:149`, `:158`, `:171`, `:182`, `:191`, `:200`, `:220` |
| L2 | 🔒 Sur la même carte, un détail sans libellé prévu prend le **nom technique** du champ comme titre, et sa valeur telle quelle : « Statut : completed » pour « marque le job 33 terminé ». | `server/lib/lumi/apercu-action.ts:286-293` |
| L3 | **En anglais**, le statut et le rôle restent en français : « Status : en retard », « · propriétaire ». Les outils ne fournissent le libellé affiché qu'en français. | `server/lib/lumi/raccourcis.ts:404`, `:434` ; `server/lib/lumi/actions-directes.ts:499`, `:514`, `:533`, `:543` ; tables dans `server/lib/agent/tools-etendus.ts:371-415` |
| L4 | La fiche complète d'un job donne au modèle le statut de base du job, son type et le statut de base de chaque visite, sans libellé affiché : c'est au modèle de traduire. | `server/lib/agent/tools.ts:429-430` |
| L5 | Un membre désactivé sort « inactive ». | `server/lib/agent/tools-etendus.ts:619` |
| L6 | La liste des automatisations donne au modèle le déclencheur brut (« invoice.overdue ») et le nom anglais des préréglages. Le texte sans modèle est corrigé (L18) ; le chemin par le modèle ne l'est pas. | `server/lib/agent/tools-etendus.ts:912-921` |
| L7 | Les réglages de relance donnent au modèle le canal brut (« email », « sms », « both »). Le texte sans modèle est corrigé (L17). | `server/lib/agent/tools-argent.ts:1952`, `:2034` |

**Deux mots pour la même chose — classe (b)**

| N° | Écart | Où |
|---|---|---|
| L8 | Job fini : Lumi « terminé », pastille « Complétée ». | `server/lib/agent/tools-etendus.ts:378` · `src/i18n/fr.ts:3288` |
| L9 | Devis que le client veut bien : Lumi « accepté », pastille « Approuvé ». | `server/lib/agent/tools-etendus.ts:387` · `src/i18n/fr.ts:3306` |
| L10 | Devis à retoucher : Lumi « modifications demandées », pastille « Changements demandés ». | `server/lib/agent/tools-etendus.ts:387` · `src/i18n/fr.ts:3305` |
| L11 | Facture envoyée pas encore due : Lumi « envoyée (pas encore due) », pastille « En attente de paiement ». | `server/lib/agent/tools-etendus.ts:392` · `src/i18n/fr.ts:3279` |
| L12 | Tâche non faite : Lumi « à faire », page Tâches « Ouverte ». | `server/lib/agent/tools-etendus.ts:731`, `server/lib/agent/tools-terrain.ts:91` · `src/pages/Tasks.tsx:81` |
| L13 | Automatisation : Lumi « active » / « en pause », page « Publiée » / « Brouillon ». | `server/lib/lumi/actions-directes.ts:464`, `server/lib/agent/tools-reglages.ts:373`, `server/lib/lumi/apercu-action.ts:141` · `src/pages/Automations.tsx:1609-1610` |
| L14 | « Devis » partout, sauf la carte d'envoi (« Soumission Q-0043 », « accepter la soumission en ligne ») et le briefing, qui met les deux dans la même phrase : « en soumissions sans réponse (3 devis) ». | `server/lib/lumi/fiches.ts:246`, `:252` ; `server/lib/lumi/briefing.ts:156` |
| L15 | « La job » dans les reçus, « aucun job » et « le job » ailleurs. | `server/lib/lumi/recus.ts:40`, `:42`, `:44` · `server/lib/lumi/actions-directes.ts:532` |
| L16 | Lumi envoie dans « Réglages → Commissions », « Réglages → Étiquettes » ; le menu s'appelle « Paramètres ». | `server/lib/agent/tools-etendus.ts:3263`, `server/lib/agent/tools-leads.ts:1252` |

**Anglicismes — classe (c), corrigés**

| N° | Écart | Où |
|---|---|---|
| L17 ✅ | « Mes relances automatiques » répondait « 14 jour(s) après l'échéance · **both** » (aussi « email », « sms »). Dit maintenant « courriel », « texto », « courriel et texto ». | `server/lib/lumi/actions-directes.ts:527` — commit `355be899` |
| L18 ✅ | « Mes automatisations » listait les noms anglais rangés en base (« Job Reminder — 1 Day Before »). Donne maintenant le nom que la page affiche. | `server/lib/lumi/actions-directes.ts:574` — commit `ac706420` |

**Tutoiement — classe (d)**

| N° | Écart | Où |
|---|---|---|
| L19 | Lumi tutoie, mais quand il répond à une question d'aide sans le modèle, il sert la réponse de la FAQ, écrite au « vous ». | `server/routes/lumi.ts:614` 🔒 (réponses : `src/components/supportArticles.ts` 🔒) |

### 7.2 Ce que le support dit

**Prix et quotas — classe (e)**

| N° | Écart | Où |
|---|---|---|
| S1 | **Prix de Scale : 347 $ dans le dépôt, 340 $ dans la consigne de la mission.** À confirmer (voir l'encadré de la section 4). | `src/pages/marketing/Pricing.tsx:95`, `server/lib/agent/promptVente.ts:31`, `server/lib/agent/reponsesFixes.ts:28`, `tests/tarifs-coherence.test.ts:28` ; 340 dans `supabase/migrations/20260721000000_plan_intro_promo.sql:62` |
| S2 | **Bureaux inclus.** L'agent du site annonce 1, 2 et 5 bureaux. Le code qui applique le quota et la page Tarifs disent 1, 1 et 2. | `server/lib/agent/promptVente.ts:30-32`, `server/lib/agent/reponsesFixes.ts:28` · `server/lib/platformFeatures.ts:108-112`, `src/pages/marketing/Pricing.tsx:213` |

**Promesses à confirmer — classe (f)**

| N° | Écart | Où |
|---|---|---|
| S3 | L'agent du site promet le **porte-à-porte, l'API et les formations dès Scale**. La page Tarifs les réserve à Autopilot. Laquelle dit vrai dépend de la table des forfaits en production. | `server/lib/agent/promptVente.ts:31`, `:33`, `server/lib/agent/reponsesFixes.ts:28` · `src/pages/marketing/Pricing.tsx:204-206` |
| S4 | **« Synchronisation Google Agenda »** : promise par l'agent du site et par la page Fonctionnalités ; aucun code de synchronisation avec Google Agenda n'a été trouvé. | `server/lib/agent/promptVente.ts:24`, `src/pages/marketing/Features.tsx:119` |
| S5 | « Des centaines d'entreprises de service l'utilisent » : rien dans le code ne permet de le confirmer. | `server/lib/agent/promptVente.ts:39` |
| S6 | 🔒 La FAQ cite une **« vue Répartition »** du Calendrier. Le Calendrier a les vues Jour, Semaine, Mois et Agenda. | `src/components/supportArticles.ts:99` · `server/lib/support/carte-app.ts:51` |

**Deux mots pour la même chose — classe (b)**

| N° | Écart | Où |
|---|---|---|
| S7 | 🔒 La FAQ envoie dans **« Soumissions → Modèles et préréglages »**. Le menu dit « Devis », le bouton dit « Modèles » : ce chemin n'existe pas sous ce nom. | `src/components/supportArticles.ts:45`, `:54` · `src/App.tsx:1110`, `src/pages/Quotes.tsx:360` |
| S8 | 🔒 Dans la FAQ, « devis » et « soumission » pour le même document. | « devis » : `src/components/supportArticles.ts:61`, `:63`, `:126`, `:211`, `:265` · « soumission » : `:34`, `:36`, `:45`, `:54`, `:184`, `:274` |
| S9 | 🔒 Dans la FAQ, « travail » et « job », et « une job » comme « un job ». | « travail » : `:97`, `:99`, `:106`, `:108` · « une job » : `:200`, `:202` · « un job » : `:274`, `:283`, `:290`, `:292` |
| S10 | 🔒 Dans la FAQ, « SMS » et « texto ». | `src/components/supportArticles.ts:115`, `:117` · `:283` |
| S11 | 🔒 Dans la FAQ, « dans Factures » puis « Finances → Facturation » pour la même page. | `src/components/supportArticles.ts:166` · `:220` |
| S12 | À la question « factures et devis ? », la réponse fixe de l'agent du site parle de « soumissions ». | `server/lib/agent/reponsesFixes.ts:32-33` |

**Anglicismes — classe (c)**

| N° | Écart | Où |
|---|---|---|
| S13 | L'agent du site dit « leads », « leaderboard qui gamifie », « kanban », « LMS », quand l'écran dit « prospects », « Classement », « Formations ». | `server/lib/agent/promptVente.ts:15`, `:20`, `:21`, `:22`, `:31` ; `server/lib/agent/reponsesFixes.ts:38` |

**Tutoiement — classe (d)**

| N° | Écart | Où |
|---|---|---|
| S14 | La réponse d'aide servie sans le modèle finit par **« Si ça ne règle pas ton cas, dis-le-moi et je creuse. »** — dans le chat de support, qui vouvoie, juste après un extrait de FAQ au « vous ». | `server/lib/support/articles-dabord.ts:136` (servi par `server/routes/support.ts:144`) |
| S15 | Le courriel « Réponse du support » tutoie : « …te répond au sujet de… », « Tu peux aussi répondre directement à ce courriel. » | `server/lib/support/tickets.ts:427`, `:430` |
| S16 | Le même module répond « tu veux que je t'aide à en réserver une ? » au visiteur du site et « Je transmets votre demande » au client. C'est écrit ainsi dans la consigne de l'agent du site ; à confirmer que c'est voulu. | `server/lib/support/ia.ts:304`, `:310` ; `server/lib/agent/promptVente.ts:11` |
| S17 | La doc d'aide que le support cite est écrite au « tu » (56 formes) : le support, qui vouvoie, en recopie des passages. | `src/pages/marketing/fonctionsData.ts` (ex. `:35`, `:39`) |

**Ce qui est en ordre côté support.** Le prompt demande le vouvoiement, interdit d'inventer une fonction, un prix, un bouton ou un réglage, impose de chercher dans la doc avant de répondre à un « comment faire », et dit quand passer à un humain. Le support n'a que quatre outils (chercher dans l'aide, passer à un humain, lire l'état d'une migration, démarrer une migration) : **aucun outil d'action de Lumi**. Démarrer une migration est la seule écriture qu'il peut faire dans un compte ; elle est décrite comme réversible. Aucun prix n'est écrit dans la FAQ, la carte de l'app, la doc d'aide ni le prompt du support dans l'application : les prix ne sont dits que par l'agent du site, et ils y sont ceux de la page Tarifs. Toutes les pages et toutes les entrées « Paramètres → … » que la FAQ cite existent, sauf S6 et S7.

### 7.3 Messages des automatisations

| N° | Classe | Écart | Où |
|---|---|---|---|
| A1 | (b) | 🔒 Les messages fournis disent « soumission » (48 fois), sauf trois restés en « devis » : « On vous a envoyé un devis récemment… », « Suivi de votre devis », « Répondez à ce message pour un devis. » | `server/lib/automationPresets.data.ts:335`, `:337`, `:1178` (et la description `:64`) |
| A2 | (b) | Les automatisations disent « dépôt » ; le formulaire de devis dit « Acompte et paiement », « Exiger un acompte ». | `server/lib/automationTemplates.ts:116-119` · `src/i18n/fr.ts:2791-2792` |
| A3 | (b) | La consigne du générateur dit « soumission » puis « devis » à huit lignes d'écart. | `server/lib/lumi/generer-parcours.ts:401`, `:409` |
| A4 | (c) | Une vingtaine de **descriptions** d'automatisations fournies sont en anglais (« Send SMS + email reminder 1 day before a scheduled job »). Les noms anglais sont traduits à l'affichage, pas les descriptions ; la recherche de la page s'en sert. | `server/lib/automationPresets.data.ts:327`, `:355`, `:502`, `:579`, `:640`, `:808`, `:956`, `:1229`… · `src/pages/Automations.tsx:992` |
| A5 | (d) | Les messages d'erreur des automatisations vouvoient (« Votre rôle ne permet pas… », « Donnez un nom… ») et tutoient (« Décris ton automatisation en une phrase. »). | `server/lib/automations-langue.ts:40`, `:45` ; `server/lib/automations-validation-messages.ts:40` |

**Ce qui est en ordre.** Aucun message fourni par Lume ne tutoie un client ; aucun ne contient une valeur de base ; aucun ne dit « email » ou « SMS ». La consigne du générateur impose le vouvoiement au client, le tutoiement à l'utilisateur, la langue de l'entreprise et les seules variables connues. Une automatisation créée par Lumi naît en pause, et ses messages partent dans la langue réglée pour l'entreprise.

**Ce qui manque pour tenir la règle.** Quand Lumi réécrit le texte d'une automatisation (`update_automation_message`, `update_automation_sms_body`), le texte est enregistré tel que le modèle l'a écrit : rien ne vérifie qu'il est dans la langue choisie, au vouvoiement, ni avec les mots de ce glossaire (`server/lib/agent/tools-reglages.ts:564-683`). Ce n'est pas un écart de texte, c'est une garde absente.

### 7.4 Courriels et textos automatiques

| N° | Classe | Écart | Où |
|---|---|---|---|
| C1 | (d) | L'avis de paiement au propriétaire tutoie (« Tu reçois ce courriel parce que… ») ; l'avis de contestation, dans le même fichier, vouvoie (« Répondez dans votre tableau de bord Stripe… »). | `server/lib/paiement-recu.ts:100`, `:137` |
| C2 | (b) | Même fichier : « Paramètres → Lume Payments », puis « Réglages → Lume Payments ». | `server/lib/paiement-recu.ts:100`, `:137` |
| C3 | (b) | Le courriel au **propriétaire** dit « dépôt du devis », « Voir le devis » ; le courriel au **client** dit « Votre soumission », « Approuver la soumission ». | `server/lib/paiement-recu.ts:51`, `:92`, `:99` · `server/routes/quotes.ts:331`, `server/routes/emails.ts:612`, `:719`, `server/lib/courriels/gabarit.ts:545`, `server/lib/courriels/bouton-automatisation.ts:49`, `:52` |

**Ce qui est en ordre.** Aucune valeur de base et aucun « email » ou « SMS » dans les courriels et textos relevés. Les courriels aux clients vouvoient et parlent de « vos travaux », jamais de « job ».

### 7.5 L'écran lui-même

| N° | Classe | Écart | Où |
|---|---|---|---|
| U1 | hors classe | **Huit libellés affichent un code à la place d'un accent.** Supprimer un devis montre « Devis supprim\u00e9 », lettre pour lettre. | `src/i18n/fr.ts:2718`, `:2721`, `:2722`, `:2726`, `:2727`, `:2731`, `:2732`, `:2733` ; visible par `src/pages/Quotes.tsx:246` |
| U2 | (d) | Les textes traduits mêlent « tu » (69 formes) et « vous » (126) : « Essaie d'ajuster ta recherche » et « Commencez par créer votre premier devis » dans la même section. | `src/i18n/fr.ts:176`, `:218` |
| U3 | (b) | Le menu dit « Devis » ; la page dit « Retour aux soumissions », « Titre de la soumission », « Le numéro de soumission… ». | `src/App.tsx:1110` · `src/pages/QuoteDetails.tsx:280`, `:287`, `src/pages/QuoteNew.tsx:639` |
| U4 | (b) | Job fini : « Complétée », « Terminé », « Terminée ». | `src/i18n/fr.ts:3288` · `src/pages/Jobs.tsx:955` · `src/components/pipeline/DealDrawer.tsx:79` |
| U5 | (b) | Devis : « Approuvé » et « Accepté ». | `src/i18n/fr.ts:3306` · `src/components/pipeline/DealDrawer.tsx:66` |
| U6 | (b) | Devis : « Changements demandés » et « Modifications demandées ». | `src/i18n/fr.ts:3305` · `src/components/pipeline/DealDrawer.tsx:73`, `src/pages/ClientPortal.tsx:107` |
| U7 | (b) | Devis : la pastille dit « Refusé », le filtre de la même page dit « Décliné ». | `src/i18n/fr.ts:3307` · `src/pages/Quotes.tsx:57` |
| U8 | (b) | Facture envoyée pas encore due : « En attente de paiement », « Ouverte », « Envoyée ». | `src/i18n/fr.ts:3279` · `src/lib/invoiceCalc.ts:85` · `src/pages/ClientPortal.tsx:101` |
| U9 | (b) | Facture payée en partie : « Partiel », « Partiellement payée », « Payée en partie », « Partielle ». | `src/i18n/fr.ts:3281`, `:3282` · `src/components/pipeline/DealDrawer.tsx:84` · `src/pages/ClientPortal.tsx:101` |
| U10 | (b) | Job à facturer : « À facturer » dans un filtre, « Facturation requise » dans l'autre, sur la même page. | `src/pages/Jobs.tsx:744` · `src/i18n/fr.ts:349` (lu par `src/pages/Jobs.tsx:399`) |
| U11 | (b) | « Prospect » sur la pastille, « Lead » ailleurs. | `src/i18n/fr.ts:3297` · `src/i18n/fr.ts:204`, `:326` |
| U12 | (b) | « Forfait & facturation » au menu, « Voir tous les plans » dans la page. | `src/pages/settings/SettingsLayout.tsx:77` · `src/pages/settings/BillingSettings.tsx:446` |
| U13 | (b) | « Paramètres » au menu ; dans les pages, « Réglages → Bureaux », « Réglages → Taxes », « Réglages globaux ». | `src/i18n/fr.ts:20` · `src/pages/CompanySettings.tsx:418`, `src/pages/NewClient.tsx:571`, `src/pages/Automations.tsx:1285` |
| U14 | (b) | « Nouvelle job », « Aucune job trouvée », mais « Job supprimé. » | `src/i18n/fr.ts:340`, `:343` · `:363` |
| U15 | (b) | « Messagerie SMS » au menu, « Envoyer un texto » sur le devis. | `src/pages/settings/SettingsLayout.tsx:91` · `src/i18n/fr.ts:2814` |
| U16 | (b) | « Acompte et paiement » dans le formulaire, « Dépôt requis », « Modifier le dépôt » sur la fiche. | `src/i18n/fr.ts:2791` · `src/pages/QuoteDetails.tsx:649`, `:660` |
| U17 | (b) | Tâche non faite : « Ouverte », « En attente », « Actives ». | `src/pages/Tasks.tsx:81` · `src/i18n/fr.ts:375`, `:382` |
| U18 | (c) | L'entrée du menu français s'appelle « Map ». | `src/i18n/fr.ts:36` |
| U19 | (c) | « email » et « boîte mail » dans du français : « Aucun email client », « Entrez votre email… », « Vérifie ta boîte mail », « Envoyer par email ». | `src/i18n/fr.ts:430`, `:1298`, `:1323`, `:2737` |
| U20 | (c) | « templates », « tag », « checklist », « marketplace », « reps » dans du français. | `src/i18n/fr.ts:2646`, `:2215`, `:3352`, `:684`, `:3175` |

**À savoir.** Le fichier des traductions contient aussi des textes d'anciens forfaits (« Le plan Débutant est gratuit ! », « Gratuit », « Pro », « Entreprise ») qu'aucune page n'affiche plus. Ils ne sont pas comptés comme écarts, mais ils promettent un forfait gratuit qui n'existe pas : mieux vaut les retirer avant qu'une page ne les relise.

### Les dix écarts les plus visibles

1. **U1** — « Devis supprim\u00e9 » à l'écran, à chaque suppression d'un devis.
2. **L1** — la carte de confirmation de Lumi montre « sent », « new_prospect », « sales_rep », « weekly ».
3. **S2** — l'agent du site annonce 2 et 5 bureaux là où le forfait en donne 1 et 2.
4. **S3** — l'agent du site promet le porte-à-porte et l'API dès Scale ; la page Tarifs dit Autopilot.
5. **S1** — prix de Scale : 347 $ partout dans le dépôt, 340 $ dans la consigne.
6. **U3** — la page « Devis » parle de « soumissions ».
7. **L3** — en anglais, Lumi affiche le statut en français.
8. **S14** — le chat de support, qui vouvoie, termine par « ton cas, dis-le-moi ».
9. **L13** — Lumi dit qu'une automatisation est « active » ou « en pause » ; la page dit « Publiée » ou « Brouillon ».
10. **S7** — la FAQ envoie dans « Soumissions → Modèles et préréglages », qui n'existe pas sous ce nom.

---

## 8. Les tests qui tiennent ce glossaire

Quatre fichiers, tous statiques (ni base, ni modèle, ni réseau). Pour les lancer :

```
npx vitest run tests/lumi-glossaire*.test.ts --maxWorkers=2
```

| Fichier | Ce qu'il fige | Verts | Écarts gardés en attente |
|---|---|---|---|
| `tests/lumi-glossaire-statuts.test.ts` | chaque valeur de base a un libellé chez Lumi et à l'écran, en français et en anglais ; Lumi dit le mot de la pastille | 18 | 5 |
| `tests/lumi-glossaire-gabarits.test.ts` | aucun statut brut, aucun « email » ni « SMS », aucun vouvoiement dans les textes sans modèle de Lumi | 8 | 4 |
| `tests/lumi-glossaire-support.test.ts` | prix de la grille, noms des forfaits, vouvoiement, escalade, aucun outil d'action, pages citées par la FAQ | 17 | 7 |
| `tests/lumi-glossaire-automatisations.test.ts` | messages fournis au vouvoiement et sans valeur de base, noms traduits, consigne du générateur, langue des outils de Lumi | 13 | 1 |
| **Total** | | **56** | **17** |

Un test « en attente » (`it.fails`) décrit un écart réel de la section 7 : il échoue aujourd'hui, et c'est attendu. **Le jour où l'écart est corrigé, ce test devient rouge** — il suffit alors de retirer le mot `.fails` pour qu'il garde la correction. Aucun de ces tests n'a été affaibli pour passer.

Correspondance entre les tests en attente et les écarts : statuts → L8 à L11 (un test), L12, L13, U1, U7 ; gabarits → L1, L3, L14, L15 ; support → S2, S3, S14, S15, S7, S6, S8 ; automatisations → A1.

---

## 9. Ce qui n'a pas pu être vérifié

- **Ce que le modèle écrit réellement.** Ces tests lisent les consignes, les tables et les textes écrits d'avance. Ils ne prouvent pas que Lumi ou le support, une fois le modèle appelé, emploient les mots de ce glossaire, tiennent le tutoiement ou le vouvoiement, ni répondent dans la langue de la personne. Cela se mesure avec le vrai modèle (`npm run qa:lumi`, `npm run qa:construire-lumi`, l'évaluation du support), que cette mission n'avait pas le droit de lancer.
- **Le prix de Scale** (340 ou 347) et **le contenu réel des forfaits** (porte-à-porte, API, formations, bureaux) : il faut lire la table des forfaits en production et les prix dans Stripe.
- **La synchronisation Google Agenda** : aucun code trouvé ; elle existe peut-être sous un autre nom ou chez un fournisseur externe.
- **Les libellés de l'écran** pour la demande de paiement, l'invitation, le membre suspendu et la visite : non relevés.
- **Les valeurs de statut d'une visite** : la base ne les borne pas par une règle.
- **Les messages d'automatisation déjà enregistrés chez les clients** : seuls les messages fournis par Lume dans le code ont été lus, pas ceux que chaque entreprise a modifiés.
- **Les pages de devis, de facture et de contrat vues par le client final**, ainsi que les modèles de PDF : seuls leurs libellés de statut ont été regardés.
- **Les comptes de la section 5** sont approximatifs : ils reposent sur une détection automatique des textes français et comptent aussi les consignes données au modèle, pas seulement ce que l'utilisateur lit.

---

## 10. Pour qui relit ou met à jour ce document

- **Source de vérité des statuts affichés** : la section `status` de `src/i18n/fr.ts` et de `src/i18n/en.ts`, lue par `src/components/ui/StatusBadge.tsx`. Les pages Jobs, Devis, Factures, Paiements et Clients passent toutes par cette pastille.
- **Tables de Lumi** : `server/lib/agent/tools-etendus.ts` (`ETIQUETTES_DERIVED`, `STATUT_DEVIS`, `STATUT_FACTURE`, `STATUT_ROLE`, `STATUT_LEAD`, `STATUT_CLIENT`), `tools-leads.ts` (`STATUT_PROSPECT`), `tools-argent.ts` (`STATUT_PAIEMENT`), `tools-terrain.ts` (`STATUT_TACHE`, `STATUT_CONTRAT`), `tools-equipe.ts` (`STATUT_INVITATION`), `tools-rapports.ts` (`ETIQ_EN`, seule table anglaise).
- **Valeurs permises en base** : les contraintes de `supabase/SCHEMA_SNAPSHOT.md` (`jobs_status_check`, `quotes_status_check`, `invoices_status_check`, `payments_status_check`, `clients_status_check`, `pipeline_deals_stage_check`, `tasks_status_check`, `invitations_status_check`, `payment_requests_status_check`).
- **Menus** : `src/App.tsx` (menu principal) et `src/pages/settings/SettingsLayout.tsx` (Paramètres).
- **Prix** : `src/pages/marketing/Pricing.tsx`, verrouillé par `tests/tarifs-coherence.test.ts`.
- **Noms affichés des automatisations** : `src/lib/automationNames.ts`.
- **Fichiers laissés intacts à dessein** : la consigne stable de Lumi et `consignesCollegue.ts` (un changement réécrit la cache de toutes les entreprises), `apercu-action.ts`, `orchestrateur.ts`, `routes/lumi.ts`, `supportArticles.ts`, `support/faq*.ts`, les messages d'automatisation déjà en base, les prix.
- **Ajouter un statut** : l'ajouter à la contrainte en base, à la section `status` des deux langues, puis à la table de Lumi. `tests/lumi-glossaire-statuts.test.ts` échoue tant que l'un des trois manque.
