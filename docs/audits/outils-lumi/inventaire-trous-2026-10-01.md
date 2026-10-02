# Ce qui manque à Lumi : inventaire du 2026-10-01

Deux inventaires en lecture seule du dépôt, faits le 2026-10-01 : ce que l'application permet et que Lumi ne sait pas faire, et les cartes de confirmation qui ne disent pas exactement ce qui va se passer. Les lignes marquées **fait** ont une PR ; le reste est à faire.

Chiffres de départ : 248 outils, dont 181 d'écriture.

## 1. Ce que l'app fait et que Lumi ne fait pas

### Les 15 trous les plus utiles

| # | Trou | Preuve dans le code | État |
|---|---|---|---|
| 1 | Lire une facture au complet ; trouver une facture par numéro ou par client | `getInvoiceById` (`src/lib/invoicesApi.ts`) ; `list_invoices` passait `p_q: null` | **fait** (#865) |
| 2 | Lire une soumission au complet (lignes, dépôt, ouvertures) | `getQuoteById` (`src/lib/quotesApi.ts`) | **fait** (#865) |
| 3 | Le vrai pipeline de ventes | `list_deals`, `update_deal_stage`, `delete_deal` lisent l'ancienne table `pipeline_deals` (`tools-leads.ts:1025`) ; la page `/ventes` utilise `deals`, `pipelines_ventes`, `pipeline_stages` (`src/lib/pipelineVentesApi.ts`) | **fait** : lire, déplacer, abandonner (#867) ; créer et modifier un deal (`create_deal`, `update_deal`, PR outils) |
| 4 | Corriger une feuille de temps (heures, pointage forcé, suppression) | `src/pages/Timesheets.tsx:552-555` | **fait** (PR outils) : `list_time_entries`, `update_time_entry`, `force_punch_out`, `delete_time_entry` |
| 5 | Montants de paie par période, et périodes passées | `GET /payroll/period-summary`, `/payroll/history` | **fait** (PR outils) : `get_payroll_amounts`, `get_payroll_history` |
| 6 | Marquer une soumission approuvée ou en attente à la main | `updateQuoteStatus` (`src/lib/quotesApi.ts`) | **fait** (PR outils) : `set_quote_status` |
| 7 | Commissions : lister, approuver, marquer payées | `server/routes/commissions.ts` (aucun outil) | **fait** (PR outils) : `list_commissions`, `approve_commission`, `mark_commission_paid` — non exécutés pour vrai (aucune commission en attente sur staging) |
| 8 | Horaire d'équipe : qui travaille demain, congés | `src/lib/teamScheduleApi.ts` | **fait** (PR outils) : `get_team_schedule` |
| 9 | Taxes perçues sur une période | `GET /taxes/collected` | **fait** (PR outils) : `get_taxes_collected` |
| 10 | Rabais et dépôt sur une soumission | champs de `createQuote` / `updateQuote` absents des outils | **fait** (PR outils) : `set_quote_discount_deposit` |
| 11 | Restaurer depuis les archives | `src/lib/archiveApi.ts` | **fait** (PR outils) : `list_archived`, `restore_archived` |
| 12 | Modifier les infos de l'entreprise et l'objectif de revenus | `src/pages/CompanySettings.tsx:249-271` | **fait** (PR outils) : `update_company_settings` |
| 13 | Automatisations : supprimer, dupliquer, partir d'un modèle, tout mettre en pause, renommer | `server/routes/automation-rules.ts` | **fait** (PR outils) : `delete_automation_rule`, `duplicate_automation_rule`, `rename_automation_rule`, `pause_all_automations`, `list_automation_templates`, `create_automation_from_template` |
| 14 | Consentement du client (texto, courriel) et champs étendus de la fiche | `definirConsentement` (`src/lib/clientsApi.ts`) | **fait** (PR outils) pour le consentement : `get_client_consent`, `set_client_consent` ; champs étendus de la fiche : à faire |
| 15 | Statistiques : taux de gain des soumissions, modes de paiement, performance d'équipe, versements Stripe | `src/lib/statistiquesApi.ts`, `GET /payments/payouts/*` | **fait** (PR outils) : `get_quote_win_rate`, `get_payment_methods_breakdown`, `get_team_performance`, `list_stripe_payouts` |

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

## 3. La PR des outils : ce qui a été prouvé, ce qui ne l'a pas été

30 outils ajoutés (13 lectures, 17 écritures), dans trois modules : `tools-lot-ventes.ts`, `tools-lot-paie.ts`, `tools-lot-entreprise.ts`.

**Exécution réelle sur staging** (org QA, identité et RLS d'un vrai compte, serveur local dont tous les envois sont redirigés vers une adresse invalide) :

- les 13 lectures répondent (`scripts/qa/lire-outils-lots.mts`) ;
- 15 écritures sur 17 passent (`scripts/qa/executer-outils-staging.mts`) ; les deux autres sont les commissions, ci-dessous ;
- `approve_commission` et `mark_commission_paid` n'ont pas été exécutés : aucune commission en attente sur staging ;
- `restore_archived` échouait sur un job à cause de la base (fonction STABLE qui écrit) ; il passe depuis la migration 20261007200000, appliquée sur staging et prod le 2026-10-01 (#883).

**Coût** : le jeu d'outils de cinq sous-agents grossit (mesuré par `scripts/qa/compter-tokens-sous-agents.mts`, comptage gratuit).

| Sous-agent | Outils | Tokens du jeu d'outils |
|---|---|---|
| devis | 27 → 30 | 6 864 → 7 682 (+12 %) |
| facturation | 52 → 55 | 12 707 → 13 291 (+5 %) |
| clients | 40 → 46 | 9 128 → 10 602 (+16 %) |
| equipe | 42 → 53 | 8 062 → 10 197 (+26 %) |
| rapports | 26 → 33 | 4 932 → 6 268 (+27 %) |

Planification, communications, terrain, mémoire et le jeu de base ne changent pas. L'effet sur la qualité des réponses n'est pas mesuré : c'est la passe d'évaluation de la session fiabilité, après le merge, qui le dira.

**Défauts de l'application trouvés en écrivant ces outils**

| Défaut | Preuve | État |
|---|---|---|
| Corriger un pointage à l'écran ne change pas la paie (l'écran écrit `punch_in`/`punch_out`, la paie lit `punch_in_at`/`punch_out_at`) ; un pointage fermé de force laisse la pause ouverte, donc payée | `src/pages/Timesheets.tsx`, `server/lib/payroll.ts` ; en prod, 28 pointages, aucun corrigé à l'écran à ce jour | corrigé, PR #872 |
| « Restaurer » un client ou un job depuis les Archives échoue : `restore_client`, `restore_job` (et `finish_job`) sont déclarées STABLE et font un UPDATE | `pg_proc.provolatile = 's'` en prod ; exécution réelle sur staging : « Impossible de restaurer ce job » ; 6 jobs archivés en prod | corrigé : migration 20261007200000 appliquée sur staging et prod le 2026-10-01, PR #883 |
| `/taxes/collected` et `/payments/payouts/*` ne vérifient que l'appartenance à l'entreprise, pas un droit financier | `server/routes/taxes.ts:68`, `server/routes/payments.ts:1199-1290` | à décider ; la garde de Lumi exige `financial.view_reports` / `financial.view_payments` |
| Supprimer une entrée de temps est une suppression définitive (pas de `deleted_at` sur `time_entries`) | `src/pages/Timesheets.tsx` | à décider (demande une migration) |

**Choix à connaître**

- `set_quote_status` exige `quotes.approve` ; l'écran laisse faire avec `quotes.update`.
- `update_time_entry` écrit les deux jeux de colonnes (heures affichées et horodatages de paie), comme l'écran après #872.
- `pause_all_automations` sait aussi reprendre (`paused: false`) ; la carte dit que les messages en attente repartent.
- Une automatisation créée depuis un modèle ou dupliquée naît éteinte ; l'outil l'éteint lui-même si la route la rendait active.
- Non construits : annuler un versement de commission, reverser une commission, supprimer un ajustement de paie, restaurer une automatisation de la corbeille.

**Passe en prod du 2026-10-02 (bureau de test, mode « demander », rien n'est exécuté)**

37 demandes sur les 30 outils : 31 exactes, 3 questions de clarification justifiées (deal inexistant, « ma première automatisation » parmi 43, job archivé), 3 ratées, aucun faux « c'est fait ». Les trois ratées et ce qu'elles ont changé :

| Demande | Ce que Lumi répondait | Correction |
|---|---|---|
| « ki travail demain » | « aucune visite planifiée demain » (l'outil des employés n'était pas chargé avec les jobs) | #902 : `get_team_schedule` voisin du sous-agent planification |
| « Quelle équipe a rapporté le plus ce mois-ci ? » | un classement par employé | #902 : `get_team_performance` voisin du sous-agent facturation |
| « Mes clients me paient surtout comment ? » | la page d'aide Facturation (étage sans modèle) | #903 (session fiabilité) |

Rejouées après déploiement : les trois passent. Trois faiblesses vues à cette occasion, corrigées dans les outils eux-mêmes :

- « c koi l'horaire de la gang cette semaine » = sept appels, un par jour (6 ¢, 12 s) → `get_team_schedule` accepte `date_to` (14 jours au plus, un seul appel).
- La grille Horaire n'est presque jamais remplie (2 lignes dans toute la prod, aucune récurrence) : « qui travaille demain » aurait répondu « personne » à une entreprise dont les équipes ont des visites. L'outil rend maintenant les visites de jobs du jour par équipe, avec ses membres (`job_visits`). En prod, l'assignation d'une visite est une ÉQUIPE (`schedule_events.team_id`, 63 visites sur 1 074) ; `assigned_user` n'est jamais rempli.
- Le 2 du mois, une statistique sans période répond « rien ce mois-ci ». Sans date demandée et mois vide, `get_payment_methods_breakdown`, `get_quote_win_rate` et `get_team_performance` se replient sur les 12 derniers mois et le disent (`periode_elargie`). Jamais quand une date est demandée.

Vu, non corrigé : sur une réponse, le modèle a écrit « 45,5 % » pour une part rendue à 46,5 % par l'outil (montants exacts). Une occurrence ; les pourcentages restent ceux de la page Statistiques.

## Ce qui n'a pas pu être déterminé

- Si l'ancienne table `pipeline_deals` reste synchronisée avec `deals`.
- Les textes exacts envoyés par les routes de contrat, de lien de paiement et d'invitation.
- Si `field_territories.assigned_team_id` vise `teams` ou `field_sales_teams`.
- Le fuseau du serveur de prod (X8 ne mord que s'il diffère de celui de l'entreprise).
- Les capacités écrites en appels directs dans des composants n'ont été qu'échantillonnées.
