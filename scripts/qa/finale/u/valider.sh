#!/usr/bin/env bash
# Le garde-fou d'un commit de l'agent U : typage, tests des automatisations (suite principale + mes tests +
# gardes statiques), puis commit avec le message donné — SEULEMENT si tout est vert.
#
#   bash scripts/qa/finale/u/valider.sh <fichier du message> [--unitaires]
#
# --unitaires : lance aussi le projet « unitaires » de vitest.automations.config.ts (≈ 2 min).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
MESSAGE="${1:?fichier du message de commit}"
JOURNAL="D:/lume-final/sorties/u/dernier.log"
: > "$JOURNAL"
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --incremental --tsBuildInfoFile D:/lume-final/sorties/u/tsbuildinfo > D:/lume-final/sorties/u/tsc.log 2>&1 \
  || { echo "tsc failed" >> "$JOURNAL"; head -20 D:/lume-final/sorties/u/tsc.log; }
npx vitest run --maxWorkers=2 --testTimeout=90000 --silent=true tests/automations-finale/u/ tests/accessibilite-statique.test.ts \
  tests/frontiere-serveur-client.test.ts tests/dockerfile-imports-src.test.ts tests/catch-vides-chemins-ecriture.test.ts \
  tests/dialogues-natifs-bannis.test.ts tests/chaine-optionnelle-incomplete.test.ts tests/qa- tests/emails/ \
  tests/lumi-panneau tests/automatisations- tests/automation/ 2>&1 \
  | grep -E "×|FAIL|failed|Failed|Tests  |Test Files  " >> "$JOURNAL"
if [ "${2:-}" = "--unitaires" ]; then
  npx vitest run --maxWorkers=2 --silent=true --config vitest.automations.config.ts --project unitaires 2>&1 \
    | grep -E "×|FAIL|failed|Failed|Tests  |Test Files  " >> "$JOURNAL"
fi
cat "$JOURNAL"
if grep -q "FAIL\|failed\|Failed" "$JOURNAL"; then echo "PAS DE COMMIT"; exit 1; fi
if ! grep -q "Tests  " "$JOURNAL"; then echo "PAS DE COMMIT (aucun test lancé)"; exit 1; fi
git add -A src server tests scripts/qa/finale/u && git commit -q -F "$MESSAGE" && git log --oneline -1
