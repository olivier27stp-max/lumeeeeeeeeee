#!/usr/bin/env bash
# ============================================================================
# backup-prod.sh — sauvegarde complète de la PROD sur ce disque.
#
#   npm run backup:prod          (manuel)
#   installé en tâche quotidienne par scripts/install-backup-cron.sh
#
# Pourquoi : les sauvegardes automatiques de Supabase se sont arrêtées entre le
# 2 et le 5 août 2026 (incident « Project Upgrade Delays » chez eux), sans
# aucune alerte. Ce script rend la protection indépendante de leur plateforme.
#
# Ce qu'il produit, par exécution :
#   prod-AAAAMMJJ-HHMM.dump      schéma + données (format compressé pg_restore)
#   prod-AAAAMMJJ-HHMM-auth.sql  comptes utilisateurs + identités
#
# ⚠️ Ces fichiers contiennent les VRAIES données de tes clients. Ils vivent
#    hors du dépôt git. À traiter comme de la production.
# ⚠️ La prod est lue, jamais écrite.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-$(dirname "$PWD")/lume-backups}"
RETENTION_JOURS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$DEST"

# Windows (Git Bash, tâche planifiée) : sans ceci, Git Bash réécrit les chemins
# du conteneur (« /out/… » → « C:/Program Files/Git/out/… ») et pg_dump
# n'écrit rien — la sauvegarde n'avait jamais fonctionné sur Windows. Le
# dossier monté, lui, doit être donné à Docker en chemin Windows (cygpath).
# Sans effet sur macOS / Linux.
export MSYS_NO_PATHCONV=1
DEST_DOCKER="$(cygpath -m "$DEST" 2>/dev/null || echo "$DEST")"

# Un échec doit se VOIR. Le montage précédent se contentait d'écrire dans un
# journal que personne ne lit : c'est exactement comme ça que l'arrêt des
# sauvegardes du 2 au 5 août 2026 est passé inaperçu pendant trois jours.
alerter() {
  local code=$?
  [ "$code" -eq 0 ] && return 0
  date -u +%FT%TZ > "$DEST/.derniere-panne" 2>/dev/null || true
  osascript -e 'display notification "Voir lume-backups/backup.log" with title "Sauvegarde Lume ÉCHOUÉE" sound name "Basso"' >/dev/null 2>&1 || true
  echo "[$(date -u +%FT%TZ)] ÉCHEC (code $code)." >&2
}
trap alerter EXIT

env_get() { grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
REF="$(env_get SUPABASE_PROJECT_REF_PROD)"
PASS="$(env_get SUPABASE_DB_PASSWORD)"
# Mot de passe par l'environnement, jamais dans la ligne de commande (visible
# dans la liste des processus et affiché par toute trace) — incident 2026-09-25.
export PGPASSWORD="$PASS"
[ -n "$REF" ] && [ -n "$PASS" ] || { echo "ERREUR: SUPABASE_PROJECT_REF_PROD et SUPABASE_DB_PASSWORD requis dans .env.local" >&2; exit 1; }

# Docker doit tourner. Sur Windows, la tâche de 3 h échouait s'il avait été
# fermé : on démarre Docker Desktop et on attend son moteur (3 min au plus).
if ! docker info >/dev/null 2>&1; then
  DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe"
  if [ -x "$DOCKER_DESKTOP" ]; then
    echo "[$(date -u +%FT%TZ)] Docker arrêté : démarrage de Docker Desktop…"
    "$DOCKER_DESKTOP" >/dev/null 2>&1 &
    for _ in $(seq 1 36); do docker info >/dev/null 2>&1 && break; sleep 5; done
  fi
  docker info >/dev/null 2>&1 || { echo "ERREUR: le moteur Docker ne répond pas." >&2; exit 1; }
fi

# Les hôtes db.<ref>.supabase.co sont en IPv6 seulement : on passe par le pooler.
HOST=""
for h in aws-1-ca-central-1.pooler.supabase.com aws-0-ca-central-1.pooler.supabase.com; do
  if docker run --rm -e PGPASSWORD postgres:17 \
       psql -h "$h" -p 5432 -U "postgres.$REF" -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    HOST="$h"; break
  fi
done
[ -n "$HOST" ] || { echo "ERREUR: aucun pooler ne répond (mot de passe ? projet en pause ?)" >&2; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M)"
echo "[$(date -u +%FT%TZ)] sauvegarde de $REF → $DEST/prod-$STAMP.dump"

docker run --rm -e PGPASSWORD -v "$DEST_DOCKER:/out" postgres:17 \
  pg_dump -h "$HOST" -p 5432 -U "postgres.$REF" -d postgres \
  --no-owner -n public -n app -n archive -Fc -f "/out/prod-$STAMP.dump" 2>&1 | grep -v '^pg_dump: warning' || true

# Les comptes vivent dans le schéma auth, hors du dump métier.
docker run --rm -e PGPASSWORD -v "$DEST_DOCKER:/out" postgres:17 \
  pg_dump -h "$HOST" -p 5432 -U "postgres.$REF" -d postgres \
  --data-only --column-inserts -t auth.users -t auth.identities \
  -f "/out/prod-$STAMP-auth.sql" 2>&1 | grep -v '^pg_dump: warning' || true

# Vérification : un fichier illisible ne vaut rien. On compte les tables.
NB_TABLES=$(docker run --rm -v "$DEST_DOCKER:/b" postgres:17 \
  pg_restore --list "/b/prod-$STAMP.dump" 2>/dev/null | grep -c 'TABLE DATA' || echo 0)
TAILLE=$(du -h "$DEST/prod-$STAMP.dump" | cut -f1)

if [ "$NB_TABLES" -lt 100 ]; then
  echo "[$(date -u +%FT%TZ)] ÉCHEC : seulement $NB_TABLES tables dans le dump — sauvegarde suspecte, conservée pour analyse." >&2
  exit 1
fi
echo "[$(date -u +%FT%TZ)] OK : $NB_TABLES tables, $TAILLE"
date -u +%FT%TZ > "$DEST/.derniere-reussite"
rm -f "$DEST/.derniere-panne"

# Rotation
SUPPRIMES=$(find "$DEST" -name 'prod-*' -type f -mtime +"$RETENTION_JOURS" -print -delete | wc -l | tr -d ' ')
[ "$SUPPRIMES" -gt 0 ] && echo "[$(date -u +%FT%TZ)] rotation : $SUPPRIMES fichier(s) de plus de $RETENTION_JOURS jours supprimé(s)"

echo "[$(date -u +%FT%TZ)] sauvegardes en réserve : $(ls -1 "$DEST"/prod-*.dump 2>/dev/null | wc -l | tr -d ' ')"
