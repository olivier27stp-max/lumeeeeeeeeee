#!/usr/bin/env bash
# Garde-fou LÉGER d'un commit de l'agent U, pour un poste chargé : typage, puis les seuls tests nommés
# (un worker, délais longs), puis commit — SEULEMENT si tout est vert. La garde large (valider.sh) et la
# suite complète du dépôt se lancent une fois par étape, avant le point au coordinateur.
#
#   bash scripts/qa/finale/u/valider-leger.sh <fichier du message> <test…>
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
MESSAGE="${1:?fichier du message de commit}"; shift
JOURNAL="D:/lume-final/sorties/u/dernier.log"
: > "$JOURNAL"
if grep -q "MESURE\|REJEU" "$MESSAGE"; then echo "PAS DE COMMIT : le message porte encore un repère à remplir"; exit 1; fi
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --incremental --tsBuildInfoFile D:/lume-final/sorties/u/tsbuildinfo > D:/lume-final/sorties/u/tsc.log 2>&1 \
  || { echo "tsc failed" >> "$JOURNAL"; head -20 D:/lume-final/sorties/u/tsc.log; }
npx vitest run --maxWorkers=1 --testTimeout=90000 --silent=true "$@" 2>&1 \
  | grep -E "×|FAIL|failed|Failed|Error|Tests  |Test Files  " >> "$JOURNAL"
cat "$JOURNAL"
if grep -q "FAIL\|failed\|Failed\|Error" "$JOURNAL"; then echo "PAS DE COMMIT"; exit 1; fi
if ! grep -q "Tests  " "$JOURNAL"; then echo "PAS DE COMMIT (aucun test lancé)"; exit 1; fi
git add -A src server tests scripts/qa/finale/u && git commit -q -F "$MESSAGE" && git log --oneline -1
