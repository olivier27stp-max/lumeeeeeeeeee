#!/usr/bin/env bash
# Lance les specs du lot « roles ». Usage : lancer.sh [--project=mobile] [fichier ou -g motif …]
# Une seule passe à la fois : la garde vérifie d'abord que la base répond et qu'il n'existe qu'UN bureau A et UN bureau B.
cd D:/lume-uiaudit/wt || exit 1
node --env-file=.env.local ../outils/roles/garde-bureaux.mjs || { echo "[lancer] garde en échec : passe annulée."; exit 9; }
export E2E_BASE=http://127.0.0.1:5183 E2E_JEU=roles E2E_SORTIES=${E2E_SORTIES:-D:/lume-uiaudit/sorties/e2e-roles}
export PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers
PROJET=--project=bureau
if [[ "$1" == --project=* ]]; then PROJET=$1; shift; fi
if [ $# -eq 0 ]; then set -- e2e/automations/roles/; fi
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts $PROJET --workers=1 "$@"
