#!/usr/bin/env bash
# Lance les specs du lot « liste » UN FICHIER À LA FOIS (workers=1), et garde le rapport JSON de chacun :
#   sorties/liste/resultats-<fichier>.json  +  sorties/liste/journal-<fichier>.log
# Usage : tout.sh [numéros de fichiers… ex. 03 05]   (sans argument : tous)
cd D:/lume-uiaudit/wt || exit 1
export E2E_BASE=http://127.0.0.1:5183 E2E_JEU=liste E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-liste
export PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers
for f in e2e/automations/liste/*.spec.ts; do
  n=$(basename "$f" .spec.ts)
  if [ $# -gt 0 ]; then garder=0; for a in "$@"; do case "$n" in "$a"*) garder=1;; esac; done; [ $garder -eq 1 ] || continue; fi
  node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts --project=bureau --workers=1 "$f" > "D:/lume-uiaudit/sorties/liste/journal-$n.log" 2>&1
  cp "$E2E_SORTIES/resultats.json" "D:/lume-uiaudit/sorties/liste/resultats-$n.json"
  mkdir -p "D:/lume-uiaudit/sorties/liste/echecs/$n" && rm -rf "D:/lume-uiaudit/sorties/liste/echecs/$n"/* && cp -r "$E2E_SORTIES/resultats/." "D:/lume-uiaudit/sorties/liste/echecs/$n/" 2>/dev/null
  find "D:/lume-uiaudit/sorties/liste/echecs/$n" -name "trace.zip" -delete
  echo "fini : $n — $(sed 's/\x1b\[[0-9;]*m//g' "D:/lume-uiaudit/sorties/liste/journal-$n.log" | grep -E '^\s+[0-9]+ (passed|failed)' | tr '\n' ' ')"
done
node D:/lume-uiaudit/outils/liste/couverture.mjs
echo "TOUT FINI"
