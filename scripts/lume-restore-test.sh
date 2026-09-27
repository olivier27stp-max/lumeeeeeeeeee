#!/usr/bin/env bash
# ============================================================================
# lume-restore-test — prouve que la dernière sauvegarde est RESTAURABLE.
#
#   lume-restore-test            (dernière sauvegarde)
#   lume-restore-test 2026-09-26_2037   (une en particulier)
#
# Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde, c'est un
# fichier. Ce script déchiffre, restaure dans un PostgreSQL jetable de la même
# version majeure, recompte tout ligne par ligne contre le manifeste, vérifie
# que les policies RLS, les fonctions et les triggers ont suivi, puis détruit
# le conteneur.
#
# Il ne touche jamais la prod : il ne lit que des fichiers locaux.
# ============================================================================
set -euo pipefail

CONF_DIR="${LUME_BACKUP_CONF:-$HOME/.config/lume-backup}"
DEST_ROOT="${LUME_BACKUP_DIR:-$HOME/Backups/lume}"
SERVICE_TROUSSEAU="${LUME_BACKUP_KEYCHAIN_SERVICE:-lume-backup-age}"
# Image du banc d'essai : postgres:17 PLUS pgvector. Sans l'extension
# `vector`, kairo.learning_entries et kairo.memory_entries ne se creent pas
# (colonnes extensions.vector(1536)) et le test accuse a tort la sauvegarde.
IMAGE_PG="${LUME_RESTORE_PG_IMAGE:-pgvector/pgvector:pg17}"
SEUIL_POLICIES_PCT="${LUME_RESTORE_MIN_POLICIES_PCT:-90}"

CONTENEUR="lume-restore-test-$$"
RESEAU="lume-restore-net-$$"
TRAVAIL=""

journal() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

nettoyer() {
  local code=$?
  [ -n "$TRAVAIL" ] && [ -d "$TRAVAIL" ] && rm -rf "$TRAVAIL"
  docker rm -f "$CONTENEUR" >/dev/null 2>&1 || true
  docker network rm "$RESEAU" >/dev/null 2>&1 || true
  [ "$code" -ne 0 ] && journal "TEST DE RESTAURATION ÉCHOUÉ (code $code)"
  return $code
}
trap nettoyer EXIT INT TERM

echouer() { journal "ERREUR: $*"; exit 1; }
identite() { security find-generic-password -s "$SERVICE_TROUSSEAU" -w | base64 -d; }

CIBLE="${1:-}"
if [ -z "$CIBLE" ]; then
  # La plus recente REUSSIE, pas la plus recente tout court. La version
  # precedente utilisait un `while` dont le corps renvoyait non-zero des que le
  # dernier dossier etait une sauvegarde ratee : sous `set -e` + `pipefail`, le
  # script mourait sans un mot de diagnostic. C'est arrive la premiere nuit,
  # le 2026-09-27, exactement dans le cas que ce test doit savoir traiter.
  CIBLE=""
  for d in $(ls -1dr "$DEST_ROOT"/20*_*/ 2>/dev/null || true); do
    if [ -f "$d/backup.tar.age" ] && grep -q '"resultat": "OK"' "$d/status.json" 2>/dev/null; then
      CIBLE="$d"; break
    fi
  done
fi
[ -n "$CIBLE" ] || echouer "aucune sauvegarde réussie dans $DEST_ROOT"
CIBLE="${CIBLE%/}"
[ -f "$CIBLE/backup.tar.age" ] || echouer "archive absente : $CIBLE/backup.tar.age"
journal "sauvegarde testée : $(basename "$CIBLE")"

TRAVAIL="$(mktemp -d "${TMPDIR:-/tmp}/lume-restore-XXXXXX")"; chmod 700 "$TRAVAIL"
journal "déchiffrement…"
age -d -i <(identite) "$CIBLE/backup.tar.age" | tar -x -C "$TRAVAIL"
[ -f "$TRAVAIL/full.dump" ] || echouer "full.dump absent de l'archive"
[ -f "$TRAVAIL/manifest.json" ] || echouer "manifest.json absent de l'archive"

# ── Les sha256 du manifeste : l'archive est-elle intègre ? ────────────────
journal "vérification des empreintes…"
python3 - "$TRAVAIL" <<'PY'
import hashlib, json, pathlib, sys
travail = pathlib.Path(sys.argv[1])
m = json.loads((travail / "manifest.json").read_text())
mauvais = []
for rel, attendu in m["fichiers"].items():
    f = travail / rel
    if not f.is_file():
        mauvais.append(f"{rel}: absent"); continue
    h = hashlib.sha256()
    with open(f, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    if h.hexdigest() != attendu["sha256"]:
        mauvais.append(f"{rel}: empreinte differente")
if mauvais:
    print("\n".join(mauvais)); sys.exit("empreintes non conformes")
print(f"  {len(m['fichiers'])} fichiers, toutes les empreintes concordent")
PY

# ── PostgreSQL jetable, même version majeure ──────────────────────────────
journal "démarrage d'un PostgreSQL jetable…"
docker network create "$RESEAU" >/dev/null
docker run -d --rm --name "$CONTENEUR" --network "$RESEAU" \
  -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=lume \
  "$IMAGE_PG" -c fsync=off -c full_page_writes=off >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTENEUR" pg_isready -U postgres -d lume >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTENEUR" pg_isready -U postgres -d lume >/dev/null 2>&1 \
  || echouer "le PostgreSQL jetable n'a pas démarré"

dans_pg() {
  docker run --rm -i --network "$RESEAU" -e PGPASSWORD=restore-test "$IMAGE_PG" \
    psql -h "$CONTENEUR" -U postgres -d lume -X -tAq "$@"
}

# Les rôles Supabase n'existent pas dans un Postgres nu, et `roles.sql` les
# met volontairement en commentaire (sur un vrai projet Supabase ils sont
# déjà là). Sans eux, toutes les policies RLS échouent à la restauration —
# c'est exactement le trou qu'on cherche à ne PAS avoir le jour du sinistre.
journal "création des rôles et schémas de la plateforme…"
dans_pg <<'SQL' >/dev/null
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','authenticator','service_role',
      'dashboard_user','pgbouncer','supabase_admin','supabase_auth_admin',
      'supabase_storage_admin','supabase_functions_admin','supabase_read_only_user',
      'supabase_replication_admin','supabase_etl_admin','pgsodium_keyholder',
      'pgsodium_keyiduser','pgsodium_keymaker','pgtle_admin']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I', r);
    end if;
  end loop;
end $$;
create schema if not exists extensions;
create schema if not exists graphql;
create schema if not exists graphql_public;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists pgsodium;
create schema if not exists supabase_functions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists vector with schema extensions;
SQL

# ── Restauration ──────────────────────────────────────────────────────────
journal "pg_restore…"
# Sans --exit-on-error : on VEUT voir tout ce qui casse, pas s'arrêter au
# premier objet manquant. Les extensions propres à Supabase (pg_cron, pg_net,
# pgsodium, vector) n'existent pas ici : leurs erreurs sont attendues et
# listées à la fin.
docker run --rm --network "$RESEAU" -e PGPASSWORD=restore-test \
  -v "$TRAVAIL:/b:ro" "$IMAGE_PG" \
  pg_restore -h "$CONTENEUR" -U postgres -d lume --no-owner --no-privileges -j2 /b/full.dump \
  > "$TRAVAIL/.restore.log" 2>&1 || true
ERREURS=$(grep -c '^pg_restore: error' "$TRAVAIL/.restore.log" || true)
journal "pg_restore terminé — $ERREURS erreur(s) signalée(s)"

# ── Comparaison au manifeste ──────────────────────────────────────────────
journal "recomptage ligne par ligne…"
dans_pg -c "
  select coalesce(json_object_agg(t, n)::text,'{}') from (
    select table_schema||'.'||table_name as t,
           (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as n
      from information_schema.tables
     where table_type='BASE TABLE'
       and table_schema in ('public','kairo','archive','auth','storage','cron','supabase_migrations')
  ) s" > "$TRAVAIL/.comptes-restaures.json"

dans_pg -c "
  select json_build_object(
    'policies',  (select count(*) from pg_policies where schemaname in ('public','kairo','archive','storage','auth')),
    'fonctions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','kairo','archive')),
    'triggers',  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','kairo','archive')),
    'vues',      (select count(*) from pg_views where schemaname in ('public','kairo','archive')),
    'tables_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and n.nspname in ('public','kairo','archive')),
    'liste_policies', (select coalesce(json_agg(x order by x),'[]'::json) from (select schemaname||'.'||tablename||'.'||policyname as x from pg_policies where schemaname in ('public','kairo','archive','storage','auth')) p),
    'liste_triggers', (select coalesce(json_agg(x order by x),'[]'::json) from (select n.nspname||'.'||c.relname||'.'||t.tgname as x from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','kairo','archive')) g),
    'liste_fonctions', (select coalesce(json_agg(x order by x),'[]'::json) from (select n.nspname||'.'||p.proname as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','kairo','archive')) f)
  )::text" > "$TRAVAIL/.objets-restaures.json"

cp "$TRAVAIL/.restore.log" "$DEST_ROOT/logs/restore-test-$(date +%Y-%m-%d_%H%M).log" 2>/dev/null || true

python3 - "$TRAVAIL" "$ERREURS" <<'PYCMP'
import json, pathlib, sys
t = pathlib.Path(sys.argv[1]); erreurs = int(sys.argv[2])
m = json.loads((t / "manifest.json").read_text())
apres = json.loads((t / ".comptes-restaures.json").read_text())
obj_apres = json.loads((t / ".objets-restaures.json").read_text())
avant, obj_avant = m["lignes_par_table"], m["objets"]

# Un Postgres nu n'a pas pg_cron : le schema `cron` ne PEUT pas se restaurer
# ici. Ses donnees sont pourtant bien dans le dump (verifie plus bas), et un
# vrai projet Supabase fournit l'extension. Ce n'est donc pas un defaut de la
# sauvegarde mais une limite du banc d'essai : on le dit au lieu de le masquer.
def hors_banc(nom): return nom.startswith("cron.")

fatales, tolerees, reportees = [], [], []
for table, attendu in sorted(avant.items()):
    obtenu = apres.get(table)
    if hors_banc(table):
        reportees.append(f"{table} ({attendu} lignes)"); continue
    if obtenu is None:
        if attendu: fatales.append(f"{table} ABSENTE ({attendu} lignes attendues)")
        continue
    if obtenu == attendu: continue
    if attendu > 0 and obtenu == 0:
        fatales.append(f"{table} VIDE ({attendu} lignes attendues)"); continue
    # La prod est vivante : le manifeste compte APRES le dump, donc les tables
    # actives ont bouge entre les deux. Une derive de quelques lignes est
    # normale ; une derive large ne l'est pas.
    marge = max(5, attendu // 100)
    (tolerees if abs(attendu - obtenu) <= marge else fatales).append(
        f"{table}: {attendu} attendues, {obtenu} restaurees")

def absents(cle):
    return sorted(set(obj_avant.get("liste_" + cle, [])) - set(obj_apres.get("liste_" + cle, [])))
pol, trg, fns = absents("policies"), absents("triggers"), absents("fonctions")

print()
print("+- Lignes " + "-" * 46)
print(f"|  manifeste : {sum(avant.values())} lignes / {len(avant)} tables")
print(f"|  restaure  : {sum(apres.values())} lignes / {len(apres)} tables")
for e in fatales[:20]:  print(f"|  FATAL      {e}")
for e in tolerees[:10]: print(f"|  derive     {e}   (prod vivante, dans la marge)")
for e in reportees:     print(f"|  hors banc  {e}   (exige pg_cron)")
print("+" + "-" * 55)
print("+- Structure " + "-" * 43)
for cle in ("policies", "fonctions", "triggers", "vues", "tables_rls"):
    print(f"|  {cle:<11} {obj_apres.get(cle,0):>5} / {obj_avant.get(cle,0):<5}")
for nom, liste in (("policy", pol), ("trigger", trg), ("fonction", fns)):
    for x in liste[:12]: print(f"|  MANQUE {nom} {x}")
    if len(liste) > 12:  print(f"|  ... et {len(liste)-12} autre(s)")
print("+" + "-" * 55)
print()

structurel = pol + trg + fns
if fatales or structurel:
    motifs = []
    if fatales:    motifs.append(f"{len(fatales)} probleme(s) de donnees")
    if structurel: motifs.append(f"{len(pol)} policy(s), {len(trg)} trigger(s), {len(fns)} fonction(s) absentes")
    print("RESULTAT : ECHEC — " + " ; ".join(motifs))
    sys.exit(1)
note = f", {len(tolerees)} derive(s) toleree(s)" if tolerees else ""
print(f"RESULTAT : SUCCES — toutes les lignes et tous les objets sont la{note}"
      + (f", {erreurs} erreur(s) pg_restore ci-dessous" if erreurs else ""))
PYCMP
CODE_COMPARAISON=$?

echo
echo "-- Les taches cron sont-elles capturees ? (pg_dump ne peut pas les prendre) --"
if [ -f "$TRAVAIL/cron-jobs.sql" ]; then
  echo "  cron-jobs.sql : $(grep -c '^select cron.schedule' "$TRAVAIL/cron-jobs.sql" || echo 0) tache(s) active(s) rejouable(s)"
else
  echo "  cron-jobs.sql ABSENT — les taches planifiees ne seraient pas restaurees"; CODE_COMPARAISON=1
fi
echo "-- Extensions a activer sur le projet cible avant restauration --"
python3 -c "import json,sys;print('\n'.join('  '+e for e in json.load(open(sys.argv[1]))['objets'].get('extensions',[])))" "$TRAVAIL/manifest.json" 2>/dev/null || true

if [ "$ERREURS" -gt 0 ]; then
  echo
  echo "-- Erreurs pg_restore, regroupees par cause --"
  grep '^pg_restore: error' "$TRAVAIL/.restore.log" \
    | sed -E 's/.*(does not exist|already exists|permission denied|could not|extension "[^"]+").*/\1/' \
    | sort | uniq -c | sort -rn | head -12
  echo "(attendu : ce Postgres nu n a ni pg_cron, ni pg_net, ni pgsodium, ni vector)"
fi
exit $CODE_COMPARAISON
