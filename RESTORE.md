# Restaurer Lume depuis une sauvegarde

> **Lis les cinq lignes suivantes avant tout le reste.**
>
> 1. Sans la clé `age`, **aucune sauvegarde n'est lisible**. Elle est dans le trousseau macOS, service `lume-backup-age`. Récupère-la : `security find-generic-password -s lume-backup-age -w | base64 -d`
> 2. Si ce Mac est mort, prends la copie de cette clé dans ton gestionnaire de mots de passe. C'est la seule autre copie.
> 3. Les sauvegardes sont dans `~/Backups/lume/AAAA-MM-JJ_HHMM/`. La plus récente réussie a `"resultat": "OK"` dans son `status.json`.
> 4. **Ne touche pas à la prod cassée** avant d'avoir une restauration qui marche ailleurs. Une prod en panne reste une source de données ; une prod à moitié réparée, non.
> 5. Tout ce qui suit se fait sur ta machine, sans rien écrire dans Supabase, jusqu'à l'étape 3.

---

## 0. Ce dont tu as besoin

| Outil | Vérifier | Si absent |
|---|---|---|
| `age` | `age --version` | `~/.local/bin/age` — sinon binaire sur github.com/FiloSottile/age/releases |
| Docker | `docker info` | démarrer Docker Desktop |
| `python3` | `python3 --version` | fourni par macOS |

```bash
export PATH="$HOME/.local/bin:$PATH"
# La plus récente RÉUSSIE. Ne prends jamais « le dernier dossier » : une
# sauvegarde interrompue en laisse un, avec un status.json FAILED et aucune
# archive dedans. C'est arrivé la nuit du 2026-09-27.
SAUVE=$(for d in $(ls -1dr ~/Backups/lume/20*_*/); do
          [ -f "$d/backup.tar.age" ] && grep -q '"resultat": "OK"' "$d/status.json" 2>/dev/null && { echo "${d%/}"; break; }
        done)
echo "$SAUVE"
```

Si cette commande ne renvoie rien, **aucune sauvegarde locale n'est exploitable** : passe à la copie sur la tour, ou au dernier `.dump` de `~/"Lume desktop"/lume-backups/` (non chiffré, ancien système).

## 1. Déchiffrer

```bash
TRAVAIL=$(mktemp -d); chmod 700 "$TRAVAIL"
age -d -i <(security find-generic-password -s lume-backup-age -w | base64 -d) \
    "$SAUVE/backup.tar.age" | tar -x -C "$TRAVAIL"
ls "$TRAVAIL"
```

Tu dois voir : `full.dump`, `roles.sql`, `schema.sql`, `data.sql`, `cron-jobs.sql`, `storage/`, `manifest.json`.

> **Le dossier `$TRAVAIL` contient les données en clair de tous tes clients.**
> À la fin : `rm -rf "$TRAVAIL"`. Ne le laisse pas traîner, ne le mets pas dans iCloud.

Ce que la sauvegarde contient, d'après son propre manifeste :

```bash
python3 -c "
import json;m=json.load(open('$TRAVAIL/manifest.json'))
print(m['horodatage'], '| PostgreSQL', m['version_postgres'])
print(m['lignes_total'],'lignes /',len(m['lignes_par_table']),'tables')
o=m['objets'];print(o['policies'],'policies |',o['fonctions'],'fonctions |',o['triggers'],'triggers')
print(m['storage']['objets_attendus'],'fichiers Storage')
"
```

---

## 2. Cas A — restaurer en local, pour vérifier ou pour dépanner

C'est ce que fait `lume-restore-test` chaque dimanche. Pour le faire à la main :

```bash
docker network create lume-secours
docker run -d --rm --name lume-db --network lume-secours \
  -e POSTGRES_PASSWORD=secours -e POSTGRES_DB=lume -p 5433:5432 \
  pgvector/pgvector:pg17
sleep 5
```

Les rôles et extensions que Supabase fournit et qu'un Postgres nu n'a pas :

```bash
docker run --rm -i --network lume-secours -e PGPASSWORD=secours pgvector/pgvector:pg17 \
  psql -h lume-db -U postgres -d lume <<'SQL'
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','authenticator','service_role',
    'dashboard_user','pgbouncer','supabase_admin','supabase_auth_admin',
    'supabase_storage_admin','supabase_functions_admin','supabase_read_only_user',
    'supabase_replication_admin','supabase_etl_admin','pgsodium_keyholder',
    'pgsodium_keyiduser','pgsodium_keymaker','pgtle_admin']
  loop
    if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I',r); end if;
  end loop;
end $$;
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists net;
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists unaccent  with schema extensions;
create extension if not exists vector    with schema extensions;
SQL
```

Puis la restauration :

```bash
docker run --rm --network lume-secours -e PGPASSWORD=secours -v "$TRAVAIL:/b:ro" \
  pgvector/pgvector:pg17 \
  pg_restore -h lume-db -U postgres -d lume --no-owner --no-privileges -j2 /b/full.dump
```

Des erreurs `pg_cron`, `pg_net`, `pgsodium` sont **normales** ici : ces extensions n'existent que chez Supabase. Tout le reste doit passer.

Tu te connectes ensuite sur `localhost:5433`, base `lume`, utilisateur `postgres`, mot de passe `secours`.

Pour tout jeter : `docker rm -f lume-db && docker network rm lume-secours`

---

## 3. Cas B — restaurer sur un NOUVEAU projet Supabase

> C'est le cas du sinistre réel. À partir d'ici, on écrit.

### 3.1 Crée le projet

Même région (`ca-central-1`) et **PostgreSQL 17** ou plus récent. Note son ref et son mot de passe de base.

### 3.2 Active les extensions AVANT tout

Sans ça, la restauration casse au premier `extensions.vector(1536)`. Dans le tableau de bord → Database → Extensions, active :

```
vector      pgcrypto      uuid-ossp     pg_trgm
btree_gist  unaccent      pg_net        pg_cron
pg_stat_statements         supabase_vault
```

La liste exacte de ce que portait la prod est dans le manifeste :

```bash
python3 -c "import json;[print(' ',e) for e in json.load(open('$TRAVAIL/manifest.json'))['objets']['extensions']]"
```

### 3.3 Rôles, schéma, données — dans cet ordre

```bash
NOUVEAU_REF=xxxxxxxxxxxx
export PGPASSWORD='le-mot-de-passe-du-nouveau-projet'
HOTE=aws-1-ca-central-1.pooler.supabase.com     # session pooler, port 5432

for f in roles.sql schema.sql data.sql; do
  echo "── $f"
  docker run --rm -i -e PGPASSWORD -v "$TRAVAIL:/b:ro" postgres:17 \
    psql -h "$HOTE" -p 5432 -U "postgres.$NOUVEAU_REF" -d postgres \
    -v ON_ERROR_STOP=0 -f "/b/$f"
done
```

**N'utilise jamais le port 6543** (transaction pooler) : les dumps y échouent.

`data.sql` commence par `SET session_replication_role = replica;` — c'est volontaire. Il y a des clés étrangères circulaires entre `jobs` et `pipeline_deals`, et entre `invoices` et elle-même : sans cette ligne, l'insertion échoue. Ne la retire pas.

### 3.4 Les tâches planifiées

`pg_dump` **ne peut pas** sauvegarder `cron.job` : la table appartient à l'extension `pg_cron`. Elles sont donc réémises à part.

```bash
docker run --rm -i -e PGPASSWORD -v "$TRAVAIL:/b:ro" postgres:17 \
  psql -h "$HOTE" -p 5432 -U "postgres.$NOUVEAU_REF" -d postgres -f /b/cron-jobs.sql
```

### 3.5 Les fichiers du Storage

Les buckets sont recréés par `data.sql` (table `storage.buckets`). Les **fichiers**, eux, ne sont dans aucun dump SQL — ils viennent du dossier `storage/` de l'archive.

```bash
python3 scripts/lume-restore-storage.py "$TRAVAIL/storage" \
  "https://$NOUVEAU_REF.supabase.co" "LA_CLE_SERVICE_ROLE_DU_NOUVEAU_PROJET"
```

Relançable sans risque : l'envoi est en `x-upsert`.

### 3.6 Rebrancher l'application

Le nouveau projet a de **nouvelles clés**. À changer partout :

| Où | Quoi |
|---|---|
| Railway (variables du service) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_PASSWORD` |
| `.env.local` | les mêmes, pour le dev |
| `~/.config/lume-backup/env` | sinon les sauvegardes continuent de viser l'ancien projet |
| Stripe / Twilio / Resend | les URL de webhook si le domaine change |

Les mots de passe des 26 comptes **restent valides** : leurs empreintes bcrypt sont dans `auth.users`, restaurée par `data.sql`.

---

## 4. Vérifier que la restauration est bonne

```bash
python3 -c "
import json;m=json.load(open('$TRAVAIL/manifest.json'))
print('\n'.join(f'{t} {n}' for t,n in sorted(m['lignes_par_table'].items())))" > /tmp/attendu.txt
```

Puis le même comptage sur la base restaurée, et `diff`. Ou plus simplement : `bash scripts/lume-restore-test.sh <la-sauvegarde>` le fait déjà, contre un Postgres jetable.

Points à contrôler à l'œil :
- `select count(*) from auth.users;` → doit donner le nombre du manifeste
- `select count(*) from pg_policies where schemaname='public';` → **si ce chiffre est bas, arrête tout** : sans les policies RLS, toutes les données de tous les clients sont visibles par tout le monde
- `select jobname, schedule from cron.job;` → les tâches planifiées
- ouvre une image d'un client dans l'app : c'est le seul vrai test du Storage

---

## 5. Ce qui n'est PAS dans la sauvegarde

Sois au clair là-dessus avant d'en avoir besoin.

- **Les secrets de `vault`** (`supabase_vault`). Chiffrés par une clé que la plateforme ne laisse pas sortir. À ressaisir à la main.
- **`cron.job_run_details`** — l'historique d'exécution des tâches. C'est un journal, pas une configuration.
- **La configuration Realtime** et les rôles réservés (`supabase_admin` et compagnie) : recréés par la plateforme sur un nouveau projet. C'est pourquoi `roles.sql` les met en commentaire.
- **Les variables d'environnement de Railway**, les clés Stripe / Twilio / Resend / Anthropic. Elles vivent chez Railway, pas dans Supabase.
- **Les sauvegardes elles-mêmes ne protègent pas de la perte de la clé `age`.** Une copie hors de ce Mac, dans ton gestionnaire de mots de passe : c'est la condition de tout le reste.

---

## 6. Quand ça coince

| Symptôme | Cause | Quoi faire |
|---|---|---|
| `age: no identity matched` | mauvaise clé, ou trousseau verrouillé | déverrouille la session ; sinon la copie du gestionnaire de mots de passe |
| `type "extensions.vector" does not exist` | extensions pas activées | reviens à l'étape 3.2 |
| `pg_dump/psql` gèlent ou coupent | port 6543 | passe en 5432 (session pooler) |
| `violates foreign key constraint` sur `data.sql` | la ligne `session_replication_role` a été retirée | remets-la en tête du fichier |
| `could not connect` la nuit, après un réveil | réseau pas encore monté | `lume-backup` attend déjà jusqu'à 10 min ; sinon relance à la main |
| `SSL error: unexpected eof while reading` pendant un `COPY` | le pooler a coupé une longue extraction | `lume-backup` reprend 3 fois avec keepalives ; si ça persiste, relance de jour |
| le test de restauration signale une dérive de quelques lignes | la prod est vivante ; le manifeste est compté après le dump | normal sous la marge (5 lignes ou 1 %) |

## 7. Lancer une sauvegarde à la main

```bash
export PATH="$HOME/.local/bin:$PATH"
bash ~/"Lume desktop/lumeeeeeeeeee/scripts/lume-backup.sh"
bash ~/"Lume desktop/lumeeeeeeeeee/scripts/install-lume-backup.sh" etat   # où en est-on
```
