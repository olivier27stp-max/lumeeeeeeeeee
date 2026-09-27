#!/usr/bin/env bash
# ============================================================================
# lume-backup — copie complète, chiffrée et restaurable de la PROD Lume.
#
#   lume-backup                 (manuel)
#   installé en tâche quotidienne par scripts/install-lume-backup.sh
#
# Produit, par exécution, dans ~/Backups/lume/AAAA-MM-JJ_HHMM/ :
#   backup.tar.age      l'archive chiffrée : full.dump, roles.sql, schema.sql,
#                       data.sql, storage/, manifest.json
#   manifest.json.age   le même manifeste à part, pour que le contrôle de
#                       cohérence du lendemain n'ait pas à ouvrir 100 Mo
#   status.json         résultat, tailles, durées — ni secret, ni RP
#
# ── LA PROD EST EN LECTURE SEULE ───────────────────────────────────────────
# Seules commandes émises contre elle : psql en `default_transaction_read_only`,
# pg_dump, pg_dumpall, et des GET sur /storage/v1/object. Aucune écriture,
# aucun DDL, aucun `supabase link` (qui, lui, ÉCRIT l'historique de migration
# dans la base distante — voir CLAUDE.md).
#
# ── POURQUOI PAS `supabase db dump` ────────────────────────────────────────
# Trois raisons, toutes vérifiées le 2026-09-26 :
#   1. il vise l'hôte direct `db.<ref>.supabase.co`, qui est IPv6 seulement et
#      injoignable depuis ce réseau ;
#   2. `--db-url` met le mot de passe dans argv, donc dans `ps` — le dépôt se
#      l'interdit depuis l'incident du 2026-09-25 ;
#   3. son `--dry-run` IMPRIME le mot de passe de la prod en clair.
# On reproduit donc ses invocations `pg_dump`/`pg_dumpall` à l'identique, par
# le conteneur postgres:17, mot de passe passé par l'environnement.
# Pour les resynchroniser après une mise à jour du CLI :
#     supabase db dump --role-only --dry-run | grep -v '^export PG'
# ⚠️ ne JAMAIS rediriger cette sortie vers un fichier : elle contient le secret.
# ============================================================================
set -euo pipefail

CONF_DIR="${LUME_BACKUP_CONF:-$HOME/.config/lume-backup}"
DEST_ROOT="${LUME_BACKUP_DIR:-$HOME/Backups/lume}"
MIROIR="${LUME_BACKUP_MIRROR:-}"
SERVICE_TROUSSEAU="${LUME_BACKUP_KEYCHAIN_SERVICE:-lume-backup-age}"
IMAGE_PG="${LUME_BACKUP_PG_IMAGE:-postgres:17}"
RET_QUOTIDIENS=7 RET_HEBDOS=4 RET_MENSUELS=12
MIN_LIBRE_MO="${LUME_BACKUP_MIN_FREE_MB:-3000}"
CHUTE_MAX_PCT="${LUME_BACKUP_MAX_DROP_PCT:-20}"
ATTENTE_RESEAU_S="${LUME_BACKUP_NET_WAIT_S:-600}"
POOLERS=(aws-1-ca-central-1.pooler.supabase.com aws-0-ca-central-1.pooler.supabase.com)

STAMP="$(date +%Y-%m-%d_%H%M)"
SORTIE="$DEST_ROOT/$STAMP"
LOGS="$DEST_ROOT/logs"
CACHE="$DEST_ROOT/.cache-storage"
DEBUT=$(date +%s)

journal() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

notifier() {
  osascript -e "display notification \"$1\" with title \"Sauvegarde Lume\" sound name \"Basso\"" >/dev/null 2>&1 || true
}

# Le répertoire de travail contient les données EN CLAIR. Il disparaît quoi
# qu'il arrive : succès, erreur, Ctrl-C, ou arrêt de la machine en cours de
# route. C'est la garantie « aucun fichier en clair ne reste sur le disque ».
TRAVAIL=""
nettoyer() {
  local code=$?
  [ -n "$TRAVAIL" ] && [ -d "$TRAVAIL" ] && rm -rf "$TRAVAIL"
  if [ "$code" -ne 0 ]; then
    journal "ÉCHEC (code $code)"
    mkdir -p "$SORTIE" 2>/dev/null || true
    printf '{"resultat":"FAILED","horodatage":"%s","code":%d}\n' "$(date -u +%FT%TZ)" "$code" \
      > "$SORTIE/status.json" 2>/dev/null || true
    date -u +%FT%TZ > "$DEST_ROOT/.derniere-panne" 2>/dev/null || true
    notifier "ÉCHOUÉE — voir $LOGS"
  fi
  return $code
}
trap nettoyer EXIT INT TERM

echouer() { journal "ERREUR: $*"; exit 1; }

# ── Configuration ──────────────────────────────────────────────────────────
[ -r "$CONF_DIR/env" ] || echouer "configuration absente : $CONF_DIR/env"
[ -r "$CONF_DIR/age-recipient.txt" ] || echouer "clé publique absente : $CONF_DIR/age-recipient.txt"
# `set -a` exporte sans que les valeurs passent par la ligne de commande.
set -a; . "$CONF_DIR/env"; set +a
DESTINATAIRE="$(cat "$CONF_DIR/age-recipient.txt")"
: "${LUME_PROD_REF:?}" "${LUME_PROD_DB_PASSWORD:?}" "${LUME_PROD_URL:?}" "${LUME_PROD_SERVICE_ROLE_KEY:?}"
export PGPASSWORD="$LUME_PROD_DB_PASSWORD"

command -v age >/dev/null || echouer "age introuvable (PATH=$PATH)"
command -v docker >/dev/null || echouer "docker introuvable"

# La clé privée ne touche jamais le disque : elle est lue du trousseau à la
# volée et donnée à age par un descripteur de fichier.
identite() { security find-generic-password -s "$SERVICE_TROUSSEAU" -w | base64 -d; }
identite >/dev/null 2>&1 || echouer "clé age introuvable dans le trousseau ($SERVICE_TROUSSEAU)"

mkdir -p "$DEST_ROOT" "$LOGS" "$CACHE"

# ── Contrôles préalables ───────────────────────────────────────────────────
LIBRE_MO=$(df -m "$DEST_ROOT" | awk 'NR==2{print $4}')
[ "$LIBRE_MO" -ge "$MIN_LIBRE_MO" ] \
  || echouer "espace libre insuffisant : ${LIBRE_MO} Mo < ${MIN_LIBRE_MO} Mo requis. Rien n'est supprimé."

docker info >/dev/null 2>&1 || echouer "le moteur Docker ne répond pas"

# Au réveil de la machine, launchd relance la tâche manquée AVANT que le
# réseau soit monté : c'est ce qui faisait échouer l'ancienne tâche de 3 h
# tous les jours depuis la mi-septembre, avec « aucun pooler ne répond ».
HOTE=""
FIN_ATTENTE=$(( $(date +%s) + ATTENTE_RESEAU_S ))
while :; do
  for h in "${POOLERS[@]}"; do
    if docker run --rm -e PGPASSWORD "$IMAGE_PG" \
         psql -h "$h" -p 5432 -U "postgres.$LUME_PROD_REF" -d postgres \
         -tAc 'select 1' >/dev/null 2>&1; then
      HOTE="$h"; break
    fi
  done
  [ -n "$HOTE" ] && break
  [ "$(date +%s)" -ge "$FIN_ATTENTE" ] && echouer "aucun pooler joignable après ${ATTENTE_RESEAU_S}s"
  journal "réseau pas encore prêt — nouvelle tentative dans 30 s"
  sleep 30
done
journal "pooler : $HOTE (session, port 5432)"

# Chaine de connexion plutot que -h/-p/-U : elle permet les KEEPALIVES, que
# les options en ligne de commande ne portent pas. Sans eux, le pooler
# Supavisor a coupe une extraction de 38 minutes en pleine nuit
# (« SSL error: unexpected eof while reading » pendant COPY public.goals,
# 2026-09-27 03:38). Le mot de passe reste dans PGPASSWORD, jamais ici.
CONNINFO="host=$HOTE port=5432 user=postgres.$LUME_PROD_REF dbname=postgres sslmode=require keepalives=1 keepalives_idle=30 keepalives_interval=10 keepalives_count=5"

# Une coupure de reseau n'est pas une raison de perdre la nuit : on reprend.
# Chaque extraction reecrit son fichier depuis zero, donc reprendre est sur.
reessayer() {
  local etape="$1"; shift
  local essai=1
  until "$@"; do
    if [ "$essai" -ge 3 ]; then
      journal "$etape : abandon apres 3 tentatives"
      return 1
    fi
    journal "$etape : echec, nouvelle tentative $essai/2 dans 30 s"
    essai=$((essai + 1))
    sleep 30
  done
}

# Les répertoires d'un essai raté n'ont pas d'archive : ils ne servent qu'à
# l'enquête. On retire ceux de plus de 14 jours, jamais un qui a réussi.
find "$DEST_ROOT" -maxdepth 1 -type d -name '20*_*' -mtime +14 \
  ! -exec test -f {}/backup.tar.age \; -exec rm -rf {} + 2>/dev/null || true

TRAVAIL="$(mktemp -d "$DEST_ROOT/.travail-XXXXXX")"
chmod 700 "$TRAVAIL"
mkdir -p "$SORTIE"

# psql en lecture seule stricte : même une faute de frappe dans une requête ne
# peut pas écrire dans la prod.
psql_prod() {
  docker run --rm -i -e PGPASSWORD -e PGOPTIONS="-c default_transaction_read_only=on" "$IMAGE_PG" \
    psql "$CONNINFO" -X -tAq "$@"
}
pg_dans_conteneur() {
  docker run --rm -e PGPASSWORD -v "$TRAVAIL:/out" "$IMAGE_PG" "$@"
}

VERSION_PG="$(psql_prod -c 'show server_version')"
journal "serveur PostgreSQL $VERSION_PG"

# ── 1. full.dump — reprise après sinistre par pg_restore ───────────────────
dump_full() {
  rm -f "$TRAVAIL/full.dump"
  pg_dans_conteneur pg_dump "$CONNINFO" --no-owner -Fc -Z6 \
    -n public -n kairo -n archive -n auth -n storage -n supabase_migrations \
    -f /out/full.dump 2>&1 | grep -vE "^pg_dump: (warning|detail|hint)" || true
  [ -s "$TRAVAIL/full.dump" ]
}
journal "full.dump…"
reessayer "full.dump" dump_full || echouer "full.dump impossible"

# ── 2. Le trio de restauration sur un NOUVEAU projet Supabase ──────────────
# Drapeaux repris tels quels de `supabase db dump --dry-run` (v2.118.0).
dump_roles() {
pg_dans_conteneur bash -c '
  set -euo pipefail
  # `-l postgres` et pas `-d` : pour pg_dumpall, -d attend une CHAÎNE de
  # connexion, pas un nom de base — il répond « missing "=" » sinon.
  pg_dumpall -d "$1" -l postgres --roles-only --role postgres \
      --quote-all-identifier --no-role-passwords --no-comments \
  | sed -E "s/^\\\\(un)?restrict .*$/-- &/" \
  | sed -E "s/^CREATE ROLE \"(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)\"/-- &/" \
  | sed -E "s/^ALTER ROLE \"(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)\"/-- &/" \
  | sed -E "s/ (NOSUPERUSER|NOREPLICATION)//g" \
  | sed -E "s/^-- (.* SET \"(pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing)\" .*)/\1/" \
  | sed -E "s/GRANT \".*\" TO \"(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)\"/-- &/" \
  | sed -E "/^--/d" | uniq > /out/roles.sql
  echo "RESET ALL;" >> /out/roles.sql
' _ "$CONNINFO"
[ -s "$TRAVAIL/roles.sql" ]
}
journal "roles.sql…"
reessayer "roles.sql" dump_roles || echouer "roles.sql impossible"

dump_schema() {
pg_dans_conteneur bash -c '
  set -euo pipefail
  pg_dump "$1" --schema-only --quote-all-identifier --role postgres \
    --exclude-schema "information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault" \
  | sed -E "s/^\\\\(un)?restrict .*$/-- &/" > /out/schema.sql
' _ "$CONNINFO"
[ -s "$TRAVAIL/schema.sql" ]
}
journal "schema.sql…"
reessayer "schema.sql" dump_schema || echouer "schema.sql impossible"

# Pas de `--use-copy` dans les appels ci-dessous : c est un drapeau du CLI
# Supabase, pas de pg_dump. Il signifie « ne pas ajouter --column-inserts » —
# or COPY est deja le defaut de pg_dump, donc ne rien passer produit le meme
# fichier. Et aucune apostrophe dans les blocs `bash -c` quotes : elle fermerait
# la chaine et le script serait evalue par le shell appelant.
dump_data() {
pg_dans_conteneur bash -c '
  set -euo pipefail
  { echo "SET session_replication_role = replica;"; echo; } > /out/data.sql
  pg_dump "$1" --data-only --quote-all-identifier --role postgres \
    --exclude-schema "information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor" \
    --exclude-table "auth.schema_migrations" --exclude-table "storage.migrations" \
    --exclude-table "supabase_functions.migrations" --schema "*" \
  | sed -E "s/^\\\\(un)?restrict .*$/-- &/" >> /out/data.sql
  echo "RESET ALL;" >> /out/data.sql
' _ "$CONNINFO"
  # Un COPY coupe en plein vol laisse un fichier tronque mais non vide : on
  # exige la ligne de cloture que pg_dump n ecrit qu apres avoir tout sorti.
  tail -3 "$TRAVAIL/data.sql" | grep -q "RESET ALL;"
}
journal "data.sql…"
reessayer "data.sql" dump_data || echouer "data.sql incomplet — le pooler a coupe 3 fois"

# ── 3. Les comptes et les métadonnées Storage sont-ils VRAIMENT là ? ───────
# Le dump de SCHÉMA exclut délibérément `auth` et `storage` (la plateforme les
# recrée) ; ce sont les DONNÉES qui comptent, et elles doivent s'y trouver.
# Sans ce contrôle, on découvrirait l'absence des 26 comptes le jour du
# sinistre.
manque=""
grep -qE '^COPY "?auth"?\."?users"?' "$TRAVAIL/data.sql" || manque="$manque auth.users"
grep -qE '^COPY "?storage"?\."?objects"?' "$TRAVAIL/data.sql" || manque="$manque storage.objects"
if [ -n "$manque" ]; then
  journal "rattrapage explicite :$manque"
  pg_dans_conteneur bash -c '
    set -euo pipefail
    pg_dump "$1" --data-only --quote-all-identifier \
      -t auth.users -t auth.identities -t storage.buckets -t storage.objects > /out/data-comptes-storage.sql
  ' _ "$CONNINFO"
  [ -s "$TRAVAIL/data-comptes-storage.sql" ] || echouer "rattrapage de$manque impossible"
fi
pg_restore --list "$TRAVAIL/full.dump" >/dev/null 2>&1 || \
  docker run --rm -v "$TRAVAIL:/b" "$IMAGE_PG" pg_restore --list /b/full.dump >/dev/null 2>&1 || \
  echouer "full.dump illisible par pg_restore"

# ── 3bis. Les tâches cron, que pg_dump ne peut PAS sauvegarder ────────────
# `cron.job` appartient à l'extension pg_cron : pg_dump saute les tables
# membres d'une extension, donc `-n cron` ne ramène rien. Découvert le
# 2026-09-26 par le test de restauration, qui a vu les 11 tâches disparaître.
# On les réémet en appels `cron.schedule()` : directement rejouables sur un
# nouveau projet, et lisibles par un humain à 3 h du matin.
# L'historique d'exécution (`cron.job_run_details`) n'est pas sauvegardé :
# c'est un journal, pas une configuration.
journal "cron-jobs.sql…"
{
  echo "-- Tâches planifiées de la prod, réémises par lume-backup."
  echo "-- À rejouer APRÈS avoir activé l'extension pg_cron sur le projet cible."
  psql_prod -c "select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command) from cron.job where active order by jobname"
  echo "-- Tâches DÉSACTIVÉES au moment de la sauvegarde (à ne réactiver qu'en connaissance de cause) :"
  psql_prod -c "select format('-- inactive: select cron.schedule(%L, %L, %L);', jobname, schedule, command) from cron.job where not active order by jobname"
} > "$TRAVAIL/cron-jobs.sql"
NB_CRON=$(grep -c '^select cron.schedule' "$TRAVAIL/cron-jobs.sql" || true)
[ "$NB_CRON" -gt 0 ] || echouer "aucune tâche cron capturée — la prod en déclare pourtant"
journal "cron : $NB_CRON tâche(s) active(s)"

# ── 4. Storage, en incrémental ─────────────────────────────────────────────
journal "storage…"
mkdir -p "$TRAVAIL/storage"
if [ -f "$CACHE/storage.tar.age" ]; then
  # Le cache du passage précédent évite de retélécharger les 87 Mo chaque nuit.
  age -d -i <(identite) "$CACHE/storage.tar.age" | tar -x -C "$TRAVAIL/storage" || {
    journal "cache Storage illisible — téléchargement complet"
    rm -rf "$TRAVAIL/storage"; mkdir -p "$TRAVAIL/storage"
  }
fi
psql_prod -c "select coalesce(json_agg(json_build_object('b',bucket_id,'n',name,'e',metadata->>'eTag','s',(metadata->>'size')::bigint)),'[]'::json) from storage.objects where bucket_id is not null and name is not null" \
  > "$TRAVAIL/.objets.json"
RESUME_STORAGE="$(python3 "$(dirname "$0")/lume-backup-storage.py" "$TRAVAIL/storage" "$TRAVAIL/.objets.json")" \
  || echouer "des objets Storage n'ont pas pu être récupérés : $RESUME_STORAGE"
rm -f "$TRAVAIL/.objets.json"
journal "storage : $RESUME_STORAGE"
# Le cache est réécrit chiffré, jamais en clair.
tar -C "$TRAVAIL/storage" -cf - . | age -r "$DESTINATAIRE" -o "$CACHE/storage.tar.age.tmp"
mv -f "$CACHE/storage.tar.age.tmp" "$CACHE/storage.tar.age"

# ── 5. manifest.json ───────────────────────────────────────────────────────
journal "manifest…"
COMPTES_JSON="$(psql_prod -c "
  select coalesce(json_object_agg(t, n)::text,'{}') from (
    select table_schema||'.'||table_name as t,
           (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as n
      from information_schema.tables
     where table_type='BASE TABLE'
       and table_schema in ('public','kairo','archive','auth','storage','cron','supabase_migrations')
  ) s")"

# Les objets structurels : c est ce que `lume-restore-test` recomptera dans la
# base restauree. Un dump qui rapporte les bonnes lignes mais a perdu 900
# policies RLS serait une catastrophe silencieuse — toutes les donnees de tous
# les clients visibles par tout le monde.
OBJETS_JSON="$(psql_prod -c "
  select json_build_object(
    'policies',  (select count(*) from pg_policies where schemaname in ('public','kairo','archive','storage','auth')),
    'fonctions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','kairo','archive')),
    'triggers',  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','kairo','archive')),
    'vues',      (select count(*) from pg_views where schemaname in ('public','kairo','archive')),
    'tables_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and n.nspname in ('public','kairo','archive')),
    'liste_policies', (select coalesce(json_agg(x order by x),'[]'::json) from (select schemaname||'.'||tablename||'.'||policyname as x from pg_policies where schemaname in ('public','kairo','archive','storage','auth')) p),
    'liste_triggers', (select coalesce(json_agg(x order by x),'[]'::json) from (select n.nspname||'.'||c.relname||'.'||t.tgname as x from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','kairo','archive')) g),
    'liste_fonctions', (select coalesce(json_agg(x order by x),'[]'::json) from (select n.nspname||'.'||p.proname as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','kairo','archive')) f),
    'extensions', (select coalesce(json_agg(x order by x),'[]'::json) from (select e.extname||' '||e.extversion||' @'||n.nspname as x from pg_extension e join pg_namespace n on n.oid=e.extnamespace) x)
  )::text")"

python3 - "$TRAVAIL" "$VERSION_PG" "$STAMP" "$RESUME_STORAGE" "$COMPTES_JSON" "$OBJETS_JSON" <<'PY'
import hashlib, json, pathlib, sys
travail = pathlib.Path(sys.argv[1])
manifeste = {
    "horodatage": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "etiquette": sys.argv[3],
    "version_postgres": sys.argv[2],
    "storage": json.loads(sys.argv[4]),
    "lignes_par_table": json.loads(sys.argv[5]),
    "objets": json.loads(sys.argv[6]),
    "fichiers": {},
}
manifeste["lignes_total"] = sum(manifeste["lignes_par_table"].values())
for chemin in sorted(travail.rglob("*")):
    if chemin.is_file() and chemin.name != "manifest.json":
        h = hashlib.sha256()
        with open(chemin, "rb") as f:
            for bloc in iter(lambda: f.read(1 << 20), b""):
                h.update(bloc)
        manifeste["fichiers"][str(chemin.relative_to(travail))] = {
            "octets": chemin.stat().st_size, "sha256": h.hexdigest()}
(travail / "manifest.json").write_text(json.dumps(manifeste, indent=1, sort_keys=True))
o = manifeste["objets"]
print(f"{manifeste['lignes_total']} lignes sur {len(manifeste['lignes_par_table'])} tables, "
      f"{len(manifeste['fichiers'])} fichiers, {o['policies']} policies, "
      f"{o['fonctions']} fonctions, {o['triggers']} triggers")
PY

# ── 6. Garde-fou : une chute brutale du volume est un signal d'alarme ──────
# La derniere REUSSIE, pas le dernier dossier. Un dossier d'echec n'a pas de
# manifeste : le comparer revenait a sauter le controle en silence, precisement
# le lendemain d'une panne — c'est-a-dire quand on en a le plus besoin.
PRECEDENT=""
for d in $(ls -1dr "$DEST_ROOT"/20*_*/ 2>/dev/null || true); do
  case "$d" in *"$STAMP"/) continue ;; esac
  if [ -f "${d}manifest.json.age" ] && grep -q '"resultat": "OK"' "${d}status.json" 2>/dev/null; then
    PRECEDENT="$d"; break
  fi
done
if [ -n "$PRECEDENT" ]; then
  journal "reference du controle : $(basename "${PRECEDENT%/}")"
  AVANT=$(age -d -i <(identite) "${PRECEDENT}manifest.json.age" | python3 -c 'import json,sys;print(json.load(sys.stdin)["lignes_total"])' 2>/dev/null || echo 0)
  APRES=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["lignes_total"])' "$TRAVAIL/manifest.json")
  if [ "$AVANT" -gt 0 ]; then
    CHUTE=$(( (AVANT - APRES) * 100 / AVANT ))
    if [ "$CHUTE" -gt "$CHUTE_MAX_PCT" ]; then
      echouer "chute de ${CHUTE}% du nombre de lignes ($AVANT → $APRES). Sauvegarde marquée FAILED, aucune rotation."
    fi
    journal "variation des lignes : $AVANT → $APRES"
  fi
fi

# ── 7. Archive, chiffrement, effacement du clair, vérification ────────────
journal "archivage et chiffrement…"
# Le tar ne touche jamais le disque en clair : il est chiffré à la volée.
tar -C "$TRAVAIL" -cf - . | age -r "$DESTINATAIRE" -o "$SORTIE/backup.tar.age"
age -r "$DESTINATAIRE" -o "$SORTIE/manifest.json.age" < "$TRAVAIL/manifest.json"
rm -rf "$TRAVAIL"; TRAVAIL=""

age -d -i <(identite) "$SORTIE/backup.tar.age" | tar -tf - >/dev/null \
  || echouer "l'archive chiffrée ne se relit pas — sauvegarde inutilisable"

TAILLE=$(du -m "$SORTIE/backup.tar.age" | cut -f1)
DUREE=$(( $(date +%s) - DEBUT ))
SHA="$(shasum -a 256 "$SORTIE/backup.tar.age" | cut -d' ' -f1)"
python3 - "$SORTIE/status.json" "$STAMP" "$TAILLE" "$DUREE" "$SHA" <<'PY'
import json, sys, datetime
json.dump({"resultat": "OK", "etiquette": sys.argv[2],
           "horodatage": datetime.datetime.utcnow().isoformat()+"Z",
           "taille_mo": int(sys.argv[3]), "duree_s": int(sys.argv[4]),
           "sha256_archive": sys.argv[5]}, open(sys.argv[1], "w"), indent=1)
PY
date -u +%FT%TZ > "$DEST_ROOT/.derniere-reussite"
rm -f "$DEST_ROOT/.derniere-panne"
journal "OK — ${TAILLE} Mo chiffrés en ${DUREE}s → $SORTIE"

# ── 8. Miroir hors machine (facultatif) ────────────────────────────────────
if [ -n "$MIROIR" ] && [ -d "$MIROIR" ]; then
  mkdir -p "$MIROIR/$STAMP"
  cp "$SORTIE"/*.age "$SORTIE/status.json" "$MIROIR/$STAMP/"
  journal "miroir : $MIROIR/$STAMP"
elif [ -n "$MIROIR" ]; then
  journal "miroir $MIROIR injoignable — la copie locale reste valide"
  notifier "Miroir injoignable, copie locale seulement"
fi

# ── 9. Rotation — seulement maintenant, et seulement si on vient de réussir ─
# Règle absolue : on ne retire jamais une sauvegarde sans en avoir fabriqué
# une neuve et vérifiée juste avant. Ce bloc n'est atteint qu'en cas de succès.
python3 - "$DEST_ROOT" "$RET_QUOTIDIENS" "$RET_HEBDOS" "$RET_MENSUELS" <<'PY'
import datetime, pathlib, shutil, sys
racine = pathlib.Path(sys.argv[1]); q, h, m = map(int, sys.argv[2:5])
sauvegardes = []
for d in sorted(racine.glob("20*_*")):
    if (d / "status.json").is_file() and (d / "backup.tar.age").is_file():
        try: sauvegardes.append((datetime.datetime.strptime(d.name, "%Y-%m-%d_%H%M"), d))
        except ValueError: pass
sauvegardes.sort(reverse=True)
garder = {d for _, d in sauvegardes[:q]}
for cle, combien in (("%G-W%V", h), ("%Y-%m", m)):
    vus = {}
    for date, d in sauvegardes:
        vus.setdefault(date.strftime(cle), d)
    garder |= set(list(vus.values())[:combien])
retires = [d for _, d in sauvegardes if d not in garder]
# Filet supplémentaire : jamais descendre sous 3 sauvegardes.
if len(sauvegardes) - len(retires) < 3:
    retires = []
for d in retires:
    shutil.rmtree(d)
print(f"rotation : {len(sauvegardes)} présentes, {len(retires)} retirée(s), {len(sauvegardes)-len(retires)} conservée(s)")
PY
