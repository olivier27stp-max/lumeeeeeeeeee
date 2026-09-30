# Crédits Lumi : plan (phase 1)

Date : 2026-09-30. Préparé à partir du code sur `origin/main` (e5aebbd0) et de la prod, en **lecture seule**.
## Statut (2026-09-30, soir) : approuvé et livré

**Décisions de Rafba** : go en prod, app mobile aussi, Scale à 347 $, D7 oui (« unlimited » devient les crédits), D8 oui, D9 corrigé.
Pour D1 à D6, non tranchées explicitement, j'ai appliqué ce que le brief demandait déjà :
- **D1** : 1 000 crédits à 3 ¢ ;
- **D2** : période anniversaire mensuelle ;
- **D3** : support hors crédits ;
- **D4** : voix débitée ;
- **D5** : avertissements dans le panneau Lumi ;
- **D6** : aucun $ côté client.

**Migrations** :
- `20261005200000_lumi_credits.sql` : crédits, grand livre et période ;
- `20261005200100_autopilot_fonctionnalite_credits.sql` : fonctionnalité « unlimited » (D7).

Toutes deux sont appliquées **sur staging**. La prod suit, appliquée avant le déploiement du code.

**Sauvegarde** : le dump complet est impossible, car le mot de passe de la base prod est refusé depuis le 2026-09-26. Une sauvegarde ciblée des objets touchés a été faite dans `lume-backups/credits-avant-migration-20260930T195858Z`.

**Preuves** :
- base sur staging, `scripts/qa/eprouver-credits-lumi.mts` : 15/15 ;
- concordance du journal avec l'usage du fournisseur, sur 200 lignes de prod : 200/200 ;
- tests serveur `lumi-credits-serveur` : 22, dont 9 rouges sur l'ancien code ;
- tests d'écran : 51, rouges sur l'ancien code.

**App mobile** : elle n'est dans aucun dépôt accessible. Le serveur ne lui renvoie plus aucun $. Contrat à lui brancher :
- `GET /api/lumi/credits` → `{ inclus, total, utilises, restants, pourcentage, renouvellement_le, palier, avertissement }` ;
- l'événement SSE `done` porte `credits`.

---

*Ci-dessous : l'inventaire et la spécification de la phase 1, tels qu'approuvés.*

---

## 0. Ce que le brief dit et que le dépôt contredit

| Brief | Réalité vérifiée | Effet sur le plan |
|---|---|---|
| « Il n'y a pas de staging » | Staging existe (`boylnjjlhexljmddmjyg`). CLAUDE.md impose staging, puis prod. | Tests d'écriture sur staging ou sur une base locale ; prod en lecture. |
| `supabase db pull` pour la base locale | `db pull` et `link` **écrivent** dans la base distante (historique `supabase_migrations`). Le CLAUDE.md l'interdit sous contrainte de lecture seule. | Utiliser `npm run db:refresh-local` : clone prod → Docker local, en lecture seule côté prod, **anonymisé**. |
| « Next.js » | Vite + React SPA + Express. | Aucun. |
| App mobile | L'app Expo n'est **pas dans ce dépôt**. Sur téléphone, le site affiche la porte « app bientôt ». | Compteur mobile hors de ce dépôt : il faudra le texte et l'endpoint pour l'app Expo (voir §6). |
| Plans 150 / 340 / 495 | En base : 150 / **347** / 495 $ CA. | À corriger ailleurs si 340 est voulu (hors scope). |
| Allocation 45 $ | 45 $ **US de coût API réel** (grille Anthropic en $ US), seulement Autopilot. Scale et Minimum : 0 (Lumi réservé à Autopilot, `20260919000000`). | 1 000 crédits = 30 $ US = **33 % de coût réel en moins** qu'aujourd'hui. Voulu ? (décision D1) |
| Système de crédits | Le 10 septembre, les « lumees » avaient été décidées : 1 lumee = 1 ¢, Autopilot à 25 000 par mois, packs à 50 $, barème par action. Jamais codé. | Le nouveau brief les **remplace** : pas de packs, pas de barème, un débit au coût réel. |
| « Dump complet avant migration » | Les **sauvegardes de la prod échouent depuis le 2026-09-26** : le mot de passe est refusé par le pooler. PITR est désactivé. | **Bloquant** : réparer `SUPABASE_DB_PASSWORD` (le tien) avant toute migration. |

---

## 1. Inventaire : comment ça marche aujourd'hui

**Le 45 $**
- `plans.ai_monthly_budget_cents` vaut 4500 pour Autopilot et 0 ailleurs. Sources : migrations `20260917100000` puis `20260919000000`.
- Aucune métadonnée Stripe n'en parle : les produits sont génériques (« Lume CRM {plan} subscription »).
- Je n'ai pas vérifié les produits Stripe de prod eux-mêmes : les clés disponibles ici sont des clés de test.

**Mesure**
- Chaque appel au modèle est journalisé dans une ligne `ai_usage` :
  - tokens d'entrée, de sortie, cache lu et cache écrit ;
  - `cost_cents` en ¢ US, calculé par `server/lib/lumi/tarifs.ts` à partir de l'usage réel renvoyé par l'API ;
  - `source`.
- Sources en prod sur 30 jours : `lumi` (237 appels, 2,95 $) et `automatisations` (5 appels, 0,03 $).
- **Voix : non débitée.** Le coût de la dictée (Gemini) va dans `lumi_traces` (`routes/agent.ts`), pas dans `ai_usage`.
- **Support : débité à tort.** `support/ia.ts` écrit `source: 'support'` sur le bureau du client, et la dépense compte **toutes** les sources.

**Débit**
- Avant chaque appel, le coût maximal est réservé de façon atomique par `reserve_ai_budget`, avec un verrou par groupe d'entreprises : le pool est partagé entre les bureaux d'un même groupe.
- Après l'appel, `settle_ai_budget` règle le coût réel. Tables `ai_reservations` et `ai_usage_monthly`.
- Un sous-budget « proactif » est limité à 20 % (le brief du matin).
- Il n'y a **aucun identifiant de requête** : un double journal débiterait deux fois.

**À l'épuisement**, on dégrade au lieu de bloquer :
- à 70 %, passage à Haiku ;
- à 90 %, au plus 2 étapes d'outils ;
- à 100 %, plus d'appel au modèle. Les raccourcis et les caches répondent encore, sinon le message « Ton assistant IA avancé est en pause jusqu'au 1er … ».
- Le reste du CRM n'est jamais bloqué.
- Une alerte par palier est envoyée à **l'exploitant**, pas au client.

**Renouvellement** : mois civil de Montréal (`lumi_periode_courante`, `date_trunc('month')`), et non le cycle Stripe.
- Aucun des 3 abonnements Autopilot actifs n'a d'abonnement Stripe (accès offerts).
- Celui de Coquin lavage est **annuel**.

**Report** : aucun. Le compteur repart à zéro chaque mois. On garde ce comportement (demandé).

---

## 2. Où un client voit des dollars d'IA (web)

| Surface | Fichier | Ce qu'on voit | À faire |
|---|---|---|---|
| **Page Lumi** : en-tête | `src/pages/Lumi.tsx:572-587` | « 12.34 $ / 45.00 $ », infobulle « Budget IA du mois », visible par **tous les rôles** | Compteur « 742 / 1 000 crédits · renouvellement le 12 nov. », avec une barre |
| Page Lumi : coût de la conversation | `Lumi.tsx:579-584` | « · cette conversation 0.42 $ » | Retirer (ou le mettre en crédits, voir D6) |
| Page Lumi : coût par réponse | `Lumi.tsx:729-734` | « · 0.03 $ » | Retirer (idem) |
| Page Lumi : bannières | `Lumi.tsx:787-797` | « Le budget IA du mois est atteint… 1er du mois » (code jamais envoyé par le serveur) | Texte en crédits, date de renouvellement réelle |
| Message de pause | `server/lib/lumi/budget.ts:89-93`, Lumi par texto `sms/lumi-sms.ts` | « en pause jusqu'au 1er … » (sans $) | Date de renouvellement réelle |
| Construire avec Lumi | `ClavardageLumi.tsx:126`, `generer-parcours.ts:520` | « Déduit de ton budget Lumi », « budget Lumi du mois atteint » | Dire « crédits Lumi » |
| **Page de prix** | `src/pages/marketing/Pricing.tsx:194-195` | Autopilot : « Illimité » (texte et voix) ; Scale : « Quota mensuel » | « 1 000 crédits Lumi / mois » ; Scale « — » |
| Plans en base | `plans.features` (Autopilot) | « Lume AI Agent (voice + unlimited) », affiché dans Facturation et à l'inscription | Correction de données (D7) |
| Facturation : rétrogradation | `BillingSettings.tsx:628` | « Lume Agent IA (voix + illimité) » | « 1 000 crédits Lumi / mois » |
| Aide et support | `support/carte-app.ts:94` | « déduit du budget Lumi » | Crédits |
| Lumi de vente (site public) | `agent/promptVente.ts:29-33`, `reponsesFixes.ts:28` | « Scale inclut l'agent IA vocal » : **faux** depuis le 19 sept. | Hors scope, mais à corriger (signalé) |
| Conditions | `Terms.tsx:271-295` | rien sur un budget ni « illimité » | Ajouter une ligne sur les crédits inclus (D8) |

**Endpoints qui envoient des $ d'IA au navigateur** : ils sont à corriger même quand rien ne s'affiche.
- `GET /api/lumi/quota` : l'objet budget complet, **plus** les plafonds journaliers de **toute l'instance**, tous clients confondus.
- Les événements SSE `usage` et `done` de `/api/lumi/chat` et `/execute` : `cost_cents` et `budget`.
- `GET /api/lumi/conversations/:id` : `usage.cost_cents`.
- `POST /api/automations/rules/generer` : `cout_cents`.
- `GET /api/billing/plans`, **public, sans connexion** : `ai_monthly_budget_cents: 4500`. Vérifié sur lumecrm.net.
- `GET /api/billing/current` : même champ.
- **PostgREST** : les admins d'un bureau lisent `ai_usage.cost_cents` directement (policy `ai_usage_admin`).

**Courriels et notifications au client** : aucun aujourd'hui. Aucun avertissement à 80 % ni à 100 %.
**Lumi, « il me reste combien ? »** : aucun outil ne lit la consommation. Il **ne peut pas** répondre aujourd'hui.

---

## 3. Clients existants concernés

Abonnements Autopilot actifs en prod : **3**, aucun facturé par Stripe.

| Bureau | Nature | Depuis |
|---|---|---|
| Coquin lavage | ton bureau (annuel, offert) | 2026-04-24 |
| Grok Audit (TEST) | bureau de test | 2026-09-10 |
| ZZ QA Champs (banc de test) | bureau de test | 2026-09-26 |

Aucun client payant n'a donc vu ni signé « 45 $ ». Le site public n'a jamais affiché de montant ; seule la page `/lumi` de l'app l'affichait. **Personne à protéger.**

---

## 4. Spécification (phases 2 et 3, après accord)

**Conversion**
- Coût réel en ¢ US = usage réel du fournisseur × grille (`tarifs.ts`) :
  - Anthropic : entrée, sortie, cache lu et cache écrit, chacun à son prix ;
  - Gemini : tokens audio de la dictée.
- Crédits = coût / 3 ¢. Taux versionné dans la table `lumi_credit_taux`, lue par la base **et** par le serveur.
- Stockés en **micro-crédits entiers** (`ai_usage.credits_micro`), calculés à l'insertion par un trigger. Les 242 lignes existantes sont rattrapées.
- Affichage : `floor(restants)`. Le coût en $ reste dans `cost_cents`, jamais exposé.

**Grand livre** : `ai_usage` existe déjà, une ligne par appel, jamais purgée. On le complète :
- `request_id`, l'identifiant de réponse du fournisseur (`msg_…`), unique par bureau ;
- ajout seulement : UPDATE et DELETE sont refusés par un trigger ;
- l'insertion se fait avec « on conflict do nothing », donc un nouvel essai ne débite jamais deux fois.

**Débit atomique** : on garde `reserve_ai_budget` et `settle_ai_budget`, déjà éprouvés sous 50 tours simultanés. Seule l'unité du plafond change : `lumi_credits_mensuels × 3 ¢`.

**Pool** : partagé par le groupe d'entreprises, comme aujourd'hui. Le détail par utilisateur s'affiche selon la page Rôles (nouvelle clé `lumi.credits_detail`, propriétaire et admin par défaut).

**Renouvellement** : mensuel, au **jour anniversaire** du début d'abonnement, dans le fuseau du bureau (`company_settings.timezone`) :
- une ancre au 31 donne un renouvellement le 30 avril ;
- sans abonnement, repli sur le 1er du mois.
- Pour un plan annuel, « le cycle Stripe » voudrait dire une fois par an, d'où le jour anniversaire mensuel (D2).

**0 crédit** : les raccourcis, les caches, `analyze_profitability` en gabarit, « Optimiser la journée » par le bouton, et tout ce qui n'appelle pas une API payante.
- Le **routeur** Haiku qui classe une demande est un vrai appel : il débite (petit coût, non mesuré séparément en prod).
- Le **support** ne débite plus (D3).

**Voix** : la dictée (Gemini) entre au grand livre, `source: 'voix'` (D4).

**Solde épuisé** : même échelle de dégradation (70 / 90 / 100 %), exprimée en crédits. La date affichée est la vraie date de renouvellement, et le CRM sans IA continue de marcher.

**Affichage**
- **Page Lumi** : compteur et barre discrets, avertissement visible à 80 % et à 100 %.
- **Paramètres › Facturation** :
  - crédits restants et date de renouvellement ;
  - historique par jour et par utilisateur (selon Rôles).
- Un **nouvel endpoint** `GET /api/lumi/credits` ne renvoie que des crédits.
- Tous les endpoints listés au §2 cessent de renvoyer des $ au client. Les comptes internes `@lume-test.ca` gardent le détail technique (D6).

**Lumi** : un outil de lecture `credits_lumi`, et les consignes disent « réponds en crédits, jamais en dollars ». La base d'aide est mise à jour, en FR et en EN.

**Libellé** : via l'i18n (`lumiCredits`), donc renommable en un seul endroit.

---

## 5. Migration proposée (non appliquée)

`supabase/migrations/proposed/20261005100000_lumi_credits.sql`, avec son DOWN complet en pied de fichier :
1. `plans.lumi_credits_mensuels` : Autopilot 1 000 ; Scale et Minimum 0 → 0. **Aucun autre plan n'a d'allocation.**
2. Table `lumi_credit_taux` (version `2026-10` = 3 ¢ US) et fonction `lumi_cents_par_credit()`.
3. `ai_usage` : `request_id`, index unique `(org_id, request_id)`, `credits_micro` et `taux_version` (trigger), rattrapage des 242 lignes, **ajout seulement**.
4. `lumi_periode_debut(org)` (anniversaire, fuseau du bureau) et `lumi_periode_courante(org)`.
5. `lumi_depense_du_mois`, `lumi_credits_utilises` (nouveau) et `reserve_ai_budget` passent en crédits, sur la période anniversaire, **sans le support**.
6. Plus de lecture directe de `ai_usage` ni de `ai_usage_monthly` par `authenticated` (aucun code du navigateur ne les lit, vérifié).

**Stripe** : **aucun changement nécessaire.** Rien dans Stripe ne mentionne l'IA ni 45 $.

**Données** : `plans.features` d'Autopilot, « Lume AI Agent (voice + unlimited) » devient « 1 000 Lumi credits / month ». C'est une correction de données, à approuver séparément (D7).

**Ordre prévu après accord** :
1. réparer les sauvegardes, puis faire un dump complet de la prod ;
2. appliquer sur staging, puis tests et Playwright ;
3. déployer le code ;
4. appliquer en prod (colonne additive d'abord, fonctions ensuite) ;
5. lancer `check:broken-objects`, `db-coherence` et `schema-refs --prod`.

---

## 6. Décisions à prendre (numérotées pour ta réponse)

- **D1.** 1 000 crédits = 30 $ US de coût réel au lieu de 45 $ US aujourd'hui, soit −33 %. On confirme ?
  Repère mesuré en prod (553 appels sur 30 jours) : un appel Lumi coûte en moyenne 0,55 ¢, soit **0,18 crédit**, donc 1 000 crédits ≈ **5 400 appels par mois**. Le bureau le plus actif (un bureau de test) a consommé 1,37 $ en 30 jours, soit 46 crédits ; ton bureau, 1,25 $, soit 42 crédits.
- **D2.** Renouvellement mensuel au **jour anniversaire** de l'abonnement, y compris pour un plan annuel. Sinon le 1er du mois, comme aujourd'hui ?
- **D3.** Le **support** (chat d'aide) ne consomme **pas** de crédits. Aujourd'hui, il en consomme sans que personne l'ait voulu.
- **D4.** La **voix** (dictée) consomme des crédits, au coût réel : environ **0,16 crédit** par dictée (Gemini 2.5 Pro, 0,47 ¢ mesuré en prod, un seul échantillon). Aujourd'hui elle est gratuite par oubli.
- **D5.** Avertissement **au client** à 80 % et à 100 % : dans la page Lumi seulement, ou aussi par courriel au propriétaire ?
- **D6.** Le coût par réponse et par conversation (aujourd'hui en $) : le **retirer** pour les clients, ou l'afficher en crédits (« · 0,4 crédit ») ?
- **D7.** Correction des données `plans.features` d'Autopilot : retirer « unlimited ».
- **D8.** Ajouter aux Conditions (§14) : « Autopilot inclut un nombre de crédits Lumi par mois ; sans report ; à l'épuisement, l'assistant avancé se met en pause jusqu'au renouvellement. »
- **D9 (hors scope, signalé).** La Lumi de vente du site public dit que « Scale inclut l'agent IA vocal ». C'est faux depuis le 19 septembre.

---

## 7. Fichiers qui seront modifiés (phases 2 et 3)

- **Serveur**
  - `server/lib/lumi/budget.ts` (état en crédits, date de renouvellement)
  - `server/lib/lumi/credits.ts` (nouveau : conversion, taux)
  - `server/routes/lumi.ts` (`/quota` → `/credits`, SSE sans $)
  - `server/routes/agent.ts` (voix au grand livre)
  - `server/lib/support/ia.ts` (support : conserver le journal, hors crédits)
  - `server/lib/lumi/generer-parcours.ts`
  - `server/routes/automation-rules.ts` (`cout_cents` retiré)
  - `server/routes/billing.ts` (champ `ai_monthly_budget_cents` retiré des réponses publiques)
  - un outil Lumi `credits_lumi`
  - `server/lib/agent/consignesCollegue.ts` (+ version du prompt)
  - `server/lib/support/carte-app.ts`
- **Navigateur**
  - `src/pages/Lumi.tsx` (compteur, barre, avertissements)
  - `src/pages/settings/BillingSettings.tsx` (section Crédits Lumi, historique)
  - `src/pages/marketing/Pricing.tsx`
  - `src/lib/planFeatures.ts`
  - `src/components/automations/ClavardageLumi.tsx`
  - `src/i18n/fr.ts` et `en.ts` (`lumiCredits`)
  - `src/pages/Terms.tsx` (si D8)
- **Tests** : unitaires (conversion avec et sans cache, voix, arrondis, idempotence, 50 requêtes concurrentes, renouvellement dans le fuseau), sécurité (autre bureau, `tenant_id` tiré de la session, aucun $ dans les réponses), grep final des « $ » d'IA, Playwright (compteur web et iPad, 80 et 100 %, solde épuisé, facturation, FR et EN).
- **App mobile (autre dépôt)** : elle consommera `GET /api/lumi/credits` ; je fournirai le contrat et les textes.

**La landing est dans ce dépôt** (`src/pages/marketing/`) : aucun texte n'est à reporter ailleurs.

---

## Annexe A : définitions actuelles (pour le DOWN)

Définitions de prod au 2026-09-30 de `reserve_ai_budget`, `lumi_depense_du_mois`, `lumi_periode_courante` et `settle_ai_budget` : voir `supabase/migrations/proposed/20261005100000_lumi_credits.down-reference.sql`.
