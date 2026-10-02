#!/usr/bin/env bash
# Enchaîne les specs du lot « actions », une passe par fichier (chaque passe est archivée).
# Usage : tout.sh [fichiers…] — sans argument : tous, dans l'ordre de priorité.
if [ $# -eq 0 ]; then set -- 02-catalogue-actions 06-publication 03-champs-types 04-variables 05-panneau-etape 08-messages-langue 01-tiroir-actions 07-anglais; fi
for f in "$@"; do
  echo "=== $f — $(date +%H:%M:%S)"
  bash D:/lume-uiaudit/outils/actions/lancer.sh "e2e/automations/actions/$f.spec.ts" > "D:/lume-uiaudit/sorties/actions/passe-$f.log" 2>&1
  grep -E "^\s+[0-9]+ (passed|failed)" "D:/lume-uiaudit/sorties/actions/passe-$f.log"
done
echo "=== fini — $(date +%H:%M:%S)"
