#!/usr/bin/env bash
# Lance les specs du lot « modeles », UNE passe, un seul worker.
#
#   bash lancer.sh e2e/automations/modeles/01-bibliotheque.spec.ts     # une spec (mode économe, voir connexion.ts)
#   bash lancer.sh e2e/automations/modeles/03-texto.spec.ts:57          # un seul test (fichier:ligne)
#   ECONOME=0 bash lancer.sh e2e/automations/modeles/00-jeu.spec.ts     # par le banc tel quel (à faire UNE fois d'abord)
#
# · Le démarrage du banc abandonne si /api/health met plus de 4 s (poste partagé) : la passe est alors relancée.
# · Chaque passe terminée laisse son JSON dans sorties/modeles/runs/ ; une passe interrompue y laisse son journal.
#   `node verdicts.mjs` fusionne le tout : le dernier verdict d'un test l'emporte.
cd D:/lume-uiaudit/wt || exit 1
[ "$ECONOME" = "0" ] || export E2E_MODELES_ECONOME=1
export E2E_BASE=http://127.0.0.1:5183 E2E_JEU=modeles E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-modeles PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers
RUNS=D:/lume-uiaudit/sorties/modeles/runs
mkdir -p "$RUNS" "$E2E_SORTIES"
cibles=("$@"); [ ${#cibles[@]} -eq 0 ] && cibles=(e2e/automations/modeles/)
depart="$RUNS/.depart"; : > "$depart"
for essai in 1 2 3 4 5 6; do
  node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts --project=bureau --workers=1 "${cibles[@]}" > "$E2E_SORTIES.log" 2>&1
  code=$?
  if grep -q "est déjà occupé" "$E2E_SORTIES.log"; then sleep 2; continue; fi
  break
done
horodatage=$(date +%Y%m%d-%H%M%S)
if [ "$E2E_SORTIES/resultats.json" -nt "$depart" ]; then
  cp "$E2E_SORTIES/resultats.json" "$RUNS/$horodatage.json"
else
  # Passe interrompue (processus arrêté) : pas de JSON neuf, on garde le journal.
  cp "$E2E_SORTIES.log" "$RUNS/$horodatage-interrompue.log"
fi
rm -f "$depart"
cat "$E2E_SORTIES.log"
exit $code
