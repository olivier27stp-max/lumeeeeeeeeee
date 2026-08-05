#!/usr/bin/env bash
# ============================================================================
# install-backup-cron.sh — installe (ou retire) la sauvegarde quotidienne.
#
#   npm run backup:install     installe la tâche : tous les jours à 03 h 00
#   npm run backup:uninstall   la retire
#
# La tâche appelle scripts/backup-prod.sh et journalise dans
# ../lume-backups/backup.log. Elle ne touche jamais à la prod en écriture.
#
# Pour vérifier à la main :  crontab -l
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
MARQUEUR="# lume-backup-quotidien"
LOG="$(dirname "$REPO")/lume-backups/backup.log"
LIGNE="0 3 * * * cd '$REPO' && /bin/bash scripts/backup-prod.sh >> '$LOG' 2>&1 $MARQUEUR"

actuel="$(crontab -l 2>/dev/null || true)"
sans_nous="$(printf '%s\n' "$actuel" | grep -v "$MARQUEUR" || true)"

if [ "${1:-install}" = "uninstall" ]; then
  printf '%s\n' "$sans_nous" | grep -v '^$' | crontab - 2>/dev/null || crontab -r 2>/dev/null || true
  echo "Tâche quotidienne retirée."
  crontab -l 2>/dev/null | grep -c "$MARQUEUR" >/dev/null && echo "  (⚠️ encore présente)" || echo "  vérifié : absente."
  exit 0
fi

printf '%s\n%s\n' "$(printf '%s\n' "$sans_nous" | grep -v '^$' || true)" "$LIGNE" | grep -v '^$' | crontab -
echo "Tâche installée : sauvegarde de la prod tous les jours à 03 h 00."
echo "  journal    : $LOG"
echo "  retirer    : npm run backup:uninstall"
echo
crontab -l | grep "$MARQUEUR"
