#!/usr/bin/env bash
# Lance les specs du lot « actions ». Usage : lancer.sh [fichier ou -g motif …]
#   bash D:/lume-uiaudit/outils/actions/lancer.sh e2e/automations/actions/02-catalogue-actions.spec.ts
#   bash D:/lume-uiaudit/outils/actions/lancer.sh e2e/automations/actions/03-champs-types.spec.ts -g "EDT-085"
#
# Le démarrage du banc sonde /api/health avec 4 s de délai : quand le poste est
# chargé, la sonde échoue et le banc croit devoir démarrer ses propres serveurs
# (« port déjà occupé »). On attend que la sonde réponde vite, et on relance
# dans ce seul cas (15 fois au plus).
cd D:/lume-uiaudit/wt || exit 1
export E2E_BASE=http://127.0.0.1:5183 E2E_JEU=actions E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-actions
export PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers
if [ $# -eq 0 ]; then set -- e2e/automations/actions/; fi
SORTIES=D:/lume-uiaudit/sorties/actions
JOURNAL=$SORTIES/dernier-lancement.log
mkdir -p "$SORTIES/passes"
TEMOIN=$SORTIES/passes/.debut
: > "$TEMOIN"
code=1
for essai in $(seq 1 15); do
  for sonde in $(seq 1 40); do
    t=$(curl -s -o /dev/null -m 6 -w "%{time_total}" "$E2E_BASE/api/health" || echo 9)
    if awk "BEGIN{exit !($t < 1.5)}"; then break; fi
  done
  node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts --project=bureau --workers=1 "$@" > "$JOURNAL" 2>&1
  code=$?
  if grep -q "est déjà occupé" "$JOURNAL"; then continue; fi
  break
done
# Chaque passe TERMINÉE garde son résultat (une passe interrompue n'écrit pas de rapport :
# on ne recopie pas celui de la passe d'avant). couverture.mjs lit ces fichiers.
if [ "$E2E_SORTIES/resultats.json" -nt "$TEMOIN" ]; then
  cp "$E2E_SORTIES/resultats.json" "$SORTIES/passes/$(date +%Y%m%d-%H%M%S).json"
fi
rm -f "$TEMOIN"
cat "$JOURNAL"
exit $code
