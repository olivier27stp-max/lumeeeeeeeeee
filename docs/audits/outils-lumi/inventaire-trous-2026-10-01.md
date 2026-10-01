# Ce qui manque à Lumi : inventaire du 2026-10-01

Deux inventaires en lecture seule du dépôt, faits le 2026-10-01 : ce que l'application permet et que Lumi ne sait pas faire, et les cartes de confirmation qui ne disent pas exactement ce qui va se passer. Les lignes marquées **fait** ont une PR ; le reste est à faire.

Chiffres de départ : 248 outils, dont 181 d'écriture.

## 1. Ce que l'app fait et que Lumi ne fait pas

### Les 15 trous les plus utiles

| # | Trou | Preuve dans le code | État |
|---|---|---|---|
| 1 | Lire une facture au complet ; trouver une facture par numéro ou par client | `getInvoiceById` (`src/lib/invoicesApi.ts`) ; `list_invoices` passait `p_q: null` | **fait** (#865) |
| 2 | Lire une soumission au complet (lignes, dépôt, ouvertures) | `getQuoteById` (`src/lib/quotesApi.ts`) | **fait** (#865) |
| 3 | Le vrai pipeline de ventes | `list_deals`, `update_deal_stage`, `delete_deal` lisent l'ancienne table `pipeline_deals` (`tools-leads.ts:1025`) ; la page `/ventes` utilise `deals`, `pipelines_ventes`, `pipeline_stages` (`src/lib/pipelineVentesApi.ts`) | **fait** (#867) pour lire, déplacer, abandonner ; créer et assigner un deal : à faire |
| 4 | Corriger une feuille de temps (heures, pointage forcé, suppression) | `src/pages/Timesheets.tsx:552-555` | à faire |
| 5 | Montants de paie par période, et périodes passées | `GET /payroll/period-summary`, `/payroll/history` | à faire |
| 6 | Marquer une soumission approuvée ou en attente à la main | `updateQuoteStatus` (`src/lib/quotesApi.ts`) | à faire |
| 7 | Commissions : lister, approuver, marquer payées | `server/routes/commissions.ts` (aucun outil) | à faire |
| 8 | Horaire d'équipe : qui travaille demain, congés | `src/lib/teamScheduleApi.ts` | à faire |
| 9 | Taxes perçues sur une période | `GET /taxes/collected` | à faire |
| 10 | Rabais et dépôt sur une soumission | champs de `createQuote` / `updateQuote` absents des outils | à faire |
| 11 | Restaurer depuis les archives | `src/lib/archiveApi.ts` | à faire |
| 12 | Modifier les infos de l'entreprise et l'objectif de revenus | `src/pages/CompanySettings.tsx:249-271` | à faire |
| 13 | Automatisations : supprimer, dupliquer, partir d'un modèle, tout mettre en pause, renommer | `server/routes/automation-rules.ts` | à faire |
| 14 | Consentement du client (texto, courriel) et champs étendus de la fiche | `definirConsentement` (`src/lib/clientsApi.ts`) | à faire |
| 15 | Statistiques : taux de gain des soumissions, modes de paiement, performance d'équipe, versements Stripe | `src/lib/statistiquesApi.ts`, `GET /payments/payouts/*` | à faire |

Le trou n° 3 était le seul qui était aussi un risque d'erreur : vérifié en prod le 2026-10-01, Lumi lisait 8 cartes de l'ancien tableau là où l'écran montre 2 deals. Corrigé par #867.

### Le reste, par domaine

**Clients et prospects**
- Journal d'activité d'une fiche (`fetchActivityLog`).
- Renommer, recolorer, supprimer une étiquette de client.
- Transférer un client, une soumission ou un job à un autre bureau.
- Exporter ou effacer les données personnelles d'un client (`server/routes/dsr.ts`).
- Savoir si un client a une carte au dossier.

**Factures et paiements**
- Journal des relances automatiques envoyées (`GET /reminders/log`).
- État de livraison d'un courriel de soumission ou de facture (`GET /email-deliveries`).
- Réglages de paiement, synchronisation QuickBooks, suppression d'un groupe de taxes, changement d'un numéro de document.

**Jobs et horaire**
- Renommer ou supprimer une étiquette de job.
- Historique de position d'un employé pour une journée.

**Équipe et paie**
- Lire les permissions actuelles d'un rôle ou d'un membre (Lumi sait seulement les écrire).
- Lire les taux horaires des membres.
- Supprimer un ajustement de paie.

**Automatisations**
- Statistiques par règle et qui est inscrit en ce moment.
- Modifier le nom, le déclencheur, les délais ou les conditions d'une règle existante.

**Formulaire de demande, champs personnalisés**
- Lire ou modifier le formulaire et obtenir son lien public.
- Créer, modifier, archiver une définition de champ.

**Messages**
- Assigner une conversation à un membre.
- Boîte courriel branchée : lire les fils, répondre.

**Rapports**
- Lancer un rapport du catalogue avec filtres (16 rapports ; `build_report` en fait 4).
- Progression d'un objectif (`GET /goals/progress`).

**Bureaux** (aucun outil)
- Lister les bureaux et les comparer ; en créer un, donner un accès.

**Porte-à-porte, formations, avis**
- Lister les représentants (`create_d2d_team` demande des identifiants qu'aucun outil ne liste).
- Classement et profil d'un représentant.
- Progression des formations par membre.
- Réglages des demandes d'avis (liens Google et Facebook, textes).

**Sans trou trouvé** : dépenses de job, notifications, objectifs, rapports programmés, modèles de courriel, taxes, services, listes de vérification, disponibilités, tâches.

## 2. Les cartes de confirmation

181 outils d'écriture. 7 ont un aperçu composé (`apercuProposition`, `server/lib/lumi/fiches.ts:146-161`) : `create_quote`, `create_invoice`, `send_sms`, `send_email`, `send_quote`, `send_invoice`, `merge_clients`. Les 174 autres passent par l'aperçu générique (`apercuAction`, `server/lib/lumi/apercu-action.ts`).

### Défauts transversaux

| Réf. | Défaut | Où corriger | État |
|---|---|---|---|
| X1 | Pour 161 outils, le titre est la phrase de la permission, identique pour des actions contraires | `src/lib/lumiVerbes.ts`, `CarteAutorisation.tsx` | **fait** (#864) |
| X2 | 156 noms de paramètres affichés en anglais ou bruts (« First name », « Send via », « Valid days ») | `server/lib/lumi/libelles-cartes.ts` | **fait** (PR cartes) : 190 paramètres, test de couverture |
| X3 | Valeurs brutes : énumérations non traduites, taux sans %, objectif de revenus en cents (« 5000000 ») | `detail()`, `apercu-action.ts` | **fait** (PR cartes) |
| X4 | Vider un champ ne se voit pas (une valeur vide ou nulle est retirée de la carte) | `detail()` et `apercuAction` | **fait** (PR cartes) : « (vidé) » sur une modification |
| X5 | Listes et objets : « 1. a — b — c » sans nom de champ, sans total ; permissions en JSON brut | `apercuAction` | **fait** (PR cartes) : lignes de vente avec total, champs nommés, permissions dans les mots de la page Rôles |
| X6 | Mauvais résolveur, donc fausse alerte rouge « introuvable » : `rule_id` de `deactivate_recurrence_rule` cherché dans les automatisations ; `template_id` des listes de vérification cherché dans les modèles de courriel | `RESOLVEURS` ; `RESOLVEURS_PAR_OUTIL` | **fait** (PR cartes) |
| X7 | Le résolveur de membre lit `team_members` ; les outils d'équipe et de paie valident contre `memberships` | `membre`, `apercu-action.ts` | **fait** (PR cartes) |
| X8 | Une heure sans décalage est lue dans le fuseau du serveur sur la carte, dans celui de l'entreprise à l'exécution | `dateLocale`, `apercu-action.ts` | **fait** (PR cartes) : une heure sans décalage s'affiche telle qu'elle sera écrite |
| X9 | Les automatisations qui partiront chez le client ne sont pas annoncées (job terminé, visite déplacée, facture payée, étiquette ajoutée) | `fiches.ts`, en réutilisant `propositionJournee.ts:243-244` | à faire |
| X10 | Conversation rouverte : la carte en attente perd son aperçu et ses badges ; carte groupée repliée par défaut | `rendreMessages` (`server/routes/lumi.ts`), `LigneGroupe` | à faire |

### Les cartes les plus risquées, outil par outil

**Argent**
- `refund_payment` : sans montant, la carte ne dit ni « remboursement complet » ni la somme. Le titre le dit depuis #864 ; la somme reste à afficher.
- `charge_card_on_file`, `remove_card_on_file` : ni marque ni 4 derniers chiffres de la carte.
- `create_payment_request`, `resend_payment_request` : ni destinataire, ni canal par défaut, ni texte du message.
- `record_invoice_payment` : le solde après paiement n'est pas montré.
- `update_quote`, `update_invoice`, `create_job`, `update_job` : les lignes remplacent tout ; ni total, ni avant → après.
- `save_job_billing_milestones` : identifiants bruts ; les jalons qui seront supprimés ne sont pas listés.
- `setup_taxes`, `create_tax_config`, `set_default_tax_group` : les taxes créées et le groupe remplacé ne sont pas montrés.

**Envois au client**
- `send_quote_sms` : ni numéro, ni texte.
- `send_agreement_email`, `send_agreement_sms` : ni adresse ou numéro, ni contenu.
- `send_quote`, `send_invoice` : l'objet et le corps affichés ne sont pas ceux qui partent quand l'entreprise a son modèle de courriel (`apercuEnvoiDocument`, `fiches.ts:220-255`).
- `send_email` : le destinataire est l'adresse brute, sans le nom de la fiche.

**Suppressions**
- `delete_client`, `delete_lead`, `delete_job`, `delete_team` : la cascade n'est pas montrée (jobs, soumissions, factures, visites, membres détachés).
- `cancel_visit`, `reschedule_job` sans `visit_id` : la visite touchée n'est pas montrée.
- `unschedule_job` : retire toutes les visites, sans en dire le nombre.
- `set_default_availability` : « remplace toutes les plages par lundi-vendredi 8 h-17 h » n'apparaît nulle part.

**Équipe et paie**
- `mark_payroll_period_paid`, `unmark_payroll_period_paid`, `add_payroll_adjustment` : ni période, ni total.
- `set_hourly_rate` : pas de taux précédent.
- `update_member_role`, `update_role_preset`, `set_member_permissions` : JSON brut, pas d'avant → après, nombre de membres touchés absent.

**Automatisations**
- `create_automation_from_text` : la carte montre seulement la phrase de l'utilisateur ; le nom, le déclencheur et les messages sont générés à l'exécution.
- `update_automation_message` : l'ancien texte n'est pas montré.

### Fait dans la PR cartes (`server/lib/lumi/complements-cartes.ts`)

Chaque ligne vient d'une lecture de la base avec les droits de l'utilisateur, juste avant la confirmation.

| Outil | Ce que la carte dit maintenant |
|---|---|
| `refund_payment` | La somme, et « remboursement COMPLET, la facture redevient due » ou « partiel, X sur Y » |
| `charge_card_on_file` | La somme prélevée (le solde) et la carte : marque, 4 derniers chiffres, expiration ; ou « aucune carte au dossier » |
| `remove_card_on_file` | La carte retirée |
| `record_invoice_payment` | Le solde après le paiement |
| `create_payment_request`, `resend_payment_request` | Le montant demandé, le canal par défaut, l'adresse ou le numéro, ou ce qui manque sur la fiche |
| `send_quote_sms` | Le numéro (client, sinon prospect) |
| `send_quote`, `send_invoice` | L'objet et le texte du modèle de l'entreprise quand elle en a un ; sinon l'objet par défaut de la route |
| `delete_client`, `delete_lead` | Le nombre de jobs, soumissions, factures et deals supprimés avec la fiche |
| `delete_job`, `unschedule_job` | Le nombre de visites retirées, avec leurs dates |
| `cancel_visit`, `reschedule_job` | La visite visée quand aucune n'est nommée |
| `delete_team` | Le nombre de membres et de jobs détachés |
| `set_default_availability` | « Toutes les plages sont remplacées par lundi à vendredi, 8 h à 17 h » |
| `set_hourly_rate` | Le taux actuel |
| `mark_payroll_period_paid`, `unmark_payroll_period_paid`, `add_payroll_adjustment` | La période de paie visée |
| `update_role_preset`, `set_member_permissions` | Permissions accordées et retirées, en clair |
| `update_quote`, `update_invoice`, `update_job` et les modèles | « N éléments — remplacent la liste actuelle au complet », chaque ligne avec son total, sous-total |

Reste à faire sur les cartes : X9 (automatisations qui partiront), X10 (carte rouverte), le total de la paie, l'avant → après d'un rôle, le texte généré de `create_automation_from_text`, l'ancien texte de `update_automation_message`, les jalons supprimés par `save_job_billing_milestones`.

### Ce que la session fiabilité a déjà pris

Dans #857 : pas de carte sur une cible introuvable, pas de carte pour un rôle sans le droit, paramètres inconnus refusés avant la carte.

## Ce qui n'a pas pu être déterminé

- Si l'ancienne table `pipeline_deals` reste synchronisée avec `deals`.
- Les textes exacts envoyés par les routes de contrat, de lien de paiement et d'invitation.
- Si `field_territories.assigned_team_id` vise `teams` ou `field_sales_teams`.
- Le fuseau du serveur de prod (X8 ne mord que s'il diffère de celui de l'entreprise).
- Les capacités écrites en appels directs dans des composants n'ont été qu'échantillonnées.
