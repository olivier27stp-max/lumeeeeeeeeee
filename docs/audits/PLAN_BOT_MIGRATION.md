# PLAN — Bot de migration : de l'ancien CRM du client jusqu'à Lume, données vérifiées

Date : 2026-09-15. Base : le module de migration assistée déjà en prod (`server/lib/migration/*`, `server/routes/migration-admin.ts`, `server/routes/migration-portal.ts`, page `src/pages/AdminMigrations.tsx`, 14 tables `migration_*`).

---

## 1. Ce qui existe déjà (et qui est l'essentiel du travail)

Lume a une chaîne de migration complète, déterministe, avec une machine à états de 20 statuts (`state-machine.ts`) :

| Étape | Ce que le code fait tout seul | Ce qu'un humain fait aujourd'hui |
|---|---|---|
| Invitation | jeton haché, portail client temporaire (`migration-portal`) | l'admin Lume crée la migration et envoie l'invitation |
| Fichiers | le client dépose ses exports ; `analyzer.ts` détecte encodage, délimiteur, types, catégorie (clients, propriétés, services, devis, jobs, factures) ; échantillons masqués | rejeter un fichier inutilisable, relancer l'analyse |
| Mapping | `mapping.ts` : synonymes Jobber / Housecall Pro / ServiceTitan / GoHighLevel / QuickBooks, fr + en ; `aiSuggest.ts` (Gemini) pour les colonnes inconnues ; **gabarits réutilisables** par CRM source (`migration_mapping_templates`, routes `save-template` / `apply-template`) | **confirmer ou corriger chaque colonne** (`POST …/mappings/:id`) — le gros du temps humain |
| Normalisation | `normalize.ts` : cents, dates ISO, courriels, téléphones E.164, clés de relation ; lignes `ready` / `error` | — |
| Doublons | `duplicates.ts` : candidats scorés contre les clients ACTIFS du workspace ; **jamais de fusion automatique** | **trancher chaque candidat** (create_new / merge / skip / review) |
| Questions | `migration_issues` : questions au client dans le portail, réponses | **rédiger les questions**, lire les réponses, relancer |
| Import test | `importer.ts` : dry-run qui n'écrit JAMAIS dans les tables actives ; rejets en CSV | lire les rejets, corriger, relancer |
| Approbation | le client approuve dans le portail (`migration_approvals`) | demander l'approbation |
| Import final | idempotent (id déterministe par ligne, `migration_import_records`), rollback qui ne touche que le lot | **cliquer « import final »** |
| Audit | `migration_audit_logs` : chaque action, qui, quand | — |

Autrement dit : le « bot » n'a pas à transférer ni vérifier les données. Le code le fait déjà. Le bot remplace **les décisions humaines répétitives** de la colonne de droite, et laisse les deux gestes irréversibles à un humain : l'approbation du client et l'import final.

## 2. Le principe (le même que pour Lumi)

Le modèle **classe et propose** ; le **code exécute** par les routes et fonctions existantes ; chaque décision du bot est une ligne d'audit (`migration_audit_logs`, acteur = agent) ; rien d'irréversible sans humain ; tout se mesure contre les migrations passées.

## 3. Le plan, par ordre de rendement

### Étape 1 — Mesurer où passe le temps humain (lecture seule, 1 h)
Requête sur `migration_audit_logs` des migrations terminées : nombre d'actions par type (corrections de mapping, décisions de doublons, questions, relances de test) et durée entre statuts. C'est ce qui dit quelle étape automatiser d'abord. Livrable : un tableau dans ce fichier.

### Étape 2 — Gabarits d'abord, sans modèle (S)
À l'analyse d'un fichier : si un gabarit existe pour le même CRM source avec la même signature de colonnes (noms normalisés), l'appliquer d'office (`apply-template` existe) et passer directement à `ready_for_test`. Une PME qui vient de Jobber ressemble à la précédente. Zéro appel LLM, zéro risque nouveau : le gabarit a déjà servi. Test : deux migrations Jobber identiques, la seconde n'a aucune correction humaine.

### Étape 3 — Agent de mapping (M)
Pour les colonnes que ni les synonymes ni un gabarit ne couvrent : **un** appel Sonnet 5 par fichier (pas un par colonne comme `aiSuggest` aujourd'hui), avec les en-têtes, 5 valeurs masquées par colonne et la liste des champs Lume ; sortie JSON stricte : `{ colonne, champ | null, confiance, raison }` validée contre `FieldDef`. Règle : confiance ≥ 0,9 → confirmé par le bot (audit) ; sinon → `migration_issue` avec la question toute prête pour le client (« La colonne “Tel2”, c'est le cellulaire ou le bureau ? »). Jamais un champ inventé : `null` est une réponse valide.
Mesure avant d'activer : rejouer l'agent sur les mappings **finaux** des migrations passées (`migration_field_mappings`) = jeu doré gratuit ; précision par CRM source.

### Étape 4 — Doublons et questions (M)
- Doublons : règle déterministe étendue — même courriel **et** même téléphone normalisés → `merge` d'office ; même nom seul → question au client avec les deux fiches masquées ; le reste → `create_new`. Le modèle ne fusionne jamais ; il rédige la question.
- Questions : le bot regroupe les issues d'un même type en un message portail lisible (« 3 clients sans ville, lesquelles ? »), et relit les réponses pour appliquer la correction (`issues/:id/answer` existe) — encore une sortie JSON validée, jamais une écriture directe.

### Étape 5 — Boucle de test (M)
Après chaque mapping complet : dry-run automatique (`test-import`), lecture des rejets, classification déterministe (date illisible, téléphone invalide, montant non numérique, relation orpheline), correction automatique quand `normalize.ts` sait faire (formats de date, séparateurs de milliers, indicatif), question au client sinon. Arrêt quand 0 erreur ou quand la même erreur revient : `request-approval`. Plafond : 5 tours par migration, puis un humain.

### Étape 6 — Interface (S)
Sur `AdminMigrations.tsx` : un panneau « Ce que le bot a fait » (décisions, confiance, raisons) avec « Annuler cette décision » ; l'humain reprend la main à tout moment. Optionnel : les mêmes actions exposées à Claude / Grok en outils MCP réservés au rôle staff (`migration_status`, `migration_issues`, `migration_answer`) pour piloter une migration en conversation.

### Étape 7 — Évaluation (M)
Jeu doré = migrations passées copiées sur staging (fichiers + mappings finaux + décisions de doublons). Métriques : précision de mapping par CRM source, part de lignes importées sans aucune intervention humaine, nombre de questions posées au client, durée invitation → approbation. Seuil d'activation par étape : pas en dessous de ce que faisait l'humain.

## 4. Ce qui ne change pas, exprès
- L'import final reste un clic humain ; l'approbation reste celle du client.
- Le dry-run reste obligatoire avant toute approbation.
- Les valeurs sources complètes ne vont jamais au modèle (masques de `masks.ts`, comme pour les échantillons).
- Rollback inchangé : lot par lot.

## 5. Ordre et effort

| # | Étape | Effort | LLM | Dépend de |
|---|---|---|---|---|
| 1 | mesure du temps humain | 1 h | non | — |
| 2 | gabarits d'office | S | non | 1 |
| 3 | agent de mapping | M | Sonnet, 1 appel / fichier | jeu doré (3 migrations passées minimum) |
| 4 | doublons + questions | M | Sonnet pour la rédaction seulement | 3 |
| 5 | boucle de test | M | non (normalisation) | 3 |
| 6 | interface | S | — | 3 |
| 7 | évaluation | M | — | 3 |

## 6. Ce qu'il faut de toi
- Combien de migrations réelles ont été faites à ce jour (le jeu doré en dépend : sans au moins 3, l'agent de mapping s'évalue à l'aveugle).
- Le CRM source le plus fréquent chez tes clients (Jobber ? Housecall ?) : c'est par lui qu'on commence les gabarits.
- Confirmer que l'approbation client et l'import final restent humains.

---

## État (2026-09-15, PR #378 fusionnée, en prod)

| Étape | État |
|---|---|
| 1 mesure | faite : une seule migration réelle en prod (`custom_files`, `test_review`) ; 8 décisions de mapping humaines, 70 questions, 0 import — le jeu doré viendra des prochaines migrations |
| 2 gabarits d'office | fait : `appliquerGabarits` (≥ 80 % de couverture, `decided_role: 'template'`) |
| 3 agent de mapping | fait : un appel Sonnet 5 par fichier, échantillons masqués, confirmé ≥ 0,90 sinon question au client avec candidats |
| 4 doublons + questions | fait : règle courriel/téléphone → fusion, nom seul → question, faible → nouvelle fiche ; questions regroupées en un message portail |
| 5 boucle de test | fait : import test partagé (`execution.ts`), constats sur orphelins/invalides, demande d'approbation quand propre |
| 6 interface | fait : « Confier au bot » (passe immédiate), « Activer le bot » (cron 10 min), carte des décisions |
| 7 évaluation | partiel : `scripts/qa/evaluer-bot-migration.mts` (synthétique Jobber, 2 passes, 0,39 ¢, `waiting_for_approval`) ; le jeu doré réel attend des migrations réelles |

Déclencheur « lorsque demandé » : l'admin clique « Confier au bot », ou active le bot et le cron reprend la migration à chaque dépôt de fichier ou réponse du client. Les deux gestes irréversibles restent humains : l'approbation (client) et l'import final (admin).

---

## Mode autonome (2026-09-15, PR #379) — « le client n'a besoin de rien faire »

Principe : quand le bot n'est pas sûr, il choisit l'option qui ne perd rien et qui se défait, et il prévient l'admin Lume, jamais le client.

| Situation | Mode client (avant) | Mode autonome (défaut maintenant) |
|---|---|---|
| Colonne inconnue ou confiance < 0,90 | question au client | conservée dans les notes de la fiche (mapping `rejected` → `_unmapped` → « Champs non importés (ancien CRM) ») ; constat pour l'admin, corrigeable dans la console |
| Doublon sur le nom seul (score ≥ 90, ni courriel ni téléphone) | question au client | nouvelle fiche (fusionnable plus tard dans Lume) |
| Question encore ouverte (posée avant la bascule) | attend le client | reçoit le défaut sûr, sort du portail |
| Reste bloqué (fichier sans catégorie, verdict manquant, erreurs bloquantes, question posée par l'admin) | `waiting_for_client` | reste au statut courant, notification à l'admin (« Migration bloquée »), jamais `waiting_for_client` |
| Import test propre | message au client « approuvez » | message au client « vous n'avez rien à faire » + notification à l'admin « prête : approbation au nom du client » ; rappel toutes les 72 h par le cron |
| Approbation | le client tape la phrase dans le portail | l'admin clique « Approuver au nom du client » (route `approve-on-behalf`) : ligne `migration_approvals` avec `confirmed_text` **null** et commentaire explicite, audit `approval.on_behalf`, message au client. Le bot ne l'appelle jamais. |
| Import final | admin | admin (inchangé) |

Réglage : `data_migrations.bot_mode` (`autonome` par défaut, `client` pour l'ancien parcours), sélecteur dans la carte « Bot de migration » de la console.
Vérification : `scripts/qa/evaluer-bot-migration.mts` (mode autonome par défaut ; `QA_BOT_MODE=client`).
Limite honnête : en mode autonome, le consentement enregistré est celui de l'admin, pas une phrase tapée par le client — l'audit le dit tel quel.
