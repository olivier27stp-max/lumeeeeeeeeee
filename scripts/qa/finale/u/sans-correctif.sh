#!/usr/bin/env bash
# Prouve qu'un test de régression ÉCHOUE sans le correctif : met de côté les
# modifications non commitées de src/ et server/ (un patch, jamais `git stash` :
# la pile de stash est partagée entre worktrees), lance les tests donnés, puis
# remet le correctif — même si les tests échouent.
#
#   bash scripts/qa/finale/u/sans-correctif.sh <fichier de test> [-t "nom"]
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
PATCH="$(mktemp -t u-correctif-XXXXXX.patch)"
git diff --binary -- src server > "$PATCH"
if [ ! -s "$PATCH" ]; then echo "aucune modification de src/ ou server/ à retirer"; exit 2; fi
git apply -R --whitespace=nowarn "$PATCH" || { echo "retrait du correctif impossible"; exit 2; }
npx vitest run --maxWorkers=1 "$@" 2>&1 | tail -25
git apply --whitespace=nowarn "$PATCH" || { echo "!!! REMISE DU CORRECTIF IMPOSSIBLE — patch gardé : $PATCH"; exit 3; }
rm -f "$PATCH"
echo "— correctif remis —"
