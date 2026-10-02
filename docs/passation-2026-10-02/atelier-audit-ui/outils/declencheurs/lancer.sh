#!/usr/bin/env bash
# Lance les specs du lot « declencheurs » (un seul worker). Usage : lancer.sh [fichier ou -g motif…]
cd D:/lume-uiaudit/wt || exit 1
CIBLE="${1:-e2e/automations/declencheurs/}"; shift || true
E2E_BASE=http://127.0.0.1:5183 E2E_JEU=declencheurs E2E_SORTIES=${E2E_SORTIES:-D:/lume-uiaudit/sorties/e2e-declencheurs} \
PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers \
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts --project=bureau --workers=1 "$CIBLE" "$@"
