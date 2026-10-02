#!/bin/sh
# Lance les specs du lot l'une après l'autre ; garde le journal et le JSON de chacune.
# Usage : tout.sh [nom de spec sans extension…]   (sans argument : toutes)
# Avant chaque spec, attend que l'API locale réponde vite (le démarrage du banc lui laisse 4 s,
# puis croit devoir démarrer des serveurs — ce qu'on ne veut jamais ici).
S=D:/lume-uiaudit/sorties/editeur/runs
mkdir -p "$S"
cd D:/lume-uiaudit/wt || exit 1
echo $$ > "$S/tout.pid"
LISTE="$@"
[ -z "$LISTE" ] && LISTE=$(ls e2e/automations/editeur/*.spec.ts | xargs -n1 basename | sed 's/\.spec\.ts$//')
for f in $LISTE; do
  n=0
  until [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:3112/api/health)" = "200" ] && [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5183/api/health)" = "200" ]; do
    n=$((n+1)); [ $n -ge 120 ] && break; sleep 5
  done
  echo "=== $f $(date -u +%H:%M:%S)"
  D:/lume-uiaudit/outils/editeur/lancer.sh "e2e/automations/editeur/$f.spec.ts" > "$S/$f.log" 2>&1
  if grep -q "Running .* test" "$S/$f.log"; then
    cp D:/lume-uiaudit/sorties/e2e-editeur/resultats.json "$S/$f.json"
    rm -rf "$S/$f-resultats"; cp -r D:/lume-uiaudit/sorties/e2e-editeur/resultats "$S/$f-resultats" 2>/dev/null
  else
    echo "    (la spec n'a pas démarré : voir $S/$f.log)"
  fi
  grep -E "^\s+[0-9]+ (passed|failed)" "$S/$f.log"
done
echo "=== fini $(date -u +%H:%M:%S)"
