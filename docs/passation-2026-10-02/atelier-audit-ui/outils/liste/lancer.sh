#!/usr/bin/env bash
# Lance les specs du lot « liste ». Usage : lancer.sh [fichier ou -g motif …]
# Journal complet : D:/lume-uiaudit/sorties/liste/journal-<nom>.log (nom = $JOURNAL, défaut « dernier »).
cd D:/lume-uiaudit/wt || exit 1
export E2E_BASE=http://127.0.0.1:5183 E2E_JEU=liste E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-liste
export PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers
if [ $# -eq 0 ]; then set -- e2e/automations/liste/; fi
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts --project=bureau --workers=1 "$@" > "D:/lume-uiaudit/sorties/liste/journal-${JOURNAL:-dernier}.log" 2>&1
echo "fin (code $?)"
