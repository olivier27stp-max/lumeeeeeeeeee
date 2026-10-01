# Audit de la page Commissions — Lume

> Audit du 2026-09-30, sur `origin/main` @ `d75ccfa6`.
> Prod en **lecture seule** pendant tout l'audit. Aucune migration, aucune correction de données, aucune écriture distante.

## Résumé

- **Les montants étaient faux.** Sur le tenant de test, 23 commissions sur 28 ne correspondaient pas à l'oracle SQL. Les causes : une base taxes incluses (+14,975 %), des paliers qui ne se déclenchaient jamais (dollars additionnés à des cents), une paie qui versait des estimations de jobs non payés, des totaux tronqués à 1 000 lignes (−88 % sur un gros mois), PayPal jamais commissionné et des mois découpés en UTC. **38 bugs** sont classés au §4 : 10 critiques, 13 élevés.
- **Corrigé dans le code, sans migration :** tout sauf B-05. Toutes les commissions correspondent maintenant à l'oracle au cent près, sauf celle de la facture refaite (RF2), qui exige M1. La page, la paie et le rapport donnent le même chiffre par la même fonction (§5).
- **Rien n'est poussé.** Les correctifs sont dans le worktree `C:\Users\Rafba\lume-commissions-audit` (base `d75ccfa6`), prêts pour une PR quand tu veux.
- **J'ai besoin de toi pour :**
  1. **Réparer les sauvegardes prod** (§0.1). Elles sont en panne depuis le 26 septembre, et le dump exigé avant toute migration est impossible tant que ce n'est pas fait.
  2. **Approuver ou non les 4 migrations** (§9) : M1 (facture refaite), M2 (Loi 25), M3 (index) et M4 (totaux en SQL).
  3. **Trancher les 17 décisions** (§3), surtout D4/D13 (reprise et clôture de période), D7 (split) et D8 (approbation).
  4. **Choisir les fonctionnalités manquantes** à construire (§8). En P0 : un écran pour créer et modifier les plans, qui n'existe pas du tout aujourd'hui.

---

## 0. Méthode et environnement (et écarts avec le brief)

| Point du brief | Ce qui a été fait | Pourquoi |
|---|---|---|
| « Il n'y a pas de staging » | Le staging existe (`boylnjjlhexljmddmjyg`, CLAUDE.md) mais **n'a pas été touché** : tout a roulé dans une pile locale isolée. | Respecte l'intention (rien de partagé). |
| `supabase start` | Pile locale dédiée `C:\Users\Rafba\lume-commissions-db` (API 56421, DB 56422), séparée des piles `relais` et `lumestats` d'autres sessions. | Ports 54761-55460 réservés par Windows. |
| `supabase db pull` | **Non utilisé.** `db pull`/`link` **écrivent** l'historique de migrations sur la base distante (CLAUDE.md). Remplacé par : schéma de la dernière sauvegarde prod (09-26, schéma seul, **aucune donnée**) + les 45 migrations ajoutées depuis + copie des définitions prod pour les 20 objets restants. | Prod strictement en lecture. |
| Vérification « local = prod » | Empreinte md5 de 8 203 objets (colonnes, fonctions + ACL, policies, index, triggers, contraintes, ACL de tables, vues) calculée des deux côtés. **Identique** ; 13 écarts purement cosmétiques (mêmes droits dans un autre ordre, `extensions.` préfixé). | |
| Accès prod | Script `prodq.mjs` → endpoint **read-only** de l'API Management. Vérifié : une tentative d'écriture est refusée par Postgres (`25006 cannot execute CREATE TABLE in a read-only transaction`). | |
| Dump complet avant migration | **Impossible aujourd'hui** : le mot de passe prod de `.env.local` est refusé. Voir §0.1. | |

### 0.1 Alertes hors périmètre découvertes en montant l'environnement

1. **Sauvegardes prod en panne depuis le 2026-09-26.** `../lume-backups/.derniere-reussite` = 2026-09-26 17:35 ; `.derniere-panne` = 2026-09-30 13:08. Cause probable : le mot de passe Postgres prod a été changé et `.env.local` n'a pas suivi (authentification refusée sur le pooler). PITR étant désactivée, **il n'existe aucune sauvegarde de la prod depuis 4 jours.** C'est aussi ce qui bloque le dump exigé avant toute migration.
2. **Dérive prod ↔ `main`** :
   - Les fonctions du « dossier Dépenses » (`cf_assurer_dossier_depenses`, `cf_depenses_champs_base`, `cf_champs_base`, `cf_assurer_champs_base`, `rentabilite_jobs(…, uuid)`, `pointage_secondes_nettes`) **existent en prod** mais leur migration n'est pas sur `main` (elle vit dans la PR #781 non mergée).
   - `supabase/migrations/20260928120000_payments_reference_notes.sql` est sur `main` mais **n'est pas appliquée en prod** (`payments.notes` / `payments.reference` absentes) — migration fantôme.

---

## 1. Inventaire de la page `/commissions`

Accès : route `<Gated permission="commissions.read">` (`src/App.tsx:1689`), entrée de menu `commissions.read` + drapeau `includes_d2d`. La page choisit sa vue selon `currentRole` (pas selon les permissions) : technicien → « Accès refusé », owner/admin → 4 onglets, tout autre rôle → vue personnelle.

### 1.1 Vue owner/admin — onglet « Vue d'ensemble » (`AdminCommissionOverview.tsx`)

| Élément | Ce qu'il affiche / fait | Derrière |
|---|---|---|
| Filtre statut | Tous / En attente / Approuvé / Versé / Reversé | `GET /api/commissions?status=` → `getCommissionEntries` (`commission-engine.ts:596`) |
| Filtre dates (du → au) | Mois courant par défaut | même route, `created_at` entre `from` et `to` + `T23:59:59.999` **sans fuseau (UTC)** |
| Filtre représentant | Membres actifs (`fetchTeamList`) | `userId` passé au serveur (respecté pour admin seulement) |
| Hero « Commissions totales » | `payroll.total` = en attente + approuvé + versé | `GET /api/commissions/payroll-preview` → `getPayrollPreview` (`:661`) ; **ignore le filtre de statut** ; `fmtMoney` arrondi au dollar |
| Courbe cumulée | Somme par jour des `amount` de la liste | JS, par `triggered_at` alors que le filtre serveur est sur `created_at` ; **inclut les reversées** |
| « En bref » : Ventes conclues | `entries.length` | compte les reversées, les estimations et chaque part d'un split |
| « En bref » : Commission moyenne / vente | `total ÷ entries.length` | numérateur sans reversées, dénominateur avec |
| « En bref » : Représentants actifs | nb de `user_id` distincts dans la liste | |
| « En bref » : Versé sur la période | `payroll.paid` | |
| KPI En attente / Approuvé / Versé / Reversé | sommes par statut | `getPayrollPreview` (floats JS sur `amount` en dollars) ; affichés **arrondis au dollar** |
| Classement des représentants (top 5) | somme `amount` par rep | JS ; **inclut les reversées** |
| Donut Répartition | 4 statuts | `getPayrollPreview` |
| Tableau « Entrées de commission » | Vente (= `description`), Rep, Valeur vente (`base_amount`), Commission (+ % arrondi), Statut, « Conclu le » (= `created_at`) | liste ; format `'$' + toLocaleString` (pas de 2 décimales, `en-US`) |
| Bouton ✓ Approuver (pending) | `POST /api/commissions/:id/approve` | `approveCommission` ; admin **et** `team.update` |
| Bouton « Verser » (approved) | `POST /api/commissions/:id/mark-paid` | `markCommissionPaid` ; admin seulement ; pas de `paid_by` |
| Bouton ✗ Annuler/Reverser (pending, approved) | `POST /api/commissions/:id/reverse` sans raison | `reverseCommission` ; **un clic, aucune confirmation** ; écrase `description` |
| « Prochains versements » (5) | pending + approved, tri par `approved_at` desc | JS |

### 1.2 Onglet « Représentants » (`Commissions.tsx` → `RepsTab`)

| Élément | Ce qu'il affiche / fait | Derrière |
|---|---|---|
| Filtres | idem 1.1 | idem |
| Tableau par rep | Ventes, En attente, Versé, Total gagné | `RepCommissionSummary.tsx` (JS) ; « Total gagné » **inclut les reversées** ; l'approuvé n'est dans aucune colonne |
| Clic sur un rep | ouvre la vue personnelle du rep (lecture seule) | `PersonalCommissionView userId=` |
| « Toutes les entrées » + 3 actions | idem 1.1 | handlers **sans `catch`** : un échec ne montre rien |

### 1.3 Onglet « Mes commissions » (admin) et vue d'un rep (`PersonalCommissionView.tsx`)

| Élément | Ce qu'il affiche | Derrière |
|---|---|---|
| Carte « Ma paie » | mode de paie, taux, prévu | `PayrollSummaryCard` → `/api/payroll/current-period` |
| Hero « Commissions gagnées » | somme de **toutes** les entrées (reversées incluses) | JS |
| KPI En attente / Versé / Prochain versement / Ventes conclues | `payroll.pending`, `payroll.paid`, somme approved de la liste, `entries.length` | mixte serveur/JS |
| « Ventes récentes » | tableau sans actions | |
| « Prochains versements » | | |

⚠ Dans l'onglet admin « Mes commissions », le composant est rendu **sans `userId`** → le serveur (appelant admin) renvoie **les commissions de tout le monde** sous le titre « Mes commissions ».

### 1.4 Onglet « Taux » (`RatesPanel`)

| Élément | Ce qu'il fait | Derrière |
|---|---|---|
| Tableau membre / rôle / mode de paie / taux horaire | lecture | `fetchTeamList` + lecture directe `team_members` (Supabase client) |
| Lien « Mode de paie » | ouvre la fiche Équipe | |
| Menu « Plan appliqué » | assigne un plan à un membre | `POST /api/commissions/rules/assign-member` (admin, pas de trace) |
| Colonne « Taux effectif » | % ou forfait du plan, ou « (par défaut) » | `planRateLabel` (`toFixed(2) + ' $'`) |
| Alerte « Aucun plan » | mode commission sans plan | |

### 1.5 Ce qui **n'existe pas** sur la page (demandé par le brief)

- **Créer / modifier / supprimer une règle** : aucune interface. Les fonctions `createCommissionRule`, `updateCommissionRule`, `deleteCommissionRule` de `src/lib/commissionsApi.ts` ne sont appelées par **aucun** écran. Une règle ne se crée que par l'API.
- **Plan par défaut de l'entreprise** et **politique de reprise** (`reversal_policy`) : aucune interface (`updateCommissionSettings` jamais appelé).
- **Démarquer « versé »** : n'existe pas (ni route, ni bouton).
- **Export** : aucun sur la page (l'export CSV existe côté Paie).
- **Verrouillage d'une période payée** : n'existe pas.
- **Split par job** : n'existe pas (le split est une propriété de la règle, voir §2).

---

## 2. Règles de commission telles qu'elles sont codées

Moteur : `server/lib/field-sales/commission-engine.ts`. Stockage : `fs_commission_entries.amount` / `base_amount` en **dollars** (`numeric`), pas en cents.

| Sujet | Ce que fait le code | Référence |
|---|---|---|
| **Base de calcul** | `invoices.total_cents` = sous-total − rabais **+ taxes** (trigger `invoices_apply_status_logic`). La commission est donc calculée **taxes incluses**. Les dépenses du job (`jobs.expenses_cents`) sont ignorées (commission sur le brut, pas la marge). Avec des surcharges par catégorie, la base devient Σ `invoice_items.line_total_cents` (hors taxes) — **deux bases différentes selon la règle**. | `:457`, `:426-452` |
| **Estimation à la création du job** | Une entrée `pending` (« Estimation ») est créée sur `jobs.total_cents` (taxes incluses), seulement si le job est créé depuis le navigateur. Lumi et le serveur n'en créent pas. | `:178`, `src/lib/jobsApi.ts:1136` |
| **Moment où elle est gagnée** | Au **paiement complet** de la facture (`invoices.status = 'paid'`), daté `triggered_at = invoices.paid_at` (= date du dernier paiement). | `:346`, `:489` |
| **Déclencheurs** | Webhook Stripe `payment_intent.succeeded` ; bouton « Marquer payée » (appel **depuis le navigateur**, perdu si l'onglet se ferme) ; outils Lumi `mark_invoice_paid` / `record_invoice_payment`. **PayPal : jamais.** | `payments.ts:318`, `invoicesApi.ts:970` |
| **Types** | `base_kind` `percent` ou `flat` (forfait par facture) ; surcharges par catégorie de service ; paliers de performance (seuil de CA ou de nb de ventes du **mois civil**, bonus % ou fixe **additif**, tous les paliers franchis s'additionnent) ; bonus conditionnel `min_sale_amount`. | `calculateCommissionAmount` `:81` |
| **Mois des paliers** | `new Date(y, m, 1)` dans le **fuseau du serveur** (UTC sur Railway), pas celui de l'entreprise. Cumul = Σ `base_amount` des entrées du rep ce mois-là, **reversées et estimations incluses**. | `:403-414` |
| **Paiement partiel** | Rien tant que la facture n'est pas soldée ; puis 100 % du total. | `:346` |
| **Facture annulée (void)** | Rien. Les commissions restent. | aucun appel |
| **Remboursement** | Seulement via `POST /payments/refund` **et** si le paiement est remboursé en totalité (test **par paiement**, pas par facture). Politique `commission_settings.reversal_policy` : `alert` (défaut) = écrit `reverse_reason` que **rien n'affiche** ; `keep` = rien ; `auto` = passe en `reversed` les entrées **non versées**, les versées restent (**aucune reprise**). Remboursement partiel, remboursement depuis le tableau de bord Stripe (`charge.refunded`), litige, retour en brouillon : **rien**. | `payments.ts:1946`, `:527` |
| **Plusieurs reps (split)** | Défini **sur la règle** (`attribution.mode='split'`, `splits:[{user_id,pct}]`), pas par job. Les bénéficiaires sont ceux de la règle — le vendeur n'est payé que s'il y figure. Les % sont **normalisés** par leur somme (60 % → payé comme 100 %) ; chaque part est arrondie séparément (Σ parts peut dépasser le total d'1 ¢). | `:465-479` |
| **Qui est le rep** | `quotes.salesperson_id` du devis du job → `clients.assigned_to` du lead → `jobs.salesperson_id` → `jobs.created_by`. `invoices.salesperson_id` **n'est jamais lu**. Facture sans job → pas de rep → pas de commission. | `:348-375` |
| **Quelle règle** | Règle active dont `assigned_user_ids` contient le rep (priorité décroissante), sinon `commission_settings.default_rule_id`, sinon rien (journal `AUCUN PLAN`). Membre en mode `hourly` → jamais de commission. | `:378-399`, `:23` |
| **Factures récurrentes / plusieurs factures d'un job** | Prévu : commission sur chaque facture. **Réel** : l'index unique `uniq_job_rep (org_id, job_id, user_id)` bloque la 2ᵉ facture d'un même job pour le même rep ; l'erreur est journalisée et le moteur répond `{created:0, skipped:null}` (aucune lettre morte). | migration `20260906120000` |
| **Changement de taux** | Non rétroactif sur les entrées déjà confirmées (le montant est figé à l'écriture, `calc_breakdown` garde le taux). Mais l'**estimation** est recalculée au taux **du jour du paiement**, pas du jour de la vente. | `:504` |
| **Rep retiré / désactivé** | `team_members.status='inactive'` → la lecture ne trouve pas de fiche → traité comme « sans fiche » → **commission générée quand même**. La Paie, elle, ne liste que les membres actifs : ces commissions n'apparaissent dans aucune paie. | `:28-41`, `payroll.ts` |
| **Statuts** | `pending` → `approved` (manuel ; **automatique** si la facture a un job) → `paid` (manuel, par entrée) ; `reversed` depuis pending/approved. Pas de retour arrière depuis `paid`. | `:475`, `:579`, `:709`, `:733` |
| **Période payée** | La Paie « marque payée » une période = photo dans `payroll_payments`. Les entrées ne changent pas de statut, **rien n'est verrouillé**, une entrée ajoutée ensuite change la paie affichée mais pas la photo. Démarquer = supprimer la photo. | `payroll.ts:384-451` |
| **Période d'appartenance** | Page Commissions, Paie et rapport : `created_at` (date de création de l'entrée — pour une estimation confirmée, c'est la date de **création du job**, pas du paiement). Graphiques : `triggered_at`. | |

---

## 3. Décisions à prendre (règles non définies ou ambiguës dans le code)

Aucune de ces règles n'a été inventée ni codée. Chacune attend ton choix.

| # | Question | État actuel du code | Options |
|---|---|---|---|
| D1 | **Base : facturé ou encaissé ?** | « Encaissé en totalité » (rien avant `paid`). | (a) garder « au solde complet » ; (b) au prorata de chaque paiement ; (c) à la facturation. |
| D2 | **Base : avec ou sans dépenses du job ?** | Sans (brut). | (a) brut ; (b) marge (sous-total − dépenses). |
| D3 | **Rabais** | Déduit (via `total_cents`). À confirmer une fois la base passée avant taxes. | |
| D4 | **Reprise (clawback) quand une commission déjà versée est remboursée** | Aucune. | (a) aucune ; (b) ajustement négatif dans la prochaine période ; (c) seulement si remboursé dans X jours. |
| D5 | **Remboursement partiel** | Rien. | (a) rien ; (b) reprise au prorata. |
| D6 | **Facture annulée (void) après paiement / retour en brouillon** | Rien. | reprise ou non, même politique que D4 ? |
| D7 | **Split** : par règle (actuel) ou **par job** (vendeur + co-vendeur) ? Et si la somme des % < 100 : normaliser (actuel) ou payer tel quel ? | Par règle, normalisé. | |
| D8 | **Approbation** : une commission sur facture liée à un job passe `approved` toute seule ; sans job, il n'y a pas de rep, donc pas de commission. Résultat : l'étape « approuver » n'existe pas en pratique (seules les estimations étaient `pending`, voir B-04). Veux-tu une approbation obligatoire avant la paie ? | approbation automatique | (a) garder l'auto ; (b) tout arrive `pending`, l'admin approuve avant la paie. |
| D9 | **Estimations (job créé, facture non payée)** : réglé comme bug (B-03) — le code dit lui-même qu'elles sont « confirmées au paiement ». Reste à décider : faut-il les annuler quand la facture du job est annulée (I7) ? | restent « Estimation » indéfiniment | lié à D6 |
| D10 | **Rep désactivé** : continue-t-il de toucher les commissions de ses ventes payées après son départ ? | Oui, mais invisibles en paie. | |
| D11 | **Taux figé à quelle date ?** Vente (création du job/devis) ou paiement ? | Paiement. | |
| D12 | **Paliers** : mois civil dans le fuseau de l'entreprise (proposé) ; un palier bonifie-t-il toute la facture qui le franchit ou seulement la part au-dessus du seuil ? | toute la facture | |
| D13 | **Période payée** : verrouillage dur (plus aucune écriture dans une période payée, corrections = ajustement dans la suivante) ? | aucun verrou | exige une migration |
| D14 | **Qui est le vendeur** quand `invoices.salesperson_id` est rempli : priorité à la facture ? | jamais lu | |
| D15 | **Visibilité entre collègues** (`field_settings.show_peer_payouts`, vrai par défaut) : Loi 25 → faux par défaut ? | vrai | migration |
| D16 | **Rentabilité** : la commission doit-elle être comptée comme un coût du job ? | non | |
| D17 | **Facture sans job** (vente directe) : quel rep ? | aucun → pas de commission | |

---

## 4. Bugs trouvés, classés, avec le correctif

Chaque bug « montant » est prouvé par le tenant de test contre l'oracle SQL (`tests/commissions-audit/`). « Corrigé » = code modifié dans ce lot, sans migration. « M1 / M2 » = migration écrite, **en attente de ton OK**.

### Critique — montants faux

| # | Bug | Preuve (avant) | Correctif |
|---|---|---|---|
| B-01 | **Commission calculée taxes incluses** (TPS + TVQ = +14,975 % au Québec), à la projection comme à la confirmation. | 23 lignes sur 28 fausses vs l'oracle ; I1 : 114,98 $ au lieu de 100,00 $ | Base = sous-total − rabais (`baseAvantTaxesCents`). Corrigé. |
| B-02 | **Paliers de performance inopérants** : le cumul du mois (`base_amount`, en **dollars**) était additionné au seuil en **cents** → un seuil de 2 500 $ n'était jamais atteint par l'historique ; mois calculé en UTC (serveur) ; estimations et reprises comptées dans le cumul. | T3 : 17,25 $ au lieu de 21,00 $ ; T5 (30 sept. 23 h 30) classée en octobre, palier perdu | `cumulDuMois()` : cents, mois civil de l'entreprise, seulement les commissions gagnées non reprises. Corrigé. |
| B-03 | **La Paie versait les estimations** (jobs créés, facture pas encore payée). | Estimations de Rita dans la paie de septembre | Paie = mêmes entrées que la page, estimations et reprises exclues. Corrigé. |
| B-04 | **On pouvait approuver puis « Verser » une estimation** : un rep payé pour une vente non encaissée. (En pratique, seules les estimations sont `pending` : une commission confirmée sans job n'a pas de rep.) | Bouton ✓ affiché sur les lignes d'estimation | Serveur refuse (`invoice_id` requis) + bouton masqué. Corrigé. |
| B-05 | **Facture refaite sur un job (payée → remboursée → annulée → supprimée → nouvelle) jamais commissionnée**, en silence (`{created:0, skipped:null}`, aucune lettre morte). | RF2 : 150,00 $ attendus, rien | Échec désormais signalé (`insert_failed` → lettre morte). **Le montant exige M1.** |
| B-06 | **PayPal : aucune commission, jamais.** | aucun appel au moteur dans le flux PayPal | Déclenchement central dans `insertOrUpdatePaymentIdempotent`. Corrigé. |
| B-07 | **« Marquer payée » : commission générée par le NAVIGATEUR** après coup — onglet fermé = rep jamais payé. | `invoicesApi.ts:970` | Générée par le serveur dans la route. Corrigé. |
| B-08 | **Totaux tronqués à 1 000 lignes** (limite `max_rows` de PostgREST) : page et paie sous-évaluées au-delà de 1 000 commissions sur la période, sans erreur. | voir §7 (tenant volumineux) | Lecture paginée pour tous les totaux. Corrigé. |
| B-09 | **Période = date de création de la ligne** : une estimation confirmée garde la date de création du **job**. Payée le 1er janvier → comptée en décembre ; job de juillet payé en septembre → paie de juillet. | Y2 apparaît dans décembre 2025 | Période = `triggered_at` (date de paiement) partout. Corrigé. |
| B-10 | **Bornes de période en UTC** (page, paie — heures ET commissions) : 23 h 30 à Toronto le dernier jour glisse au mois suivant. | I6 (31 août 23 h 30) absente d'août | Bornes dans le fuseau de l'entreprise. Corrigé. |

### Élevé

| # | Bug | Correctif |
|---|---|---|
| B-11 | Split arrondi part par part : Σ parts pouvait dépasser la commission d'1 ¢ (50/50 sur 5 ¢ → 3 + 3). | Plus grand reste, Σ = total exact (test de propriété sur 2 000 cas). Corrigé. |
| B-12 | Remboursement fait dans le tableau de bord Stripe (`charge.refunded`) : aucune reprise. | Même politique que le remboursement depuis Lume. Corrigé. |
| B-13 | Remboursement **après** versement : rien ne le signale. | Commission versée marquée « Remboursée après versement » (visible) ; la Paie affiche l'écart de la période payée. Le montant versé ne bouge pas. Reprise = décision D4. |
| B-14 | Onglet admin « Mes commissions » affichait les commissions **de toute l'équipe**. | Filtré sur soi. Corrigé. |
| B-15 | Un **sales_rep par défaut recevait 403** sur sa propre page (route exigeait `financial.view_reports`, qu'il n'a pas). | `commissions.read`, portée « soi » côté serveur. Corrigé. |
| B-16 | « Commissions gagnées », « Total gagné », classement, moyenne, Finances : **reprises et estimations additionnées** ; chaque part d'un split comptée comme une vente. | Tous les chiffres viennent des totaux serveur. Corrigé. |
| B-17 | Rep désactivé : ses commissions dues disparaissaient de **toutes** les paies. | Il reste visible (marqué inactif) tant qu'une commission lui est due. Fond = D10. |
| B-18 | KPI **arrondis au dollar** (« $1 235 » pour 1 234,56 $), « $ » devant en français, `en-US`. | `Intl` fr-CA / en-CA, 2 décimales. Corrigé. |
| B-19 | **Aucune trace d'audit** (règle, plan, réglages, approbation, versement, reprise). | `audit_events` : auteur, date, avant/après. Corrigé. |
| B-20 | **Aucune validation** : taux 1 000 %, forfait négatif, split à 150 %, bénéficiaire d'un autre tenant. | Schémas Zod + contrôle d'appartenance. Corrigé. |
| B-21 | Via l'API, un membre lisait **les taux et plans de tous ses collègues**. | Non-admin : son plan seulement. Corrigé (côté base : M2). |
| B-22 | « Reverser » : un clic sur une petite croix, sans confirmation ni raison ; la raison **écrasait** la description. | Confirmation obligatoire, raison dans `reverse_reason`. Corrigé. |
| B-23 | Échecs muets : reprise lancée sans lettre morte ; lecture ratée = « 0 touchée » ; drapeau « alert » avalé ; actions de l'onglet Représentants sans `catch` (bouton mort en cas d'erreur). | Lettres mortes + erreurs levées + toasts. Corrigé. |

### Moyen

| # | Bug | Correctif |
|---|---|---|
| B-24 | Rapport « Commissions » : total incluant reprises et estimations ; date = création. | Colonne « Dû » totalisée, date « Gagnée le ». Corrigé. |
| B-25 | Aperçu Finances : noms des reps « — ». | Noms serveur. Corrigé. |
| B-26 | Colonne « Vente » = description technique anglaise en base (« Commission on invoice payment ») ; % = ratio arrondi à l'entier sur base TTC. | N° de facture/job + client ; taux réel de la règle (et part du split). Corrigé. |
| B-27 | Approuver / reverser ne rafraîchissaient pas les totaux. | Rechargés après chaque action. Corrigé. |
| B-28 | Permissions incohérentes : approuver exigeait `team.update`, verser rien ; supprimer une règle rien, la créer `settings.update`. | Alignées. Corrigé. |
| B-29 | « Prochains versements » et Profil comptaient les estimations. | Exclues. Corrigé. |
| B-30 | `PUT /commissions/rules/:id` déclarée deux fois (code mort) ; lecture des noms de règles sans filtre d'org. | Nettoyé. Corrigé. |

### Bas

| # | Bug | État |
|---|---|---|
| B-35 | Onglet « Taux » : un bénéficiaire de split (Sara) était averti « Aucun plan : aucune commission ne sera calculée » alors qu'il en touche. | Affiche « Part de split : 50 % de … ». Corrigé. |
| B-36 | À 390 px, l'onglet « Taux » sortait de l'écran, coupé par le conteneur : **inatteignable** (sans défilement de page, donc invisible aux contrôles habituels). | Onglets défilants. Corrigé (le test E2E vérifie chaque onglet dans la fenêtre). |
| B-37 | Rôles non traduits dans l'onglet « Taux » (« Sales_rep », « Owner », « Technician » en français). | Libellés FR/EN. Corrigé. |
| B-38 | Ordre des membres de l'onglet « Taux » différent à chaque chargement (liste d'équipe non triée). | Tri alphabétique. Corrigé. |
| B-31 | Boutons icônes sans `aria-label`. | Corrigé. |
| B-32 | Dates affichées dans le fuseau du navigateur. | Fuseau de l'entreprise (renvoyé par l'API). Corrigé. |
| B-33 | Page non branchée sur l'i18n (`isFr ? … : …` partout) ; messages d'erreur serveur en anglais affichés tels quels en français. | **Non corrigé** (refonte de traduction, hors correctif ciblé). |
| B-34 | Rapport : fuseau `America/Toronto` codé en dur, pas celui de l'entreprise. | **Non corrigé** (identique pour toutes les orgs actuelles). |

### Hors périmètre, trouvés en chemin (non corrigés — à te soumettre)

- **Sauvegardes prod en panne depuis le 2026-09-26** (§0.1).
- **Factures récurrentes liées à un job : le clonage échoue** — le cron copie `job_id`, que l'index `idx_invoices_one_per_job` refuse. Et les factures par jalon / par visite d'un même job heurtent le même index.
- `invoices_org_job_unique_active_idx` n'exclut pas les factures annulées : on ne peut pas refaire la facture d'un job sans supprimer l'annulée.
- S-05 : tout membre lit `team_members.hourly_rate_cents` de ses collègues ; un membre peut modifier son propre `memberships.hourly_rate_cents` (sans effet sur la paie, qui lit `team_members`).
- La fenêtre « Partage de votre localisation » n'a pas de nom accessible (lecteur d'écran : « dialogue » sans titre).

---

## 5. Écarts entre les sources de chiffres

Toutes les sommes se font en JavaScript sur `amount` (dollars flottants). **Aucune fonction partagée.** Constat avant correction :

| Source | Période filtrée sur | Fuseau des bornes | Statuts comptés | Reversées | Estimations |
|---|---|---|---|---|---|
| Commissions — hero/KPI (admin) | `created_at` | UTC | pending+approved+paid | exclues | incluses |
| Commissions — courbe, classement, moyenne (admin) | `triggered_at` (courbe) | navigateur | tous | **incluses** | incluses |
| Commissions — vue perso « gagnées » | `created_at` | UTC | tous | **incluses** | incluses |
| Commissions — onglet Représentants « Total gagné » | `created_at` | UTC | tous | **incluses** | incluses |
| Paie — sommaire, export CSV, « marquer payée » | `created_at` | UTC (`Z`) — ignore `payroll_settings.timezone` | ≠ reversed | exclues | **incluses (payées)** |
| Paie — « période en cours » | `created_at` | UTC (sans `Z`) | pending+approved+paid | exclues | incluses |
| Rapport « Commissions » | `created_at` | America/Toronto codé en dur | filtre libre | **incluses dans le total** | incluses |
| Finances (aperçu) | `created_at` | — | par rep : tous | **incluses** | incluses |
| Profil (ProfileSettings) | aucune (tout l'historique) | — | pending+approved / paid | — | incluses |
| Rentabilité (`rentabilite_jobs`, `rpc_insights_job_profitability`, Lumi `get_job_profitability`) | — | — | **la commission n'est pas un coût** | | |
| Statistiques, D2D, classement terrain | aucun chiffre de commission | | | | |
| Lumi | ne lit pas les commissions (`get_payroll_summary` = heures seulement) | | | | |

### Après correction

Une seule lecture (`toutesLesEntrees` / `getCommissionEntries`, `server/lib/field-sales/commission-engine.ts`) et une seule règle de totaux (`totauxCommissions`, `commission-periode.ts`), utilisées par :

| Source | Période | Fuseau | Dû = | Prouvé par |
|---|---|---|---|---|
| Page Commissions (vue d'ensemble, représentants, perso) | `triggered_at` | entreprise | en attente + approuvé + versé, sans estimations ni reprises | `api.test.ts`, E2E |
| Paie (sommaire, export, « marquer payée », période en cours) | `triggered_at` | réglage paie, sinon entreprise | idem | `api.test.ts` « paie vs page » : égal au cent pour chaque rep |
| Rapport « Commissions » | `triggered_at` | America/Toronto (B-34) | colonne « Dû » | `api.test.ts` « total Dû = la page » |
| Finances, Profil | via la page | — | idem | typage + revue |

**Écarts qui restent (par conception ou décision) :**
- **Rentabilité** (`rentabilite_jobs`, `rpc_insights_job_profitability`, Lumi `get_job_profitability`, et `analyze_profitability` de la PR #781 non mergée) : la commission **n'est pas un coût du job**. C'est une décision (D16), pas corrigé.
- **Lumi** ne lit aucune commission (`get_payroll_summary` = heures seulement, et le dit). Ses actions de paie passent par les routes corrigées ; ses actions « facture payée » appellent le moteur corrigé.
- **Statistiques, porte-à-porte, classement terrain** : aucun chiffre de commission, donc aucun écart possible.
- **Prod ↔ `main`** : pendant l'audit, une autre session a appliqué en prod des fonctions (dépenses, relances, numéros de tâches) ; aucune ne touche commissions, factures ou paiements (empreinte refaite).

---

## 6. Résultats des tests

Tout tourne contre la pile locale (schéma = prod), jamais contre la prod ni le staging. Le tenant de test est rejoué avant chaque suite.

| Suite | Avant correctifs | Après correctifs | Avec M1 + M2 (prouvé en local, puis retiré) |
|---|---|---|---|
| **Unitaires** (`unitaires.test.ts` : split, base avant taxes, bornes de fuseau, heure d'été, 31 déc., totaux, paliers) | — (fonctions créées) | **19 / 19** | 19 / 19 |
| **Exactitude vs oracle** (`exactitude.test.ts`, 12 tests) | **5 réussis sur 13** (version d'alors) — 23 lignes sur 28 fausses | **9 / 12** — les 3 restants = RF2 | **12 / 12** |
| **API Express réelle** (`api.test.ts` : page = paie = rapport = oracle, RBAC, x-org-id trafiqué, validation, audit) | non mesuré (le rep recevait 403) | **20 / 20** | 20 / 20 |
| **Sécurité RLS** (`securite.test.ts`, jetons réels sur PostgREST) | 6 / 10 | 6 / 10 (côté base, rien ne change sans migration) | **9 / 10** — reste S-05 (décision) |
| **Pagination** (2 506 lignes dont 2 500 au même instant) | — | **1 / 1** | 1 / 1 |
| **E2E Playwright** (bureau 1440, iPad 820, téléphone 390 ; FR et EN ; chaque bouton, filtres, onglets, états chargement / vide / erreur / sans permission, porte mobile, 22 captures de régression) | — | **43 / 43** (2 sautés : la porte mobile ne se teste qu'en téléphone) ; 2ᵉ passe contre les captures : **0 régression** | — |
| **Suite du dépôt** (`npm test`) | — | **5 461 réussis**, 0 échec (les tests d'audit sont opt-in : `COMMISSIONS_AUDIT=1`) | — |
| **`check:schema-refs`** (contre la base locale = prod) | — | **0 écart** : toute colonne citée par le code existe | — |
| `tsc --noEmit` | — | 0 erreur | — |

Les 7 tests encore rouges portent leur raison dans leur nom (`[exige M1]`, `[exige M2]`, `[décision en attente]`).

Constaté par les E2E et **non** couvert par eux : il n'y a aucun bouton pour créer ou modifier une règle, régler le plan par défaut ou la politique de remboursement, démarquer « versé » ou exporter — ces éléments n'existent pas (§1.5, §8).

---

## 7. Performance avant / après

Tenant volumineux : 60 reps, 220 000 commissions sur 24 mois (≈ 10 000 / mois), dont 20 000 estimations. Médiane de 5 appels sur l'API locale. « Avant » = code d'origine (même commit, port 3013).

| Appel | Avant : temps | Avant : total renvoyé | Après : temps | Après : total | Après + index M3 |
|---|---:|---|---:|---|---:|
| Totaux du mois (page) | 41–85 ms | **98 209,60 $ à 99 557,14 $ selon l'appel, au lieu de 819 846,39 $** (−88 %) | 1,5 s | exact | 1,1 s |
| Changement de filtre : année 2025 | 30–58 ms | **103 561 $ à 105 858 $ au lieu de 10 497 617,99 $** | 18 s | exact | 14 s |
| Paie de la période | 59–118 ms | **faux de −720 000 $** | 0,5 s | exact | 0,19 s |
| Liste du mois (1 000 plus récentes) | 114–183 ms | — | 79–97 ms | — | 65 ms |

**Lecture honnête :** « avant » était rapide parce qu'il ne lisait que 1 000 lignes prises au hasard (B-08). « Après » est exact ; il reste lent seulement au-delà de ~10 000 commissions par période, parce qu'il rapatrie chaque ligne (1 000 par aller-retour). À l'échelle actuelle de la prod (27 commissions au total, une seule entreprise), tous les appels sont instantanés.

**EXPLAIN ANALYZE** (même tenant) :

| Requête | Sans index | Avec index M3 |
|---|---|---|
| Liste du mois (service_role) | 145 ms — *Parallel Seq Scan*, 210 000 lignes filtrées | **3,3 ms** — *Index Scan* |
| Cumul du mois d'un rep (paliers) | 20 ms — *Bitmap* sur user_id | **0,36 ms** |
| Même lecture en `authenticated` (RLS active, propriétaire) | 193 ms — *Seq Scan* | **8 ms** |
| Même lecture en `authenticated`, rep (RLS : ses lignes) | 101 ms — *Seq Scan* | (index org+rep) |
| Page de pagination, clé « OR » vs plage | 36 ms | **0,9 ms** (plage retenue) |
| Totaux d'une année **en SQL** (M4, testé dans une transaction annulée) | — | **766 ms** (mois : 60 ms), mêmes totaux au cent |

**Ce qui a été optimisé sans migration :** pagination par clé au lieu de décalage (42 s → 14–18 s sur l'année), boucle quadratique retirée, enrichissements (noms, règles, factures, jobs) en parallèle et bornés à l'org, réponse des totaux passée de ~660 Ko à 15–29 Ko (la liste complète n'est plus renvoyée avec les totaux).
**Ce qui exige une migration :** M3 (index) et M4 (totaux en SQL) — §9.
**N+1 :** aucun (une requête par type d'enrichissement). **Calculs JS qui devraient être en SQL :** les totaux — c'est M4.

---

## 8. Fonctionnalités manquantes (proposition seulement — rien n'a été construit)

Comparaison avec les modules de commissions de ServiceTitan (paie « performance pay » des techniciens et vendeurs), SalesRabbit et Spotio (porte-à-porte, gestion des incitatifs). Classé par utilité pour un entrepreneur qui a des reps et des techniciens.

| Priorité | Manque | Chez les autres | Pourquoi c'est utile ici |
|---|---|---|---|
| **P0** | **Écran pour créer / modifier un plan** (taux, forfait, paliers, bonus, split) et choisir le plan par défaut et la politique de remboursement. | Tous | Aujourd'hui, un plan ne se crée que par l'API : l'onglet « Taux » ne sait qu'assigner un plan existant. Le moteur sait faire paliers, surcharges par catégorie et bonus, mais personne ne peut les régler. |
| **P0** | **Relevé de commission par rep et par période** (PDF/CSV) + **export** depuis la page. | ServiceTitan, Spotio, SalesRabbit | Le rep sait ce qu'on lui doit et pourquoi ; l'entrepreneur a une pièce justificative (Loi 25 : droit d'accès). |
| **P0** | **Clôture de période** : une période payée est figée ; tout changement ultérieur (remboursement, commission tardive) devient une ligne d'ajustement dans la période suivante. | ServiceTitan | Couvre D4/D13 ; le signal d'écart ajouté (B-13) n'en est que l'alarme. |
| P1 | **Split par job** (vendeur + co-vendeur ou technicien), réglé sur le devis ou le job. | ServiceTitan, SalesRabbit | Le split actuel est figé dans la règle : il ne sait pas qui a vraiment participé à une vente. |
| P1 | **Commission technicien** (prime à la réalisation, % de la main-d'œuvre, lead généré par le technicien). | ServiceTitan (« tech-generated leads ») | Les techniciens sont exclus du module ; un lead vendu à partir d'une visite n'est jamais récompensé. |
| P1 | **Reprise configurable** (délai : remboursé dans les X jours = reprise, sinon non). | SalesRabbit (« chargebacks »), Spotio | Règle standard du porte-à-porte ; tranche D4/D5. |
| P1 | **Prime ponctuelle / concours** (« spiff ») en une ligne, avec raison. | Tous | Aujourd'hui seulement via un ajustement de paie, invisible sur la page Commissions. |
| P2 | **Commission du gestionnaire** (« override » : % sur les ventes de son équipe). | SalesRabbit, Spotio | Courant dès qu'il y a un chef d'équipe. |
| P2 | **Commission sur la marge** (sous-total − dépenses du job) comme option de plan. | ServiceTitan | Le dossier Dépenses existe maintenant ; utile pour les jobs à forts coûts de matériaux (D2). |
| P2 | **Contestation d'une ligne** par le rep (commentaire, statut « contestée »). | Spotio | Évite les litiges par texto. |
| P3 | **Notification** au rep quand une commission est gagnée, approuvée, versée. | SalesRabbit | Motivation, et moins de « est-ce que j'ai été payé ? ». |
| P3 | **Objectifs et accélérateurs** (taux qui monte au-delà d'un quota). | Spotio | Les paliers existent dans le moteur ; il manque l'écran et le suivi du quota. |

---

## 9. Migrations — appliquées le 2026-09-30

Approuvées par Rafba le 2026-09-30, appliquées **staging puis prod** après une sauvegarde complète de la prod relue (`../lume-backups/prod-20261001-0010.dump`, 268 tables). Vérifié après coup : index valides, fonction réservée à `service_role`, `check:schema-refs` (staging + prod), `check:broken-objects`, `qa:rls-roles` 24/24, empreinte du schéma prod = staging (hors pgvector, écart préexistant).

| Fichier | Corrige | Preuve |
|---|---|---|
| `20261005600000_commissions_facture_refaite.sql` | B-05 : facture refaite sur un job jamais commissionnée. | Exactitude 12/12 (RF2 payée), idempotence intacte. |
| `20261005600100_commissions_rls_loi25.sql` | S-01 à S-04 : un rep ne lit que SES commissions et SON plan (Loi 25), admin suspendu sans accès, réglages réservés propriétaire/admin, `show_peer_payouts` faux par défaut. | Sécurité : S-01/S-02 au vert. Aucune page ne lit ces tables depuis le navigateur. |
| `20261005600200_commissions_index_periode.sql` | Aucune lecture de période n'avait d'index. | 145 → 3,3 ms ; RLS 193 → 8 ms (§7). |
| `20261005600300_commissions_index_periode_rep.sql` | Vue d'un rep, relevé, cumul des paliers. | Cumul du mois 20 → 0,36 ms. |
| `20261005600400_commissions_totaux_sql.sql` | Totaux d'une période en une requête (`commissions_totaux_periode`). | Année 766 ms au lieu de 14–18 s. `totauxPeriode()` l'utilise et retombe sur la lecture paginée si elle manque ; `tests/commissions-audit/totaux-sql.test.ts` : SQL = code au cent (47/47). |
| `20261005600500_commissions_demo_corbeille.sql` | Les 27 commissions de démonstration de Coquin lavage (juillet, sans facture, 7 156 $) mises à la corbeille (suppression douce). | 0 commission active restante en prod ; retour arrière dans le fichier. |

La politique de reprise (clawback) n'a pas besoin de migration : elle vit dans les réglages (`commission-reglages.ts`).

**Reste hors périmètre :** S-05 (taux horaires) corrigé à part par #818.

---

## 10. Rejouer l'audit

```
# pile locale (schéma = prod) : C:\Users\Rafba\lume-commissions-db  →  npx supabase start
npx tsx tests/commissions-audit/seed.ts                  # tenant de test rejoué via le vrai moteur
npx tsx tests/commissions-audit/comparer.ts              # oracle SQL vs moteur, ligne par ligne
bash ../lume-commissions-db/lancer-app-locale.sh api     # Express 3012, sans aucune clé externe
bash ../lume-commissions-db/lancer-app-locale.sh web     # Vite 5183
COMMISSIONS_AUDIT=1 npx vitest run tests/commissions-audit --no-file-parallelism
npm i --no-save @playwright/test && npx playwright test -c tests/commissions-audit/e2e
psql … -f tests/commissions-audit/volume.sql && npx tsx tests/commissions-audit/perf.mts
```
Sans pile locale, les tests d'intégration se sautent d'eux-mêmes : la CI n'est pas affectée (seuls les tests unitaires tournent).
