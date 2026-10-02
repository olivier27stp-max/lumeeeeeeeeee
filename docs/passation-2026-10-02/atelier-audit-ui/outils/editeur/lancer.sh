#!/bin/sh
# Lance les specs du lot « editeur » : ./lancer.sh [fichiers ou options playwright]
cd D:/lume-uiaudit/wt || exit 1
E2E_BASE=http://127.0.0.1:5183 E2E_JEU=editeur E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-editeur \
PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers \
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts \
  --project=bureau --workers=1 "$@"
