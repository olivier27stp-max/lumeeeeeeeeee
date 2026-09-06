#!/usr/bin/env bash
# ============================================================================
# install-backup-agent.sh — installe (ou retire) la sauvegarde quotidienne.
#
#   npm run backup:install     installe la tâche : tous les jours à 03 h 00
#   npm run backup:uninstall   la retire
#   npm run backup:status      dit si la dernière sauvegarde est fraîche
#
# Pourquoi launchd et plus cron : cron ne rattrape PAS un déclenchement manqué.
# Le Mac dort à 03 h 00 → la sauvegarde des 6 et 7 août 2026 n'a jamais tourné,
# en silence. launchd (StartCalendarInterval) relance la tâche au réveil.
#
# Deuxième piège couvert ici : launchd démarre avec un PATH minimal qui ne
# contient PAS /usr/local/bin, où vit `docker`. Sans le PATH ci-dessous la
# tâche échoue avec « docker: command not found ».
#
# Pour vérifier à la main :  launchctl list | grep lume
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"

LABEL="com.lume.backup-prod"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# ── Windows (Git Bash) : tâche planifiée, pas launchd ─────────────────────
# Constaté le 2026-09-06 : sur le poste Windows du propriétaire, ce script
# n'installait RIEN (launchctl absent, échec silencieux) — aucune sauvegarde
# de la prod n'a jamais existé sur ce disque. Même exigence que launchd :
# 03 h 00 tous les jours, et RATTRAPAGE si le PC dormait (StartWhenAvailable).
# Docker Desktop doit tourner : backup-prod.sh l'utilise pour pg_dump.
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
  TACHE="Lume Backup Prod"
  BASH_WIN="$(cygpath -w "$(command -v bash)")"
  REPO_WIN="$(cygpath -m "$REPO")"
  if [ "${1:-install}" = "uninstall" ]; then
    powershell.exe -NoProfile -Command "Unregister-ScheduledTask -TaskName '$TACHE' -Confirm:\$false -ErrorAction SilentlyContinue" >/dev/null
    echo "Tâche quotidienne retirée (Planificateur de tâches Windows)."
    exit 0
  fi
  powershell.exe -NoProfile -Command "
    \$action = New-ScheduledTaskAction -Execute '$BASH_WIN' -Argument '-lc \"cd \\\"$REPO_WIN\\\" && npm run backup:prod\"' -WorkingDirectory '$REPO_WIN'
    \$trigger = New-ScheduledTaskTrigger -Daily -At 03:00
    \$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName '$TACHE' -Action \$action -Trigger \$trigger -Settings \$settings -Force | Out-Null
  " || { echo "ERREUR: Register-ScheduledTask a échoué" >&2; exit 1; }
  if powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName '$TACHE' -ErrorAction Stop | Out-Null" 2>/dev/null; then
    echo "Tâche quotidienne installée : « $TACHE », 03 h 00, rattrapée si le PC dormait."
    echo "Prérequis : Docker Desktop lancé au démarrage, SUPABASE_DB_PASSWORD dans .env.local."
    exit 0
  fi
  echo "ERREUR: tâche introuvable après installation" >&2; exit 1
fi
LOG="$(dirname "$REPO")/lume-backups/backup.log"
CIBLE="gui/$(id -u)"
MARQUEUR_CRON="# lume-backup-quotidien"

# `launchctl list | grep -q` est un piège : grep sort à la première
# correspondance, launchctl prend un SIGPIPE, et `pipefail` transforme la
# correspondance en échec. On teste la chaîne en bash, sans tuyau.
est_charge() {
  local liste; liste="$(launchctl list 2>/dev/null || true)"
  [[ "$liste" == *"$LABEL"* ]]
}

# --- retrait -----------------------------------------------------------------
if [ "${1:-install}" = "uninstall" ]; then
  launchctl bootout "$CIBLE/$LABEL" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  if est_charge; then
    echo "⚠️ encore chargée — relancer, ou 'launchctl bootout $CIBLE/$LABEL'"
    exit 1
  fi
  echo "Tâche quotidienne retirée (vérifié : absente de launchctl)."
  exit 0
fi

# --- installation ------------------------------------------------------------
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/backup-prod.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLISTEOF

# Recharger proprement. `bootstrap` renvoie « 5: Input/output error » quand le
# service est DÉJÀ enregistré : ce n'est pas une panne, donc on vérifie l'état
# réel plutôt que le code de sortie.
launchctl bootout "$CIBLE/$LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5; do est_charge || break; sleep 1; done
launchctl bootstrap "$CIBLE" "$PLIST" 2>/dev/null \
  || launchctl load -w "$PLIST" 2>/dev/null \
  || true

# Retirer l'ancienne ligne cron si elle traîne encore (sinon double sauvegarde).
cron_actuel="$(crontab -l 2>/dev/null || true)"
if [[ "$cron_actuel" == *"$MARQUEUR_CRON"* ]]; then
  printf '%s\n' "$cron_actuel" | grep -v "$MARQUEUR_CRON" | grep -v '^$' | crontab - || true
  echo "Ancienne tâche cron retirée."
fi

# L'enregistrement n'est pas instantané : laisser à launchd le temps de publier.
charge=0
for _ in 1 2 3 4 5; do
  if est_charge; then charge=1; break; fi
  sleep 1
done
if [ "$charge" -ne 1 ]; then
  echo "ERREUR : la tâche n'apparaît pas dans launchctl." >&2
  exit 1
fi

echo "Tâche installée : sauvegarde de la prod tous les jours à 03 h 00."
echo "  rattrapage : si le Mac dort à 03 h 00, elle part au réveil."
echo "  journal    : $LOG"
echo "  état       : npm run backup:status"
echo "  lancer tout de suite : launchctl kickstart -p $CIBLE/$LABEL"
echo "  retirer    : npm run backup:uninstall"
echo
launchctl list | grep "$LABEL"
