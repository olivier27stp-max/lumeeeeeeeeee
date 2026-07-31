# Maintien de la base de données

État au 2026-07-31, après l'audit. Complète `sop_dsr_response.md` (procédure
Loi 25) et `../compliance/ropa.md` (registre des traitements).

**Prérequis pour toutes les commandes** : `SUPABASE_ACCESS_TOKEN` et
`SUPABASE_PROJECT_REF` dans `.env.local`. Le jeton est à l'échelle du **compte
entier** — le générer pour une intervention, le révoquer après.

---

## 1. Ce qui tourne tout seul

Dix tâches planifiées. `pg_cron` 1.6.4.

| Tâche | Quand | Rôle |
|---|---|---|
| `lume_sync_auth_telemetry` | toutes les 15 min | Alimente `login_history` et `active_sessions` depuis `auth.sessions` |
| `lume_invariant_checks` | 04:40 | Exécute les 7 sondes ; écrit toute défaillance dans `security_events` |
| `security-canary-nightly` | 04:17 | Vérifie que les tables de control plane n'ont pas été rouvertes |
| `lume_retention_job` | 04:00 | Rétention des données (Loi 25) |
| `lume_purge_location_data` | 04:30 | Purge des données de géolocalisation |
| `lume_purge_audit_events` | 03:15 | Purge de l'audit au-delà de la rétention |
| `lume_purge_oauth_states` | toutes les heures | Purge des states OAuth expirés |
| `cleanup_lost_pipeline_deals_daily` | 03:00 | Nettoyage métier |
| `cleanup-expired-pipeline-deals` | toutes les heures | Nettoyage métier |
| `lume_release_sms_numbers` | 08:10 | **INACTIF** — libération des numéros SMS |

**Vérifier que tout tourne** — à faire chaque semaine :

```sql
select j.jobname, d.status, d.start_time::timestamp(0), d.return_message
  from cron.job j
  left join lateral (select * from cron.job_run_details d
                      where d.jobid = j.jobid order by start_time desc limit 1) d on true
 where j.active order by j.jobname;
```

Toute ligne `failed`, ou dont `start_time` ne correspond pas à la planification,
est un incident. Un cron qui échoue en silence est un cron qui n'existe pas.

---

## 2. ⚠️ Le trou principal : personne n'est prévenu

**Les sondes écrivent, mais rien ne notifie.** `lume_invariant_checks` consigne
ses défaillances dans `security_events`, et `security_events` n'est lu par
personne automatiquement.

C'est le dernier maillon manquant, et c'est le plus important : une détection
que personne ne regarde équivaut à pas de détection.

**En attendant, contrôle manuel — à faire chaque matin :**

```sql
select created_at::timestamp(0), event_type, severity, details
  from public.security_events
 where source = 'db-cron' and created_at > now() - interval '24 hours'
 order by created_at desc;
```

**Zéro ligne = tout va bien.** Toute ligne est à traiter le jour même.

**Pour fermer ce trou** (une demi-journée) : brancher un webhook sortant sur
l'insertion dans `security_events` (Supabase Database Webhooks → Slack ou
courriel), ou faire lire la table par le serveur au démarrage et à intervalle
régulier.

---

## 3. Contrôles périodiques

### Chaque semaine

**Santé structurelle** — doit renvoyer des zéros partout :

```sql
select (select count(*) from public.check_all_invariants() where failures > 0) as invariants_en_echec,
       (select count(*) from public.check_rls_coverage())                      as rls_incomplete,
       (select count(*) from public.check_cross_tenant_references())           as refs_cross_org,
       (select count(*) from public.check_exposed_trigger_functions())         as triggers_exposes,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.prosecdef and p.proconfig is null)     as secdef_sans_search_path;
```

**Aucun bouton frontend cassé** — la vérification qui a trouvé
`seed_automation_presets` :

```bash
grep -rhoE "\.rpc\(\s*'[a-z_0-9]+'" src/ | grep -oE "'[a-z_0-9]+'" | tr -d "'" | sort -u
```
puis, pour chaque nom, vérifier
`has_function_privilege('authenticated', 'public.<nom>(...)', 'execute')`.
Toute fonction appelée par le front et non exécutable est un bouton mort.

### Chaque mois

**Isolation multi-tenant.** Rejouer la campagne (lecture seule, transactions
annulées) : se faire passer pour un utilisateur réel et compter les lignes
d'autres organisations visibles. Attendu : 0 partout.

> **Lire le compte de couverture, pas seulement le nombre de fuites.** En
> juillet, 123 relations sur 170 n'ont **pas pu** être testées faute de données
> réparties sur plusieurs organisations. Un « 0 fuite » sur une table qui ne
> contient rien à fuir ne prouve rien. Ce contrôle gagne en valeur à mesure que
> de vrais clients arrivent.

**Régénérer le référentiel de schéma** après tout changement structurel :

```bash
node --env-file=.env.local scripts/gen-schema-snapshot.mjs \
  supabase/SCHEMA_SNAPSHOT.md "$(date -u '+%Y-%m-%d %H:%M UTC')"
```

`supabase/complete_schema.sql` est **périmé et marqué comme tel** — il a produit
quatre findings faux pendant l'audit. Ne jamais s'en servir comme référence.

**Requêtes lentes** — `pg_stat_statements` collecte depuis le 2026-07-08 :

```sql
select calls, round(mean_exec_time::numeric,1) as ms_moyen,
       left(replace(query, chr(10), ' '), 120) as requete
  from pg_stat_statements
 where calls > 20 order by mean_exec_time desc limit 20;
```

---

## 4. Que faire quand…

### Une sonde d'invariant remonte une défaillance

1. Identifier laquelle : `select * from public.check_all_invariants();`
2. `cross_tenant_references` → **arrêter et alerter**. Des données d'organisations
   différentes se mélangent : c'est le scénario le plus grave.
3. `invoice_totals_balance` ou `invoice_numbering` → problème de facturation.
   Ne pas corriger en masse : identifier les factures concernées une par une.
4. `rls_coverage` → une table a perdu sa RLS. Vérifier quelle migration l'a créée.
5. `failing_cron_jobs` → voir §1.

### On soupçonne une fuite entre organisations

1. **Ne rien corriger tout de suite.** Mesurer d'abord.
2. Rejouer la campagne d'isolation (§3) pour établir l'étendue.
3. Consulter `login_history` et `active_sessions` pour savoir qui s'est connecté.
4. Créer un incident : `security_incidents` (via l'API, admin requis).
5. Seulement ensuite, corriger — et **tester les deux sens** : le chemin
   légitime doit passer, le chemin d'attaque doit être refusé.

### Il faut restaurer

- **Le PITR n'est PAS activé.** Il n'existe que des **sauvegardes quotidiennes**
  (8 conservées). Perte maximale : **24 heures**.
- Restauration depuis le tableau de bord Supabase → Database → Backups.
- ⚠️ **Aucune restauration n'a jamais été testée.** Une sauvegarde jamais
  restaurée n'est pas une sauvegarde. À faire avant la mise en service.

---

## 5. Modifier la base sans rien casser

Les cinq règles ci-dessous ont toutes été payées comptant pendant l'audit du
31 juillet — treize findings ont dû être retirés.

1. **Lire l'état dans le catalogue, jamais dans le code source.** Sept fausses
   fuites sont venues d'un répertoire en retard de 741 commits ; quatre autres
   d'un `complete_schema.sql` périmé de 121 migrations.
2. **Ne jamais retranscrire un corps de fonction.** Le lire depuis
   `pg_proc.prosrc` et le réécrire tel quel. Une transcription manuelle avait
   introduit des `coalesce()` inexistants.
3. **Remonter dans la fonction appelée** avant de déclarer une route vulnérable.
   Six faux positifs sur sept venaient d'une garde située en aval.
4. **Vérifier l'ACL réelle, pas le `grant` écrit dans la migration.** Un
   durcissement générique peut avoir retiré un droit entre-temps — c'est ce qui
   avait cassé l'inscription pendant une journée.
5. **Tester les deux sens, même en étant sûr de soi.** Le test qui a révélé que
   l'inscription était cassée est celui qui vérifiait qu'on ne la cassait pas.

Et le piège structurel à connaître : **`auth.uid()` vaut NULL sous
`service_role`.** Une garde interne du type
`if not has_org_admin_role(auth.uid(), ...)` refuse alors **tout le monde**, y
compris le serveur légitime. Ce seul motif avait rendu **neuf fonctions
inertes**, dont le droit à l'effacement Loi 25.

---

## 6. Ce qui manque pour un niveau SaaS premium

Par ordre de rentabilité.

| # | Manque | Effort | Pourquoi ça compte |
|---|---|---|---|
| 1 | **Alerte sortante sur `security_events`** | ½ journée | Sans elle, toute la détection installée ne sert à rien |
| 2 | **Tester une restauration** | 2 h | Une sauvegarde jamais restaurée n'est pas une sauvegarde |
| 3 | **Capturer les connexions échouées** | 1 journée | Le login ne passe pas par le serveur ; il faut un Auth Hook Supabase. Sans ça, aucune détection de force brute |
| 4 | **Environnement de staging** | 1 journée | Impossible aujourd'hui de tester une migration ailleurs qu'en production |
| 5 | **Rendre le dossier de migrations exécutable** | 1 journée | 25 collisions de timestamps : `supabase db push` est inutilisable, tout est appliqué à la main, et la dérive est déjà prouvée |
| 6 | **Activer le test d'isolation en CI** | ½ journée | Aujourd'hui il sort **en vert** sans avoir rien testé. Nécessite le point 4 |
| 7 | **PITR** | coût mensuel | Devient difficile à éviter dès le premier vrai client : 24 h de perte, c'est une journée de facturation perdue |
| 8 | **Politique de rotation des secrets** | ½ journée | `secret_rotation_log` est **vide** : aucune rotation n'a jamais été journalisée |
| 9 | **Retirer les 113 tables vides de l'exposition** | 1 journée | La moitié de l'API publique ne sert à rien et n'a jamais été éprouvée |

**Les points 1 et 2 sont ceux à faire avant la mise en service.** Le reste peut
suivre, mais le point 3 devient urgent dès qu'il y a de vrais utilisateurs — un
CRM sans détection de force brute sur l'authentification, c'est une porte sans
serrure sur laquelle personne ne regarde.

### Conformité — état réel

| Table | Contenu | Lecture |
|---|---|---|
| `consents` | **0** | Aucun consentement enregistré |
| `data_export_log` | **0** | Aucun export journalisé, malgré la migration N7.7 déployée le 30/07 — **à vérifier** |
| `dsar_requests` | **0** | Aucune demande reçue (normal avant lancement) |
| `secret_rotation_log` | **0** | Aucune rotation journalisée |
| `security_incidents` | **0** | Aucun incident déclaré |

Ces tables existent et fonctionnent — la déclaration d'incident et l'effacement
DSR ont été réparés le 31 juillet et testés. Elles sont vides parce que rien ne
s'est encore produit, **sauf `data_export_log`** dont le remplissage doit être
confirmé par un export réel.
