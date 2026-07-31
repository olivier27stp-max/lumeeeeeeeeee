#!/usr/bin/env bash
#
# Teste qu'une sauvegarde de la production est REELLEMENT restaurable.
#
# POURQUOI
#   Au 2026-07-31, aucune des 8 sauvegardes quotidiennes n'avait jamais ete
#   restauree. Une sauvegarde jamais restauree n'est pas une sauvegarde : c'est
#   une hypothese. Ce script la transforme en certitude.
#
# ⚠️ NE JAMAIS UTILISER LE BOUTON « RESTORE » DU TABLEAU DE BORD POUR TESTER.
#   Il restaure PAR-DESSUS la production et ecrase tout ce qui s'est passe
#   depuis. Ce n'est pas un test, c'est une perte de donnees.
#
# CE QUE FAIT CE SCRIPT
#   1. exporte la production (LECTURE SEULE — pg_dump n'ecrit rien) ;
#   2. demarre un PostgreSQL local jetable ;
#   3. y restaure l'export ;
#   4. compte les lignes et les compare a la production ;
#   5. detruit le conteneur.
#
#   La production n'est JAMAIS modifiee. Le seul risque est de remplir un peu
#   ton disque, et le script nettoie derriere lui.
#
# PREREQUIS
#   * Docker Desktop demarre (l'image postgres fournit pg_dump/pg_restore/psql,
#     rien a installer) ;
#   * la chaine de connexion de la base, a recuperer dans
#     Supabase -> Settings -> Database -> Connection string -> URI
#     (elle contient le mot de passe ; ne la commite jamais).
#
# USAGE
#   SUPABASE_DB_URL='postgresql://postgres:MOTDEPASSE@db.xxx.supabase.co:5432/postgres' \
#     bash scripts/test-restauration.sh
#
set -uo pipefail

IMAGE="postgres:17"
CONTENEUR="lume-test-restauration"
PORT_LOCAL="55432"
DUMP="/tmp/lume-restauration-$(date +%Y%m%d-%H%M%S).dump"
MDP_LOCAL="test-restauration"

echo "════════════════════════════════════════════════════════════════"
echo "  Test de restauration — la production n'est jamais modifiee"
echo "════════════════════════════════════════════════════════════════"
echo

# ── Verifications prealables ────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker ne repond pas. Demarre Docker Desktop, puis relance."
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "✗ SUPABASE_DB_URL n'est pas defini."
  echo
  echo "  Recupere-la dans Supabase -> Settings -> Database -> Connection string -> URI,"
  echo "  puis relance ainsi :"
  echo
  echo "    SUPABASE_DB_URL='postgresql://postgres:...@db.xxx.supabase.co:5432/postgres' \\"
  echo "      bash scripts/test-restauration.sh"
  exit 2
fi

nettoyer() {
  echo
  echo "── Nettoyage ──"
  docker rm -f "$CONTENEUR" >/dev/null 2>&1 && echo "  conteneur supprime"
  [ -f "$DUMP" ] && rm -f "$DUMP" && echo "  fichier d'export supprime"
}
trap nettoyer EXIT

# ── 1. Export de la production (lecture seule) ──────────────────────────────
echo "── 1/4  Export de la production (lecture seule, quelques minutes) ──"
docker run --rm -v /tmp:/tmp "$IMAGE" \
  pg_dump "$SUPABASE_DB_URL" --no-owner --no-acl -Fc -f "$DUMP" 2>&1 | tail -5
if [ ! -s "$DUMP" ]; then
  echo "✗ L'export a echoue ou est vide. Verifie la chaine de connexion."
  exit 1
fi
echo "  export reussi : $(du -h "$DUMP" | cut -f1)"

# ── 2. PostgreSQL local jetable ─────────────────────────────────────────────
echo
echo "── 2/4  Demarrage d'un PostgreSQL local jetable ──"
docker rm -f "$CONTENEUR" >/dev/null 2>&1
docker run -d --name "$CONTENEUR" -e POSTGRES_PASSWORD="$MDP_LOCAL" \
  -p "$PORT_LOCAL":5432 -v /tmp:/tmp "$IMAGE" >/dev/null
LOCAL="postgresql://postgres:$MDP_LOCAL@localhost:5432/postgres"

printf "  attente du demarrage"
for _ in $(seq 1 30); do
  if docker exec "$CONTENEUR" pg_isready -U postgres >/dev/null 2>&1; then echo " — pret"; break; fi
  printf "."; sleep 2
done

# ── 3. Restauration ─────────────────────────────────────────────────────────
echo
echo "── 3/4  Restauration dans la base locale ──"
# Les erreurs sur les roles Supabase absents localement sont NORMALES et sans
# consequence : on teste la recuperabilite des DONNEES, pas la reproduction
# exacte de l'environnement Supabase.
docker exec "$CONTENEUR" pg_restore -d "$LOCAL" --no-owner --no-acl "$DUMP" 2>&1 \
  | grep -viE "role .* does not exist|already exists|extension|permission denied" | tail -8
echo "  restauration terminee"

# ── 4. Verification ─────────────────────────────────────────────────────────
echo
echo "── 4/4  Verification du contenu restaure ──"
docker exec "$CONTENEUR" psql "$LOCAL" -t -A -F' | ' -c "
  select 'clients',  count(*) from public.clients
  union all select 'jobs',     count(*) from public.jobs
  union all select 'invoices', count(*) from public.invoices
  union all select 'quotes',   count(*) from public.quotes
  union all select 'orgs',     count(*) from public.orgs
  union all select 'tables',   count(*) from pg_class c
              join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relkind='r';" 2>/dev/null \
  | sed 's/^/     /'

echo
echo "════════════════════════════════════════════════════════════════"
echo "  A COMPARER AVEC LA PRODUCTION (valeurs du 2026-07-31) :"
echo "     clients 66 · jobs 34 · invoices 13 · quotes 16 · orgs 31 · tables 219"
echo
echo "  Si les nombres correspondent, ta sauvegarde est RECUPERABLE."
echo "  Note le temps qu'a pris ce script : c'est ton delai de reprise reel."
echo "════════════════════════════════════════════════════════════════"
echo
echo "  Limite connue : pg_dump ne capture ni les utilisateurs Supabase Auth"
echo "  ni les fichiers Storage. Pour une reprise complete il faudrait aussi"
echo "  le schema auth (--schema=auth) et les buckets. Ce test valide la"
echo "  recuperabilite des DONNEES METIER, qui est la question du jour."
