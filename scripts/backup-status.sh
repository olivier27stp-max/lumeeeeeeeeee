#!/usr/bin/env bash
# ============================================================================
# backup-status.sh — « ma dernière sauvegarde date de quand ? »
#
#   npm run backup:status
#
# Sort en code 1 si la dernière sauvegarde réussie a plus de 36 h, pour qu'on
# puisse le brancher ailleurs. Une sauvegarde qu'on croit installée mais qui ne
# tourne plus est pire que pas de sauvegarde du tout : elle rassure à tort.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-$(dirname "$PWD")/lume-backups}"
LABEL="com.lume.backup-prod"
SEUIL_H=36

echo "Dossier : $DEST"

# Pas de tuyau ici : `launchctl list | grep -q` fait sortir launchctl en SIGPIPE
# (grep s'arrête à la première correspondance) et `pipefail` transforme alors
# une correspondance en échec — la tâche s'affichait « absente » alors qu'elle
# était bien installée.
liste="$(launchctl list 2>/dev/null || true)"
if [[ "$liste" == *"$LABEL"* ]]; then
  echo "Tâche   : installée (launchd, 03 h 00, rattrapée au réveil)"
else
  echo "Tâche   : ⚠️ ABSENTE — lancer 'npm run backup:install'"
fi

dernier="$(ls -1t "$DEST"/prod-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$dernier" ]; then
  echo "État    : ⚠️ AUCUNE sauvegarde sur le disque."
  exit 1
fi

age_s=$(( $(date +%s) - $(stat -f %m "$dernier") ))
age_h=$(( age_s / 3600 ))
taille=$(du -h "$dernier" | cut -f1)
nb=$(ls -1 "$DEST"/prod-*.dump 2>/dev/null | wc -l | tr -d ' ')

echo "Dernier : $(basename "$dernier") ($taille, il y a ${age_h} h)"
echo "Réserve : $nb sauvegarde(s)"

if [ -f "$DEST/.derniere-panne" ]; then
  echo "État    : ⚠️ dernière exécution EN ÉCHEC ($(cat "$DEST/.derniere-panne")) — voir backup.log"
  exit 1
fi

if [ "$age_h" -gt "$SEUIL_H" ]; then
  echo "État    : ⚠️ PÉRIMÉE (plus de ${SEUIL_H} h). La tâche ne tourne pas."
  exit 1
fi

echo "État    : ✅ à jour"
