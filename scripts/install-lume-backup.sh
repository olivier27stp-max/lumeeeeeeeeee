#!/usr/bin/env bash
# ============================================================================
# install-lume-backup — planifie la sauvegarde et son test de restauration.
#
#   bash scripts/install-lume-backup.sh installer
#   bash scripts/install-lume-backup.sh etat
#   bash scripts/install-lume-backup.sh retirer
#
# Pourquoi launchd et pas cron : cron ne rattrape JAMAIS un déclenchement
# manqué. Un portable fermé à 3 h saute la nuit, en silence. launchd, avec
# StartCalendarInterval, relance la tâche au réveil.
#
# Deuxième piège : launchd démarre avec un PATH minimal (/usr/bin:/bin) qui ne
# contient ni ~/.local/bin (age, supabase) ni /usr/local/bin (docker). On le
# fixe explicitement dans le plist.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
DEPOT="$PWD"
CIBLE="gui/$(id -u)"
LOGS="${LUME_BACKUP_DIR:-$HOME/Backups/lume}/logs"
AGENTS="$HOME/Library/LaunchAgents"

plist() { echo "$AGENTS/$1.plist"; }

ecrire_plist() {
  local label="$1" script="$2" heure="$3" minute="$4" jour="${5:-}"
  local calendrier="    <key>Hour</key><integer>$heure</integer>
    <key>Minute</key><integer>$minute</integer>"
  [ -n "$jour" ] && calendrier="$calendrier
    <key>Weekday</key><integer>$jour</integer>"
  cat > "$(plist "$label")" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$DEPOT/scripts/$script</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
$calendrier
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
}

charger() {
  local label="$1"
  launchctl bootout "$CIBLE/$label" 2>/dev/null || true
  launchctl bootstrap "$CIBLE" "$(plist "$label")"
  # `launchctl list | grep -q` est un piège : grep sort à la première
  # correspondance, launchctl prend un SIGPIPE, et `pipefail` fait échouer le
  # script alors que tout va bien.
  local liste; liste="$(launchctl list 2>/dev/null || true)"
  case "$liste" in *"$label"*) echo "  $label : chargée" ;;
                   *) echo "  $label : ÉCHEC du chargement"; return 1 ;; esac
}

case "${1:-etat}" in
  installer)
    mkdir -p "$AGENTS" "$LOGS"
    [ -r "$HOME/.config/lume-backup/env" ] || { echo "Configuration absente. Voir RESTORE.md."; exit 1; }
    security find-generic-password -s lume-backup-age -w >/dev/null 2>&1 \
      || { echo "Clé age absente du trousseau. Voir RESTORE.md."; exit 1; }
    # 1 h et non 3 h : l ancienne tache `com.lume.backup-prod` part a 3 h et
    # tient le pooler ~40 min. Les deux ensemble se sont coupees mutuellement la
    # nuit du 2026-09-27 (SSL eof en plein COPY). A supprimer quand l ancienne
    # sera retiree.
    ecrire_plist com.lume.backup          lume-backup.sh       1 0
    ecrire_plist com.lume.restore-test    lume-restore-test.sh 2 0 0
    charger com.lume.backup
    charger com.lume.restore-test
    echo
    echo "Sauvegarde : tous les jours à 1 h 00 (rattrapée au réveil)."
    echo "Test de restauration : chaque dimanche à 2 h 00."
    echo "Journaux : $LOGS"
    ;;
  retirer)
    for label in com.lume.backup com.lume.restore-test; do
      launchctl bootout "$CIBLE/$label" 2>/dev/null || true
      rm -f "$(plist "$label")"
      echo "  $label : retirée"
    done
    echo "Les sauvegardes déjà produites sont conservées."
    ;;
  etat)
    liste="$(launchctl list 2>/dev/null || true)"
    for label in com.lume.backup com.lume.restore-test com.lume.backup-prod; do
      ligne="$(printf '%s\n' "$liste" | awk -v l="$label" '$3==l{print $1" (dernier code de sortie "$2")"}')"
      printf '  %-26s %s\n' "$label" "${ligne:-absente}"
    done
    DEST="${LUME_BACKUP_DIR:-$HOME/Backups/lume}"
    echo
    echo "  dernière réussite : $(cat "$DEST/.derniere-reussite" 2>/dev/null || echo jamais)"
    echo "  dernière panne    : $(cat "$DEST/.derniere-panne" 2>/dev/null || echo aucune)"
    n=$(ls -1d "$DEST"/20*_*/ 2>/dev/null | wc -l | tr -d ' ')
    echo "  sauvegardes en réserve : $n ($(du -sh "$DEST" 2>/dev/null | cut -f1))"
    ;;
  *) echo "usage: $0 {installer|etat|retirer}"; exit 1 ;;
esac
